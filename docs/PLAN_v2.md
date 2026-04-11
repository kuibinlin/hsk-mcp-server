# HSK MCP Server — Implementation Plan v2

> **Status:** Supersedes `PLAN.md`. Folds in all 7 must-fixes and most should-fixes from `CRITIC.md`. This is the document to implement against.
>
> **Owner decisions locked:**
> - Subdomain: `hsk-mcp.linsnotes.com`
> - v1 scope: all 12 tools at launch
> - CI: GitHub Actions
> - Testing: agent-driven (Claude Code / MCP Inspector) during implementation and QA
>
> **Defaults applied (owner-approved):**
> 1. Rate-limit fallback: if Workers Rate Limiting binding isn't free-tier, fall back to a KV counter keyed on IP.
> 2. Dataset version: `DATASET_VERSION` injected as a wrangler `vars` at build time, value = upstream drkameleon commit SHA.
> 3. Meaning search is English-only — documented in every tool's description.
> 4. Cursor strategy: keyset pagination (`WHERE id > ?`) where trivially possible; elsewhere cap `offset ≤ 2000`.
>
> **Attribution:** dataset is `drkameleon/complete-hsk-vocabulary` (MIT). Pinned commit SHA verified and written to `ATTRIBUTION.md` + `DATASET_VERSION` env var.

---

## A. Resolved decisions (v2)

**1. Subdomain: `hsk-mcp.linsnotes.com`.** Explicit and self-describing; leaves room for sibling MCP servers (e.g. `cedict-mcp.linsnotes.com`) under the same apex.

**2. Template strategy: scaffold fresh via `npm create cloudflare@latest hsk-mcp`, skip the demo template fork.** Critic S0.1 spike showed the `remote-mcp-authless` template is DO + SSE and would need to be gutted; faster to start clean.

**3. Pagination: keyset where possible, bounded offset elsewhere.**

- **Keyset-capable tools** (`words_by_radical`, `find_polyphones`, `build_study_set`, `hsk://level/{n}` resources): cursor = `{last_id: number, q_hash: string}`. Query: `WHERE id > ?1 ORDER BY id LIMIT ?2`. Zero offset cost on the DB side; scales to any dataset size.
- **Ranked tools** (`search_by_meaning` FTS ranked, `suggest_next_words` frequency-ranked, `homophone_drill`): cursor = `{offset: number, q_hash: string}` with **hard cap `offset ≤ 2000`**. If a query's keyset ordering doesn't match its user-visible ranking, keyset is wrong. Offset cap protects D1 `rows_read` budget.
- `q_hash = sha256(canonical_json(tool_args)).slice(0, 16)`. Cursor whose hash doesn't match current args → `InvalidParams` error. Cursor body signed via HMAC-SHA256 with `env.CURSOR_SECRET` (wrangler secret) to prevent tampering.
- `limit` default 20, max 100. Response shape: `{ items: [...], next_cursor: string|null }`.
- Encoded as `base64url(JSON.stringify({v: 1, body: {...}, sig: "..."}))`.

**4. FTS5 tokenization: three separate FTS5 tables with physical shadow columns.**

Physical columns live on `forms` (not derived), populated by the seed script:
- `gloss_en TEXT` — meanings joined with ` | `
- `pinyin_plain TEXT` — tone-marks-stripped lowercased with spaces (e.g. `"a yi"`)
- `pinyin_concat TEXT` — same but **spaces removed** (e.g. `"ayi"`)
- `hanzi_concat TEXT` — simplified + traditional concatenated with a space

Three FTS5 virtual tables, all **contentless** (`content=''`) — explicit inserts from the seed script, plus triggers on `forms` for future-proofing (not exercised in v1 since dataset is read-only):

```sql
CREATE VIRTUAL TABLE gloss_fts USING fts5(gloss_en, tokenize='unicode61 remove_diacritics 2');
CREATE VIRTUAL TABLE pinyin_fts USING fts5(pinyin_concat, tokenize='trigram');
CREATE VIRTUAL TABLE hanzi_fts USING fts5(hanzi_concat, tokenize='trigram');
```

Each FTS5 table's `rowid` mirrors `forms.id`. Seed script does:
```sql
INSERT INTO gloss_fts(rowid, gloss_en)     VALUES (?, ?);
INSERT INTO pinyin_fts(rowid, pinyin_concat) VALUES (?, ?);
INSERT INTO hanzi_fts(rowid, hanzi_concat)  VALUES (?, ?);
```
per row. Triggers on `forms` kept minimal (AFTER INSERT only) — for future dataset refreshes.

This decision lets:
- `search_by_meaning("aunt")` hit `gloss_fts` (English FTS).
- `homophone_drill("yi")` and `search_by_pinyin("nihao")` hit `pinyin_fts` (trigram; `"nihao"` matches `"ayi"`? no — but `"nihao"` matches `"nihaoma"`, and **crucially** the lack-of-space form is queryable directly. For typed-with-spaces input like `"ni hao"` we strip spaces before querying).
- `lookup_hsk_word("阿姨")` go through the `simplified` UNIQUE index first, falling back to `hanzi_fts` for substring/partial queries.

