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
//                ../../fuaran-ts/packages/ops/dist exists (FUARAN_TS_ROOT names
//                another checkout; FUARAN_WIRE_FIXTURES another corpus).
//
//    Emitter leg (Phase 2451, this runner):
//      every emitter-profile vector manifest.json declares, from the TS host's
//      oldestAccepted revision onward: integer-only when claimed, inside the
//      declared subset, and accepted (WIRE_FORMAT.md 11.4).
//
//  ── The roster mode (Phase 2301) ──────────────────────────────────────────
//
//  `node cross-host-conformance.mjs --roster` runs the change-set's leg stage
//  over EVERY host in roster.json — the checks the corpus makes of the hosts
//  (each fixture's `since`, each codec host's corpusFamilies, each bundled
//  snapshot) and then each host's leg — and refuses to read green with a leg
//  skipped. The logic is change-set.mjs; WIRE_FORMAT.md 11.3 is its contract.
// ============================================================================

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { resolveCorpusRoot, runRoster } from './change-set.mjs';

const here = dirname(fileURLToPath(import.meta.url));

// Phase 2301 — `--roster` is the change-set's leg stage (WIRE_FORMAT.md 11.3): every host in
// roster.json, against the corpus FUARAN_WIRE_FIXTURES names. Without it, this file is Leg B.
if (process.argv.includes('--roster')) process.exit(await runRoster(process.argv.slice(2)));

// The corpus is the one FUARAN_WIRE_FIXTURES names (a set-but-missing path is refused), else the
// directory above this one; the TS host is FUARAN_TS_ROOT, else the corpus's sibling `fuaran-ts`.
let corpusRoot;
try {
  corpusRoot = resolveCorpusRoot();
} catch (err) {
  console.error(`
  FATAL: ${err.message}
`);
  process.exit(2);
}
const tsRoot = process.env.FUARAN_TS_ROOT || join(here, '..', '..', 'fuaran-ts');
const opsDist = join(tsRoot, 'packages', 'ops', 'dist', 'index.js');
const { default: Ajv2020 } = await import('ajv/dist/2020.js');

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

// allErrors MUST stay false: with allErrors:true, ajv's evaluation of the deeply
// recursive node schema over the §21 depth-limit fixture (limit-node-depth-at-max,
// 256 nesting levels) is effectively unbounded — measured >6h in CI and >120s
// locally, vs 5ms with allErrors:false. First-error reporting is sufficient for a
// gate: an invalid document still fails, naming the first divergence.
const ajv = new Ajv2020({ strict: false, allErrors: false });
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

// ── The constrained-emitter acceptance leg (Phase 2451, WIRE_FORMAT.md §11.4) ─
//  For every lineage manifest.json declares under `emitterProfiles`, every revision
//  from `oldestAccepted['fuaran-ts']` onward: each vector names a row of a family
//  every codec host reads, carries no non-integer number token when the revision
//  claims `integer-only`, lies inside the revision's declared subset (node kinds
//  through a §23 policy admitting exactly `subset.kinds`; control and op tags at
//  their positions), and is accepted by the TS host. `oldestAccepted` must name
//  exactly the roster's codec hosts.
const VECTOR_KINDS = new Set(['node-round-trip', 'op-round-trip', 'lenient-accept']);
let admitting;
try {
  ({ admitting } = await import(
    pathToFileURL(join(tsRoot, 'packages', 'schema', 'dist', 'index.js')).href
  ));
} catch (err) {
  console.error(`\n  FATAL: could not load @fuaran-ui/schema from ${tsRoot}: ${err.message}\n`);
  process.exit(2);
}

