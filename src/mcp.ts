import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpHandler } from "agents/mcp";
import { registerLevelLists } from "./resources/levelLists.js";
import { registerMeta } from "./resources/meta.js";
import { setDatasetVersion } from "./response.js";
import { registerTools } from "./tools/index.js";
import type { Env } from "./types.js";

const DEV_CURSOR_SECRET = "hsk-mcp-dev-cursor-key";

function buildServer(env: Env): McpServer {
  setDatasetVersion(env.DATASET_VERSION);

  const server = new McpServer(
    { name: "hsk-mcp", version: "0.1.0" },
    { capabilities: { tools: {}, resources: {} } },
  );

  registerTools(server, env.DB, env.CURSOR_SECRET ?? DEV_CURSOR_SECRET);
  registerMeta(server, env.DB, env);
  registerLevelLists(server, env.DB);

  return server;
}

export function handleMcp(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  // Fresh server + handler per request — reuse triggers "already connected" error.
  const handler = createMcpHandler(buildServer(env), { route: "/mcp" });
  return handler(request, env, ctx);
}
