import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { countForms, countHeadwords } from "../db.js";
import type { Env } from "../types.js";

export function registerMeta(server: McpServer, db: D1Database, env: Env): void {
  server.registerResource(
    "meta",
    "hsk://meta",
    { description: "Server metadata: dataset version, tool count, and vocabulary statistics." },
    async () => {
      const [headwordCount, formCount] = await Promise.all([
        countHeadwords(db),
        countForms(db),
      ]);

      const data = {
        dataset_version: env.DATASET_VERSION,
        tool_count: 12,
        headword_count: headwordCount,
        form_count: formCount,
      };

      return {
        contents: [
          { uri: "hsk://meta", mimeType: "application/json", text: JSON.stringify(data, null, 2) },
        ],
      };
    },
  );
}
