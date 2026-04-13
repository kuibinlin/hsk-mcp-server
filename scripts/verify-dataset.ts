import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { type RawHskDataset, RawHskDatasetSchema } from "../src/schemas/rawHsk.js";

const DATASET_PATH = resolve(process.cwd(), "complete.json");

const EXPECTED_SHA256 = "8568093e1bb55c990a43615be4bd49cdf0f581e127fa580bb8d9c057502c98b4";

const EXPECTED = {
  headwords: 11_470,
  forms: 12_623,
  multiFormHeadwords: 879,
  polyphones: 622,
  frequencySentinels: 105,
  radicals: 238,
  posTags: 36,
  maxFormsPerHeadword: 8,
  formKeyCollisions: 0,
} as const;

const FREQUENCY_SENTINEL_THRESHOLD = 100_000;

type Stats = {
  fileBytes: number;
  fileSha256: string;
  headwords: number;
  forms: number;
  multiFormHeadwords: number;
  polyphones: number;
  frequencySentinels: number;
  radicals: number;
  posTags: number;
  maxFormsPerHeadword: number;
  formKeyCollisions: number;
};

function formKey(simplified: string, traditional: string, pinyin: string): string {
  return createHash("sha256")
    .update(`${simplified}|${traditional}|${pinyin}`)
    .digest("hex")
    .slice(0, 12);
}

async function loadDataset(): Promise<{ raw: Buffer; parsed: RawHskDataset }> {
  const raw = await readFile(DATASET_PATH);
  const json = JSON.parse(raw.toString("utf8"));
  const parsed = RawHskDatasetSchema.parse(json);
  return { raw, parsed };
}

function computeStats(raw: Buffer, dataset: RawHskDataset): Stats {
  const fileSha256 = createHash("sha256").update(raw).digest("hex");
  const radicals = new Set<string>();
  const posTags = new Set<string>();
  const formKeys = new Set<string>();
  let totalForms = 0;
  let multiFormHeadwords = 0;
  let polyphones = 0;
  let frequencySentinels = 0;
  let maxFormsPerHeadword = 0;
  let collisions = 0;

  for (const entry of dataset) {
    radicals.add(entry.radical);
    for (const tag of entry.pos) posTags.add(tag);
    if (entry.frequency >= FREQUENCY_SENTINEL_THRESHOLD) frequencySentinels++;
    if (entry.forms.length > maxFormsPerHeadword) maxFormsPerHeadword = entry.forms.length;
    if (entry.forms.length > 1) multiFormHeadwords++;

    const distinctPinyin = new Set(entry.forms.map((f) => f.transcriptions.pinyin));
    if (distinctPinyin.size > 1) polyphones++;

    for (const form of entry.forms) {
      totalForms++;
      const key = formKey(entry.simplified, form.traditional, form.transcriptions.pinyin);
      if (formKeys.has(key)) collisions++;
      formKeys.add(key);
    }
  }

  return {
    fileBytes: raw.byteLength,
    fileSha256,
    headwords: dataset.length,
    forms: totalForms,
    multiFormHeadwords,
    polyphones,
    frequencySentinels,
    radicals: radicals.size,
    posTags: posTags.size,
    maxFormsPerHeadword,
    formKeyCollisions: collisions,
  };
}

function assertExpectations(stats: Stats): string[] {
  const failures: string[] = [];
  const check = (label: string, actual: number, expected: number) => {
    if (actual !== expected) failures.push(`${label}: expected ${expected}, got ${actual}`);
  };

  if (stats.fileSha256 !== EXPECTED_SHA256) {
    failures.push(`file sha256: expected ${EXPECTED_SHA256}, got ${stats.fileSha256}`);
  }
  check("headwords", stats.headwords, EXPECTED.headwords);
  check("forms", stats.forms, EXPECTED.forms);
  check("multi-form headwords", stats.multiFormHeadwords, EXPECTED.multiFormHeadwords);
  check("polyphones (distinct pinyin)", stats.polyphones, EXPECTED.polyphones);
  check("frequency sentinels", stats.frequencySentinels, EXPECTED.frequencySentinels);
  check("radicals", stats.radicals, EXPECTED.radicals);
  check("POS tags", stats.posTags, EXPECTED.posTags);
  check("max forms per headword", stats.maxFormsPerHeadword, EXPECTED.maxFormsPerHeadword);
  check("form_key collisions", stats.formKeyCollisions, EXPECTED.formKeyCollisions);
  return failures;
}

function printReport(stats: Stats, failures: string[]): void {
  const lines = [
    "HSK dataset verification",
    "========================",
    `dataset path     : ${DATASET_PATH}`,
    `expected sha256  : ${EXPECTED_SHA256}`,
    `actual sha256    : ${stats.fileSha256}`,
    `file bytes       : ${stats.fileBytes.toLocaleString()}`,
    "",
    `headwords        : ${stats.headwords.toLocaleString()} (expected ${EXPECTED.headwords.toLocaleString()})`,
    `forms            : ${stats.forms.toLocaleString()} (expected ${EXPECTED.forms.toLocaleString()})`,
    `multi-form heads : ${stats.multiFormHeadwords} (expected ${EXPECTED.multiFormHeadwords})`,
    `polyphones       : ${stats.polyphones} (expected ${EXPECTED.polyphones}; distinct raw pinyin within a headword)`,
    `freq sentinels   : ${stats.frequencySentinels} (expected ${EXPECTED.frequencySentinels}; frequency >= ${FREQUENCY_SENTINEL_THRESHOLD.toLocaleString()})`,
    `radicals         : ${stats.radicals} (expected ${EXPECTED.radicals})`,
    `POS tags         : ${stats.posTags} (expected ${EXPECTED.posTags})`,
    `max forms / head : ${stats.maxFormsPerHeadword} (expected ${EXPECTED.maxFormsPerHeadword})`,
    `form_key dupes   : ${stats.formKeyCollisions} (expected ${EXPECTED.formKeyCollisions})`,
  ];
  for (const line of lines) console.log(line);
  if (failures.length > 0) {
    console.log("");
    console.log("FAIL");
    for (const failure of failures) console.log(`  - ${failure}`);
  } else {
    console.log("");
    console.log("OK — all invariants hold");
  }
}

async function main(): Promise<void> {
  const { raw, parsed } = await loadDataset();
  const stats = computeStats(raw, parsed);
  const failures = assertExpectations(stats);
  printReport(stats, failures);
  if (failures.length > 0) process.exit(1);
}

await main();
