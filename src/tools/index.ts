import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { register as buildStudySet } from "./buildStudySet.js";
import { register as classifierFor } from "./classifierFor.js";
import { register as compareWords } from "./compareWords.js";
import { register as convertCharacters } from "./convertCharacters.js";
import { register as convertScript } from "./convertScript.js";
import { register as frequencyRank } from "./frequencyRank.js";
import { register as homophoneDrill } from "./homophoneDrill.js";
import { register as hskDiff } from "./hskDiff.js";
import { register as lookupWord } from "./lookupWord.js";
import { register as polyphones } from "./polyphones.js";
import { register as searchMeaning } from "./searchMeaning.js";
import { register as suggestNextWords } from "./suggestNextWords.js";
import { register as wordsByRadical } from "./wordsByRadical.js";

export function registerTools(server: McpServer, db: D1Database, cursorSecret: string): void {
  // Lookup tools
  lookupWord(server, db);
  frequencyRank(server, db);
  convertScript(server, db);
  classifierFor(server, db);
  convertCharacters(server, db);

  // Search/filter tools (paginated)
  searchMeaning(server, db, cursorSecret);
  wordsByRadical(server, db, cursorSecret);
  polyphones(server, db, cursorSecret);
  homophoneDrill(server, db, cursorSecret);

  // Study tools (paginated)
  buildStudySet(server, db, cursorSecret);
  suggestNextWords(server, db, cursorSecret);

  // Comparison tools
  compareWords(server, db);
  hskDiff(server, db);
}
