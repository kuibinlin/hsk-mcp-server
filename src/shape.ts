// Row → MCP response shaping.
// Transforms raw D1 rows into clean nested objects for tool responses.

import type { FormRow, HeadwordRow } from "./db.js";

// ── Output types ─────────────────────────────────────────────────────

export interface FormShape {
  form_key: string;
  traditional: string;
  pinyin: string;
  pinyin_plain: string;
  transcriptions: {
    numeric: string;
    wadegiles: string;
    bopomofo: string;
    romatzyh: string;
  };
  meanings: string[];
  classifiers: string[];
}

export interface WordShape {
  simplified: string;
  radical: string;
  frequency: number;
  frequency_rank: number | null;
  frequency_rarity: string;
  pos: string[];
  levels: string[];
  new_level: number | null;
  old_level: number | null;
  forms: FormShape[];
}

export interface WordBrief {
  simplified: string;
  pinyin: string;
  meanings: string[];
  new_level: number | null;
  old_level: number | null;
}

// ── Shaping functions ────────────────────────────────────────────────

export function shapeForm(row: FormRow): FormShape {
  return {
    form_key: row.form_key,
    traditional: row.traditional,
    pinyin: row.pinyin,
    pinyin_plain: row.pinyin_plain,
    transcriptions: {
      numeric: row.numeric,
      wadegiles: row.wadegiles,
      bopomofo: row.bopomofo,
      romatzyh: row.romatzyh,
    },
    meanings: JSON.parse(row.meanings_json) as string[],
    classifiers: JSON.parse(row.classifiers_json) as string[],
  };
}

export function shapeWord(hw: HeadwordRow, forms: FormRow[]): WordShape {
  return {
    simplified: hw.simplified,
    radical: hw.radical,
    frequency: hw.frequency,
    frequency_rank: hw.frequency_rank,
    frequency_rarity: hw.frequency_rarity,
    pos: JSON.parse(hw.pos_tags) as string[],
    levels: JSON.parse(hw.level_tags) as string[],
    new_level: hw.new_level,
    old_level: hw.old_level,
    forms: forms.map(shapeForm),
  };
}

export function shapeWordBrief(hw: HeadwordRow, forms: FormRow[]): WordBrief {
  const primary = forms[0];
  return {
    simplified: hw.simplified,
    pinyin: primary?.pinyin ?? "",
    meanings: primary ? (JSON.parse(primary.meanings_json) as string[]) : [],
    new_level: hw.new_level,
    old_level: hw.old_level,
  };
}

// ── Grouping utility ─────────────────────────────────────────────────

/** Group form rows by headword_id. Preserves form_index order within each group. */
export function groupFormsByHeadword(forms: FormRow[]): Map<number, FormRow[]> {
  const map = new Map<number, FormRow[]>();
  for (const f of forms) {
    let group = map.get(f.headword_id);
    if (!group) {
      group = [];
      map.set(f.headword_id, group);
    }
    group.push(f);
  }
  return map;
}
