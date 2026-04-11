# HSK MCP Server — Implementation Plan v1

> **Status:** Draft produced by architecture research session on 2026-04-11. Must-fixes from the critic review in `CRITIC.md` are NOT yet folded in — see that doc before coding. A corrected `PLAN_v2.md` will supersede this once fixes are applied.
>
> **Owner decisions locked in this session:**
> - Subdomain: `hsk-mcp.linsnotes.com`
> - v1 scope: all 12 tools at launch (not the MVP-6 cut the critic recommended)
> - CI: GitHub Actions
> - Testing: agent-driven (Claude Code / MCP Inspector) during implementation
>
> **Attribution:** dataset is `drkameleon/complete-hsk-vocabulary` (MIT, ~193 stars). Pin commit SHA in `ATTRIBUTION.md` before seeding.

---

Public, authless, read-only remote MCP server on Cloudflare Workers exposing the HSK vocabulary (11,470 headwords) as tutor-oriented tools. Stack: CF Workers + D1 + FTS5 + `agents` SDK on top of `@modelcontextprotocol/sdk`, Streamable HTTP transport, custom subdomain of `linsnotes.com`.

---

## A. Resolved decisions

**1. Subdomain: `hsk-mcp.linsnotes.com`.** Explicit and self-describing; leaves room for sibling MCP servers (e.g. `cedict-mcp.linsnotes.com`) under the same apex. Provision via Wrangler `routes` with `custom_domain = true`.

**2. Template strategy: fork `cloudflare/ai/demos/remote-mcp-authless` for project scaffolding ONLY (wrangler config, TS config, lint, CI shape), then replace the server entrypoint from scratch.** The template is Durable Object + SSE; we want stateless + Streamable HTTP. Retrofitting it means ripping out the DO, the SSE adapter, and most of `src/index.ts` — at which point "fork" is a misnomer. Keeping the outer repo skeleton buys us the wrangler/tsconfig/lint wiring (a half-day), and writing the MCP handler ourselves against `@modelcontextprotocol/sdk` + `agents`'s `createMcpHandler` is clearer than hollowing out the template. Timebox the fork to 30 minutes; if it's tangled, scaffold from scratch with `npm create cloudflare@latest`.

**3. Pagination: `{limit, cursor}` with opaque base64url cursor, stateless.** Cursor encodes `{offset:number, q_hash:string}` as base64url JSON. `q_hash` is sha256(first 16 chars) of the tool's canonical argument set — the server rejects a cursor whose hash doesn't match the current args, preventing cursor reuse across queries. `limit` default 20, max 100. Returned as `{items, next_cursor|null, total?}`. Offset-based is fine because D1 queries are millisecond-scale on an 11k-row table and there is no append stream to worry about.

**4. FTS5 tokenization: `unicode61 remove_diacritics 2` for English/pinyin FTS, plus a separate `trigram` FTS5 table for hanzi substring search.** SQLite shipped the `trigram` tokenizer in 3.34 and D1 uses a recent SQLite, so both are available. We index three shadow columns: `gloss_en` (meanings joined), `pinyin_plain` (tone marks stripped + lowercased, e.g. "a la bo yu"), and `hanzi` (simplified + traditional concatenated). `gloss_en` and `pinyin_plain` go into a `unicode61` FTS table; `hanzi` goes into a `trigram` FTS table. This lets `search_by_meaning("aunt")` hit English FTS, `homophone_drill("yi")` hit pinyin FTS with toneless matching, and `lookup_hsk_word("阿姨")` do exact index lookup with a trigram fallback for partial hanzi. **Phase 0 spike**: verify `trigram` tokenizer exists in D1 — `SELECT fts5('trigram');` — 30 min timebox. If missing, fall back to bigram shadow column built in the seed step.

**5. Polyphone representation: one row per `form`, with `headword_id` grouping them.** Two tables: `headwords(id, simplified, radical, level_tags, frequency, pos_tags, old_level, new_level)` — one row per entry — and `forms(id, headword_id, form_index, traditional, pinyin, pinyin_plain, numeric, wadegiles, bopomofo, romatzyh, meanings_json, classifiers_json)` — one row per pronunciation. This is the only shape that lets `find_polyphones`, `homophone_drill`, and `convert_script` work naturally: those tools are fundamentally about form-level pronunciations, not headwords. Tools that return "a word" return the headword with its nested `forms[]` array; tools that return "a pronunciation" return a form pointer `{simplified, form_index}`.

