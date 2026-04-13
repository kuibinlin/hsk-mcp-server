import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { formsByHeadwordIds, headwordsByLevel } from "../db.js";
import { groupFormsByHeadword, shapeWordBrief } from "../shape.js";

export function registerLevelLists(server: McpServer, db: D1Database): void {
  for (let level = 1; level <= 7; level++) {
    server.registerResource(
      `level-${level}`,
      `hsk://level/${level}`,
      {
        description: `HSK 3.0 level ${level} vocabulary list (brief format, ordered by frequency).`,
      },
      async () => {
        const hws = await headwordsByLevel(db, "new", level);
        const ids = hws.map((h) => h.id);
        const forms = await formsByHeadwordIds(db, ids);
        const grouped = groupFormsByHeadword(forms);
        const words = hws.map((h) => shapeWordBrief(h, grouped.get(h.id) ?? []));

        return {
          contents: [
            {
              uri: `hsk://level/${level}`,
              mimeType: "application/json",
              text: JSON.stringify({ level, scheme: "new", words }, null, 2),
            },
          ],
        };
      },
    );
  }
}
