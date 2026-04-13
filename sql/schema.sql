-- HSK MCP Server — D1 schema
-- Idempotent: every apply drops and recreates.
-- Dataset: complete.json from drkameleon/complete-hsk-vocabulary
-- Invariants (see scripts/verify-dataset.ts): 11,470 headwords, 12,623 forms, 622 polyphones, 105 freq sentinels.
-- form_key derivation: sha256(simplified|traditional|pinyin)[:12] using the case-preserving tone-marked pinyin.
-- Verified zero collisions across 12,623 forms; tone-stripped variants collide on within-headword tone differences.

DROP TABLE IF EXISTS hanzi_fts;
DROP TABLE IF EXISTS pinyin_fts;
DROP TABLE IF EXISTS gloss_fts;
DROP TABLE IF EXISTS forms;
DROP TABLE IF EXISTS headwords;

CREATE TABLE headwords (
  id               INTEGER PRIMARY KEY,
  simplified       TEXT    NOT NULL,
  radical          TEXT    NOT NULL,
  frequency        INTEGER NOT NULL,
  frequency_rank   INTEGER,
  frequency_rarity TEXT    NOT NULL CHECK (frequency_rarity IN ('common', 'off_chart')),
  pos_tags         TEXT    NOT NULL,
  level_tags       TEXT    NOT NULL,
  new_level        INTEGER CHECK (new_level IS NULL OR new_level BETWEEN 1 AND 7),
  old_level        INTEGER CHECK (old_level IS NULL OR old_level BETWEEN 1 AND 6)
);

CREATE UNIQUE INDEX idx_headwords_simplified ON headwords(simplified);
CREATE INDEX idx_headwords_radical    ON headwords(radical);
CREATE INDEX idx_headwords_new_level  ON headwords(new_level);
CREATE INDEX idx_headwords_old_level  ON headwords(old_level);
CREATE INDEX idx_headwords_freq_rank  ON headwords(frequency_rank);

CREATE TABLE forms (
  id               INTEGER PRIMARY KEY,
  headword_id      INTEGER NOT NULL REFERENCES headwords(id),
  form_index       INTEGER NOT NULL,
  form_key         TEXT    NOT NULL UNIQUE,
  traditional      TEXT    NOT NULL,
  pinyin           TEXT    NOT NULL,
  pinyin_plain     TEXT    NOT NULL,
  pinyin_concat    TEXT    NOT NULL,
  numeric          TEXT    NOT NULL,
  wadegiles        TEXT    NOT NULL,
  bopomofo         TEXT    NOT NULL,
  romatzyh         TEXT    NOT NULL,
  meanings_json    TEXT    NOT NULL,
  classifiers_json TEXT    NOT NULL,
  gloss_en         TEXT    NOT NULL,
  hanzi_concat     TEXT    NOT NULL
);

CREATE INDEX idx_forms_headword     ON forms(headword_id);
CREATE INDEX idx_forms_pinyin_plain ON forms(pinyin_plain);
CREATE INDEX idx_forms_traditional  ON forms(traditional);

CREATE VIRTUAL TABLE gloss_fts USING fts5(
  gloss_en,
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE VIRTUAL TABLE pinyin_fts USING fts5(
  pinyin_concat,
  tokenize = 'trigram'
);

CREATE VIRTUAL TABLE hanzi_fts USING fts5(
  hanzi_concat,
  tokenize = 'trigram'
);
