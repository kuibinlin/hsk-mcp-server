import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpHandler } from "agents/mcp";
import { z } from "zod";

function buildServer(): McpServer {
  const server = new McpServer(
    { name: "hsk-mcp", version: "0.1.0" },
    { capabilities: { tools: {}, resources: {} } },
  );

  server.registerTool(
    "hsk_ping",
    {
      title: "HSK ping",
      description:
        "Phase 0 smoke-test tool. Returns 'pong' plus the server's dataset version. " +
        "Use this to verify the MCP connection is live.",
      inputSchema: {},
      outputSchema: {
        message: z.string(),
        dataset_version: z.string(),
      },
    },
    async () => {
      const payload = {
        message: "pong",
        dataset_version: "unpinned",
      };
      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload,
      };
    },
  );

  return server;
}

export function handleMcp(
  request: Request,
  env: unknown,
  ctx: ExecutionContext,
): Promise<Response> {
  const handler = createMcpHandler(buildServer(), { route: "/mcp" });
  return handler(request, env, ctx);
}
