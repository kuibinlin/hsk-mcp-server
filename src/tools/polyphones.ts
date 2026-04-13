import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { encodeCursor, fingerprint, PAGE_SIZE, resolveOffset } from "../cursor.js";
import { formsByHeadwordIds, polyphoneHeadwords } from "../db.js";
import { errorResult, paginatedResult } from "../response.js";
import { groupFormsByHeadword, shapeWord } from "../shape.js";

export function register(server: McpServer, db: D1Database, secret: string): void {
  server.registerTool(
    "hsk_polyphones",
    {
      title: "Find polyphones",
      description:
        "List Chinese characters with multiple pronunciations (多音字) in the HSK vocabulary. " +
        "Each result includes all pronunciation forms with pinyin, meanings, and part of speech. " +
        "Ordered by frequency. Paginated (20 per page). Meanings are in English.",
      inputSchema: {
        cursor: z.string().optional().describe("Pagination cursor from a previous response"),
      },
    },
    async ({ cursor: token }) => {
      const fp = fingerprint({ tool: "polyphones" });
      const offset = await resolveOffset(token, fp, secret);
      if (typeof offset !== "number") return errorResult(offset.error);

      const hws = await polyphoneHeadwords(db, PAGE_SIZE + 1, offset);
      const hasMore = hws.length > PAGE_SIZE;
      const page = hasMore ? hws.slice(0, PAGE_SIZE) : hws;

      const ids = page.map((h) => h.id);
      const forms = await formsByHeadwordIds(db, ids);
      const grouped = groupFormsByHeadword(forms);
      const results = page.map((h) => shapeWord(h, grouped.get(h.id) ?? []));

      const nextCursor = hasMore ? await encodeCursor(offset + PAGE_SIZE, fp, secret) : null;
      return paginatedResult(results, nextCursor);
    },
  );
}
