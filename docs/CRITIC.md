# Critical Review — HSK MCP Server Implementation Plan v1

> **Date:** 2026-04-11. Reviews `PLAN.md` in this directory. All numbered references point to sections of that plan.

## 1. Verdict

**Ship with fixes.** The plan is unusually thorough for a solo 1–2 week project and the bones are right: stateless `createMcpHandler` on Workers, D1 + FTS5, decisions list pre-resolved. But it contains at least two **factually outdated config claims** (rate-limit binding syntax, and a Rate Limit free-tier assumption that isn't validated), several **MCP spec correctness gaps** (Streamable HTTP requires GET, not just POST; `outputSchema` only landed in 2025-06-18 so protocol-version pinning matters), and one **load-bearing architectural smell** (unbounded plaintext `offset` in the cursor, plus FTS5 shadow-column sync isn't spelled out). None of these kill the design, but several will silently break Phase 1 if not fixed before coding. Scope (12 tools in ~7–10 days) is aggressive; the owner has chosen to ship all 12 anyway — plan accordingly.

## 2. Must-fix before Phase 1

### 2.1 `[[unsafe.bindings]]` for rate limiting is outdated syntax
The plan's `wrangler.toml` uses:
```toml
[[unsafe.bindings]]
name = "RL"
type = "ratelimit"
```
Per the current Cloudflare docs (`developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/`), the Rate Limiting binding has graduated out of `unsafe` and is now its own top-level block:
```toml
[[ratelimits]]
name = "RL"
namespace_id = "1001"
  [ratelimits.simple]
  limit = 60
  period = 60
```
**Fix:** update section B's wrangler snippet and add a Phase 0 spike line item "S0.8 confirm ratelimit binding syntax and free-tier availability against current docs."

### 2.2 Rate-Limit binding free-tier availability is unverified
The plan assumes `env.RL.limit(...)` just works on the Workers Free plan. Cloudflare's rate-limit docs do not list the binding as free-tier in the pricing page, and I couldn't find an authoritative "yes, free tier" statement. If it turns out to be Paid-only, the whole rate-limit middleware is dead on arrival.
**Fix:** verify in Phase 0. Mitigation if not free: fall back to a tiny in-Worker sliding window using the Cache API or a KV counter (KV is free but eventually consistent — fine for abuse-prevention keyed on IP). Do not gate launch on a feature you haven't confirmed is on your plan.

### 2.3 Streamable HTTP is POST **and** GET — the plan says POST only
Section B describes "request lifecycle for `lookup_hsk_word` … JSON-RPC parse" and implies a single `POST /mcp`. Per MCP spec 2025-03-26 (and preserved in 2025-06-18), a Streamable HTTP server **MUST support both POST and GET on the MCP endpoint**. GET is how the client opens a server-to-client SSE stream for out-of-band notifications, resumability, and cancellation. `createMcpHandler` from `agents/mcp` handles this for you, so in practice the risk is in the plan's *description* and any hand-rolled routing — make sure the Worker's `fetch` does not 405 on GET `/mcp`.
**Fix:** delete the "POST /mcp only" phrasing. Route all methods to `createMcpHandler(server)(req, env, ctx)` and let the handler decide. Add an integration test that issues a GET and expects 200 + `text/event-stream`.

### 2.4 `outputSchema` + `structuredContent` are only stable as of MCP 2025-06-18
The plan repeatedly promises "`structuredContent` matching `outputSchema`" as a Phase 1 exit criterion (section C and G). Those fields were added in the **2025-06-18** revision, not 2025-03-26. You must:
- Pin `@modelcontextprotocol/sdk` to a version that speaks 2025-06-18.
- Advertise protocolVersion 2025-06-18 in the server's `initialize` response (and confirm `createMcpHandler` does this — the Cloudflare docs page for `createMcpHandler` doesn't spell out which protocolVersion it negotiates by default).
- Always also emit a text-content block with the JSON-serialized result, per the spec's "SHOULD also return … in a TextContent block" backwards-compat clause. The plan's shape `{content:[{type:"text",...}], structuredContent:entry}` is right; just make sure the text block is the serialized `entry`, not a prose summary.
**Fix:** add to the launch checklist: "server initialize handshake negotiates 2025-06-18; structuredContent mirrored into a text block."

