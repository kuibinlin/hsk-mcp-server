import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { register as frequencyRank } from "./frequencyRank.js";
import { register as hskDiff } from "./hskDiff.js";
import { register as lookupWord } from "./lookupWord.js";
import { register as polyphones } from "./polyphones.js";
import { register as searchMeaning } from "./searchMeaning.js";
import { register as wordsByRadical } from "./wordsByRadical.js";

export function registerTools(server: McpServer, db: D1Database, cursorSecret: string): void {
  lookupWord(server, db);
  searchMeaning(server, db, cursorSecret);
  wordsByRadical(server, db, cursorSecret);
  polyphones(server, db, cursorSecret);
  frequencyRank(server, db);
  hskDiff(server, db);
}
