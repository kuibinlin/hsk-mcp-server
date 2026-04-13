import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { READONLY } from "../annotations.js";
import { formsByHeadwordIds, headwordsBySimplifiedList } from "../db.js";
import { jsonResult } from "../response.js";
import { groupFormsByHeadword, shapeWord } from "../shape.js";

export function register(server: McpServer, db: D1Database): void {
  server.registerTool(
    "hsk.compare",
    {
      title: "Compare words",
      description:
        "Compare 2-5 Chinese words side by side. " +
        "Each word shows simplified/traditional characters, pinyin, part of speech, frequency rank, " +
        "HSK levels, radical, all transcription systems, and meanings.",
      inputSchema: {
        words: z
          .array(z.string())
          .min(2)
          .max(5)
          .describe("Simplified Chinese words to compare. Example: ['聪明', '推荐', '参考']."),
      },
      annotations: READONLY,
    },
    async ({ words }) => {
      const hws = await headwordsBySimplifiedList(db, words);
      const ids = hws.map((h) => h.id);
      const forms = await formsByHeadwordIds(db, ids);
      const grouped = groupFormsByHeadword(forms);

      // Preserve requested order; mark missing words
      const results = words.map((w) => {
        const hw = hws.find((h) => h.simplified === w);
        if (!hw) return { simplified: w, found: false as const };
        return { ...shapeWord(hw, grouped.get(hw.id) ?? []), found: true as const };
      });

      return jsonResult({ comparisons: results });
    },
  );
}