### 2.5 Cursor: `offset` is plaintext and unbounded
Section B defines the cursor as `base64url({o: offset, h: sha256(canonicalJSON(args)).slice(0,16)})`. Two separate issues:
1. **No offset cap.** A malicious (or confused) client can pass `o: 10_000_000`, and your handler will issue `LIMIT 20 OFFSET 10_000_000` to D1. D1 has to walk all those rows — cheap CPU on the Worker, expensive rows-read on your daily cap, and directly blows the "<10% free-tier rows_read" success criterion.
2. **Hash integrity isn't integrity.** The hash only proves the cursor was *originally minted* for these args; it doesn't stop replay, and sha256 truncated to 16 chars (64 bits) is fine for a non-security check but the plan calls it "rejects reuse across queries" which it doesn't — it rejects *cross-query* reuse, not *within-query* offset tampering.
**Fix:** (a) enforce `offset ≤ total_rows_of_underlying_query` or cap at e.g. 2000 — if exhausted, return `nextCursor: null`. (b) switch to keyset pagination where feasible (`WHERE id > ?1 ORDER BY id LIMIT ?2`) — for `words_by_radical` and `hsk_diff` this is trivial and eliminates the `OFFSET` cost entirely. (c) HMAC the cursor with a Worker secret if you want tamper-evidence; sha256 of the args alone is fine for a stateless sanity check, just don't oversell it.

### 2.6 FTS5 shadow-column sync is not specified
The plan declares `forms_fts` as `content='forms', content_rowid='id'` and says "Seed populates `gloss_en` with meanings joined ` | `". With `content=` (external content), **FTS5 does not auto-sync**: you must either (a) insert into the FTS table explicitly during seed, or (b) create `AFTER INSERT/UPDATE/DELETE` triggers on `forms` that `INSERT INTO forms_fts(rowid, gloss_en, pinyin_plain) VALUES (new.id, ..., ...)`. The plan mentions neither.
Also: `gloss_en` and `pinyin_plain` are described as "shadow columns" but they're not columns in the `forms` table — they're derived values. With `content='forms'`, FTS5 expects the column names in the FTS5 declaration to match real columns in `forms`. Either (i) add physical `gloss_en`/`pinyin_plain` columns to `forms`, populated at seed time, or (ii) drop `content='forms'` and use a standalone contentless FTS5 table.
**Fix:** pick one strategy, document it in `sql/schema.sql`, and add an integration test that updates a row and verifies the FTS index still returns it.

### 2.7 `pinyin_plain` in a `unicode61`-tokenized FTS column will not behave as a user expects
"ni hao" and "nǐ hǎo" both become `ni hao` after tone-stripping, which is fine, but `unicode61` tokenizes on whitespace, so a query for `nihao` (no space — by far the most common way users type it) will **not** match `ni hao`. Separately, FTS5 full-word matching won't match `ni*` against `ni1` unless you use prefix queries.
**Fix:** either (a) store a second column `pinyin_concat` with spaces removed and tokenize that with `trigram`, or (b) normalize the query server-side — if the query has no spaces, split it into syllables (there are ~410 valid Mandarin syllables; a greedy tokenizer is ~30 lines) before handing to FTS5. Option (a) is simpler, costs ~5% more DB size, and you already have a trigram table for hanzi. Decision #4 should be revisited.

## 3. Should-fix in Phase 1

### 3.1 The "<5ms CPU" budget is a claim, not a guarantee
Section B asserts "Budget <5ms CPU" and G asserts "Worker CPU p95 <8ms". Nothing in Phase 0 measures this for the realistic hot-path tools (`search_by_meaning` with FTS5, `suggest_next_words` with JOIN on `known_words` and frequency sort). S0.5 benchmarks "5 queries <10ms CPU" but doesn't say which queries. Add explicit Phase 0 benchmarks for the two heaviest tools against the real seeded DB, and include the wrangler dev --remote numbers, not local-only.

### 3.2 Polyphone stability: `(headword_id, form_index)` is not a stable public key
Decision #5 groups polyphones under `headword_id` with `form_index` as the ordering key. But the upstream dataset `drkameleon/complete-hsk-vocabulary` can reorder `forms[]` between versions (nothing in the JSON constrains order). If your cursor or `find_polyphones` response exposes `form_index` and the user pins it, re-seeding breaks references.
**Fix:** either derive a stable form key from `(simplified, traditional, pinyin_plain)` hash, or mark `form_index` as "not stable across dataset versions" in the schema doc and use it only internally.

