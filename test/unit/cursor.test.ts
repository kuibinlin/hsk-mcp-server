import { describe, expect, it } from "vitest";
import {
  CursorError,
  decodeCursor,
  encodeCursor,
  fingerprint,
  MAX_OFFSET,
  resolveOffset,
} from "../../src/cursor.js";

const SECRET = "test-secret-key";

async function mustEncode(offset: number, fp: string): Promise<string> {
  const token = await encodeCursor(offset, fp, SECRET);
  expect(token).toBeTypeOf("string");
  return token as string;
}

describe("fingerprint", () => {
  it("sorts keys and joins as key=value pairs", () => {
    expect(fingerprint({ b: 2, a: "x" })).toBe("a=x&b=2");
  });

  it("is deterministic regardless of insertion order", () => {
    const a = fingerprint({ radical: "女", level: 1 });
    const b = fingerprint({ level: 1, radical: "女" });
    expect(a).toBe(b);
  });

  it("handles single param", () => {
    expect(fingerprint({ q: "hello" })).toBe("q=hello");
  });
});

describe("encodeCursor / decodeCursor round-trip", () => {
  it("round-trips offset and fingerprint", async () => {
    const fp = fingerprint({ radical: "女" });
    const token = await mustEncode(20, fp);
    expect(await decodeCursor(token, fp, SECRET)).toBe(20);
  });

  it("works with non-ASCII fingerprint values", async () => {
    const fp = fingerprint({ radical: "女" });
    const token = await mustEncode(40, fp);
    expect(await decodeCursor(token, fp, SECRET)).toBe(40);
  });

  it("works at MAX_OFFSET boundary", async () => {
    const fp = fingerprint({ q: "test" });
    const token = await mustEncode(MAX_OFFSET, fp);
    expect(await decodeCursor(token, fp, SECRET)).toBe(MAX_OFFSET);
  });
});

describe("encodeCursor bounds", () => {
  const fp = fingerprint({ q: "test" });

  it("returns null when offset exceeds MAX_OFFSET", async () => {
    expect(await encodeCursor(MAX_OFFSET + 1, fp, SECRET)).toBeNull();
  });

  it("returns null for zero offset", async () => {
    expect(await encodeCursor(0, fp, SECRET)).toBeNull();
  });

  it("returns null for negative offset", async () => {
    expect(await encodeCursor(-1, fp, SECRET)).toBeNull();
  });
});

describe("decodeCursor validation", () => {
  it("rejects tampered payload", async () => {
    const fp = fingerprint({ q: "test" });
    const token = await mustEncode(20, fp);
    const dot = token.indexOf(".");
    const tampered = `X${token.slice(1, dot)}${token.slice(dot)}`;
    await expect(decodeCursor(tampered, fp, SECRET)).rejects.toThrow(CursorError);
  });

  it("rejects wrong secret", async () => {
    const fp = fingerprint({ q: "test" });
    const token = await mustEncode(20, fp);
    await expect(decodeCursor(token, fp, "wrong-secret")).rejects.toThrow(CursorError);
  });

  it("rejects mismatched fingerprint", async () => {
    const fp1 = fingerprint({ radical: "女" });
    const fp2 = fingerprint({ radical: "水" });
    const token = await mustEncode(20, fp1);
    await expect(decodeCursor(token, fp2, SECRET)).rejects.toThrow("does not match");
  });

  it("rejects malformed token (no dot)", async () => {
    const fp = fingerprint({ q: "test" });
    await expect(decodeCursor("nodothere", fp, SECRET)).rejects.toThrow("malformed");
  });

  it("rejects empty string", async () => {
    const fp = fingerprint({ q: "test" });
    await expect(decodeCursor("", fp, SECRET)).rejects.toThrow("malformed");
  });
});

describe("resolveOffset", () => {
  it("returns 0 when token is undefined", async () => {
    const fp = fingerprint({ q: "test" });
    expect(await resolveOffset(undefined, fp, SECRET)).toBe(0);
  });

  it("returns offset for a valid token", async () => {
    const fp = fingerprint({ q: "test" });
    const token = await mustEncode(40, fp);
    expect(await resolveOffset(token, fp, SECRET)).toBe(40);
  });

  it("returns error object for invalid token", async () => {
    const fp = fingerprint({ q: "test" });
    const result = await resolveOffset("bad.token", fp, SECRET);
    expect(result).toHaveProperty("error");
    expect(typeof (result as { error: string }).error).toBe("string");
  });

  it("returns error object for mismatched fingerprint", async () => {
    const fp1 = fingerprint({ q: "a" });
    const fp2 = fingerprint({ q: "b" });
    const token = await mustEncode(20, fp1);
    const result = await resolveOffset(token, fp2, SECRET);
    expect(result).toHaveProperty("error");
  });
});
