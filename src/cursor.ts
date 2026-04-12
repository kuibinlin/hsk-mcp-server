// HMAC-signed pagination cursors with bounded offset.
// Encodes {offset, query fingerprint} into an opaque token; the HMAC prevents
// clients from forging offsets beyond MAX_OFFSET or reusing a cursor across
// different queries.

export const PAGE_SIZE = 20;
export const MAX_OFFSET = 2000;

const te = new TextEncoder();
const td = new TextDecoder();

// ── Public API ───────────────────────────────────────────────────────

/** Deterministic fingerprint from query parameters (sorted key=value pairs). */
export function fingerprint(params: Record<string, string | number>): string {
  return Object.keys(params)
    .sort()
    .map((k) => `${k}=${String(params[k])}`)
    .join("&");
}

/** Encode a cursor for the next page. Returns null when nextOffset is out of bounds. */
export async function encodeCursor(
  nextOffset: number,
  fp: string,
  secret: string,
): Promise<string | null> {
  if (nextOffset <= 0 || nextOffset > MAX_OFFSET) return null;
  const payload = JSON.stringify({ o: nextOffset, q: fp });
  const sig = await hmacSign(payload, secret);
  return `${strToB64(payload)}.${bufToB64(sig)}`;
}

/** Decode a cursor token. Returns the offset. Throws CursorError on any problem. */
export async function decodeCursor(token: string, fp: string, secret: string): Promise<number> {
  const dot = token.indexOf(".");
  if (dot < 1) throw new CursorError("malformed cursor");

  const payload = b64ToStr(token.slice(0, dot));
  const expectedSig = bufToB64(await hmacSign(payload, secret));
  if (token.slice(dot + 1) !== expectedSig) throw new CursorError("invalid cursor signature");

  const { o, q } = JSON.parse(payload) as { o: number; q: string };
  if (q !== fp) throw new CursorError("cursor does not match current query");
  if (typeof o !== "number" || o <= 0 || o > MAX_OFFSET)
    throw new CursorError("cursor offset out of range");

  return o;
}

export class CursorError extends Error {
  override name = "CursorError";
}

/**
 * Resolve a cursor token to an offset.
 * Returns 0 when no token is provided (first page).
 * Returns `{ error: string }` on invalid cursors so callers can
 * return an MCP error without a try/catch block.
 */
export async function resolveOffset(
  token: string | undefined,
  fp: string,
  secret: string,
): Promise<number | { error: string }> {
  if (!token) return 0;
  try {
    return await decodeCursor(token, fp, secret);
  } catch (e) {
    if (e instanceof CursorError) return { error: e.message };
    throw e;
  }
}

// ── Internals ────────────────────────────────────────────────────────

async function hmacSign(payload: string, secret: string): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey(
    "raw",
    te.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", key, te.encode(payload));
}

function strToB64(s: string): string {
  const bytes = te.encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function b64ToStr(b64: string): string {
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
  return td.decode(bytes);
}

function bufToB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