**Phase 0 spike S0.4 verifies trigram tokenizer availability.** If missing, fall back to a bigram shadow column built at seed time (character-pair concatenation) using default unicode61.

**5. Polyphone representation: one row per `form`, grouped by `headword_id`, identified externally by a stable hash key.**

- `headwords(id, simplified, radical, level_tags, frequency, pos_tags, old_level, new_level, ...)` — one row per headword, UNIQUE on `simplified`.
- `forms(id, headword_id, form_index, form_key, traditional, pinyin, pinyin_plain, pinyin_concat, numeric, wadegiles, bopomofo, romatzyh, meanings_json, classifiers_json, gloss_en, hanzi_concat)` — one row per pronunciation.
- **`form_key` is the public stable identifier**: `sha256(simplified + "|" + traditional + "|" + pinyin_plain).slice(0,12)`. Survives dataset re-seeds and reorderings. This is what tool outputs expose; `form_index` is internal only.

**6. `suggest_next_words` ranking: pure frequency ASC, tie-broken by radical novelty.** Unchanged from v1 plan.

**7. Frequency `1,000,000` sentinel: exposed as `frequency_rank: null` + `frequency_rarity: "off_chart"`.** Unchanged. Phase 0 spike S0.6 confirms value from upstream source before seeding.

**8. v1 tool-set: all 12 tools at launch.** Owner override of critic's MVP-6 recommendation. Timeline has no built-in slack; scope cuts (`compare_words`, `build_study_set` first) triggered only if Phase 0 blows up.

