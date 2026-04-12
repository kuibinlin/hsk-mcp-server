// Shared MCP tool response helpers.
// Every tool returns through one of these to keep formatting consistent.
// `_meta.dataset_version` is attached to every successful response.

type TextContent = { type: "text"; text: string };
type ToolResult = { content: TextContent[]; isError?: boolean };

interface Meta {
  dataset_version: string;
}

let _meta: Meta = { dataset_version: "unknown" };

/** Call once at startup to set the dataset version for all responses. */
export function setDatasetVersion(version: string): void {
  _meta = { dataset_version: version };
}

/** Wrap any data object as a successful MCP tool response. */
export function jsonResult(data: unknown): ToolResult {
  const body = typeof data === "object" && data !== null ? { ...data, _meta } : data;
  return { content: [{ type: "text", text: JSON.stringify(body, null, 2) }] };
}

/** Paginated response with next_cursor. */
export function paginatedResult(items: unknown[], nextCursor: string | null): ToolResult {
  return jsonResult({ results: items, next_cursor: nextCursor });
}

/** Standard empty-result response (not an error — zero matches is valid). */
export function emptyResult(): ToolResult {
  return jsonResult({ results: [], next_cursor: null });
}

/** Error response shown to the LLM. */
export function errorResult(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}
