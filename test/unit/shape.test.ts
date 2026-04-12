import { describe, expect, it } from "vitest";
import type { FormRow, HeadwordRow } from "../../src/db.js";
import { groupFormsByHeadword, shapeForm, shapeWord, shapeWordBrief } from "../../src/shape.js";

const HW: HeadwordRow = {
  id: 1,
  simplified: "好",
  radical: "女",
  frequency: 12,
  frequency_rank: 1,
  frequency_rarity: "common",
  pos_tags: '["adjective","verb"]',
  level_tags: '["new-1","old-1"]',
  new_level: 1,
  old_level: 1,
};

const FORM_A: FormRow = {
  id: 10,
  headword_id: 1,
  form_index: 0,
  form_key: "abc123def456",
  traditional: "好",
  pinyin: "hǎo",
  pinyin_plain: "hao",
  pinyin_concat: "hao",
  numeric: "hao3",
  wadegiles: "hao³",
  bopomofo: "ㄏㄠˇ",
  romatzyh: "hao",
  meanings_json: '["good","well"]',
  classifiers_json: "[]",
  gloss_en: "good; well",
  hanzi_concat: "好好",
};

const FORM_B: FormRow = {
  id: 11,
  headword_id: 1,
  form_index: 1,
  form_key: "xyz789abc012",
  traditional: "好",
  pinyin: "hào",
  pinyin_plain: "hao",
  pinyin_concat: "hao",
  numeric: "hao4",
  wadegiles: "hao⁴",
  bopomofo: "ㄏㄠˋ",
  romatzyh: "haw",
  meanings_json: '["to like","to be fond of"]',
  classifiers_json: "[]",
  gloss_en: "to like; to be fond of",
  hanzi_concat: "好好",
};

describe("shapeForm", () => {
  it("parses JSON columns and nests transcriptions", () => {
    const result = shapeForm(FORM_A);
    expect(result.form_key).toBe("abc123def456");
    expect(result.pinyin).toBe("hǎo");
    expect(result.meanings).toEqual(["good", "well"]);
    expect(result.classifiers).toEqual([]);
    expect(result.transcriptions).toEqual({
      numeric: "hao3",
      wadegiles: "hao³",
      bopomofo: "ㄏㄠˇ",
      romatzyh: "hao",
    });
  });

  it("does not include raw DB fields", () => {
    const result = shapeForm(FORM_A);
    expect(result).not.toHaveProperty("id");
    expect(result).not.toHaveProperty("headword_id");
    expect(result).not.toHaveProperty("meanings_json");
    expect(result).not.toHaveProperty("classifiers_json");
    expect(result).not.toHaveProperty("gloss_en");
    expect(result).not.toHaveProperty("hanzi_concat");
  });
});

describe("shapeWord", () => {
  it("merges headword and forms into a clean shape", () => {
    const result = shapeWord(HW, [FORM_A, FORM_B]);
    expect(result.simplified).toBe("好");
    expect(result.radical).toBe("女");
    expect(result.pos).toEqual(["adjective", "verb"]);
    expect(result.levels).toEqual(["new-1", "old-1"]);
    expect(result.forms).toHaveLength(2);
    expect(result.forms[0]?.pinyin).toBe("hǎo");
    expect(result.forms[1]?.pinyin).toBe("hào");
  });

  it("does not include raw DB fields", () => {
    const result = shapeWord(HW, [FORM_A]);
    expect(result).not.toHaveProperty("id");
    expect(result).not.toHaveProperty("pos_tags");
    expect(result).not.toHaveProperty("level_tags");
  });

  it("handles empty forms array", () => {
    const result = shapeWord(HW, []);
    expect(result.forms).toEqual([]);
  });
});

describe("shapeWordBrief", () => {
  it("returns primary form pinyin and meanings", () => {
    const result = shapeWordBrief(HW, [FORM_A, FORM_B]);
    expect(result.simplified).toBe("好");
    expect(result.pinyin).toBe("hǎo");
    expect(result.meanings).toEqual(["good", "well"]);
    expect(result.new_level).toBe(1);
    expect(result.old_level).toBe(1);
  });

  it("handles empty forms gracefully", () => {
    const result = shapeWordBrief(HW, []);
    expect(result.pinyin).toBe("");
    expect(result.meanings).toEqual([]);
  });

  it("omits frequency and transcription detail", () => {
    const result = shapeWordBrief(HW, [FORM_A]);
    expect(result).not.toHaveProperty("frequency");
    expect(result).not.toHaveProperty("frequency_rank");
    expect(result).not.toHaveProperty("forms");
  });
});

describe("groupFormsByHeadword", () => {
  it("groups forms by headword_id", () => {
    const formC: FormRow = { ...FORM_A, id: 20, headword_id: 2, form_index: 0 };
    const map = groupFormsByHeadword([FORM_A, FORM_B, formC]);
    expect(map.size).toBe(2);
    expect(map.get(1)).toHaveLength(2);
    expect(map.get(2)).toHaveLength(1);
  });

  it("preserves insertion order within groups", () => {
    const map = groupFormsByHeadword([FORM_A, FORM_B]);
    const group = map.get(1) ?? [];
    expect(group[0]?.form_index).toBe(0);
    expect(group[1]?.form_index).toBe(1);
  });

  it("returns empty map for empty input", () => {
    const map = groupFormsByHeadword([]);
    expect(map.size).toBe(0);
  });
});