**6. `suggest_next_words` ranking: `frequency_rank ASC` filtered to unknown words at `current_level`, tie-broken by radical novelty.** Pure frequency is the defensible default — "learn the most common words first" is the canonical HSK tutor heuristic. Radical novelty is a cheap bonus: if two words tie on frequency, prefer the one whose radical the learner hasn't seen in `known_words`. POS balancing is out for v1 — it's a deep rabbit hole and the caller can always filter POS themselves. Accept `pos_mix` as a reserved arg that's rejected with a 501-style error if passed — documents the extension without implementing it.

**7. Frequency `1_000_000` sentinel: expose as `null` with a `frequency_rarity: "off_chart"` flag on `HskEntry`.** 93 entries sit at this sentinel. Exposing `1000000` directly poisons any sort and confuses clients; dropping it silently is worse. Null + flag is the honest shape. `frequency_rank` tool returns `{rank: null, rarity: "off_chart"}` for those. Confirm the sentinel in Phase 0 by reading drkameleon's build scripts; if it's a different number, adjust.

**8. v1 tool-set: all 12.** The surface is small enough and the tools are thin enough (each is a SQL query + shape) that cutting to 6 saves days, not weeks. Shipping the full 12 at launch means one directory submission pass, one QA pass, one doc site. If Phase 0 spikes surface real trouble, the first tools cut are `compare_words` and `build_study_set` (they're convenience aggregations over others).

**9. Shared `HskEntry` shape** (JSON Schema, re-used as `structuredContent` in every list tool):

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
      "form_index": 0,
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
  ]
}
```

`levels.new` / `levels.old` are `1..7` / `1..6` or `null`. `frequency_rarity` is `"common" | "off_chart"`. Declared once in `src/schemas/hskEntry.ts` and re-imported by every tool's `outputSchema`.

**10. Deployment workflow: commit `sql/seed.sql` (generated at build time from `complete.json`), apply via `wrangler d1 execute --file=sql/seed.sql` in CI on push to `main`.** The seed is ~10 MB of SQL, bearable for git. Generating from JSON at build time means schema changes in `scripts/build-seed.ts` are reviewable, reproducible, and CI-verifiable. Local dev uses the same command against a local D1. No runtime seed, no first-request penalty.

---

## B. Target architecture

### Component diagram

```
Claude client  ──HTTPS──▶  CF edge (hsk-mcp.linsnotes.com)
                               │
                               ▼
                     ┌──────────────────────┐
                     │  Worker (hsk-mcp)    │
                     │  ─ POST /mcp         │
                     │  ─ GET  /healthz     │
                     │  ─ GET  /.well-known │
                     │                      │
                     │  createMcpHandler    │
                     │   ├ rate-limit mw    │
                     │   ├ tool dispatcher  │
                     │   └ cursor codec     │
                     └──────────┬───────────┘
                                │  prepared stmts
                                ▼
                          ┌──────────┐
                          │   D1     │
                          │  hsk_db  │
                          └──────────┘
