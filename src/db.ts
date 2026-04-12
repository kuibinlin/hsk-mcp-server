// Typed D1 query helpers for the HSK vocabulary database.
// Thin wrappers around prepared statements — no business logic.

// ── Row types (mirror sql/schema.sql) ────────────────────────────────

export interface HeadwordRow {
  id: number;
  simplified: string;
  radical: string;
  frequency: number;
  frequency_rank: number | null;
  frequency_rarity: string;
  pos_tags: string;
  level_tags: string;
  new_level: number | null;
  old_level: number | null;
}

export interface FormRow {
  id: number;
  headword_id: number;
  form_index: number;
  form_key: string;
  traditional: string;
  pinyin: string;
  pinyin_plain: string;
  pinyin_concat: string;
  numeric: string;
  wadegiles: string;
  bopomofo: string;
  romatzyh: string;
  meanings_json: string;
  classifiers_json: string;
  gloss_en: string;
  hanzi_concat: string;
}

// ── Single-row lookups ───────────────────────────────────────────────

export function headwordById(db: D1Database, id: number): Promise<HeadwordRow | null> {
  return db.prepare("SELECT * FROM headwords WHERE id = ?").bind(id).first<HeadwordRow>();
}

export function headwordBySimplified(
  db: D1Database,
  simplified: string,
): Promise<HeadwordRow | null> {
  return db
    .prepare("SELECT * FROM headwords WHERE simplified = ?")
    .bind(simplified)
    .first<HeadwordRow>();
}

// ── Batch lookups ────────────────────────────────────────────────────

export async function headwordsByIds(db: D1Database, ids: number[]): Promise<HeadwordRow[]> {
  if (ids.length === 0) return [];
  const ph = ids.map(() => "?").join(",");
  const { results } = await db
    .prepare(`SELECT * FROM headwords WHERE id IN (${ph})`)
    .bind(...ids)
    .all<HeadwordRow>();
  return results;
}

export async function formsByHeadwordId(db: D1Database, headwordId: number): Promise<FormRow[]> {
  const { results } = await db
    .prepare("SELECT * FROM forms WHERE headword_id = ? ORDER BY form_index")
    .bind(headwordId)
    .all<FormRow>();
  return results;
}

export async function formsByHeadwordIds(db: D1Database, ids: number[]): Promise<FormRow[]> {
  if (ids.length === 0) return [];
  const ph = ids.map(() => "?").join(",");
  const { results } = await db
    .prepare(`SELECT * FROM forms WHERE headword_id IN (${ph}) ORDER BY headword_id, form_index`)
    .bind(...ids)
    .all<FormRow>();
  return results;
}

// ── Lookup via forms table ───────────────────────────────────────────

export async function headwordIdsByTraditional(
  db: D1Database,
  traditional: string,
): Promise<number[]> {
  const { results } = await db
    .prepare("SELECT DISTINCT headword_id FROM forms WHERE traditional = ?")
    .bind(traditional)
    .all<{ headword_id: number }>();
  return results.map((r) => r.headword_id);
}

export async function headwordIdsByPinyinConcat(
  db: D1Database,
  pinyinConcat: string,
): Promise<number[]> {
  const { results } = await db
    .prepare("SELECT DISTINCT headword_id FROM forms WHERE pinyin_concat = ?")
    .bind(pinyinConcat)
    .all<{ headword_id: number }>();
  return results.map((r) => r.headword_id);
}

// ── Filtered headword queries ────────────────────────────────────────

const FREQ_ORDER = "frequency_rank IS NULL, frequency_rank";

export async function headwordsByRadical(
  db: D1Database,
  radical: string,
  limit: number,
  offset: number,
): Promise<HeadwordRow[]> {
  const { results } = await db
    .prepare(`SELECT * FROM headwords WHERE radical = ? ORDER BY ${FREQ_ORDER} LIMIT ? OFFSET ?`)
    .bind(radical, limit, offset)
    .all<HeadwordRow>();
  return results;
}

export async function headwordsByLevel(
  db: D1Database,
  scheme: "new" | "old",
  level: number,
): Promise<HeadwordRow[]> {
  // Column name from literal union — safe to interpolate
  const col = scheme === "new" ? "new_level" : "old_level";
  const { results } = await db
    .prepare(`SELECT * FROM headwords WHERE ${col} = ? ORDER BY ${FREQ_ORDER}`)
    .bind(level)
    .all<HeadwordRow>();
  return results;
}

// ── Polyphones ───────────────────────────────────────────────────────

export async function polyphoneHeadwords(
  db: D1Database,
  limit: number,
  offset: number,
): Promise<HeadwordRow[]> {
  const { results } = await db
    .prepare(
      `SELECT h.* FROM headwords h
       WHERE h.id IN (
         SELECT headword_id FROM forms
         GROUP BY headword_id
         HAVING COUNT(DISTINCT pinyin) > 1
       )
       ORDER BY ${FREQ_ORDER.replace(/frequency_rank/g, "h.frequency_rank")}
       LIMIT ? OFFSET ?`,
    )
    .bind(limit, offset)
    .all<HeadwordRow>();
  return results;
}

// ── FTS searches ─────────────────────────────────────────────────────
// Return matched form rows; caller fetches headwords via headwordsByIds.

export async function searchGloss(
  db: D1Database,
  query: string,
  limit: number,
  offset: number,
): Promise<FormRow[]> {
  const { results } = await db
    .prepare(
      `SELECT f.* FROM gloss_fts g
       JOIN forms f ON f.id = g.rowid
       WHERE g.gloss_en MATCH ?
       ORDER BY g.rank
       LIMIT ? OFFSET ?`,
    )
    .bind(query, limit, offset)
    .all<FormRow>();
  return results;
}

export async function searchPinyin(
  db: D1Database,
  query: string,
  limit: number,
  offset: number,
): Promise<FormRow[]> {
  const { results } = await db
    .prepare(
      `SELECT f.* FROM pinyin_fts p
       JOIN forms f ON f.id = p.rowid
       WHERE p.pinyin_concat MATCH ?
       ORDER BY p.rank
       LIMIT ? OFFSET ?`,
    )
    .bind(query, limit, offset)
    .all<FormRow>();
  return results;
}

export async function searchHanzi(
  db: D1Database,
  query: string,
  limit: number,
  offset: number,
): Promise<FormRow[]> {
  const { results } = await db
    .prepare(
      `SELECT f.* FROM hanzi_fts hz
       JOIN forms f ON f.id = hz.rowid
       WHERE hz.hanzi_concat MATCH ?
       ORDER BY hz.rank
       LIMIT ? OFFSET ?`,
    )
    .bind(query, limit, offset)
    .all<FormRow>();
  return results;
}