### 3.3 CORS, almost certainly needed
Not mentioned anywhere. MCP Inspector and browser-embedded MCP clients (Claude's web, plus future in-browser clients) send preflight `OPTIONS` and require `Access-Control-Allow-Origin`, `Access-Control-Allow-Methods: GET, POST, OPTIONS`, `Access-Control-Allow-Headers: content-type, mcp-session-id, mcp-protocol-version`. Must-handle, and `createMcpHandler` does not (to my knowledge) add CORS for you. Add a thin CORS middleware before the MCP handler.

### 3.4 `.well-known/mcp` (and `.well-known/oauth-protected-resource`) discovery
The plan doesn't mention either. Directory submissions (Anthropic Connectors, Glama, Smithery, mcp.so) increasingly probe `.well-known/mcp.json` for capabilities. Even for an authless server, returning a static JSON at `/.well-known/mcp` (or `/.well-known/mcp.json` — the SEP isn't final but `mcp.json` is winning) is 15 lines and strictly helps discoverability. For `/.well-known/oauth-protected-resource`: skippable since you're authless, but if any client requires it you can return a minimal doc.

### 3.5 CI, secrets, deploy — named, not gestured at
"Apply via `wrangler d1 execute --file=sql/seed.sql` in CI on push to main" is the only CI mention. No workflow file is listed in the directory layout (`.github/workflows/*` missing). No mention of `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` as GitHub secrets. No mention of seed idempotency (does re-running wipe the DB, or does it ON CONFLICT?). Seed files are not idempotent by default, so a second CI run will fail on PK collisions.
**Fix:** add `.github/workflows/deploy.yml` to directory layout, document the two secrets, and make the seed start with `DROP TABLE IF EXISTS ...; CREATE TABLE ...;` or use `INSERT OR REPLACE`. Also: `wrangler d1 execute --file=` is limited to 5 GiB files and batches statements in groups of 10,000 — a 9.2 MB dataset with ~11,470 headwords + ~12–15k forms is fine, but a single `INSERT` per row might yield 25k+ statements which D1 will auto-batch. Benchmark seed apply time and add it to Phase 0.

### 3.6 Graceful degradation on D1 outage
No plan item. If D1 returns an error, the Worker should return a JSON-RPC error with code `-32603` ("Internal error") rather than throwing. Wrap every tool handler in try/catch, log the original error, return a sanitized message.

### 3.7 Dataset versioning in responses
The plan says "pinned SHA" for upstream drift mitigation but no tool or resource response carries a `dataset_version` field. Callers caching results have no way to invalidate. Add a single string (`env.DATASET_VERSION` from wrangler vars, set to upstream SHA) to every response's `structuredContent._meta.dataset_version`, or expose `hsk://meta` as a resource.

### 3.8 Cost tripwire and cap monitoring
Good news: Workers Free simply starts returning 5xx at 100k req/day — there is no surprise billing — so "tripwire" is built-in. The plan's alert at 80% cap is good. But: the rate limit is 60/min/IP, meaning a single abusive IP can burn 86,400 requests/day (60×60×24) — 86% of your daily cap from one IP. Lower to 30/min/IP, or add a daily per-IP cap (KV counter), or both.

### 3.9 Scope: 12 tools in 7–10 days solo is risky
Phase 0 has 7 spikes inside 1–2 days; Phase 1 has 6 tools + staging + Inspector + unit tests >80% in 3–4 days; Phase 2 adds 6 more tools + domain + rate-limit hardening + observability + directory submissions in 3–4 days. The most likely blow-ups: (a) FTS5 Chinese tokenization bikeshedding in Phase 0 eats 2 extra days; (b) MCP Inspector in CI is flakier than the plan implies; (c) directory submission review latency is weeks, not the day the form is filed. **Recommendation (owner overrode):** ship v1 with the MVP-6 tools only. Owner has chosen to keep all 12 — treat the timeline as best-case and add slack.

## 4. Nice-to-fix in Phase 2

- **Localization disclosure:** the README and every tool description should explicitly say "meanings are English-only." Callers will assume otherwise.
- **Empty-result convention:** document once — "not found" returns `content: [{type:'text', text:'No results.'}], structuredContent: {results: []}`, not an error. The plan is silent.
- **Tool schema versioning:** bump `serverInfo.version` on breaking changes; document "we follow semver on tool outputSchemas." No current mention.
- **Discoverability of the server itself:** the README needs a one-liner `{"url":"https://hsk-mcp.linsnotes.com/mcp"}` JSON for users to paste into Claude Desktop / Claude Code / other clients. The plan says "tool catalog + example prompts" but not the actual connection string.
- **Attribution:** check the upstream `drkameleon/complete-hsk-vocabulary` LICENSE on GitHub. If it's MIT, just copy the notice. If it derives from a CC-BY source (HSK word lists are published by China's MoE/Hanban but the specific normalizations in this dataset may have different provenance), surface that in ATTRIBUTION.md. Hanban's raw HSK word lists are not copyrightable in most jurisdictions (facts), but the curated JSON structure is.
- **Backup:** D1 supports `wrangler d1 export` to a SQL dump. Add a monthly CI job that exports and commits to a `backups/` branch. Free-tier compatible.
- **WAF backstop:** `cf.threat_score > 10` is mentioned but not configured via Terraform or documented as a manual dashboard step. Make it a launch-checklist line item.