**9. Shared `HskEntry` shape** (declared once in `src/schemas/hskEntry.ts`, referenced by every tool's `outputSchema`):

```json
{
  "simplified": "阿姨",
  "radical": "阝",
  "levels": { "new": 4, "old": 3, "tags": ["new-4", "old-3"] },
  "frequency_rank": 4355,
  "frequency_rarity": "common",
  "pos": ["n"],
  "forms": [
    {
      "form_key": "a3f1c9d8e2b4",
      "traditional": "阿姨",
      "transcriptions": {
        "pinyin": "ā yí",
        "numeric": "a1 yi2",
        "wadegiles": "a¹ i²",
        "bopomofo": "ㄚ ㄧˊ",
        "romatzyh": "a yi"
      },
      "meanings": ["maternal aunt", "..."],
      "classifiers": ["个"]
    }
  ],
  "_meta": {
    "dataset_version": "<drkameleon commit SHA>"
  }
}
```

`levels.new` / `levels.old` are `1..7` / `1..6` or `null`. `frequency_rarity` is `"common" | "off_chart"`. `form_key` replaces the old `form_index` for external identity.

**10. Deployment: seed committed as `sql/seed.sql`, applied via GitHub Actions on push to `main`.** Workflow: `scripts/build-seed.ts` regenerates `seed.sql` from `complete.json` → seed starts with `DROP TABLE IF EXISTS ...` for idempotency → `wrangler d1 execute DB --remote --file=sql/seed.sql`. GH Actions secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.

---

## A'. v2-only additions (from critic)

**A'.1 MCP protocol version: pin to 2025-06-18.** `outputSchema` + `structuredContent` only landed in that revision. Plan:
- Pin `@modelcontextprotocol/sdk` to the version that speaks `2025-06-18`.
- Verify `createMcpHandler` (from `agents/mcp`) advertises this protocol version in its `initialize` response — if not, configure it explicitly.
- Every tool response includes both `structuredContent: entry` AND a mirrored `content: [{type: "text", text: JSON.stringify(entry, null, 2)}]` block per the spec's backwards-compat clause.

**A'.2 Transport: Streamable HTTP MUST support POST and GET at `/mcp`.** GET opens the server→client SSE stream. Router delegates all methods on `/mcp` to `createMcpHandler(server)(req, env, ctx)`. Integration test issues GET and expects `200 text/event-stream`.

**A'.3 CORS middleware** wraps the MCP handler. Returns:
```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: content-type, mcp-session-id, mcp-protocol-version, authorization
Access-Control-Max-Age: 86400
```
Handles `OPTIONS` preflight with a 204 before MCP handler runs.

**A'.4 `.well-known/mcp.json`** static JSON served from Worker (15 lines). Fields: `name`, `description`, `url`, `protocolVersion`, `contact`, `license`, `server_info.version`, capability hints. Not final spec — best-effort for directory crawlers.

**A'.5 Rate limiting: layered, with KV fallback.**
- Primary: Workers Rate Limiting binding `env.RL.limit({key: cf-connecting-ip})` — **30 req/min/IP** (lowered from 60 per critic §3.8; single IP can now burn max 43,200/day = 43% of free-tier cap vs 86%).
- Phase 0 spike S0.8 verifies the binding is free-tier. If not: fall back to a KV counter: `kv.get("rl:<ip>:<minute>")` + `kv.put(...)`. KV free tier (100k reads / 1k writes per day) is tight — deployed with a 10-min eventually-consistent bucket to keep writes low.
- Plus daily per-IP cap: KV counter `rl:daily:<ip>` capped at 5000/day. KV write cost: max 1 per IP per day.
- WAF custom rule `cf.threat_score > 10` backstop (manual dashboard setup, launch-checklist item).

**A'.6 Graceful D1 outage:** every tool handler wrapped in try/catch. D1 error → log original → return JSON-RPC error `-32603` with sanitized message `"Dataset temporarily unavailable"`. `isError: true` on the content block.

**A'.7 Empty-result convention:** not-found or zero-match returns `{ content: [{type: "text", text: "No results."}], structuredContent: { items: [], next_cursor: null } }`. No JSON-RPC error — empty is a valid outcome.

**A'.8 Tool description disclaimers:** every tool description mentions the English-only meanings constraint where relevant, and the English-focused gloss search. Template phrase: *"Meanings are in English. For Chinese-language queries, use the hanzi/pinyin search tools instead."*

**A'.9 Dataset version surfaced:** `env.DATASET_VERSION` wrangler var (build-time, upstream commit SHA). Every `structuredContent` carries `_meta.dataset_version`. Separate `hsk://meta` resource returns `{dataset_version, tool_count, headword_count, form_count, generated_at}`.

**A'.10 CI/CD spec (GitHub Actions):**

```
.github/workflows/
├── ci.yml       # PR: typecheck, test, build-seed dry-run
├── deploy.yml   # push to main: build-seed, wrangler deploy, wrangler d1 execute --remote --file=sql/seed.sql
└── backup.yml   # monthly cron: wrangler d1 export → commit to backups/ branch
```

Required secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`. Seed is idempotent (DROP → CREATE → INSERT) so re-runs are safe. Deploy verifies staging `*.workers.dev` before promoting to custom domain.

---

## B. Target architecture

### Component diagram

```
Claude client ──HTTPS──▶ CF edge (hsk-mcp.linsnotes.com)
                             │
                             ▼
                ┌─────────────────────────────┐
                │  Worker (hsk-mcp)           │
                │  ┌───────────────────────┐  │
                │  │ CORS middleware       │  │
                │  │ Rate-limit middleware │  │
                │  │ (RL binding OR KV)    │  │
                │  │ Error wrapper         │  │
                │  └──────────┬────────────┘  │
                │             ▼               │
                │  ┌───────────────────────┐  │
                │  │ createMcpHandler      │  │
                │  │  ─ POST/GET /mcp      │  │
                │  │  ─ tool dispatcher    │  │
                │  │  ─ cursor codec       │  │
                │  │  ─ shape helpers      │  │
                │  └──────────┬────────────┘  │
                │             │               │
                │ Also: GET /healthz          │
                │       GET /.well-known/mcp  │
                └─────────────┼───────────────┘
                              │ prepared stmts
                              ▼
                         ┌─────────┐
                         │   D1    │
                         │ hsk_db  │
                         └─────────┘
                              │
                         ┌─────────┐
                         │   KV    │  (rate-limit fallback + daily cap)
                         │ hsk_rl  │
                         └─────────┘
```

### Request lifecycle — `lookup_hsk_word("阿姨")`

1. Request lands at Worker. CORS preflight shortcuts here if `OPTIONS`.
2. Rate-limit middleware reads `cf-connecting-ip`. Primary: `env.RL.limit({key})`; Fallback: KV counter `rl:<ip>:<window>`. Plus daily cap check `rl:daily:<ip>`. Over → 429 + `Retry-After`.
3. `createMcpHandler(server)(req, env, ctx)` parses JSON-RPC envelope. Routes `tools/call` → `lookupHskWord`.
4. Tool handler validates args against Zod `inputSchema`.
5. Handler runs inside a try/catch. Issues two prepared stmts: `SELECT * FROM headwords WHERE simplified = ?1 LIMIT 1`, then if found `SELECT * FROM forms WHERE headword_id = ?1 ORDER BY form_index`.
6. Rows shaped into `HskEntry` via `shapeHskEntry(headword, forms, env)` — attaches `_meta.dataset_version = env.DATASET_VERSION`.
7. Response: `{ content: [{type: "text", text: JSON.stringify(entry, null, 2)}], structuredContent: entry }`.
8. Error path: D1 error → JSON-RPC `-32603`; not found → `content: [{type:"text", text:"No results."}], structuredContent: {items: [], next_cursor: null}`; invalid args → JSON-RPC `-32602`.

### Directory layout

```
/Users/kuibin/Code/hsk-mcp-server/
├── complete.json                         # upstream snapshot, pinned SHA
├── wrangler.toml
├── package.json
├── tsconfig.json
├── biome.json
├── README.md                             # tool catalog, connection string, attribution
├── LICENSE                               # MIT
├── ATTRIBUTION.md                        # drkameleon upstream + SHA
├── .github/
│   └── workflows/
│       ├── ci.yml
│       ├── deploy.yml
│       └── backup.yml
├── scripts/
│   ├── build-seed.ts                     # complete.json → sql/seed.sql
│   └── verify-dataset.ts                 # sanity checks before seeding
├── sql/
│   ├── schema.sql                        # DDL
│   └── seed.sql                          # generated, committed, idempotent
├── src/
│   ├── index.ts                          # fetch handler, router
│   ├── mcp.ts                            # createMcpHandler wiring
│   ├── middleware/
│   │   ├── cors.ts
│   │   ├── rateLimit.ts                  # RL binding + KV fallback
│   │   └── errorWrap.ts
│   ├── cursor.ts                         # keyset + bounded-offset, HMAC-signed
│   ├── db.ts                             # prepared stmt wrappers
│   ├── shape.ts                          # row → HskEntry
│   ├── pinyin.ts                         # tone strip, concat, normalize
│   ├── wellKnown.ts                      # /.well-known/mcp.json
│   ├── schemas/
│   │   ├── hskEntry.ts                   # shared shape
│   │   └── tools.ts                      # per-tool Zod in/out
│   ├── tools/
│   │   ├── lookupHskWord.ts
│   │   ├── convertScript.ts
│   │   ├── searchByMeaning.ts
│   │   ├── wordsByRadical.ts
│   │   ├── buildStudySet.ts
│   │   ├── suggestNextWords.ts
│   │   ├── compareWords.ts
│   │   ├── findPolyphones.ts
│   │   ├── homophoneDrill.ts
│   │   ├── frequencyRank.ts
│   │   ├── hskDiff.ts
│   │   ├── classifierFor.ts
│   │   └── index.ts                      # registry + defineTool helper
│   └── resources/
│       ├── levelLists.ts                 # hsk://level/{1..7}
│       └── meta.ts                       # hsk://meta
└── test/
    ├── unit/
    │   ├── cursor.test.ts
    │   ├── pinyin.test.ts
    │   ├── shape.test.ts
    │   ├── cors.test.ts
    │   └── tools/*.test.ts
    └── integration/
        ├── mcp-inspector.sh              # scripted tools/list + per-tool calls
        └── streamable-http.test.ts       # GET /mcp returns 200 text/event-stream
```

### `wrangler.toml` key bindings (v2)

```toml
name = "hsk-mcp"
main = "src/index.ts"
compatibility_date = "2026-04-01"
compatibility_flags = ["nodejs_compat"]

[vars]
DATASET_VERSION = "<filled-at-build-time>"

[observability]
enabled = true

[[d1_databases]]
binding = "DB"
database_name = "hsk_db"
database_id = "<filled-after-create>"

[[kv_namespaces]]
binding = "RL_KV"
id = "<filled-after-create>"

[[ratelimits]]
name = "RL"
namespace_id = "1001"
  [ratelimits.simple]
  limit = 30
  period = 60

[[routes]]
pattern = "hsk-mcp.linsnotes.com"
custom_domain = true
```

Secrets (via `wrangler secret put`): `CURSOR_SECRET` (HMAC key for cursor signing).

### D1 schema (`sql/schema.sql`) — v2

```sql
-- Idempotent seed header
DROP TABLE IF EXISTS gloss_fts;
DROP TABLE IF EXISTS pinyin_fts;
DROP TABLE IF EXISTS hanzi_fts;
DROP TABLE IF EXISTS forms;
DROP TABLE IF EXISTS headwords;

CREATE TABLE headwords (
  id INTEGER PRIMARY KEY,
  simplified TEXT NOT NULL,
  radical TEXT NOT NULL,
  frequency INTEGER NOT NULL,
  frequency_rank INTEGER,
  frequency_rarity TEXT NOT NULL CHECK (frequency_rarity IN ('common','off_chart')),
  pos_tags TEXT NOT NULL,
  level_tags TEXT NOT NULL,
  new_level INTEGER,
  old_level INTEGER
);
CREATE UNIQUE INDEX idx_headwords_simplified ON headwords(simplified);
CREATE INDEX idx_headwords_radical ON headwords(radical);
CREATE INDEX idx_headwords_new_level ON headwords(new_level);
CREATE INDEX idx_headwords_old_level ON headwords(old_level);
CREATE INDEX idx_headwords_freq_rank ON headwords(frequency_rank);

CREATE TABLE forms (
  id INTEGER PRIMARY KEY,
  headword_id INTEGER NOT NULL REFERENCES headwords(id),
  form_index INTEGER NOT NULL,
  form_key TEXT NOT NULL UNIQUE,          -- sha256(simp|trad|pinyin_plain).slice(0,12)
  traditional TEXT NOT NULL,
  pinyin TEXT NOT NULL,
  pinyin_plain TEXT NOT NULL,             -- "a yi"
  pinyin_concat TEXT NOT NULL,            -- "ayi"
  numeric TEXT NOT NULL,
  wadegiles TEXT NOT NULL,
  bopomofo TEXT NOT NULL,
  romatzyh TEXT NOT NULL,
  meanings_json TEXT NOT NULL,
  classifiers_json TEXT NOT NULL,
  gloss_en TEXT NOT NULL,                 -- meanings joined ' | '
  hanzi_concat TEXT NOT NULL              -- simplified + ' ' + traditional
);
CREATE INDEX idx_forms_headword ON forms(headword_id);
CREATE INDEX idx_forms_pinyin_plain ON forms(pinyin_plain);
CREATE INDEX idx_forms_form_key ON forms(form_key);

-- Contentless FTS5 tables; seed populates them explicitly.
CREATE VIRTUAL TABLE gloss_fts USING fts5(
  gloss_en,
  tokenize='unicode61 remove_diacritics 2'
);
CREATE VIRTUAL TABLE pinyin_fts USING fts5(
  pinyin_concat,
  tokenize='trigram'
);
CREATE VIRTUAL TABLE hanzi_fts USING fts5(
  hanzi_concat,
  tokenize='trigram'
);
```

### Seed script (`scripts/build-seed.ts`) — shape

1. Parse `complete.json`.
2. Assert invariants (matches `verify-dataset.ts` counts: 11470 headwords, ~12092 forms, 622 polyphones, 93 sentinels).
3. Emit DDL from `schema.sql`.
4. For each headword: compute `new_level`/`old_level` from `level[]`, compute `frequency_rank` (null if sentinel), emit `INSERT INTO headwords`.
5. For each form of each headword: compute `pinyin_plain`, `pinyin_concat`, `gloss_en`, `hanzi_concat`, `form_key`, emit `INSERT INTO forms`.
6. For each form `INSERT INTO gloss_fts(rowid, gloss_en) VALUES (id, ?)`, same for `pinyin_fts` and `hanzi_fts`.
7. Wrap in a transaction per chunk of 1000 rows to keep statement counts manageable.

### Rate limiting

Middleware in `src/middleware/rateLimit.ts`:
1. Read `cf-connecting-ip`.
2. Try `env.RL.limit({key: ip})` if binding is bound; else fall back to KV.
3. KV fallback: `const key = \`rl:${ip}:${Math.floor(Date.now()/60_000)}\`; const count = Number(await env.RL_KV.get(key)) || 0; if (count >= 30) return 429; await env.RL_KV.put(key, String(count+1), {expirationTtl: 120});`
4. Daily cap: `rl:daily:${ip}:${yyyymmdd}`; cap 5000/day; write once per IP per day max.
5. Over → 429 + `Retry-After: 60`.

### Cursor codec (`src/cursor.ts`)

```ts
type KeysetCursor = { type: 'keyset'; last_id: number; q_hash: string };
type OffsetCursor = { type: 'offset'; offset: number; q_hash: string };

function sign(body: object, secret: string): string { /* HMAC-SHA256, first 16 hex */ }
function encode(body: KeysetCursor | OffsetCursor, secret: string): string {
  const sig = sign(body, secret);
  return base64url(JSON.stringify({ v: 1, body, sig }));
}
function decode(cursor: string, args: unknown, secret: string): KeysetCursor | OffsetCursor {
  // base64 decode → verify v=1 → recompute sig → compare → recompute q_hash → compare
  // offset cursors: reject if offset > 2000
  // fail modes throw JSON-RPC InvalidParams
}
```

---

## C. Phased delivery plan

### Phase 0 — Spike/verify (2 days, not 1)

Budget bumped to 2 days; critic was right that 1 day was tight.

- **S0.1 Template state** (30 min). Inspect `cloudflare/ai/demos/remote-mcp-authless`. Success: confirm decision to scaffold fresh stands.
- **S0.2 MCP spec rev** (30 min). Confirm current rev at modelcontextprotocol.io; pin SDK version; confirm `createMcpHandler` speaks 2025-06-18 protocolVersion.
- **S0.3 CF free-tier numbers** (15 min). Verify Workers 100k req/day, CPU 10 ms, D1 5 GB+5M rows/day, KV 100k reads/1k writes/day.
- **S0.4 FTS5 trigram tokenizer in D1** (30 min). Create throwaway D1, `CREATE VIRTUAL TABLE … USING fts5(x, tokenize='trigram')`. Fallback: bigram shadow column.
- **S0.5 FTS5 Chinese benchmark on hot-path tools** (90 min). Seed throwaway D1 with real `complete.json`, run 5 queries: `search_by_meaning("aunt")`, `search_by_meaning("aunt" with level filter)`, `suggest_next_words` JOIN, `homophone_drill` pinyin trigram, `words_by_radical` keyset scan. Success: each <8 ms CPU on wrangler dev --remote.
- **S0.6 Frequency sentinel** (15 min). Read drkameleon build scripts; confirm `1_000_000` semantics; record upstream commit SHA for pinning.
- **S0.7 `agents` + `createMcpHandler` smoke** (45 min). Minimal Worker with one no-op tool, `wrangler dev`, MCP Inspector. Verify `tools/list` round-trips AND that `initialize` negotiates protocolVersion 2025-06-18.
- **S0.8 Rate Limit binding free-tier check** (30 min). Try `env.RL.limit()` on a fresh free-tier account. If unavailable, KV fallback is the primary path.
- **S0.9 CORS smoke** (15 min). Hit the no-op Worker with `curl -X OPTIONS -H "Origin: https://example.com"`; verify 204 + correct headers.
- **S0.10 Seed apply time** (30 min). Apply a prototype 9 MB `seed.sql` to a throwaway D1. Success: completes within wrangler timeout; document any batching.

**Gate:** all spikes green or documented workaround before Phase 1.

### Phase 1 — Core infrastructure + 6 tools (4 days)

Scaffolding, schema, seed, shared infra, 6 core tools, staging deploy, MCP Inspector integration. Tools: `lookup_hsk_word`, `search_by_meaning`, `words_by_radical`, `find_polyphones`, `frequency_rank`, `hsk_diff`.

**Exit gate:** all 6 tools return valid MCP responses with `structuredContent`; MCP Inspector green; staging `*.workers.dev` URL live; CORS + rate limit + error wrapping verified; unit tests >80% on shared modules.

### Phase 2 — Remaining 6 tools + custom domain + launch (4 days)

Tools: `convert_script`, `build_study_set`, `suggest_next_words`, `compare_words`, `homophone_drill`, `classifier_for`. Plus: `/.well-known/mcp.json`, `hsk://meta` resource, custom domain flip, WAF backstop rule, README, directory submissions.

