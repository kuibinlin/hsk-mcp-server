const ALLOW_HEADERS = [
  "content-type",
  "mcp-session-id",
  "mcp-protocol-version",
  "authorization",
  "accept",
].join(", ");

const BASE_CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": ALLOW_HEADERS,
  "Access-Control-Expose-Headers": "mcp-session-id, mcp-protocol-version",
  "Access-Control-Max-Age": "86400",
  Vary: "Origin",
};

export function corsPreflight(): Response {
  return new Response(null, { status: 204, headers: BASE_CORS });
}

export function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(BASE_CORS)) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
