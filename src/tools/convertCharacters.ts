import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { READONLY } from "../annotations.js";
import {
  formsByHeadwordId,
  formsByHeadwordIds,
  headwordBySimplified,
  headwordIdsByTraditional,
  headwordsByIds,
} from "../db.js";
import { emptyResult, jsonResult } from "../response.js";

export function register(server: McpServer, db: D1Database): void {
  server.registerTool(
    "hsk.convert_characters",
    {
      title: "Convert simplified ↔ traditional",
      description:
        "Convert a Chinese word between simplified and traditional characters. " +
        "Accepts either script and returns both with pinyin and meanings. " +
        "Covers 11,470 HSK words. Meanings are in English.",
      inputSchema: {
        word: z
          .string()
          .describe("Chinese word in simplified or traditional. Example: '国' or '國'."),
      },
      annotations: READONLY,
    },
    async ({ word }) => {
      // 1. Try simplified match
      const hw = await headwordBySimplified(db, word);
      if (hw) {
        const forms = await formsByHeadwordId(db, hw.id);
        return jsonResult({ results: shape(hw.simplified, forms) });
      }

      // 2. Try traditional match
      const tradIds = await headwordIdsByTraditional(db, word);
      if (tradIds.length > 0) {
        const hws = await headwordsByIds(db, tradIds);
        const forms = await formsByHeadwordIds(db, tradIds);
        return jsonResult({
          results: hws.flatMap((h) => {
            const hwForms = forms.filter((f) => f.headword_id === h.id);
            return shape(h.simplified, hwForms);
          }),
        });
      }

      return emptyResult();
    },
  );
}

function shape(
  simplified: string,
  forms: { traditional: string; pinyin: string; meanings_json: string }[],
) {
  return forms.map((f) => ({
    simplified,
    traditional: f.traditional,
    pinyin: f.pinyin,
    meanings: JSON.parse(f.meanings_json) as string[],
  }));
}
