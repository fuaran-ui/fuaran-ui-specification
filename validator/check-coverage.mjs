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
//   * (Phase 1692) a FUARAN code CITED anywhere in a host's source that nothing
//     accounts for — see the citation arm below.
//
// WHAT IT CANNOT CATCH, and why. Three of the five hosts embed the FUARAN code
// inside the human-readable message text rather than carrying it as a field on
// the finding, so there is nothing to compare a declaration against — a host
// could implement a rule and never declare it, or declare one it does not
// implement, and this gate would pass. Those hosts declare `machineChecked:
// false` and say so themselves. Making the code a first-class value per host is
// the prerequisite, and is open work. A gate that quietly implied otherwise
// would be worse than no gate.
//
// ── THE CITATION ARM (Phase 1692) ───────────────────────────────────────────
//
// The three checks above all quantify over a host's DECLARATION. That leaves the
// failure they were written for only half covered, and Phase 1666 is the
// instance: the reference renumbered FUARAN150 to FUARAN152, the sweep reached
// each host's `limits.*` and missed the identical sentence in every `decode.*`,
// so four hosts went on naming a code for a defect that code no longer named.
// Nothing was red. Every declaration was consistent, because a citation in prose
// is not a declaration — and a code named in a comment is read by a human, which
// is the audience the drift misled.
//
// So this arm quantifies over the host's SOURCE. Every `FUARAN…` token in a
// host's tracked source must be accounted for by one of:
//
//   * the pre-emit vocabulary beside this file;
//   * the host's own `otherFamilies` declaration (the FUARAN code space is
//     shared with the reference's build-time source-AST walker and its analyzer
//     descriptors, neither of which this vocabulary enumerates);
//   * for the REFERENCE host only, an `otherFamiliesSource` naming the in-repo
//     registry that owns those codes. The reference is the host the other two
//     families live in, so enumerating them here would be a second derivation of
//     a fact its own registry tool already derives and collision-checks. A
//     SUBSET host cannot claim this — it owns no registry — which is what keeps
//     the route from being a one-line opt-out for anyone who wants one.
//
// An unaccounted citation is the drift. A retired or renumbered code cited
// anywhere in any host now has exactly one place it can be, and it is red.
//
// WHAT THE CITATION ARM CANNOT SEE, stated for the same reason as everything
// else here. It reads TOKENS, not meanings: a code cited correctly for the wrong
// rule is accounted for and passes, because deciding that would need the rule
// the citation sits beside, which is what `message-parity.json` answers for the
// codes it covers and nothing answers for the rest. It cannot see a code
// assembled from parts at runtime. And on a checkout where a host's source is
// absent it reports NOT SCANNED rather than clean — "I could not look" must
// never render as "I looked and it was clean".
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
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

// ── The citation arm's source walk ──────────────────────────────────────────
//
// Extensions the five hosts' own sources use, plus the reference's C#/VB
// authoring surfaces (whose analyzer codes are the third registry). A file type
// absent here is not scanned, which is why the walk reports what it read.
const SOURCE_EXT = new Set(['.fs', '.fsi', '.fsx', '.ts', '.tsx', '.py', '.go', '.rs', '.cs', '.vb']);

// Build output, dependency trees and version-control metadata. Named rather than
// inferred: `packages/` is fuaran-ts's SOURCE root and `pkg/` is Go build output,
// so a heuristic over directory names would be wrong in both directions.
const SKIP_DIR = new Set([
  '.git', '.github', '.venv', '.vs', '.idea', '.mypy_cache', '.pytest_cache', '.ruff_cache',
  'node_modules', 'obj', 'bin', 'dist', 'target', 'build', 'out', '__pycache__',
  'coverage', 'htmlcov', 'TestResults', 'artifacts', '.next', '.turbo', '.nuget',
]);

// A FUARAN code as every host spells one: the numeric family and the few named
// ones the vocabulary carries (FUARAN-DUP-ID, FUARAN-EMPTY-ID, …).
const CODE_RE = /\bFUARAN(?:-[A-Z][A-Z0-9-]*|[0-9]{3,})\b/g;

