const TONE_MAP: Record<string, string> = {
  ā: "a",
  á: "a",
  ǎ: "a",
  à: "a",
  ē: "e",
  é: "e",
  ě: "e",
  è: "e",
  ī: "i",
  í: "i",
  ǐ: "i",
  ì: "i",
  ō: "o",
  ó: "o",
  ǒ: "o",
  ò: "o",
  ū: "u",
  ú: "u",
  ǔ: "u",
  ù: "u",
  ǖ: "v",
  ǘ: "v",
  ǚ: "v",
  ǜ: "v",
  ü: "v",
  Ā: "a",
  Á: "a",
  Ǎ: "a",
  À: "a",
  Ē: "e",
  É: "e",
  Ě: "e",
  È: "e",
  Ī: "i",
  Í: "i",
  Ǐ: "i",
  Ì: "i",
  Ō: "o",
  Ó: "o",
  Ǒ: "o",
  Ò: "o",
  Ū: "u",
  Ú: "u",
  Ǔ: "u",
  Ù: "u",
  Ǖ: "v",
  Ǘ: "v",
  Ǚ: "v",
  Ǜ: "v",
  Ü: "v",
};

export function stripTones(input: string): string {
  let out = "";
  for (const ch of input) {
    const mapped = TONE_MAP[ch];
    out += mapped ?? ch.toLowerCase();
  }
  return out;
}

export function toConcat(input: string): string {
  return stripTones(input).replace(/\s+/g, "");
}

export function normalize(input: string): string {
  let s = stripTones(input.trim());
  s = s.replace(/u:/g, "v");
  s = s.replace(/[1-5]/g, "");
  s = s.replace(/[\s'\u2019-]/g, "");
  return s;
}