**Exit gate:** `hsk-mcp.linsnotes.com/mcp` live; p95 e2e <150 ms US-East; launch checklist complete; directory submissions filed.

**Total calendar time: ~10 days solo** (bumped from 7–10 per critic §3.9; no slack left).

---

## D. Work breakdown (v2)

**Phase 0 — Spikes**
1. S0.1..S0.10 per above — success criteria inline — no deps.

**Phase 1 — Scaffolding & infra**
2. `npm create cloudflare@latest hsk-mcp` → commit baseline — `wrangler.toml package.json tsconfig.json` — `wrangler dev` serves hello — [1].
3. Install deps: `agents`, `@modelcontextprotocol/sdk` (pinned), `zod`, `biome`, `vitest` — `package.json` — clean install — [2].
4. `src/index.ts` router + `src/mcp.ts` with `createMcpHandler` and one no-op tool — `src/index.ts src/mcp.ts` — Inspector `tools/list` shows 1 tool, `initialize` advertises 2025-06-18 — [3].
5. `src/middleware/cors.ts` — `src/middleware/cors.ts` — `curl -X OPTIONS` returns 204 with correct headers — [4].
6. `src/middleware/errorWrap.ts` — `src/middleware/errorWrap.ts` — throwing tool handler returns JSON-RPC -32603 — [4].
7. `src/middleware/rateLimit.ts` with RL binding + KV fallback — `src/middleware/rateLimit.ts wrangler.toml` — 31st req in a minute returns 429 — [4].
8. Create D1 `hsk_db` via wrangler — `wrangler.toml` — `wrangler d1 list` shows it — [2].
9. Create KV `hsk_rl` via wrangler — `wrangler.toml` — `wrangler kv namespace list` — [2].
10. Write `sql/schema.sql` per A.4/B — `sql/schema.sql` — `wrangler d1 execute DB --file=sql/schema.sql --local` succeeds — [8].
11. `scripts/verify-dataset.ts` — `scripts/verify-dataset.ts` — prints expected counts (11470, 622, 93) and upstream SHA — [1].
12. `src/pinyin.ts` tone-strip + concat + normalize — `src/pinyin.ts` — 20 unit tests incl. ü, capitals, multi-syllable — [3].
13. `scripts/build-seed.ts` — `scripts/build-seed.ts sql/seed.sql` — seed file <15 MB, idempotent DROP+CREATE, valid SQL — [10,11,12].
14. Apply seed locally — none — `SELECT count(*) FROM headwords` = 11470, `SELECT count(*) FROM forms` = ~12092, `SELECT count(*) FROM gloss_fts` = same — [13].
15. `src/schemas/hskEntry.ts` shared shape (Zod + JSON Schema) — `src/schemas/hskEntry.ts` — parses hand-built sample — [4].
16. `src/db.ts` + `src/shape.ts` — `src/db.ts src/shape.ts` — unit tests against seeded local D1 — [14,15].
17. `src/cursor.ts` keyset + bounded-offset + HMAC — `src/cursor.ts` — tests: round-trip, tamper reject, cross-query reject, offset>2000 reject — [4].
18. `src/tools/index.ts` `defineTool` registry helper — `src/tools/index.ts` — [15].
19. `src/wellKnown.ts` `/.well-known/mcp.json` handler — `src/wellKnown.ts` — GET returns valid JSON — [4].
20. `src/resources/meta.ts` `hsk://meta` resource — `src/resources/meta.ts` — Inspector reads meta — [18].