## 5. Spot-checks performed

- **`[[unsafe.bindings]]` for rate limit:** **outdated.** Current syntax is `[[ratelimits]]` with a nested `[ratelimits.simple]` table. Older `[[unsafe.bindings]]` form may still work but the docs no longer recommend it. (`developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/`)
- **FTS5 trigram tokenizer on D1:** **confirmed working.** Community reports and tutorials show `CREATE VIRTUAL TABLE … USING fts5(… tokenize='trigram')` running in D1 for Japanese/Chinese substring search as of 2024. Decision #4 is safe.
- **`createMcpHandler` export path:** **confirmed** — it's exported from `agents/mcp`, not the top-level `agents`. Import is `import { createMcpHandler } from "agents/mcp"`. Plan doesn't specify the subpath; make sure the actual code uses `agents/mcp`.
- **Streamable HTTP requires GET:** **confirmed.** Spec (modelcontextprotocol.io/specification/2025-03-26/basic/transports) says the endpoint MUST support both POST and GET. Plan description is misleading.
- **`outputSchema` / `structuredContent`:** **confirmed** — added in 2025-06-18 revision (not 2025-03-26). Plan must pin SDK accordingly.
- **`custom_domain = true` in routes:** **confirmed current** per Cloudflare's routing docs.
- **Workers free tier overage behavior:** **confirmed** — at 100k req/day the Worker returns 5xx until UTC midnight; no surprise billing. Plan's alert-at-80% is adequate, but single-IP 60/min burn analysis is still valid.
- **`wrangler d1 execute --file` limits:** 5 GiB file cap, auto-batches in groups of 10k statements. A 9.2 MB JSON → ~25k statements is within limits; expect multiple batch commits, not one.
- **Custom URI schemes in MCP resources:** **allowed** per spec (any RFC 3986-valid scheme). `hsk://` is fine. Note: `@modelcontextprotocol/sdk` uses the JS `URL` constructor, which handles unknown schemes inconsistently — test `hsk://level/1` parsing before relying on it.
- **`.well-known/mcp` discovery:** **not final**, but a real SEP is in flight and some directory aggregators probe it. Low-cost to add a static stub.

## 6. Unanswered questions

1. Has the architect verified `env.RL.limit()` is actually callable on Workers Free? If not, what's the fallback design?
2. Which protocolVersion does `createMcpHandler` (current `agents/mcp` release) advertise in the initialize response by default — 2025-03-26 or 2025-06-18? If the former, `outputSchema` won't be accepted by strict clients.
3. Is `drkameleon/complete-hsk-vocabulary`'s license actually MIT, and does it re-license any upstream (CC-BY-SA or government-sourced) material? ATTRIBUTION.md can't be written without this.
4. What's the intended behavior when a user passes `limit=100, cursor=<offset 9000>` against a query with 9050 results? Does the last page return 50 and `nextCursor: null`, or 50 and a cursor that errors on next call? Spec this.
5. Are the 12 tool names final, or negotiable? (Owner: yes, all 12 final.)
6. Where does `env.DATASET_VERSION` come from — build-time injection, wrangler var, or a row in the DB? Decide before seeding.
7. Is there any intent to support Chinese-language *meaning queries* (e.g., user asks in Chinese), or strictly English glosses? If strictly English, state it in every tool description.

**Sources**
- [Cloudflare Rate Limit binding docs](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
- [createMcpHandler reference](https://developers.cloudflare.com/agents/api-reference/mcp-handler-api/)
- [MCP 2025-03-26 Transports spec](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports)
- [MCP tools & structuredContent](https://modelcontextprotocol.io/specification/draft/server/tools)
- [Cloudflare D1 import/export limits](https://developers.cloudflare.com/d1/best-practices/import-export-data/)
- [Workers free-tier overage behavior](https://community.cloudflare.com/t/workers-free-plan-behavior-if-limit-is-reached/92012)
- [Wrangler custom_domain routing](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
- [D1 FTS5 trigram community thread](https://community.cloudflare.com/t/add-tokenizers-that-support-cjk-chinese-japanese-korean-search/445474)
- [.well-known/mcp SEP discussion](https://github.com/modelcontextprotocol/modelcontextprotocol/issues/1960)
