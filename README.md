# HSK MCP Server

A remote [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server that gives AI assistants structured access to the complete HSK Chinese vocabulary dataset. It exposes 13 tools and 8 resources covering word lookup, transcription conversion, frequency analysis, study set generation, and more.

**11,470 headwords / 12,623 pronunciation forms / HSK 1-7 (new 3.0) + HSK 1-6 (old 2.0)**

## What is this?

MCP is an open protocol that lets AI assistants (like Claude) call external tools and read external data in a standardized way. This server turns the HSK vocabulary into a set of tools that any MCP-compatible client can use.

When you connect this server to Claude (or any MCP client), the AI can look up Chinese words, search by meaning, compare HSK levels, find homophones, suggest study vocabulary, and more — all backed by a real database instead of relying on training data.

## Connecting to the server

The MCP endpoint URL is:

```
https://hsk-mcp.linsnotes.com/mcp
```

No API key or authentication is required. The server is publicly accessible and free to use.

### Claude Desktop

Add to your `claude_desktop_config.json`:

- Open Developer Settings: Click your `profile` in the sidebar, select `Settings`, then go to the `Developer` tab.
- Edit Config: Click the `Edit Config` button to open your `claude_desktop_config.json` file.
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- Add Server Details: Add your server configuration under the `mcpServers` key:

```json
{
  ...
  "mcpServers": {
    "hsk": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://hsk-mcp.linsnotes.com/mcp"]
    }
  }
  ...
}
```

Restart Claude Desktop after saving. The HSK tools will be available in all conversations.

### Claude Code (CLI)

```bash
claude mcp add hsk --transport http https://hsk-mcp.linsnotes.com/mcp
```

This registers the server in `~/.claude.json`. Every new Claude Code session will connect to it and have access to all 13 tools. To remove it later: `claude mcp remove hsk`.

### Cursor

Settings → MCP → Add new MCP server:

- **Name:** `hsk`
- **Type:** Streamable HTTP
- **URL:** `https://hsk-mcp.linsnotes.com/mcp`

### Other MCP clients

Use the Streamable HTTP transport with the URL above. No headers or auth required.

### Verify the server is running

```bash
# Health check
curl https://hsk-mcp.linsnotes.com/healthz
# → {"ok":true}

# MCP discovery
curl https://hsk-mcp.linsnotes.com/.well-known/mcp.json
# → {"name":"hsk-mcp","description":"...","url":"https://hsk-mcp.linsnotes.com/mcp",...}
```

## What you can ask

Once connected, just talk to your AI assistant naturally. The assistant will call the right tools automatically. Examples:

- "Look up 翻译 — show me the pinyin, traditional form, meanings, and part of speech"
- "What HSK level is 改革? Include its frequency rank"
- "Find Chinese words meaning 'recommend' — show results as a table with pinyin and HSK level"
- "Show me HSK level 3 words with the 口 radical, formatted as a numbered list with pinyin and meanings"
- "Give me 5 polyphones (characters with multiple readings) with all their pronunciations and meanings"
- "What's the frequency rank and rarity class of 准备?"
- "Convert 互联网 to all transcription systems: pinyin, Wade-Giles, Bopomofo, and Romatzyh"
- "Build me an HSK 3 study set as a markdown table with columns: word, pinyin, part of speech, and meaning"
- "I know 外卖, 高铁, and 请客 — suggest what I should learn next at HSK 3, include frequency rank"
- "Compare 聪明 and 简历 side by side — show frequency, HSK level, part of speech, and all meanings"
- "What classifier (measure word) goes with 航班?"

> **Tip:** Each tool returns rich structured data (pinyin, traditional characters, part of speech, frequency rank, HSK levels, transcriptions, meanings, classifiers). The AI decides what to show based on your prompt — so **be specific about what fields and format you want**. For example, "give me HSK 2 words" will return a basic list, but "give me HSK 2 words as a table with pinyin, part of speech, and meaning" will produce a much more useful result.

## Tools

### Lookup

| Tool                     | Description                                                                                                      | Input  |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------- | ------ |
| `hsk_lookup`             | Look up a word by simplified, traditional, or pinyin. Returns all forms with meanings, frequency, and HSK level. | `word` |
| `hsk_frequency`          | Get frequency ranking and rarity class for a word (1 = most common).                                             | `word` |
| `hsk_convert_script`     | Show a word in all 5 transcription systems: pinyin, numeric, Wade-Giles, Bopomofo, Romatzyh.                     | `word` |
| `hsk_classifier`         | Find the measure word(s) for a noun.                                                                             | `word` |
| `hsk_convert_characters` | Convert between simplified and traditional characters. Returns both scripts with pinyin and meanings.            | `word` |

### Search & filter (paginated)

| Tool                   | Description                                                                                   | Input                |
| ---------------------- | --------------------------------------------------------------------------------------------- | -------------------- |
| `hsk_search_meaning`   | Full-text search by English meaning, ranked by relevance.                                     | `query`, `cursor?`   |
| `hsk_words_by_radical` | Find all words sharing a radical, ordered by frequency.                                       | `radical`, `cursor?` |
| `hsk_polyphones`       | List characters with multiple pronunciations (多音字).                                        | `cursor?`            |
| `hsk_homophones`       | Find words sharing the same pinyin (homophones). Accepts tone marks, numbers, or plain ASCII. | `pinyin`, `cursor?`  |

### Study tools (paginated)

| Tool                 | Description                                                    | Input                                    |
| -------------------- | -------------------------------------------------------------- | ---------------------------------------- |
| `hsk_build_study_set`| Build a study set for a level, ordered by frequency.           | `level`, `scheme?`, `cursor?`            |
| `hsk_suggest_next`   | Suggest next words to learn, excluding words you already know. | `level`, `scheme?`, `known[]`, `cursor?` |

### Comparison

| Tool           | Description                                                             | Input                                          |
| -------------- | ----------------------------------------------------------------------- | ---------------------------------------------- |
| `hsk_compare`  | Compare 2-5 words side by side (frequency, levels, meanings, radicals). | `words[]`                                      |
| `hsk_diff`     | Compare two HSK levels to see vocabulary overlap and differences.       | `level_a`, `scheme_a?`, `level_b`, `scheme_b?` |

**Notes:**

- `scheme` is `"new"` (HSK 3.0, levels 1-7) or `"old"` (HSK 2.0, levels 1-6). Defaults to `"new"`.
- Paginated tools return 20 results per page with a `next_cursor` for fetching more.
- All meanings are in English.

## Resources

The server also exposes MCP resources — read-only data the client can fetch directly without calling a tool:

| URI                                     | Description                                                        |
| --------------------------------------- | ------------------------------------------------------------------ |
| `hsk://meta`                            | Server metadata: dataset version, tool count, headword/form counts |
| `hsk://level/1` through `hsk://level/7` | Full vocabulary list for each HSK 3.0 level                        |

**How to use resources:** MCP clients can read these URIs to get bulk data. Unlike tools (which the AI calls on your behalf), resources are fetched as context. For example:

- `hsk://meta` — useful for checking the dataset version and total word count
- `hsk://level/3` — returns the full HSK 3 vocabulary (953 words) with pinyin and meanings, which the AI can use as reference material for a study session

Resources return brief word data (simplified, pinyin, meanings, HSK levels). For full details on a specific word (part of speech, transcriptions, frequency rank, classifiers), use the tools instead.

## Prompts

The server provides pre-built prompts — guided interaction patterns that MCP clients can offer to users:

| Prompt | Description | Input |
| --- | --- | --- |
| `hsk-study-session` | Start a guided HSK study session. Builds a study set for your level, lets you exclude words you already know, and presents vocabulary as a structured table. | `level` |
| `hsk-word-deep-dive` | Get comprehensive details about a Chinese word: all transcription systems, frequency rank, part of speech, classifiers, and homophones. | `word` |

In clients that support prompts (like Claude Desktop), these appear as selectable templates. Pick one, fill in the input, and the AI runs through a structured workflow using the right tools automatically.

## Data coverage

Each word entry includes:

- **Simplified and traditional** characters
- **5 transcription systems**: pinyin (tone marks), numeric (tone numbers), Wade-Giles, Bopomofo/Zhuyin, Gwoyeu Romatzyh
- **English meanings** and **measure words** (classifiers)
- **Radical** (部首)
- **HSK levels**: both new 3.0 (levels 1-7) and old 2.0 (levels 1-6)
- **Frequency rank** among HSK vocabulary (1 = most common)
- **Part of speech** tags
- **Multiple pronunciation forms** for polyphones (e.g. 好 = hǎo / hào)

Dataset: [drkameleon/complete-hsk-vocabulary](https://github.com/drkameleon/complete-hsk-vocabulary) (MIT).

## How it works

```
MCP Client (Claude, Cursor, etc.)
        |
        | Streamable HTTP (POST/GET /mcp)
        v
+---------------------------+
|  Cloudflare Worker        |
|  +---------+-----------+  |
|  | CORS    | Rate limit|  |
|  +---------+-----------+  |
|  | MCP Protocol Handler |  |
|  |  - 13 tools          |  |
|  |  - 8 resources       |  |
|  +----------+-----------+  |
|             |              |
|         D1 (SQLite)        |
|  11,470 headwords          |
|  12,623 forms              |
|  3 FTS5 indexes            |
+---------------------------+
```

1. The client sends a standard MCP request over Streamable HTTP
2. The Worker validates the request, checks rate limits (30 req/min per IP)
3. The MCP handler routes to the right tool
4. The tool queries Cloudflare D1 (SQLite at the edge) using prepared statements
5. Results are shaped into a clean JSON response with dataset version metadata

## Database design

### Tables

The database has two core tables and three search indexes:

**`headwords`** — one row per word (11,470 rows). Holds properties of the word itself: simplified characters (unique key), radical, frequency rank, HSK levels, parts of speech. These don't change across pronunciations.

**`forms`** — one row per pronunciation (12,623 rows). A word can have multiple pronunciations (polyphones) — e.g. 好 has hǎo (good) and hào (to like). Each gets its own row with all 5 transcription systems, English meanings, and classifiers. Linked to headwords via `headword_id`.

### Full-text search (FTS5)

Regular SQL only supports exact matches (`WHERE col = 'aunt'`) or slow full-table scans (`WHERE col LIKE '%aunt%'`). [FTS5](https://www.sqlite.org/fts5.html) is SQLite's full-text search engine — it builds a specialized index for fast, accurate text search.

Three FTS5 virtual tables are needed because each searches a different kind of text with a different strategy. FTS5 only allows one tokenizer per table, so they can't be combined.

**`gloss_fts`** — English meaning search, `unicode61` tokenizer (word-boundary aware)

Searching `MATCH 'aunt'` correctly matches "maternal **aunt**" but not "r**aunt**ed". This powers `hsk_search_meaning`. The source column is `gloss_en` on `forms` — all meanings joined into a single flat string (`"maternal aunt | step-mother | childcare worker"`). FTS5 needs a single text column, not a JSON array, so `gloss_en` exists alongside `meanings_json` which holds the structured data for responses.

**`pinyin_fts`** — pinyin search, `trigram` tokenizer (substring matching)

Trigram indexes every 3-character window, so `MATCH 'nihao'` matches both `"nihao"` and `"nihaoma"`. The source column is `pinyin_concat` — pinyin with tones stripped and spaces removed (e.g. `"ayi"` not `"ā yí"`). This way searching `"ayi"` matches regardless of whether the user types spaces or tones. Note: trigram requires queries of 3+ characters — shorter queries (like `"yi"`) fall back to an indexed `WHERE pinyin_plain = ?` query in the application layer.

**`hanzi_fts`** — character search, `trigram` tokenizer

Same approach as pinyin. The source column is `hanzi_concat` — simplified and traditional concatenated with a space (e.g. `"阿姨 阿姨"`). One search matches both scripts.

### Why concat columns exist

The `forms` table has several columns that look redundant but serve different roles:

| Column          | Example                 | Purpose                                                |
| --------------- | ----------------------- | ------------------------------------------------------ |
| `pinyin`        | `ā yí`                  | Display — returned in responses                        |
| `pinyin_plain`  | `a yi`                  | Indexed exact match — for short pinyin queries         |
| `pinyin_concat` | `ayi`                   | FTS trigram source — space-free for substring search   |
| `meanings_json` | `["maternal aunt",...]` | Display — structured array for responses               |
| `gloss_en`      | `maternal aunt \| ...`  | FTS unicode61 source — flat text for word search       |
| `hanzi_concat`  | `阿姨 阿姨`             | FTS trigram source — simplified + traditional together |

FTS tables store their own copy of the indexed text alongside the search index. The actual structured data (meanings array, full pinyin, etc.) stays in `forms`; FTS queries JOIN back via `rowid`.

## Tech stack

| Component  | Technology                                                                                                                            |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime    | [Cloudflare Workers](https://workers.cloudflare.com)                                                                                  |
| Database   | [Cloudflare D1](https://developers.cloudflare.com/d1/) (SQLite at the edge)                                                           |
| Protocol   | [MCP](https://modelcontextprotocol.io) via Streamable HTTP                                                                            |
| MCP SDK    | [@modelcontextprotocol/sdk](https://www.npmjs.com/package/@modelcontextprotocol/sdk) + [agents](https://www.npmjs.com/package/agents) |
| Language   | TypeScript                                                                                                                            |
| Validation | [Zod](https://zod.dev)                                                                                                                |
| Testing    | [Vitest](https://vitest.dev)                                                                                                          |
| Linting    | [Biome](https://biomejs.dev)                                                                                                          |
| CI         | GitHub Actions (typecheck + test on PRs)                                                                                              |
| Deploy     | Cloudflare Git integration (auto-deploy on push)                                                                                      |

## Development

```bash
# Install dependencies
pnpm install

# Start local dev server
pnpm dev

# Seed local D1 database
pnpm build-seed
pnpm exec wrangler d1 execute DB --local --file=sql/schema.sql
pnpm exec wrangler d1 execute DB --local --file=sql/seed.sql

# Run tests
pnpm test

# Type check
pnpm typecheck

# Lint
pnpm lint
```

### Project structure

```
src/
  index.ts              # Request router (healthz, well-known, MCP)
  mcp.ts                # MCP server setup + tool/resource/prompt registration + server instructions
  types.ts              # Env interface (D1, rate limit, secrets)
  annotations.ts        # Tool annotation constants (readOnlyHint, etc.)
  cursor.ts             # HMAC-signed pagination cursors
  db.ts                 # Typed D1 query helpers
  shape.ts              # DB row -> clean response shaping
  response.ts           # MCP response formatting helpers
  pinyin.ts             # Tone stripping, normalization
  pos.ts                # POS tag code-to-label mapping
  middleware/
    cors.ts             # CORS headers
    errorWrap.ts        # D1 error -> JSON-RPC -32603
    rateLimit.ts        # Per-IP rate limiting (30/min via Workers Rate Limiting binding)
  tools/                # 13 tool handlers (one file each)
  resources/            # MCP resources (meta, level lists)
sql/
  schema.sql            # D1 DDL (tables, indexes, FTS5)
scripts/
  build-seed.ts         # complete.json -> sql/seed.sql
  verify-dataset.ts     # Dataset invariant checks
```

### Dataset integrity

`scripts/verify-dataset.ts` contains a hardcoded SHA-256 hash of `complete.json`. When `pnpm verify-dataset` runs, it hashes the file again and compares — if someone accidentally modifies or replaces the file, the check fails. You can verify the hash yourself:

```bash
shasum -a 256 complete.json
```

## License

MIT

## Attribution

Dataset: [drkameleon/complete-hsk-vocabulary](https://github.com/drkameleon/complete-hsk-vocabulary) by drkameleon, licensed under MIT.
