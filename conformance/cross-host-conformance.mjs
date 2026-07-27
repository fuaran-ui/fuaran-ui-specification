// ============================================================================
//  Cross-implementation wire-format conformance runner (Phase 98).
//
//  The mechanical enforcement of the forward-coupling rule (WIRE_FORMAT.md §11)
//  ACROSS the two conformant hosts: the F# `Fuaran.UI` tier and the TypeScript
//  `@fuaran-ui/*` tier. The paper's central claim — "language-neutral contract,
//  F# + TS as sibling implementations" — depends on the two hosts agreeing
//  byte-for-byte on the canonical wire format. This runner makes a divergence
//  UN-MERGEABLE rather than discipline-maintained.
//
//  ── The two-leg gate ───────────────────────────────────────────────────────
//
//  The committed `wire-format-fixtures/` corpus IS the F# encoder's canonical
//  output: `Corpus.emit` writes `CanonicalJson.encode*` straight into the
//  `expectedFile` payloads and the F# `DecodeError` code/path straight into the
//  manifest. So the corpus is a serialized F# conformance report.
//
//    Leg A (F#, run by the workflow's dotnet-test step):
//      Fuaran.UI.JsonDecode.Tests — RoundTrip re-decodes+re-encodes every
//      fixture with the CURRENT F# encoder and asserts byte-equality with the
//      committed corpus; Reject asserts the F# code/path; SchemaConformance
//      asserts every accept-fixture validates and every reject-fixture fails
//      against schema.json + the stale-schema guard.
//      ⇒ proves  F# encoder/decoder  ==  committed corpus  (+ schema-valid).
//
//    Leg B (this runner):
//      drives the TS @fuaran-ui/ops codec over the same corpus and byte-diffs
//      its canonical output against the F# canonical form (the corpus), plus
//      schema-validates the TS output with an off-the-shelf Draft 2020-12
//      validator (ajv).
//      ⇒ proves  TS encoder/decoder  ==  committed corpus  (+ schema-valid).
//
//    A == corpus  (Leg A)  AND  B == corpus  (Leg B)   ⇒   F#  ==  TS, byte-for-byte.
//
//  A one-byte divergence in EITHER host fails the gate:
//    • TS encoder edit  → this runner's byte-diff (or schema check) fails here.
//    • F# encoder edit  → Leg A's RoundTrip re-encode no longer matches the
//      committed corpus (caught in dotnet test); or, if the corpus was also
//      regenerated, the corpus changes and THIS runner's TS↔corpus diff fails.
//
//  Run locally:  npm install && npm run conformance   (from this directory)
//  Requires:     the TS workspace built — `pnpm -C ../../fuaran-ts build` — so
//                ../../fuaran-ts/packages/ops/dist exists.
// ============================================================================

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';

const here = dirname(fileURLToPath(import.meta.url));
// conformance/ → wire-format-fixtures/ (the corpus root) and the sibling TS host.
const corpusRoot = join(here, '..');
const opsDist = join(here, '..', '..', 'fuaran-ts', 'packages', 'ops', 'dist', 'index.js');

const read = (rel) => readFileSync(join(corpusRoot, rel), 'utf8');
// Fixtures are single-line compact JSON written without a trailing newline; the
// TS/F# encoders emit the same. Strip at most one trailing newline defensively
// so an editor/git autocrlf touch on the corpus payload can't masquerade as a
// real divergence (mirrors the @fuaran-ui/ops corpus.test.ts convention).
const canon = (s) => s.replace(/\n$/, '');

// ── Load the TS host (the second conformant implementation) ──────────────────
//  Imported by path; its internal `@fuaran-ui/schema` bare import resolves
//  through fuaran-ts/packages/ops/node_modules (the pnpm symlink), independent
//  of this runner's own node_modules.
let encodeNode, encodeOp, decodeNode, decodeOp;
try {
  ({ encodeNode, encodeOp, decodeNode, decodeOp } = await import(pathToFileURL(opsDist).href));
} catch (err) {
  console.error(
    `\n  FATAL: could not load the TypeScript host at\n    ${opsDist}\n` +
      `  Build the TS workspace first:  pnpm -C ../../fuaran-ts install && pnpm -C ../../fuaran-ts build\n` +
      `  Underlying error: ${err.message}\n`,
  );
  process.exit(2);
}

// ── Load the corpus + schema ─────────────────────────────────────────────────
const manifest = JSON.parse(read('manifest.json'));
const fixtures = manifest.fixtures;

const ajv = new Ajv2020({ strict: false, allErrors: true });
const schemaValid = ajv.compile(JSON.parse(read('schema.json')));

// ── Fail-loud divergence reporting ───────────────────────────────────────────
const failures = [];
const record = (fixtureId, kind, host, summary, detail) =>
  failures.push({ fixtureId, kind, host, summary, detail });

