import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { READONLY } from "../annotations.js";
import { encodeCursor, fingerprint, PAGE_SIZE, resolveOffset } from "../cursor.js";
import { headwordsByIds, searchGloss } from "../db.js";
import { errorResult, paginatedResult } from "../response.js";
import { shapeForm } from "../shape.js";

export function register(server: McpServer, db: D1Database, secret: string): void {
  server.registerTool(
    "hsk.search_meaning",
    {
      title: "Search by English meaning",
      description:
        "Search for HSK words by English meaning using full-text search. " +
        "Each result includes simplified characters, pinyin, all transcription systems, meanings, " +
        "classifiers, and HSK levels. Ordered by relevance. Paginated (20 per page).",
      inputSchema: {
        query: z
          .string()
          .describe("English meaning to search for. Example: 'recommend', 'beautiful', 'to eat'."),
        cursor: z.string().optional().describe("Pagination cursor from a previous response."),
      },
      annotations: READONLY,
    },
    async ({ query, cursor: token }) => {
      const fp = fingerprint({ query });
      const offset = await resolveOffset(token, fp, secret);
      if (typeof offset !== "number") return errorResult(offset.error);

      const forms = await searchGloss(db, query, PAGE_SIZE + 1, offset);
      const hasMore = forms.length > PAGE_SIZE;
      const page = hasMore ? forms.slice(0, PAGE_SIZE) : forms;

      const hwIds = [...new Set(page.map((f) => f.headword_id))];
      const hws = await headwordsByIds(db, hwIds);
      const hwMap = new Map(hws.map((h) => [h.id, h]));

      const results = page.map((f) => {
        const hw = hwMap.get(f.headword_id);
        return {
          simplified: hw?.simplified ?? "",
          new_level: hw?.new_level ?? null,
          old_level: hw?.old_level ?? null,
          form: shapeForm(f),
        };
      });

      const nextCursor = hasMore ? await encodeCursor(offset + PAGE_SIZE, fp, secret) : null;
      return paginatedResult(results, nextCursor);
    },
  );
}
