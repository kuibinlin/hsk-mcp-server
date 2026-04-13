import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { READONLY } from "../annotations.js";
import { encodeCursor, fingerprint, PAGE_SIZE, resolveOffset } from "../cursor.js";
import { formsByHeadwordIds, suggestWords } from "../db.js";
import { errorResult, paginatedResult } from "../response.js";
import { groupFormsByHeadword, shapeWord } from "../shape.js";

export function register(server: McpServer, db: D1Database, secret: string): void {
  server.registerTool(
    "hsk_suggest_next",
    {
      title: "Suggest next words",
      description:
        "Suggest the next words to learn at a given HSK level, excluding words already known. " +
        "Each word includes simplified/traditional characters, pinyin, part of speech, meanings, " +
        "radical, frequency rank, and HSK levels. Ordered by frequency (most useful first). " +
        "Paginated (20 per page).",
      inputSchema: {
        level: z.number().int().min(1).max(7).describe("Target HSK level. Range: 1-7."),
        scheme: z
          .enum(["new", "old"])
          .default("new")
          .describe(
            "HSK scheme. 'new' = HSK 3.0 (levels 1-7), 'old' = HSK 2.0 (levels 1-6). Default: 'new'.",
          ),
        known: z
          .array(z.string())
          .default([])
          .describe(
            "Simplified Chinese words the learner already knows. Example: ['你好', '谢谢', '外卖'].",
          ),
        cursor: z.string().optional().describe("Pagination cursor from a previous response."),
      },
      annotations: READONLY,
    },
    async ({ level, scheme, known, cursor: token }) => {
      // Sort known list so fingerprint is stable regardless of input order
      const sortedKnown = [...known].sort();
      const fp = fingerprint({ level, scheme, known: sortedKnown.join(",") });
      const offset = await resolveOffset(token, fp, secret);
      if (typeof offset !== "number") return errorResult(offset.error);

      const hws = await suggestWords(db, scheme, level, sortedKnown, PAGE_SIZE + 1, offset);
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
