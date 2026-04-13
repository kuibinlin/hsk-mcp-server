import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { encodeCursor, fingerprint, PAGE_SIZE, resolveOffset } from "../cursor.js";
import { formsByPinyinPlain, headwordsByIds, searchPinyin } from "../db.js";
import { normalize } from "../pinyin.js";
import { errorResult, paginatedResult } from "../response.js";
import { shapeForm } from "../shape.js";

export function register(server: McpServer, db: D1Database, secret: string): void {
  server.registerTool(
    "hsk_homophone_drill",
    {
      title: "Homophone drill",
      description:
        "Find HSK words that share the same pinyin pronunciation (homophones). " +
        "Useful for drilling tone-pair distinctions. Accepts pinyin with tone marks (yì), " +
        "tone numbers (yi4), or plain (yi). Each result includes simplified characters, pinyin, " +
        "all transcription systems, meanings, and HSK levels. " +
        "Paginated (20 per page). Meanings are in English.",
      inputSchema: {
        pinyin: z.string().describe("Pinyin to search for (e.g. 'yì', 'yi4', 'yi')"),
        cursor: z.string().optional().describe("Pagination cursor from a previous response"),
      },
    },
    async ({ pinyin, cursor: token }) => {
      const norm = normalize(pinyin);
      const fp = fingerprint({ pinyin: norm });
      const offset = await resolveOffset(token, fp, secret);
      if (typeof offset !== "number") return errorResult(offset.error);

      // Trigram FTS requires ≥3 chars. Use indexed pinyin_plain for short queries.
      const forms =
        norm.length >= 3
          ? await searchPinyin(db, norm, PAGE_SIZE + 1, offset)
          : await formsByPinyinPlain(db, norm, PAGE_SIZE + 1, offset);

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