```

### Request lifecycle — `lookup_hsk_word("阿姨")`

1. `POST /mcp` lands at Worker. Rate-limit middleware reads `cf-connecting-ip`, calls `env.RL.limit({key: ip})`. Under limit: continue. Over: 429 + `Retry-After: 60`.
2. `createMcpHandler` parses the JSON-RPC envelope, routes `tools/call` → `lookupHskWord`.
3. Tool handler validates args against its `inputSchema` (Zod).
4. Handler issues two prepared stmts: `SELECT * FROM headwords WHERE simplified = ?1` and `SELECT * FROM forms WHERE headword_id = ?1 ORDER BY form_index`.
5. Rows shaped into `HskEntry` via `shapeHskEntry(rows)`.
6. Response: `{content: [{type:"text", text: JSON.stringify(entry, null, 2)}], structuredContent: entry}`.
7. Envelope returned to edge, edge to client. Budget: <5 ms CPU.

### Directory layout

```
/Users/kuibin/Code/hsk-mcp-server/
├── complete.json                      # upstream snapshot, pinned SHA in README
├── wrangler.toml
├── package.json
├── tsconfig.json
├── biome.json
├── README.md                          # attribution, tool docs, pinned SHA
├── LICENSE                            # MIT
├── ATTRIBUTION.md                     # drkameleon upstream + SHA
├── scripts/
│   ├── build-seed.ts                  # complete.json → sql/seed.sql
│   └── verify-dataset.ts              # sanity checks before seeding
├── sql/
│   ├── schema.sql                     # DDL
│   └── seed.sql                       # generated, committed
├── src/
│   ├── index.ts                       # fetch handler, router
│   ├── mcp.ts                         # createMcpHandler wiring
│   ├── rateLimit.ts                   # rate-limit middleware
│   ├── cursor.ts                      # encode/decode/validate
│   ├── db.ts                          # prepared stmt wrappers
│   ├── shape.ts                       # row → HskEntry
│   ├── pinyin.ts                      # tone mark strip, normalization
│   ├── schemas/
│   │   ├── hskEntry.ts                # shared shape
│   │   └── tools.ts                   # per-tool Zod in/out
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
│   │   └── index.ts                   # registry
│   └── resources/
│       └── levelLists.ts              # hsk://level/{1..7}
└── test/
    ├── unit/
    │   ├── cursor.test.ts
    │   ├── pinyin.test.ts
    │   ├── shape.test.ts
    │   └── tools/*.test.ts
    └── integration/
        └── mcp-inspector.sh
```

### `wrangler.toml` key bindings

```toml
name = "hsk-mcp"
main = "src/index.ts"
compatibility_date = "2026-04-01"
compatibility_flags = ["nodejs_compat"]

[observability]
enabled = true

[[d1_databases]]
binding = "DB"
database_name = "hsk_db"
database_id = "<filled-after-create>"

# NOTE: critic flagged this as outdated — should be [[ratelimits]] not [[unsafe.bindings]].
# See CRITIC.md §2.1. This block will be corrected in PLAN_v2.
[[unsafe.bindings]]
name = "RL"
type = "ratelimit"
namespace_id = "1001"
simple = { limit = 60, period = 60 }

[[routes]]
pattern = "hsk-mcp.linsnotes.com"
custom_domain = true
```

### D1 schema (`sql/schema.sql`)

```sql
CREATE TABLE headwords (
  id INTEGER PRIMARY KEY,
  simplified TEXT NOT NULL,
  radical TEXT NOT NULL,
  frequency INTEGER NOT NULL,           -- raw incl sentinel
  frequency_rank INTEGER,               -- null when sentinel
  frequency_rarity TEXT NOT NULL,       -- 'common' | 'off_chart'
  pos_tags TEXT NOT NULL,               -- JSON array
  level_tags TEXT NOT NULL,             -- JSON array
  new_level INTEGER,                    -- 1..7 or null
  old_level INTEGER                     -- 1..6 or null
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
  traditional TEXT NOT NULL,
  pinyin TEXT NOT NULL,
  pinyin_plain TEXT NOT NULL,           -- "a yi", lowercased, no tones
  numeric TEXT NOT NULL,
  wadegiles TEXT NOT NULL,
  bopomofo TEXT NOT NULL,
  romatzyh TEXT NOT NULL,
  meanings_json TEXT NOT NULL,
  classifiers_json TEXT NOT NULL
);
CREATE INDEX idx_forms_headword ON forms(headword_id);
CREATE INDEX idx_forms_pinyin_plain ON forms(pinyin_plain);

-- English gloss + pinyin FTS
-- NOTE: critic flagged shadow-column sync is not specified here.
-- See CRITIC.md §2.6. Must add triggers or switch to contentless FTS5 in PLAN_v2.
CREATE VIRTUAL TABLE forms_fts USING fts5(
  gloss_en, pinyin_plain,
  content='forms', content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);

-- Hanzi substring via trigram
CREATE VIRTUAL TABLE hanzi_fts USING fts5(
  hanzi,
  content='forms', content_rowid='id',
  tokenize='trigram'
);
```

The seed script populates `forms_fts.gloss_en` with meanings joined by " | " and `hanzi_fts.hanzi` with `simplified || ' ' || traditional`.

### Rate limiting

Middleware in `src/rateLimit.ts` wraps the `fetch` handler before it reaches `createMcpHandler`. Keyed on `cf-connecting-ip`. 60 req/min/IP. Plus a WAF custom rule `cf.threat_score > 10` as backstop. Per-tool result counts capped by the Zod input schemas (`limit.max(100)`).

### Cursor codec

`encode({offset, args}) → base64url(JSON.stringify({o: offset, h: sha256(canonicalJSON(args)).slice(0,16)}))`. Decoder validates the hash against current args; mismatch → `InvalidParams`. State-free, tamper-resistant, tiny.

---

## C. Phased delivery plan

### Phase 0 — Spike/verify (1-2 days)

Each spike has: input, success criterion, timebox.

- **S0.1 Template state.** Clone `cloudflare/ai` repo, inspect `demos/remote-mcp-authless/src/index.ts`. Success: confirm whether it uses DO+SSE or has been updated to Streamable HTTP. 30 min.
- **S0.2 MCP spec rev.** Open `modelcontextprotocol.io/specification`. Success: confirm current rev date and Streamable HTTP is the transport. 15 min.
- **S0.3 CF free-tier numbers.** Dash → Workers & D1 pricing. Success: note req/day, CPU/req, D1 rows read/day limits. 15 min.
- **S0.4 FTS5 trigram tokenizer in D1.** Create throwaway D1, run `CREATE VIRTUAL TABLE t USING fts5(x, tokenize='trigram');`. Success: no error. If fails, design bigram shadow column. 30 min.
- **S0.5 FTS5 Chinese benchmark.** Seed throwaway D1 with 500 rows, run 5 queries (meaning exact, meaning fuzzy, pinyin-toneless, hanzi substring, radical scan). Success: each <10 ms CPU. 45 min.
- **S0.6 Frequency sentinel.** Read drkameleon build scripts on GitHub. Success: identify exact sentinel value + semantics. 15 min.
- **S0.7 `agents` + `createMcpHandler` smoke.** Minimal Worker with one no-op tool, `wrangler dev`, call with MCP Inspector. Success: `tools/list` round-trips. 45 min.

**Gate:** all spikes green; any red spike has a documented workaround before Phase 1.

### Phase 1 — MVP (3-4 days)

Ship 6 tools to `*.workers.dev` staging, tested via MCP Inspector. Subset: `lookup_hsk_word`, `search_by_meaning`, `words_by_radical`, `find_polyphones`, `frequency_rank`, `hsk_diff`. These cover: lookup, English search, radical scan, polyphones (tests the forms table), metadata (tests the sentinel), diff (tests old/new level handling). The other 6 reuse the same infrastructure.

**Exit gate:** all 6 tools return valid MCP responses with `structuredContent`, MCP Inspector shows green, staging URL published, unit tests >80% on core modules.

### Phase 2 — v1 launch (3-4 days)

Remaining 6 tools, custom domain, rate limiting hardening, observability dashboards, README/attribution polish, directory submissions.

**Exit gate:** `hsk-mcp.linsnotes.com/mcp` live, p95 <100 ms edge, submissions filed at Anthropic Connectors Directory, Glama, Smithery, mcp.so, PulseMCP.

---

## D. Work breakdown

Format: `[N] Task — files — test/gate — deps`

**Phase 0**
1. S0.1–S0.7 spikes — see above — each has its own success criterion — no deps.

**Phase 1 — Scaffolding**
2. `npm create cloudflare@latest hsk-mcp` or fork template — `wrangler.toml package.json tsconfig.json` — `wrangler dev` serves `hello world` — [1].
3. Add `agents`, `@modelcontextprotocol/sdk`, `zod`, `biome`, `vitest` — `package.json` — install clean — [2].
4. Minimal `src/index.ts` + `src/mcp.ts` with `createMcpHandler` and one no-op tool — `src/index.ts src/mcp.ts` — MCP Inspector `tools/list` shows one tool — [3].
5. Create D1 `hsk_db` via `wrangler d1 create hsk_db`, paste ID into `wrangler.toml` — `wrangler.toml` — `wrangler d1 list` shows it — [2].
6. Write `sql/schema.sql` — `sql/schema.sql` — `wrangler d1 execute DB --file=sql/schema.sql --local` succeeds — [5].

**Phase 1 — Seed**
7. `scripts/verify-dataset.ts`: parse `complete.json`, assert no nulls in `level/frequency/radical/meanings`, count polyphones, print sentinel count — `scripts/verify-dataset.ts` — prints expected counts (11470, 622, 93) — [1].
8. `src/pinyin.ts` tone-strip + normalize — `src/pinyin.ts` — unit tests on 20 samples — [2].
9. `scripts/build-seed.ts` — emits `sql/seed.sql` with `INSERT INTO headwords/forms` + FTS5 rebuild — `scripts/build-seed.ts sql/seed.sql` — seed file <15 MB, well-formed SQL — [6,7,8].
10. Apply seed locally: `wrangler d1 execute DB --file=sql/seed.sql --local` — none — `SELECT count(*) FROM headwords` → 11470, `SELECT count(*) FROM forms` → ~12092 — [9].

**Phase 1 — Shared infra**
11. `src/schemas/hskEntry.ts` shared shape — `src/schemas/hskEntry.ts` — Zod parses a hand-built sample — [4].
12. `src/db.ts` prepared stmt wrappers + `src/shape.ts` row shaper — `src/db.ts src/shape.ts` — unit tests with seeded local D1 — [10,11].
13. `src/cursor.ts` encode/decode/validate — `src/cursor.ts` — unit tests: round-trip + hash mismatch rejection — [4].
14. `src/rateLimit.ts` middleware — `src/rateLimit.ts wrangler.toml` — integration test returns 429 after limit — [4].
15. `src/tools/index.ts` registry + helper `defineTool(name, inputSchema, outputSchema, handler)` — `src/tools/index.ts` — [11].

**Phase 1 — Core 6 tools**
16. `lookupHskWord` — `src/tools/lookupHskWord.ts` — returns 阿姨 correctly, handles missing word, handles polyphone — [12,15].
17. `searchByMeaning` — `src/tools/searchByMeaning.ts` — "aunt" returns 阿姨; level filter works; pagination round-trips — [12,13,15].
18. `wordsByRadical` — `src/tools/wordsByRadical.ts` — 口 radical returns expected set, max_level filter works — [12,13,15].
19. `findPolyphones` — `src/tools/findPolyphones.ts` — returns 622 entries total across pages — [12,13,15].
20. `frequencyRank` — `src/tools/frequencyRank.ts` — common word returns int, sentinel word returns `{rank:null, rarity:"off_chart"}` — [12,15].
21. `hskDiff` — `src/tools/hskDiff.ts` — 阿姨 returns `{new:4, old:3, moved:false}`; a new-only word returns `{old:null, ...}` — [12,15].

**Phase 1 — Deploy to staging**
22. `wrangler deploy` to `hsk-mcp.<acct>.workers.dev`, seed remote D1 — none — staging URL serves `/mcp` — [16..21].
23. Run MCP Inspector against staging, exercise each tool — `test/integration/mcp-inspector.sh` — all 6 green — [22].

**Phase 2 — Remaining 6 tools**
24. `convertScript` — `src/tools/convertScript.ts` — pinyin→numeric+wadegiles round-trip — [12,15].
25. `buildStudySet` — `src/tools/buildStudySet.ts` — level=3 size=20 returns 20 items ranked by frequency — [12,13,15].
26. `suggestNextWords` — `src/tools/suggestNextWords.ts` — excludes known, prefers high-frequency, radical-novelty tiebreak — [12,15].
27. `compareWords` — `src/tools/compareWords.ts` — diff table of 2-5 words — [12,15].
28. `homophoneDrill` — `src/tools/homophoneDrill.ts` — "yi" returns yi-pronounced forms; tone_strict filters — [12,13,15].
29. `classifierFor` — `src/tools/classifierFor.ts` — 书 returns ["本"] — [12,15].

**Phase 2 — Resources + domain + polish**
30. MCP Resources for `hsk://level/{1..7}` — `src/resources/levelLists.ts` — Inspector lists them, fetch returns JSON — [15].
31. Custom domain: add `routes` block, verify DNS in CF dash — `wrangler.toml` — `hsk-mcp.linsnotes.com/mcp` returns 200 — [22].
32. README with tool catalog, attribution, pinned SHA, example prompts — `README.md ATTRIBUTION.md` — links check — [29].
33. Observability: add log fields (tool name, latency, result count), CF dashboard Workers Analytics view saved — `src/mcp.ts` — logs visible in dash — [31].
34. WAF backstop rule — none (dash) — rule active — [31].
35. Directory submissions: Anthropic Connectors Directory, Glama, Smithery, mcp.so, PulseMCP — none — submissions acknowledged — [32].

---

## E. Observability, testing, rollout

**Unit tests (vitest).** `cursor.ts` (round-trip, tamper, cross-query hash mismatch), `pinyin.ts` (tone strip, edge cases like ü, capitals, multi-syllable), `shape.ts` (null sentinel → null+flag, level split, form ordering), each tool handler with a seeded in-memory/local D1 via `wrangler dev --local` fixture. Target >80% line coverage on `src/` excluding generated schemas.

**Integration tests.** A `test/integration/mcp-inspector.sh` script that boots `wrangler dev` and runs the MCP Inspector CLI with a canned script: `initialize` → `tools/list` → one `tools/call` per tool with known inputs → assert on shape. Runs in CI on every push.

**Manual QA script (Claude web + Claude Code).** After staging deploy, connect to the server and run these 10 prompts:
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

Each should produce a coherent Claude reply referencing structured data.

**Rollout.** `wrangler dev` (local) → `wrangler deploy` (staging `*.workers.dev`) → manual QA script against staging → custom domain flip → re-run manual QA against `hsk-mcp.linsnotes.com` → directory submissions.

**First-week metrics.** Watch in CF dash: requests/day (alert at 80% of free-tier cap), CPU time p95 (alert at 8 ms), D1 rows read/day, error rate per tool (alert >1%), rate-limit 429 count, top IPs. Log a one-line JSON per request `{tool, latency_ms, ok, result_count, ip_hash}` for greppable forensics.

---

## F. Risks & mitigations

- **Template/transport mismatch** → Phase 0 spike S0.1 + decision to scaffold fresh. Mitigated.
- **MCP spec drift** → Phase 0 spike S0.2. Re-pin `@modelcontextprotocol/sdk` to latest at scaffold time; re-verify on each release.
- **CF free-tier headroom** → rate limit 60/min/IP + 100-cap on list tools + metric alerts at 80% of free-tier cap. Seed DB only on deploy, never at request time.
- **FTS5 on Chinese** → decision #4 gives explicit tokenizers per language; Phase 0 spike S0.5 benchmarks before commit; fallback to bigram shadow column documented.
- **10 ms CPU ceiling** → all tools use indexed queries, no table scans; benchmark in Phase 0; if a tool exceeds budget, cache its result in a `KV` namespace (free tier) keyed on canonical args.
- **Frequency sentinel wrong value** → Phase 0 spike S0.6 verifies against upstream; decision #7 exposes as null+flag either way.
- **`new-7` POS gaps** → 250 entries missing POS (161 in new-7). When a `pos` filter excludes them, log a warning field in response `{warnings: ["250 entries excluded due to missing POS data"]}`.
- **Directory review latency** → submit on day 1 of Phase 2, don't gate launch on approval.
- **Upstream dataset drift** → pinned SHA in `ATTRIBUTION.md` + in seed build script comment. No auto-update.
- **Abuse of authless endpoint** → rate limit + WAF + no write paths + monitored 429 rate. If abuse appears, promote to stricter IP-based + ASN allowlist rule.
- **D1 cold-start on custom domain** → D1 is warm-by-binding; no cold start beyond Worker isolate warmup (single-digit ms).

---

## G. Success criteria

**Functional.** All 12 tools callable from Claude web (via Connectors Directory) and Claude Code (via `claude mcp add`). Each tool returns valid MCP `content[]` + `structuredContent` matching the declared `outputSchema`. Resources for `hsk://level/{1..7}` listable and readable.

**Non-functional.** p95 end-to-end latency <150 ms from US-East; Worker CPU p95 <8 ms; D1 query p95 <5 ms; error rate <0.5%; rate limit 429 rate <2% of total; well under 10% of CF free-tier daily caps in the first week.

**Launch readiness checklist.**
1. [ ] All Phase 0 spikes green or mitigated.
2. [ ] 12 tools implemented with Zod in/out schemas.
3. [ ] `sql/seed.sql` committed, reproducible from `complete.json`.
4. [ ] `wrangler deploy` succeeds to staging + prod.
5. [ ] Custom domain `hsk-mcp.linsnotes.com` resolves and serves `/mcp`.
6. [ ] MCP Inspector manual QA passes 10/10 prompts.
7. [ ] Rate limit tested (60/min/IP returns 429 on 61st).
8. [ ] Observability logs visible in CF dash.
9. [ ] README with tool catalog, example prompts, attribution.
10. [ ] `ATTRIBUTION.md` with drkameleon SHA + MIT notice.
11. [ ] `LICENSE` MIT file present.
12. [ ] Unit tests >80% coverage, CI green.
13. [ ] Integration test script in CI.
14. [ ] Directory submissions filed (5 directories).
15. [ ] First-week metric alerts configured.