**Phase 1 — Core 6 tools**
21. `lookupHskWord` — `src/tools/lookupHskWord.ts` — 阿姨 returns correct entry; missing returns empty-result shape; polyphone returns all forms with `form_key` — [16,18].
22. `searchByMeaning` — `src/tools/searchByMeaning.ts` — "aunt" returns 阿姨; level filter works; offset cursor paginates; offset>2000 rejected — [16,17,18].
23. `wordsByRadical` — `src/tools/wordsByRadical.ts` — 口 radical returns expected set; keyset pagination works; max_level filter correct — [16,17,18].
24. `findPolyphones` — `src/tools/findPolyphones.ts` — 622 entries across pages via keyset — [16,17,18].
25. `frequencyRank` — `src/tools/frequencyRank.ts` — common word returns rank; sentinel word returns null + off_chart — [16,18].
26. `hskDiff` — `src/tools/hskDiff.ts` — 阿姨 returns new=4 old=3; new-only word returns old=null — [16,18].

**Phase 1 — Staging deploy**
27. Create GH repo, push — none — remote mirrors local — [2..26].
28. `.github/workflows/ci.yml` — typecheck + test + build-seed dry run — CI green on PR — [27].
29. `.github/workflows/deploy.yml` — build-seed, wrangler deploy, wrangler d1 execute --remote seed — pushes to main deploy — [27].
30. Add GH secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CURSOR_SECRET` (as wrangler secret via CI) — none — deploy.yml succeeds end-to-end — [29].
31. First staging deploy to `hsk-mcp.<acct>.workers.dev` — none — URL serves `/mcp` and `/.well-known/mcp.json` — [30].
32. Run MCP Inspector against staging, exercise 6 tools — `test/integration/mcp-inspector.sh` — all 6 green — [31].

**Phase 2 — Remaining tools**
33. `convertScript` — `src/tools/convertScript.ts` — round-trips 5 systems — [16,18].
34. `buildStudySet` — `src/tools/buildStudySet.ts` — level=3 size=20 returns 20 by frequency — [16,17,18].
35. `suggestNextWords` — `src/tools/suggestNextWords.ts` — excludes known; frequency+radical-novelty; `pos_mix` param rejected with 501-style error — [16,18].
36. `compareWords` — `src/tools/compareWords.ts` — 2–5 word diff table — [16,18].
37. `homophoneDrill` — `src/tools/homophoneDrill.ts` — "yi" via pinyin trigram returns yi-forms; tone_strict filters correctly — [16,17,18].
38. `classifierFor` — `src/tools/classifierFor.ts` — 书 returns ["本"]; empty-coverage noun returns empty-result shape with warning — [16,18].
39. `hsk://level/{1..7}` resources — `src/resources/levelLists.ts` — Inspector lists 7 resources, each fetchable with keyset pagination — [18].

