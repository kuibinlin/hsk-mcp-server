import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { formsByHeadwordId, headwordBySimplified } from "../db.js";
import { emptyResult, jsonResult } from "../response.js";

const SYSTEMS = ["pinyin", "numeric", "wadegiles", "bopomofo", "romatzyh"] as const;
type System = (typeof SYSTEMS)[number];

export function register(server: McpServer, db: D1Database): void {
  server.registerTool(
    "hsk_convert_script",
    {
      title: "Convert transcription",
      description:
        "Convert a Chinese word between transcription systems: pinyin (tone marks), " +
        "numeric (tone numbers), Wade-Giles, Bopomofo/Zhuyin, and Gwoyeu Romatzyh. " +
        "Input is a simplified Chinese word; output shows all five systems for every pronunciation form.",
      inputSchema: {
        word: z.string().describe("Simplified Chinese word (e.g. '阿姨', '好')"),
      },
    },
    async ({ word }) => {
      const hw = await headwordBySimplified(db, word);
      if (!hw) return emptyResult();

      const forms = await formsByHeadwordId(db, hw.id);
      const conversions = forms.map((f) => {
        const scripts: Record<System, string> = {
          pinyin: f.pinyin,
          numeric: f.numeric,
          wadegiles: f.wadegiles,
          bopomofo: f.bopomofo,
          romatzyh: f.romatzyh,
        };
        return { form_key: f.form_key, traditional: f.traditional, scripts };
      });

      return jsonResult({ simplified: hw.simplified, conversions });
    },
  );
}