const carriesNonIntegerNumber = (wire) => {
  let inString = false;
  let escaped = false;
  let inNumber = false;
  for (const c of wire) {
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
      inNumber = false;
    } else if (c === '-' || (c >= '0' && c <= '9')) inNumber = true;
    else if (inNumber && (c === '.' || c === 'e' || c === 'E')) return true;
    else inNumber = false;
  }
  return false;
};
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const controlKindsOf = (v, out = []) => {
  if (Array.isArray(v)) v.forEach((x) => controlKindsOf(x, out));
  else if (isObject(v)) {
    const carrier = v.$type === 'Form' ? 'fields' : v.$type === 'Filters' ? 'items' : undefined;
    if (carrier !== undefined && Array.isArray(v[carrier]))
      for (const m of v[carrier]) if (isObject(m) && isObject(m.kind)) out.push(m.kind.$type);
    Object.values(v).forEach((x) => controlKindsOf(x, out));
  }
  return out;
};
const opTagsOf = (op) =>
  isObject(op) && typeof op.$type === 'string'
    ? [op.$type, ...(op.$type === 'Batch' && Array.isArray(op.ops) ? op.ops.flatMap(opTagsOf) : [])]
    : [];

const rosterCodecHosts = JSON.parse(readFileSync(join(here, 'roster.json'), 'utf8'))
  .hosts.filter((h) => h.role === 'codec')
  .map((h) => h.id)
  .sort();
const fixtureById = new Map(fixtures.map((f) => [f.id, f]));
let emitterVectors = 0;
for (const [name, lineage] of Object.entries(manifest.emitterProfiles ?? {})) {
  const recorded = Object.keys(lineage.oldestAccepted ?? {}).sort();
  if (JSON.stringify(recorded) !== JSON.stringify(rosterCodecHosts))
    record(name, 'emitter-profile', 'TS', 'oldestAccepted does not name exactly the roster codec hosts', `${recorded} vs ${rosterCodecHosts}`);
  const from = lineage.revisions.findIndex((r) => r.id === lineage.oldestAccepted?.['fuaran-ts']);
  if (from < 0) {
    record(name, 'emitter-profile', 'TS', 'records no oldestAccepted revision of its own for fuaran-ts');
    continue;
  }
  for (const r of lineage.revisions.slice(from)) {
    for (const id of r.vectors) {
      emitterVectors++;
      const f = fixtureById.get(id);
      const fail = (summary, detail) => record(`${r.id}/${id}`, 'emitter-vector', 'TS', summary, detail);
      if (f === undefined || !VECTOR_KINDS.has(f.kind) || f.expectedFile === undefined) {
        fail('names no row of a family every codec host reads');
        continue;
      }
      const input = canon(read(f.inputFile));
      if (r.axes.includes('integer-only') && carriesNonIntegerNumber(input))
        fail('carries a number token with a fraction or an exponent under integer-only');
      const policy = admitting(r.id, r.subset.kinds);
      const gated = f.decoder === 'op' ? decodeOp(input, policy) : decodeNode(input, policy);
      if (!gated.ok) fail('a node kind outside the declared subset', `${gated.error.code} at ${gated.error.path}`);
      const parsed = JSON.parse(input);
      const stray = [
        ...controlKindsOf(parsed).filter((k) => !r.subset.formFieldKinds.includes(k)),
        ...(f.decoder === 'op' ? opTagsOf(parsed).filter((t) => !r.subset.ops.includes(t)) : []),
      ];
      if (stray.length > 0) fail('a control or op tag outside the declared subset', stray.join(', '));
      const decoded = f.decoder === 'op' ? decodeOp(input) : decodeNode(input);
      if (!decoded.ok) {
        fail('TS decoder did not ACCEPT an emitter vector', `${decoded.error.code} at ${decoded.error.path}`);
        continue;
      }
      const out = f.decoder === 'op' ? encodeOp(decoded.value) : encodeNode(decoded.value);
      const want = canon(read(f.expectedFile));
      if (out !== want) fail('TS re-encode differs from the vector\'s expected bytes', firstDiff(want, out));
    }
  }
}

// ── Report ───────────────────────────────────────────────────────────────────
const total = accepts.length + rejects.length;
if (failures.length === 0) {
  console.log(
    `\n  ✓ cross-implementation conformance: ${total} fixtures ` +
      `(${accepts.length} round-trip + ${rejects.length} reject), ${emitterVectors} emitter-profile vectors\n` +
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