**Phase 2 — Launch**
40. Custom domain: `custom_domain = true` routes block, verify DNS in CF dash — `wrangler.toml` — `hsk-mcp.linsnotes.com/mcp` returns 200 — [31].
41. Manual WAF backstop rule (`cf.threat_score > 10`) — none — rule active in dash — [40].
42. README: connection string `{"url":"https://hsk-mcp.linsnotes.com/mcp"}`, 12-tool catalog with English-only disclaimer, attribution, pinned SHA, example prompts — `README.md ATTRIBUTION.md` — [38,40].
43. `.github/workflows/backup.yml` monthly D1 export — `.github/workflows/backup.yml` — first run succeeds, commits dump to `backups/` branch — [29].
44. Agent-driven QA pass (see §E) — `test/integration/mcp-inspector.sh` + Claude Code agent script — all 12 tools + 3 resources + CORS + rate limit + error paths green — [40].
45. Directory submissions: Anthropic Connectors, Glama, Smithery, mcp.so, PulseMCP — none — acknowledgments received — [42].

---

## E. Testing and agent-driven QA

**Unit tests (vitest).** Coverage targets: `cursor.ts` (round-trip, tamper, cross-query, offset cap), `pinyin.ts` (tone strip, concat, ü, capitals), `shape.ts` (sentinel→null+flag, level split, form_key stability), `cors.ts`, `rateLimit.ts`, each tool handler against seeded local D1. Target >80% line coverage on `src/`.

