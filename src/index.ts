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
