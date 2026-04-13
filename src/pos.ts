// ICTCLAS / PKU part-of-speech tag mapping.
// Reference: https://github.com/drkameleon/complete-hsk-vocabulary

const POS_LABELS: Record<string, string> = {
  a: "adjective",
  ad: "adjective as adverbial",
  ag: "adjective morpheme",
  an: "adjective with nominal function",
  b: "non-predicate adjective",
  c: "conjunction",
  cc: "coordinating conjunction",
  d: "adverb",
  dg: "adverb morpheme",
  e: "interjection",
  f: "directional locality",
  g: "morpheme",
  h: "prefix",
  i: "idiom",
  j: "abbreviation",
  k: "suffix",
  l: "fixed expressions",
  m: "numeral",
  mg: "numeric morpheme",
  mq: "numeral-classifier",
  n: "common noun",
  ng: "noun morpheme",
  nr: "personal name",
  ns: "place name",
  nt: "organization name",
  nx: "nominal character string",
  nz: "other proper noun",
  o: "onomatopoeia",
  p: "preposition",
  q: "classifier",
  qt: "temporal classifier",
  qv: "verbal classifier",
  r: "pronoun",
  rg: "pronoun morpheme",
  s: "space word",
  t: "time word",
  tg: "time word morpheme",
  u: "auxiliary",
  v: "verb",
  vd: "verb as adverbial",
  vg: "verb morpheme",
  vn: "verb with nominal function",
  w: "symbol and non-sentential punctuation",
  x: "unclassified items",
  y: "modal particle",
  z: "descriptive",
};

export interface PosTag {
  code: string;
  label: string;
}

/** Resolve a POS code to a code+label pair. Unknown codes use the code as label. */
export function resolvePos(code: string): PosTag {
  return { code, label: POS_LABELS[code.toLowerCase()] ?? code };
}
