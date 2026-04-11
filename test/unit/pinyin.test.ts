import { describe, expect, it } from "vitest";
import { normalize, stripTones, toConcat } from "../../src/pinyin";

describe("stripTones", () => {
  it("returns empty for empty input", () => {
    expect(stripTones("")).toBe("");
  });

  it("preserves plain ASCII unchanged (lowercased)", () => {
    expect(stripTones("ni hao")).toBe("ni hao");
  });

  it("strips tone marks on lowercase vowels", () => {
    expect(stripTones("nǐ hǎo")).toBe("ni hao");
  });

  it("lowercases capitalised tone-marked syllables", () => {
    expect(stripTones("Ā lā bó yǔ")).toBe("a la bo yu");
  });

  it("maps ü to v", () => {
    expect(stripTones("lǜ")).toBe("lv");
  });

  it("maps uppercase Ü tone variants to v", () => {
    expect(stripTones("Ǖ Ǘ Ǚ Ǜ Ü")).toBe("v v v v v");
  });

  it("preserves whitespace between syllables", () => {
    expect(stripTones("wǒ ài nǐ")).toBe("wo ai ni");
  });

  it("collapses every tone variant of a single vowel", () => {
    expect(stripTones("ā á ǎ à")).toBe("a a a a");
  });

  it("is idempotent on already-stripped input", () => {
    const once = stripTones("Ā lā bó yǔ");
    expect(stripTones(once)).toBe(once);
  });

  it("leaves apostrophes and hyphens intact", () => {
    expect(stripTones("xī'ān")).toBe("xi'an");
  });
});

describe("toConcat", () => {
  it("removes spaces between syllables", () => {
    expect(toConcat("Ā lā bó yǔ")).toBe("alaboyu");
  });

  it("returns empty for empty input", () => {
    expect(toConcat("")).toBe("");
  });

  it("collapses tabs and newlines", () => {
    expect(toConcat("ni\thao\n")).toBe("nihao");
  });

  it("leaves an already-concatenated form unchanged", () => {
    expect(toConcat("nihao")).toBe("nihao");
  });

  it("handles a long multisyllable proper noun", () => {
    expect(toConcat("Běi jīng dà xué")).toBe("beijingdaxue");
  });
});

describe("normalize", () => {
  it("strips numeric tone digits", () => {
    expect(normalize("ni3hao3")).toBe("nihao");
  });

  it("normalises mixed case tone-marked input", () => {
    expect(normalize("Nǐ Hǎo")).toBe("nihao");
  });

  it("rewrites the ASCII u: digraph to v", () => {
    expect(normalize("lu:")).toBe("lv");
  });

  it("removes ASCII apostrophes used as syllable separators", () => {
    expect(normalize("xi'an")).toBe("xian");
  });

  it("removes typographic apostrophes too", () => {
    expect(normalize("xi\u2019an")).toBe("xian");
  });

  it("trims surrounding whitespace", () => {
    expect(normalize("  ni hao  ")).toBe("nihao");
  });

  it("returns empty for empty input", () => {
    expect(normalize("")).toBe("");
  });

  it("leaves already-normalised plain pinyin unchanged", () => {
    expect(normalize("nihao")).toBe("nihao");
  });

  it("handles spaced numeric pinyin", () => {
    expect(normalize("ni3 hao3")).toBe("nihao");
  });

  it("strips the neutral-tone digit 5", () => {
    expect(normalize("ma5")).toBe("ma");
  });

  it("normalises a tone-marked ü word", () => {
    expect(normalize("lǜsè")).toBe("lvse");
  });

  it("normalises a longer mixed-case sentence", () => {
    expect(normalize("Wǒ ài Zhōng guó")).toBe("woaizhongguo");
  });

  it("preserves a v that the user already typed", () => {
    expect(normalize("lvse")).toBe("lvse");
  });

  it("collapses hyphenated syllable boundaries", () => {
    expect(normalize("ni-hao")).toBe("nihao");
  });

  it("agrees with toConcat on a tone-stripped, lowercased phrase", () => {
    expect(normalize("Ā lā bó yǔ")).toBe(toConcat("Ā lā bó yǔ"));
  });
});
