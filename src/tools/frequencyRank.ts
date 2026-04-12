import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { formsByHeadwordId, headwordBySimplified } from "../db.js";
import { emptyResult, jsonResult } from "../response.js";
import { shapeWord } from "../shape.js";

export function register(server: McpServer, db: D1Database): void {
  server.registerTool(
    "hsk_frequency_rank",
    {
      title: "Frequency rank",
      description:
        "Get the frequency ranking and usage statistics for a Chinese word. " +
        "Returns the word's rank among common HSK vocabulary (1 = most frequent), " +
        "raw frequency score, rarity class, and HSK level. " +
        "Meanings are in English.",
      inputSchema: {
        word: z.string().describe("Simplified Chinese word to look up (e.g. '的', '好')"),
      },
    },
    async ({ word }) => {
      const hw = await headwordBySimplified(db, word);
      if (!hw) return emptyResult();

      const forms = await formsByHeadwordId(db, hw.id);
      return jsonResult({ results: [shapeWord(hw, forms)] });
    },
  );
}