**Integration tests.** `test/integration/mcp-inspector.sh` boots `wrangler dev --local`, uses MCP Inspector CLI with a scripted session: `initialize` → assert protocolVersion 2025-06-18 → `tools/list` → assert 12 tools → `tools/call` per tool with known inputs → assert shape + `structuredContent._meta.dataset_version` populated. `test/integration/streamable-http.test.ts` issues GET `/mcp` and asserts `200 text/event-stream`. Runs in CI on PR.

**Agent-driven manual QA.** Before custom-domain flip and before directory submission, run a Claude Code session that:
1. Connects to the staging MCP server via `claude mcp add`.
2. Executes each of the 10 manual-QA prompts (from §E.3 below).
3. Checks every response has `structuredContent`, mentions the correct HSK level, cites `dataset_version`.
4. Exercises error paths: invalid cursor, invalid tool args, over-limit pagination, D1 error simulation.
5. Reports pass/fail + any coherence issues back.

Manual-QA prompts (§E.3):
1. "Look up 阿姨 in HSK"
2. "What HSK level is 呵护?"
3. "Show me HSK new-4 words with the 口 radical, 10 of them"
4. "Find Chinese words meaning 'aunt'"
5. "Give me 5 polyphones"
6. "What's the frequency rank of 啊?"
7. "Convert ā yí to Wade-Giles"
8. "I know 你好 and 谢谢. What should I learn next at HSK 1?"
9. "Compare 呵 and 啊"
10. "What classifier goes with 书?"

**Rollout.** `wrangler dev` → staging `*.workers.dev` → agent-driven QA → custom domain → agent-driven QA again → directory submissions.

**First-week metrics.** CF dash: requests/day (alert 80k), Worker CPU p95 (alert 8 ms), D1 rows read/day (alert 4M), error rate per tool (alert >1%), rate-limit 429 rate, top IPs. Log `{tool, latency_ms, ok, result_count, ip_hash, dataset_version}` per request.

