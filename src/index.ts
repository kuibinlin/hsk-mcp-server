import { handleMcp } from "./mcp.js";
import { corsPreflight, withCors } from "./middleware/cors.js";
import { withErrorWrap } from "./middleware/errorWrap.js";
import { checkRateLimit } from "./middleware/rateLimit.js";
import type { Env } from "./types.js";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === "OPTIONS") {
      return corsPreflight();
    }

    const url = new URL(request.url);

    if (url.pathname === "/healthz") {
      return withCors(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }

    if (url.pathname === "/.well-known/mcp.json") {
      const body = {
        name: "hsk-mcp",
        description: "HSK Chinese vocabulary MCP server — 13 tutor-oriented tools for Claude",
        url: `${url.origin}/mcp`,
        protocolVersion: "2025-11-25",
        transport: "streamable-http",
      };
      return withCors(
        new Response(JSON.stringify(body, null, 2), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }

    if (url.pathname === "/.well-known/mcp/server-card.json") {
      return withCors(
        new Response(JSON.stringify(serverCard(url.origin), null, 2), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }

    if (url.pathname === "/mcp" || url.pathname.startsWith("/mcp/")) {
      const rateLimited = await checkRateLimit(request, env);
      if (rateLimited) return withCors(rateLimited);

      const safeMcp = withErrorWrap((req) => handleMcp(req, env, ctx));
      const response = await safeMcp(request);
      return withCors(response);
    }

    return withCors(new Response("Not Found", { status: 404 }));
  },
} satisfies ExportedHandler<Env>;

function serverCard(origin: string) {
  return {
    serverInfo: { name: "hsk-mcp", version: "0.1.0" },
    authentication: { required: false },
    url: `${origin}/mcp`,
    tools: [
      {
        name: "hsk.lookup",
        description:
          "Look up a Chinese word by simplified characters, traditional characters, or pinyin. " +
          "Returns all pronunciation forms with meanings, frequency rank, and HSK level.",
      },
      {
        name: "hsk.frequency",
        description: "Get frequency ranking, rarity class, and HSK level for a Chinese word.",
      },
      {
        name: "hsk.convert_script",
        description:
          "Convert a Chinese word to all 5 transcription systems: pinyin, numeric, Wade-Giles, Bopomofo, Romatzyh.",
      },
      {
        name: "hsk.classifier",
        description: "Find the measure word (classifier / 量词) for a Chinese noun.",
      },
      {
        name: "hsk.convert_characters",
        description:
          "Convert between simplified and traditional Chinese characters with pinyin and meanings.",
      },
      {
        name: "hsk.search_meaning",
        description:
          "Search for HSK words by English meaning using full-text search. Ordered by relevance. Paginated.",
      },
      {
        name: "hsk.words_by_radical",
        description:
          "Find all HSK words sharing a given radical (部首), ordered by frequency. Paginated.",
      },
      {
        name: "hsk.polyphones",
        description:
          "List characters with multiple pronunciations (多音字) with all readings. Paginated.",
      },
      {
        name: "hsk.homophones",
        description:
          "Find words sharing the same pinyin pronunciation for tone-pair drilling. Paginated.",
      },
      {
        name: "hsk.build_study_set",
        description:
          "Build a study set for an HSK level with pinyin, part of speech, meanings, and frequency. Paginated.",
      },
      {
        name: "hsk.suggest_next",
        description:
          "Suggest next words to learn at an HSK level, excluding words already known. Paginated.",
      },
      {
        name: "hsk.compare",
        description:
          "Compare 2-5 Chinese words side by side: frequency, HSK levels, part of speech, meanings.",
      },
      {
        name: "hsk.diff",
        description: "Compare two HSK levels to see vocabulary overlap and differences.",
      },
    ],
    resources: [
      {
        uri: "hsk://meta",
        description: "Server metadata: dataset version, tool count, headword/form counts",
      },
      { uri: "hsk://level/1", description: "Full vocabulary list for HSK 3.0 level 1" },
      { uri: "hsk://level/2", description: "Full vocabulary list for HSK 3.0 level 2" },
      { uri: "hsk://level/3", description: "Full vocabulary list for HSK 3.0 level 3" },
      { uri: "hsk://level/4", description: "Full vocabulary list for HSK 3.0 level 4" },
      { uri: "hsk://level/5", description: "Full vocabulary list for HSK 3.0 level 5" },
      { uri: "hsk://level/6", description: "Full vocabulary list for HSK 3.0 level 6" },
      { uri: "hsk://level/7", description: "Full vocabulary list for HSK 3.0 level 7" },
    ],
  };
}
