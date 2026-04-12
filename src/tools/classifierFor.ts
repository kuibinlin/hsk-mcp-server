import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { formsByHeadwordId, headwordBySimplified } from "../db.js";
import { emptyResult, jsonResult } from "../response.js";

export function register(server: McpServer, db: D1Database): void {
  server.registerTool(
    "hsk_classifier_for",
    {
      title: "Classifier for word",
      description:
        "Find the measure word (classifier / 量词) for a Chinese noun. " +
        "Returns all classifiers associated with the word's forms. " +
        "If the word has no classifiers in the dataset, returns an empty list.",
      inputSchema: {
        word: z.string().describe("Simplified Chinese word (e.g. '书', '人', '猫')"),
      },
    },
    async ({ word }) => {
      const hw = await headwordBySimplified(db, word);
      if (!hw) return emptyResult();

      const forms = await formsByHeadwordId(db, hw.id);
      const allClassifiers = new Set<string>();
      for (const f of forms) {
        const cls = JSON.parse(f.classifiers_json) as string[];
        for (const c of cls) allClassifiers.add(c);
      }

      return jsonResult({
        simplified: hw.simplified,
        classifiers: [...allClassifiers],
      });
    },
  );
}
