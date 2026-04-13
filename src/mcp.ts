import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpHandler } from "agents/mcp";
import { z } from "zod";
import { registerLevelLists } from "./resources/levelLists.js";
import { registerMeta } from "./resources/meta.js";
import { setDatasetVersion } from "./response.js";
import { registerTools } from "./tools/index.js";
import type { Env } from "./types.js";

const DEV_CURSOR_SECRET = "hsk-mcp-dev-cursor-key";

const SERVER_INSTRUCTIONS = [
  "You are connected to the HSK Chinese Vocabulary MCP server.",
  "It provides 13 read-only tools covering 11,470 headwords and 12,623 pronunciation forms across HSK 1-7 (new 3.0) and HSK 1-6 (old 2.0).",
  "",
  "Tool routing guide:",
  "- For word lookup by characters or pinyin: hsk_lookup",
  "- For frequency/rarity info: hsk_frequency",
  "- For transcription systems (pinyin, Wade-Giles, Bopomofo, Romatzyh): hsk_convert_script",
  "- For simplified ↔ traditional conversion: hsk_convert_characters",
  "- For measure words: hsk_classifier",
  "- For English meaning search: hsk_search_meaning",
  "- For radical-based search: hsk_words_by_radical",
  "- For characters with multiple readings: hsk_polyphones",
  "- For same-sound words: hsk_homophones",
  "- For level word lists: hsk_build_study_set",
  "- For personalized suggestions: hsk_suggest_next (pass known words to exclude them)",
  "- For side-by-side word comparison: hsk_compare",
  "- For level overlap/differences: hsk_diff",
  "",
  "All tools return structured JSON with pinyin, part of speech, meanings (English), frequency rank, and HSK levels.",
  "Paginated tools return 20 results per page. Pass the next_cursor value to fetch more.",
  "Present results in a clear format — tables work well for study sets and comparisons.",
].join("\n");

function buildServer(env: Env): McpServer {
  setDatasetVersion(env.DATASET_VERSION);

  const server = new McpServer(
    { name: "hsk-mcp", version: "0.1.0" },
    {
      capabilities: { tools: {}, resources: {} },
      instructions: SERVER_INSTRUCTIONS,
    },
  );

  registerTools(server, env.DB, env.CURSOR_SECRET ?? DEV_CURSOR_SECRET);
  registerMeta(server, env.DB, env);
  registerLevelLists(server, env.DB);
  registerPrompts(server);

  return server;
}

function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    "hsk-study-session",
    {
      title: "HSK study session",
      description:
        "Start a guided HSK study session. Builds a study set for your level, " +
        "lets you exclude words you already know, and presents vocabulary as a structured table.",
      argsSchema: {
        level: z.string().describe("HSK level (1-7). Example: '3'."),
      },
    },
    ({ level }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `I want to study HSK level ${level} vocabulary.`,
              "Use hsk_build_study_set to get the word list.",
              "Present results as a markdown table with columns: Word, Pinyin, Part of Speech, Meaning, Frequency Rank.",
              "After showing the first page, ask if I want to see more or if there are words I already know to exclude.",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "hsk-word-deep-dive",
    {
      title: "Deep dive into a word",
      description:
        "Get comprehensive details about a Chinese word: all transcription systems, " +
        "frequency rank, part of speech, classifiers, and homophones.",
      argsSchema: {
        word: z.string().describe("Chinese word to explore. Example: '翻译'."),
      },
    },
    ({ word }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `I want to deeply explore the word "${word}".`,
              "1. Use hsk_lookup to get full details (meanings, part of speech, HSK level, frequency).",
              "2. Use hsk_convert_script to show all transcription systems.",
              "3. Use hsk_classifier to check if it has a measure word.",
              "4. Use hsk_homophones to find words with the same pinyin.",
              "Present everything in a clear, organized format.",
            ].join("\n"),
          },
        },
      ],
    }),
  );
}

export function handleMcp(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  // Fresh server + handler per request — reuse triggers "already connected" error.
  const handler = createMcpHandler(buildServer(env), { route: "/mcp" });
  return handler(request, env, ctx);
}
