import { handleMcp } from "./mcp";
import { corsPreflight, withCors } from "./middleware/cors";
import type { Env } from "./types";

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
        description: "HSK Chinese vocabulary MCP server (Phase 0 scaffold)",
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
      const response = await handleMcp(request, env, ctx);
      return withCors(response);
    }

    return withCors(new Response("Not Found", { status: 404 }));
  },
} satisfies ExportedHandler<Env>;
