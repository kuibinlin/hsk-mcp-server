import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { encodeCursor, fingerprint, PAGE_SIZE, resolveOffset } from "../cursor.js";
import { formsByHeadwordIds, headwordsByRadical } from "../db.js";
import { errorResult, paginatedResult } from "../response.js";
import { groupFormsByHeadword, shapeWord } from "../shape.js";

export function register(server: McpServer, db: D1Database, secret: string): void {
  server.registerTool(
    "hsk_words_by_radical",
    {
      title: "Words by radical",
      description:
        "Find all HSK words that share a given radical (部首). " +
        "Returns full word details ordered by frequency rank. Paginated. " +
        "Meanings are in English.",
      inputSchema: {
        radical: z.string().describe("Chinese radical character (e.g. '女', '水', '心')"),
        cursor: z.string().optional().describe("Pagination cursor from a previous response"),
      },
    },
    async ({ radical, cursor: token }) => {
      const fp = fingerprint({ radical });
      const offset = await resolveOffset(token, fp, secret);
      if (typeof offset !== "number") return errorResult(offset.error);

      const hws = await headwordsByRadical(db, radical, PAGE_SIZE + 1, offset);
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
