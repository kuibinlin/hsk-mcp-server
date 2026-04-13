import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { READONLY } from "../annotations.js";
import { formsByHeadwordId, headwordBySimplified } from "../db.js";
import { emptyResult, jsonResult } from "../response.js";

export function register(server: McpServer, db: D1Database): void {
  server.registerTool(
    "hsk_classifier",
    {
      title: "Classifier for word",
      description:
        "Find the measure word (classifier / 量词) for a Chinese noun. " +
        "Returns all classifiers associated with the word. " +
        "Empty list if no classifiers exist in the dataset.",
      inputSchema: {
        word: z.string().describe("Simplified Chinese noun. Example: '书', '航班', '猫'."),
      },
      annotations: READONLY,
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