---

## F. Risks & mitigations (v2)

- **Rate Limit binding not free-tier** → S0.8 spike; KV fallback ready. Mitigated.
- **MCP spec drift / protocolVersion mismatch** → S0.2 + S0.7 confirm 2025-06-18 negotiation. Pin SDK. Mitigated.
- **Streamable HTTP GET support** → delegated to `createMcpHandler`; integration test verifies. Mitigated.
- **Cursor abuse (huge offset)** → hard cap 2000; HMAC signing prevents tampering. Mitigated.
- **FTS5 shadow-column sync** → physical columns on `forms` + explicit seed inserts. Mitigated.
- **Pinyin "nihao" vs "ni hao" mismatch** → `pinyin_concat` trigram column. Mitigated.
- **Polyphone reorder breaking cursors** → `form_key` hash is the public identity. Mitigated.
- **CORS** → middleware + test. Mitigated.
- **D1 outage** → try/catch + -32603. Mitigated.
- **Seed non-idempotent** → DROP+CREATE at top of seed.sql. Mitigated.
- **Abuse from single IP** → 30 req/min + 5k/day + WAF backstop. Mitigated.
- **10 ms CPU ceiling** → S0.5 benchmarks hot-path tools on real data; keyset pagination keeps D1 scans bounded; fallback is to cache hot queries in KV.
- **Frequency sentinel** → S0.6 verifies upstream semantics. Mitigated.
- **new-7 POS gaps** → POS filter responses include `warnings: ["N entries excluded due to missing POS data"]`.
- **Directory review latency** → submit Day 1 of Phase 2; launch doesn't gate on acceptance.
- **Upstream dataset drift** → pinned SHA in `DATASET_VERSION` var + `ATTRIBUTION.md`. Monthly backup workflow exports D1 to a branch.
- **Solo-dev timeline** → 2+4+4 = 10 days; all 12 tools. Critic warned the timeline is best-case. First scope cuts if Phase 0 slips: `compare_words`, `build_study_set`.
- **Tool-schema versioning** → bump `serverInfo.version` on breaking output-schema changes; documented in README.

---

## G. Success criteria (v2)

**Functional.**
- All 12 tools callable from Claude web (Connectors) and Claude Code (`claude mcp add https://hsk-mcp.linsnotes.com/mcp`).
- Every response carries valid `content[]` + `structuredContent` matching the declared `outputSchema`, plus `_meta.dataset_version`.
- 7 resources for `hsk://level/{1..7}` + `hsk://meta` listable and readable.
- CORS preflight returns 204 with correct headers.
- GET `/mcp` opens SSE stream; POST `/mcp` handles JSON-RPC.
- `/.well-known/mcp.json` serves static discovery JSON.
- Rate limit: 30 req/min/IP enforced; 5000 req/day/IP enforced; over-limit returns 429 + `Retry-After`.
- Empty-result tools return empty-result shape, not errors.
- D1 errors return JSON-RPC `-32603` with sanitized message.

**Non-functional.** p95 e2e <150 ms US-East; Worker CPU p95 <8 ms; D1 query p95 <5 ms; error rate <0.5%; 429 rate <2% of total; <10% of CF free-tier daily caps week 1.

**Launch readiness checklist (v2).**
1. [ ] All Phase 0 spikes green or mitigated (S0.1..S0.10).
2. [ ] MCP protocol 2025-06-18 negotiated in `initialize`.
3. [ ] Streamable HTTP GET + POST both work at `/mcp`.
4. [ ] 12 tools with Zod in/out schemas, English-only disclaimers.
5. [ ] 7 resources (`hsk://level/{1..7}` + `hsk://meta`) listable.
6. [ ] `/.well-known/mcp.json` served.
7. [ ] CORS middleware verified end-to-end.
8. [ ] Rate limit middleware with RL binding OR KV fallback, 30/min/IP + 5k/day/IP.
9. [ ] Cursor HMAC-signed; offset cap 2000; keyset for radical/polyphone/level resources.
10. [ ] `sql/seed.sql` idempotent; reproducible via `scripts/build-seed.ts`.
11. [ ] `wrangler deploy` via GH Actions on push to main; secrets set.
12. [ ] Custom domain `hsk-mcp.linsnotes.com` resolves and serves `/mcp`.
13. [ ] MCP Inspector integration tests pass (unit + scripted + streamable-http).
14. [ ] Agent-driven manual QA passes 10/10 prompts + 5 error-path cases.
15. [ ] Observability logs visible in CF dash with per-request JSON.
16. [ ] WAF backstop rule active.
17. [ ] README with connection string, tool catalog, example prompts, attribution.
18. [ ] `ATTRIBUTION.md` with upstream SHA + MIT notice; license verified.
19. [ ] `DATASET_VERSION` surfaced in every response `_meta`.
20. [ ] Unit tests >80% coverage; CI green.
21. [ ] Directory submissions filed (Anthropic Connectors, Glama, Smithery, mcp.so, PulseMCP).
22. [ ] Monthly D1 backup workflow configured.
23. [ ] First-week metric alerts configured.
