// Tool annotation constants for MCP clients.
// All HSK tools are read-only queries against a local D1 database.

export const READONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;
