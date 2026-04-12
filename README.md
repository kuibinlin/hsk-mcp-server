# HSK MCP Server

A remote [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server that gives AI assistants structured access to the complete HSK Chinese vocabulary dataset. It exposes 12 tools and 8 resources covering word lookup, transcription conversion, frequency analysis, study set generation, and more.

**11,470 headwords / 12,623 pronunciation forms / HSK 1-7 (new 3.0) + HSK 1-6 (old 2.0)**

## What is this?

MCP is an open protocol that lets AI assistants (like Claude) call external tools and read external data in a standardized way. This server turns the HSK vocabulary into a set of tools that any MCP-compatible client can use.

When you connect this server to Claude (or any MCP client), the AI can look up Chinese words, search by meaning, compare HSK levels, find homophones, suggest study vocabulary, and more — all backed by a real database instead of relying on training data.

## Connecting to the server

### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "hsk": {
      "url": "https://hsk-mcp.linsnotes.com/mcp"
    }
  }
}
```

### Claude Code (CLI)

```bash
claude mcp add hsk --transport streamable-http https://hsk-mcp.linsnotes.com/mcp
```

### Cursor / Windsurf / other MCP clients

Use the Streamable HTTP transport with URL:

```
https://hsk-mcp.linsnotes.com/mcp
```

No API key or authentication is required. The server is publicly accessible and free to use.

## What you can ask

Once connected, just talk to your AI assistant naturally. The assistant will call the right tools automatically. Examples:

- "Look up the word 阿姨"
- "What HSK level is 呵护?"
- "Find Chinese words meaning 'beautiful'"
- "Show me HSK level 3 words with the 口 radical"
- "Give me 5 polyphones (characters with multiple readings)"
- "What's the frequency rank of 啊?"
- "Convert 阿姨 to Wade-Giles and Bopomofo"
- "I know 你好 and 谢谢 — what should I learn next at HSK 1?"
- "Compare the words 呵 and 啊"
- "What classifier (measure word) goes with 书?"

## Tools

### Lookup

| Tool | Description | Input |
|------|-------------|-------|
| `hsk_lookup_word` | Look up a word by simplified, traditional, or pinyin. Returns all forms with meanings, frequency, and HSK level. | `word` |
| `hsk_frequency_rank` | Get frequency ranking and rarity class for a word (1 = most common). | `word` |
| `hsk_convert_script` | Show a word in all 5 transcription systems: pinyin, numeric, Wade-Giles, Bopomofo, Romatzyh. | `word` |
| `hsk_classifier_for` | Find the measure word(s) for a noun. | `word` |

### Search & filter (paginated)

| Tool | Description | Input |
|------|-------------|-------|
| `hsk_search_meaning` | Full-text search by English meaning, ranked by relevance. | `query`, `cursor?` |
| `hsk_words_by_radical` | Find all words sharing a radical, ordered by frequency. | `radical`, `cursor?` |
| `hsk_polyphones` | List characters with multiple pronunciations (多音字). | `cursor?` |
| `hsk_homophone_drill` | Find words sharing the same pinyin (homophones). Accepts tone marks, numbers, or plain ASCII. | `pinyin`, `cursor?` |

### Study tools (paginated)

| Tool | Description | Input |
|------|-------------|-------|
| `hsk_build_study_set` | Build a study set for a level, ordered by frequency. | `level`, `scheme?`, `cursor?` |
| `hsk_suggest_next_words` | Suggest next words to learn, excluding words you already know. | `level`, `scheme?`, `known[]`, `cursor?` |

### Comparison

| Tool | Description | Input |
|------|-------------|-------|
| `hsk_compare_words` | Compare 2-5 words side by side (frequency, levels, meanings, radicals). | `words[]` |
| `hsk_diff` | Compare two HSK levels to see vocabulary overlap and differences. | `level_a`, `scheme_a?`, `level_b`, `scheme_b?` |

**Notes:**
- `scheme` is `"new"` (HSK 3.0, levels 1-7) or `"old"` (HSK 2.0, levels 1-6). Defaults to `"new"`.
- Paginated tools return 20 results per page with a `next_cursor` for fetching more.
- All meanings are in English.

## Resources

The server also exposes MCP resources — read-only data the client can fetch:

| URI | Description |
|-----|-------------|
| `hsk://meta` | Server metadata: dataset version, tool count, headword/form counts |
| `hsk://level/1` through `hsk://level/7` | Full vocabulary list for each HSK 3.0 level |

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

Dataset: [drkameleon/complete-hsk-vocabulary](https://github.com/drkameleon/complete-hsk-vocabulary) (MIT), pinned at commit `7ac65bf1`.

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
|  |  - 12 tools          |  |
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

Full-text search uses three FTS5 indexes:
- **English meanings** — `unicode61` tokenizer for natural language search
- **Pinyin** — `trigram` tokenizer so "nihao" matches without spaces or tones
- **Hanzi** — `trigram` tokenizer for character substring matching

## Tech stack

| Component | Technology |
|-----------|-----------|
| Runtime | [Cloudflare Workers](https://workers.cloudflare.com) |
| Database | [Cloudflare D1](https://developers.cloudflare.com/d1/) (SQLite at the edge) |
| Protocol | [MCP](https://modelcontextprotocol.io) via Streamable HTTP |
| MCP SDK | [@modelcontextprotocol/sdk](https://www.npmjs.com/package/@modelcontextprotocol/sdk) + [agents](https://www.npmjs.com/package/agents) |
| Language | TypeScript |
| Validation | [Zod](https://zod.dev) |
| Testing | [Vitest](https://vitest.dev) |
| Linting | [Biome](https://biomejs.dev) |
| CI | GitHub Actions (typecheck + test on PRs) |
| Deploy | Cloudflare Git integration (auto-deploy on push) |

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
  mcp.ts                # MCP server setup + tool/resource registration
  types.ts              # Env interface (D1, KV, secrets)
  cursor.ts             # HMAC-signed pagination cursors
  db.ts                 # Typed D1 query helpers
  shape.ts              # DB row -> clean response shaping
  response.ts           # MCP response formatting helpers
  pinyin.ts             # Tone stripping, normalization
  middleware/
    cors.ts             # CORS headers
    errorWrap.ts        # D1 error -> JSON-RPC -32603
    rateLimit.ts        # Per-IP rate limiting (30/min, 5k/day)
  tools/                # 12 tool handlers (one file each)
  resources/            # MCP resources (meta, level lists)
sql/
  schema.sql            # D1 DDL (tables, indexes, FTS5)
scripts/
  build-seed.ts         # complete.json -> sql/seed.sql
  verify-dataset.ts     # Dataset invariant checks
```

## License

MIT

## Attribution

Dataset: [drkameleon/complete-hsk-vocabulary](https://github.com/drkameleon/complete-hsk-vocabulary) by drkameleon, licensed under MIT. Pinned at commit [`7ac65bf1`](https://github.com/drkameleon/complete-hsk-vocabulary/tree/7ac65bf1a6387d35f1ade478906172a19311c7f9).
