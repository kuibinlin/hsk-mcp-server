import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { READONLY } from "../annotations.js";
import { formsByHeadwordIds, headwordsByLevel } from "../db.js";
import { jsonResult } from "../response.js";
import { groupFormsByHeadword, shapeWordBrief } from "../shape.js";

export function register(server: McpServer, db: D1Database): void {
  server.registerTool(
    "hsk.diff",
    {
      title: "Compare HSK levels",
      description:
        "Compare two HSK levels to see vocabulary overlap and differences. " +
        "Shows words exclusive to each level and words shared by both. " +
        "Useful for comparing old (HSK 2.0) vs new (HSK 3.0) standards.",
      inputSchema: {
        level_a: z.number().int().min(1).max(7).describe("First HSK level. Range: 1-7."),
        scheme_a: z
          .enum(["new", "old"])
          .default("new")
          .describe("HSK scheme for level_a. 'new' = HSK 3.0, 'old' = HSK 2.0. Default: 'new'."),
        level_b: z.number().int().min(1).max(7).describe("Second HSK level. Range: 1-7."),
        scheme_b: z
          .enum(["new", "old"])
          .default("new")
          .describe("HSK scheme for level_b. 'new' = HSK 3.0, 'old' = HSK 2.0. Default: 'new'."),
      },
      annotations: READONLY,
    },
    async ({ level_a, scheme_a, level_b, scheme_b }) => {
      const [hwsA, hwsB] = await Promise.all([
        headwordsByLevel(db, scheme_a, level_a),
        headwordsByLevel(db, scheme_b, level_b),
      ]);

      const setA = new Set(hwsA.map((h) => h.id));
      const setB = new Set(hwsB.map((h) => h.id));

      const onlyA = hwsA.filter((h) => !setB.has(h.id));
      const onlyB = hwsB.filter((h) => !setA.has(h.id));
      const both = hwsA.filter((h) => setB.has(h.id));

      // Batch-fetch forms for all headwords in one query
      const allIds = [...onlyA, ...onlyB, ...both].map((h) => h.id);
      const allForms = await formsByHeadwordIds(db, allIds);
      const grouped = groupFormsByHeadword(allForms);

      const brief = (hws: typeof hwsA) =>
        hws.map((h) => shapeWordBrief(h, grouped.get(h.id) ?? []));

      return jsonResult({
        label_a: `${scheme_a}-${level_a}`,
        label_b: `${scheme_b}-${level_b}`,
        only_a: brief(onlyA),
        only_b: brief(onlyB),
        both: brief(both),
        counts: { only_a: onlyA.length, only_b: onlyB.length, both: both.length },
      });
    },
  );
}
