// D1 error-wrapping middleware.
// Catches database errors and returns a sanitized JSON-RPC -32603 response
// so callers never see raw D1 internals.

export function withErrorWrap(handler: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    try {
      return await handler(req);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("Unhandled error:", message);

      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Dataset temporarily unavailable" },
          id: null,
        }),
        { status: 500, headers: { "content-type": "application/json" } },
      );
    }
  };
}