const walkSource = (dir, into, budget) => {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return budget;
  }
  for (const e of entries) {
    if (budget.files <= 0) return budget;
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIR.has(e.name)) continue;
      walkSource(p, into, budget);
      continue;
    }
    if (!e.isFile()) continue;
    const dot = e.name.lastIndexOf('.');
    if (dot < 0 || !SOURCE_EXT.has(e.name.slice(dot))) continue;
    let text;
    try {
      if (statSync(p).size > 4 * 1024 * 1024) continue;
      text = readFileSync(p, 'utf8');
    } catch {
      continue;
    }
    budget.files -= 1;
    budget.scanned += 1;
    for (const m of text.matchAll(CODE_RE)) {
      const code = m[0];
      if (!into.has(code)) into.set(code, new Set());
      into.get(code).add(p);
    }
  }
  return budget;
};

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

  // ── The citation arm ──────────────────────────────────────────────────────
  const otherFamilyCodes = new Set(Object.values(d.otherFamilies ?? {}).flat());
  const ownsRegistry = d.posture === 'reference' && typeof d.otherFamiliesSource === 'string';
  if (typeof d.otherFamiliesSource === 'string' && d.posture !== 'reference') {
    problems.push(
      `${host}: declares 'otherFamiliesSource' on posture '${d.posture}'. Only the REFERENCE host owns the ` +
        `other FUARAN registries (the source-AST walker and the analyzer descriptors); a subset host has no ` +
        `registry to point at, so its non-vocabulary codes belong in 'otherFamilies' where they can be read.`
    );
  }

  const cited = new Map();
  const budget = { files: 20000, scanned: 0 };
  walkSource(dir, cited, budget);

  let citationState;
  if (budget.scanned === 0) {
    citationState = 'not-scanned';
    console.log(
      `${host}: citations NOT SCANNED — no host source found under ${dir}. A bare corpus checkout has no host ` +
        `sources, and "I could not look" is not "I looked and it was clean".`
    );
  } else if (ownsRegistry) {
    citationState = 'own-registry';
  } else {
    const unaccounted = [...cited.keys()]
      .filter((c) => !vocabCodes.has(c) && !otherFamilyCodes.has(c))
      .sort();
    if (unaccounted.length > 0) {
      const where = unaccounted
        .slice(0, 8)
        .map((c) => `${c} (${[...cited.get(c)].sort()[0]})`)
        .join(', ');
      problems.push(
        `${host}: ${unaccounted.length} FUARAN code(s) cited in source that nothing accounts for: ${where}` +
          `${unaccounted.length > 8 ? `, and ${unaccounted.length - 8} more` : ''}. ` +
          `A cited code must be in the vocabulary or in this host's 'otherFamilies'. If the reference renumbered ` +
          `or retired it, the citation is stale — this is the Phase 1666 class, where a renumbering reached each ` +
          `host's limits and missed the identical sentence in its decoder.`
      );
      citationState = `${unaccounted.length} unaccounted`;
    } else {
      citationState = 'clean';
    }
  }

  rows.push({
    host,
    posture: d.posture ?? '?',
    implemented: implemented.length,
    named: Object.keys(abstained).length,
    other: Object.values(d.otherFamilies ?? {}).flat().length,
    checked: d.machineChecked === true,
    cited: cited.size,
    scanned: budget.scanned,
    citations: citationState,
  });
}

if (wantMatrix) {
  const total = vocabCodes.size;
  console.log(`\nPre-emit defect coverage — ${total} codes in the vocabulary\n`);
  console.log('host           posture     implemented  named-abstentions  other-family  machine-checked  files  codes-cited  citations');
  console.log('-------------  ----------  -----------  -----------------  ------------  ---------------  -----  -----------  ---------------');
  for (const r of rows.sort((a, b) => a.host.localeCompare(b.host))) {
    console.log(
      `${r.host.padEnd(13)}  ${r.posture.padEnd(10)}  ${String(`${r.implemented}/${total}`).padEnd(11)}  ` +
        `${String(r.named).padEnd(17)}  ${String(r.other).padEnd(12)}  ${(r.checked ? 'yes' : 'no').padEnd(15)}  ` +
        `${String(r.scanned).padEnd(5)}  ${String(r.cited).padEnd(11)}  ${r.citations}`
    );
  }
  console.log(
    '\n"machine-checked: no" means the host embeds the code in message prose rather than carrying it as a value,\n' +
      'so its declaration is a statement of intent this gate cannot verify against the implementation.\n' +
      '"citations" is the Phase 1692 arm over the host\'s SOURCE rather than its declaration: every FUARAN code the\n' +
      'source names must be in the vocabulary or in this host\'s "otherFamilies". "own-registry" is the reference\n' +
      'host, which OWNS the other two FUARAN registries and collision-checks them itself; "not-scanned" means no\n' +
      'host source was found, which is reported rather than passed.\n'
  );
}

if (problems.length > 0) {
  console.error(`\nValidator coverage drift (${problems.length}):\n`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

const scannedRows = rows.filter((r) => r.scanned > 0);
const citationNote =
  scannedRows.length === 0
    ? '; no host source was scanned (citations NOT checked)'
    : `; ${scannedRows.length} host source tree(s) scanned, every FUARAN code cited in them accounted for`;
console.log(
  `validator coverage: ${rows.length} host declaration(s) consistent with the ${vocabCodes.size}-code vocabulary${citationNote}`
);
