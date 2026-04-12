import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { encodeCursor, fingerprint, PAGE_SIZE, resolveOffset } from "../cursor.js";
import { formsByHeadwordIds, suggestWords } from "../db.js";
import { errorResult, paginatedResult } from "../response.js";
import { groupFormsByHeadword, shapeWord } from "../shape.js";

export function register(server: McpServer, db: D1Database, secret: string): void {
  server.registerTool(
    "hsk_suggest_next_words",
    {
      title: "Suggest next words",
      description:
        "Suggest the next words to learn at a given HSK level, excluding words the learner already knows. " +
        "Results are ordered by frequency (most useful words first). Paginated. " +
        "Meanings are in English.",
      inputSchema: {
        level: z.number().int().min(1).max(7).describe("Target HSK level (1-7)"),
        scheme: z
          .enum(["new", "old"])
          .default("new")
          .describe("HSK scheme: 'new' (3.0) or 'old' (2.0)"),
        known: z
          .array(z.string())
          .default([])
          .describe("Simplified Chinese words the learner already knows (e.g. ['你好', '谢谢'])"),
        cursor: z.string().optional().describe("Pagination cursor from a previous response"),
      },
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
