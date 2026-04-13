import { beforeEach, describe, expect, it } from "vitest";
import {
  emptyResult,
  errorResult,
  jsonResult,
  paginatedResult,
  setDatasetVersion,
} from "../../src/response.js";

beforeEach(() => {
  setDatasetVersion("abc123");
});

function parse(result: ReturnType<typeof jsonResult>) {
  return JSON.parse(result.content[0]?.text ?? "");
}

describe("jsonResult", () => {
  it("wraps data as MCP text content", () => {
    const r = jsonResult({ foo: 1 });
    expect(r.content).toHaveLength(1);
    expect(r.content[0]?.type).toBe("text");
    expect(parse(r).foo).toBe(1);
  });

  it("attaches _meta.dataset_version", () => {
    const data = parse(jsonResult({ results: [] }));
    expect(data._meta).toEqual({ dataset_version: "abc123" });
  });

  it("does not set isError", () => {
    expect(jsonResult({})).not.toHaveProperty("isError");
  });
});

describe("paginatedResult", () => {
  it("wraps items and next_cursor", () => {
    const data = parse(paginatedResult(["a", "b"], "cur_tok"));
    expect(data.results).toEqual(["a", "b"]);
    expect(data.next_cursor).toBe("cur_tok");
  });

  it("includes _meta", () => {
    const data = parse(paginatedResult([], null));
    expect(data._meta.dataset_version).toBe("abc123");
  });
});

describe("emptyResult", () => {
  it("returns empty results with null cursor", () => {
    const data = parse(emptyResult());
    expect(data.results).toEqual([]);
    expect(data.next_cursor).toBeNull();
  });
});

describe("errorResult", () => {
  it("sets isError and message", () => {
    const r = errorResult("bad cursor");
    expect(r.isError).toBe(true);
    expect(r.content[0]?.text).toBe("bad cursor");
  });
});
