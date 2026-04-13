import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { READONLY } from "../annotations.js";
import {
  formsByHeadwordId,
  formsByHeadwordIds,
  headwordBySimplified,
  headwordIdsByPinyinConcat,
  headwordIdsByTraditional,
  headwordsByIds,
} from "../db.js";
import { normalize } from "../pinyin.js";
import { emptyResult, jsonResult } from "../response.js";
import { groupFormsByHeadword, shapeWord } from "../shape.js";

export function register(server: McpServer, db: D1Database): void {
  server.registerTool(
    "hsk.lookup",
    {
      title: "Look up HSK word",
      description:
        "Look up a Chinese word by simplified characters, traditional characters, or pinyin. " +
        "Returns all pronunciation forms with meanings, frequency rank, and HSK level. " +
        "Pinyin input accepts tone marks (hǎo), tone numbers (hao3), or plain ASCII (hao). " +
        "Meanings are in English.",
      inputSchema: {
        word: z
          .string()
          .describe(
            "Chinese word to look up. Accepts simplified (好), traditional (國), or pinyin (hǎo / hao3 / hao).",
          ),
      },
      annotations: READONLY,
    },
    async ({ word }) => {
      // 1. Simplified exact match (unique index)
      const hw = await headwordBySimplified(db, word);
      if (hw) {
        const forms = await formsByHeadwordId(db, hw.id);
        return jsonResult({ results: [shapeWord(hw, forms)] });
      }

      // 2. Traditional match
      const tradIds = await headwordIdsByTraditional(db, word);
      if (tradIds.length > 0) return jsonResult({ results: await resolve(db, tradIds) });

      // 3. Pinyin match (normalized concat form)
      const norm = normalize(word);
      if (norm.length > 0) {
        const pyIds = await headwordIdsByPinyinConcat(db, norm);
        if (pyIds.length > 0) return jsonResult({ results: await resolve(db, pyIds) });
      }

      return emptyResult();
    },
  );
}

async function resolve(db: D1Database, ids: number[]) {
  const hws = await headwordsByIds(db, ids);
  const forms = await formsByHeadwordIds(db, ids);
  const grouped = groupFormsByHeadword(forms);
  return hws.map((h) => shapeWord(h, grouped.get(h.id) ?? []));
}