/** First byte offset at which two strings differ, with a context window. */
const firstDiff = (expected, actual) => {
  const n = Math.min(expected.length, actual.length);
  let i = 0;
  while (i < n && expected[i] === actual[i]) i++;
  const from = Math.max(0, i - 30);
  const win = (s) => JSON.stringify(s.slice(from, i + 30));
  return (
    `byte offset ${i} (length F#=${expected.length}, TS=${actual.length})\n` +
    `      F#  …${win(expected)}…\n` +
    `      TS  …${win(actual)}…\n` +
    `          ${' '.repeat(Math.min(i - from, 30) + 1)}^`
  );
};

// ── Run the TS host over every fixture ───────────────────────────────────────
const accepts = fixtures.filter((f) => f.kind === 'node-round-trip' || f.kind === 'op-round-trip');
const rejects = fixtures.filter((f) => f.kind === 'reject');

for (const f of accepts) {
  const input = read(f.inputFile);
  const fsharpCanonical = canon(read(f.expectedFile ?? f.inputFile));
  const decoded = f.decoder === 'node' ? decodeNode(input) : decodeOp(input);

  if (!decoded.ok) {
    // TS rejects an input the F# host accepts — a decoder divergence.
    record(
      f.id,
      f.kind,
      'TS',
      'TS decoder REJECTED an accept-fixture (F# host accepts it)',
      `${decoded.error.code} at ${decoded.error.path} — ${decoded.error.message}`,
    );
    continue;
  }

  const tsCanonical = f.decoder === 'node' ? encodeNode(decoded.value) : encodeOp(decoded.value);

  if (tsCanonical !== fsharpCanonical) {
    record(
      f.id,
      f.kind,
      'TS',
      'TS encoder output diverges from the F# canonical form',
      firstDiff(fsharpCanonical, tsCanonical),
    );
    continue;
  }

  // Schema-validation leg: the TS host's own output must validate against the
  // canonical Draft 2020-12 schema (Phase 96) — proving the TS host emits
  // schema-valid wire, not merely F#-identical wire.
  if (!schemaValid(JSON.parse(tsCanonical))) {
    record(
      f.id,
      f.kind,
      'TS',
      'TS encoder output FAILS the canonical JSON Schema (schema.json)',
      (schemaValid.errors ?? [])
        .map((e) => `      ${e.instancePath || '$'} ${e.message}`)
        .join('\n'),
    );
  }
}

for (const f of rejects) {
  const input = read(f.inputFile);
  const decoded = f.decoder === 'node' ? decodeNode(input) : decodeOp(input);

  if (decoded.ok) {
    record(
      f.id,
      f.kind,
      'TS',
      'TS decoder ACCEPTED a reject-fixture (F# host rejects it)',
      `expected ${f.expectedErrorCode} at ${f.expectedPath}`,
    );
    continue;
  }
  if (decoded.error.code !== f.expectedErrorCode) {
    record(
      f.id,
      f.kind,
      'TS',
      'TS decoder error CODE diverges from the F# canonical error',
      `F#=${f.expectedErrorCode}   TS=${decoded.error.code}   (path ${decoded.error.path})`,
    );
    continue;
  }
  if (!decoded.error.path.startsWith(f.expectedPath ?? '$')) {
    record(
      f.id,
      f.kind,
      'TS',
      'TS decoder error PATH diverges from the F# canonical error',
      `F# path prefix=${f.expectedPath}   TS path=${decoded.error.path}   (code ${decoded.error.code})`,
    );
  }
}

// ── Report ───────────────────────────────────────────────────────────────────
const total = accepts.length + rejects.length;
if (failures.length === 0) {
  console.log(
    `\n  ✓ cross-implementation conformance: ${total} fixtures ` +
      `(${accepts.length} round-trip + ${rejects.length} reject)\n` +
      `    TS @fuaran-ui/ops output is byte-identical to the F# canonical form and schema-valid.\n` +
      `    (F#↔corpus parity is asserted by the workflow's dotnet-test leg.)\n`,
  );
  process.exit(0);
}

console.error(`\n  ✗ CROSS-IMPLEMENTATION WIRE-FORMAT DIVERGENCE — ${failures.length} of ${total} fixtures\n`);
for (const d of failures) {
  console.error(`  ── ${d.fixtureId}  [${d.kind}]  host: ${d.host}`);
  console.error(`     ${d.summary}`);
  if (d.detail) console.error(`     ${d.detail.replace(/\n/g, '\n     ')}`);
  console.error('');
}
console.error(
  `  The two hosts disagree on the canonical wire format. Per WIRE_FORMAT.md §11 the\n` +
    `  encoder + decoder + schema + corpus + BOTH host implementations move in one commit.\n` +
    `  Regenerate the corpus from F# (\`dotnet run --project fuaran-dotnet/src/Fuaran.UI.JsonDecode.Tests\n` +
    `  -- --emit-corpus wire-format-fixtures\`) and bring the TS @fuaran-ui/ops codec into line.\n`,
);
process.exit(1);
