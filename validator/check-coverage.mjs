#!/usr/bin/env node
// Project every host's validator-coverage declaration against the canonical
// defect vocabulary, and fail on drift.
//
//   node validator/check-coverage.mjs [--matrix] [hostDir ...]
//
// With no host directories it discovers them as siblings of the corpus checkout
// (the standard workspace layout every other cross-host tool assumes). `--matrix`
// prints the coverage table as well as checking it. Node only; no build step, no
// dependencies, so any host's CI can run it.
//
// WHAT THIS CATCHES, precisely — the limits matter more than the checks:
//
//   * a declared code that the vocabulary does not define. This is the failure
//     that actually bites: the reference renames or retires a code and a host
//     goes on claiming it, so the matrix reports coverage that no longer means
//     anything.
//   * a code the vocabulary defines that a host neither implements nor accounts
//     for. Silence is the drift; an abstention with a reason is a decision.
//   * the reference host claiming anything other than the whole vocabulary,
//     which would mean its declaration had been hand-edited away from the
//     artefact generated out of it.
//
// WHAT IT CANNOT CATCH, and why. Three of the five hosts embed the FUARAN code
// inside the human-readable message text rather than carrying it as a field on
// the finding, so there is nothing to compare a declaration against — a host
// could implement a rule and never declare it, or declare one it does not
// implement, and this gate would pass. Those hosts declare `machineChecked:
// false` and say so themselves. Making the code a first-class value per host is
// the prerequisite, and is open work. A gate that quietly implied otherwise
// would be worse than no gate.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const corpusRoot = resolve(here, '..');
const vocabPath = join(here, 'defect-vocabulary.json');

if (!existsSync(vocabPath)) {
  console.error(`defect-vocabulary.json not found at ${vocabPath} — regenerate the corpus.`);
  process.exit(1);
}

const vocab = JSON.parse(readFileSync(vocabPath, 'utf8'));
const vocabCodes = new Set(vocab.codes.map((c) => c.code));

const args = process.argv.slice(2);
const wantMatrix = args.includes('--matrix');
let hostDirs = args.filter((a) => !a.startsWith('--'));

if (hostDirs.length === 0) {
  const parent = resolve(corpusRoot, '..');
  hostDirs = readdirSync(parent, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => join(parent, d.name))
    .filter((d) => existsSync(join(d, 'validator-coverage.json')));
}

if (hostDirs.length === 0) {
  console.error('No host declarations found. Pass host directories explicitly, or run inside the workspace checkout.');
  process.exit(1);
}

const problems = [];
const rows = [];

for (const dir of hostDirs) {
  const path = join(dir, 'validator-coverage.json');
  const d = JSON.parse(readFileSync(path, 'utf8'));
  const host = d.host ?? dir;
  const implemented = d.implemented ?? [];
  const abstained = d.abstained ?? {};

  if (d.family !== vocab.family) {
    problems.push(`${host}: declares family '${d.family}', vocabulary is '${vocab.family}'`);
  }

  const unknown = implemented.filter((c) => !vocabCodes.has(c));
  if (unknown.length > 0) {
    problems.push(
      `${host}: declares ${unknown.length} code(s) the vocabulary does not define: ${unknown.join(', ')}. ` +
        `If these belong to the build-time source-AST walker, move them to 'otherFamilies'; if the reference ` +
        `retired them, drop the claim.`
    );
  }

  const unknownAbstained = Object.keys(abstained).filter((c) => !vocabCodes.has(c));
  if (unknownAbstained.length > 0) {
    problems.push(`${host}: abstains from ${unknownAbstained.join(', ')}, which the vocabulary does not define`);
  }

  const accounted = new Set([...implemented, ...Object.keys(abstained)]);
  const unaccounted = [...vocabCodes].filter((c) => !accounted.has(c));
  if (unaccounted.length > 0 && !d.abstentionDefault) {
    problems.push(
      `${host}: ${unaccounted.length} vocabulary code(s) are neither implemented, abstained, nor covered by an ` +
        `'abstentionDefault'. Silence is the drift this gate exists to refuse — state a default reason.`
    );
  }

  if (d.posture === 'reference') {
    const missing = [...vocabCodes].filter((c) => !implemented.includes(c));
    if (missing.length > 0) {
      problems.push(
        `${host}: declares posture 'reference' but omits ${missing.length} vocabulary code(s): ${missing.join(', ')}. ` +
          `The reference's declaration is generated from the same source as the vocabulary, so a divergence means ` +
          `this file was hand-edited.`
      );
    }
  }

  rows.push({
    host,
    posture: d.posture ?? '?',
    implemented: implemented.length,
    named: Object.keys(abstained).length,
    other: Object.values(d.otherFamilies ?? {}).flat().length,
    checked: d.machineChecked === true,
  });
}

if (wantMatrix) {
  const total = vocabCodes.size;
  console.log(`\nPre-emit defect coverage — ${total} codes in the vocabulary\n`);
  console.log('host           posture     implemented  named-abstentions  other-family  machine-checked');
  console.log('-------------  ----------  -----------  -----------------  ------------  ---------------');
  for (const r of rows.sort((a, b) => a.host.localeCompare(b.host))) {
    console.log(
      `${r.host.padEnd(13)}  ${r.posture.padEnd(10)}  ${String(`${r.implemented}/${total}`).padEnd(11)}  ` +
        `${String(r.named).padEnd(17)}  ${String(r.other).padEnd(12)}  ${r.checked ? 'yes' : 'no'}`
    );
  }
  console.log(
    '\n"machine-checked: no" means the host embeds the code in message prose rather than carrying it as a value,\n' +
      'so its declaration is a statement of intent this gate cannot verify against the implementation.\n'
  );
}

if (problems.length > 0) {
  console.error(`\nValidator coverage drift (${problems.length}):\n`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

console.log(`validator coverage: ${rows.length} host declaration(s) consistent with the ${vocabCodes.size}-code vocabulary`);
