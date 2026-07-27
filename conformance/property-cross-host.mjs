// ============================================================================
//  Phase 101 — cross-host property-based parity harness.
//
//  Complements cross-host-conformance.mjs (Phase 98), which pins each host to
//  the FIXED corpus. This harness pins the two hosts to each other over the
//  GENERATED tree-space the curated fixtures can't reach.
//
//  Leg A (F# → TS): read the F#-canonical fuzz samples emitted by
//    `dotnet run --project fuaran-dotnet/src/Fuaran.UI.JsonDecode.Tests \
//        -- --emit-fuzz-samples <corpus>/conformance/fuzz-samples <count>`
//  into <fuzz-samples>/fsharp/, decode + re-encode each through the TS codec,
//  and assert the TS canonical form is byte-identical to the F# input. Writes
//  the TS-canonical output to <fuzz-samples>/typescript/.
//
//  Leg B (TS → F#, the converse) is the F# `--check-fuzz-samples` mode run
//  afterwards: it reads <fuzz-samples>/typescript/ (genuine TS-encoder output)
//  and asserts the F# codec reproduces each byte-for-byte.
//
//  Leg A here + Leg B there ⇒ F# canonical == TS canonical over the generated
//  space, both directions. A one-byte divergence in either host's codec turns
//  the gate red and names the sample + first differing byte.
//
//  Prereqs: the TS host must be built (pnpm --filter @fuaran-ui/ops build) and
//  the F# emit step must have run first. No extra npm deps (plain node + the
//  built dist).
// ============================================================================

import { readFileSync, writeFileSync, readdirSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const samplesDir = join(here, 'fuzz-samples');
const fsharpDir = join(samplesDir, 'fsharp');
const tsDir = join(samplesDir, 'typescript');
// conformance/ → wire-format-fixtures/ → workspace-root → fuaran-ts
const opsDist = join(here, '..', '..', 'fuaran-ts', 'packages', 'ops', 'dist', 'index.js');

let mod;
try {
  mod = await import(pathToFileURL(opsDist).href);
} catch (err) {
  console.error(
    `\n  FATAL: could not load the TypeScript host at\n    ${opsDist}\n` +
      `  Build the TS workspace first: pnpm --filter @fuaran-ui/ops build\n  (${err})`,
  );
  process.exit(2);
}
const { encodeNode, encodeOp, decodeNode, decodeOp } = mod;

if (!existsSync(fsharpDir)) {
  console.error(
    `\n  FATAL: F# fuzz samples not found at\n    ${fsharpDir}\n` +
      `  Emit them first: dotnet run --project fuaran-dotnet/src/Fuaran.UI.JsonDecode.Tests ` +
      `-- --emit-fuzz-samples ${samplesDir} 300`,
  );
  process.exit(2);
}

const firstDiff = (a, b) => {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) {
      return `first diff at byte ${i}: F#=${JSON.stringify(a.slice(i, i + 24))} TS=${JSON.stringify(
        b.slice(i, i + 24),
      )}`;
    }
  }
  return `lengths differ: F#=${a.length} TS=${b.length}`;
};

rmSync(tsDir, { recursive: true, force: true });
mkdirSync(tsDir, { recursive: true });

const files = readdirSync(fsharpDir)
  .filter((f) => f.endsWith('.json'))
  .sort();

let failures = 0;
for (const f of files) {
  const wire = readFileSync(join(fsharpDir, f), 'utf8');
  const isOp = f.startsWith('op-');
  const decoded = isOp ? decodeOp(wire) : decodeNode(wire);

  if (!decoded.ok) {
    failures++;
    console.error(
      `DECODE FAILED ${f}: TS decoder rejected an F#-canonical sample — ` +
        `${decoded.error.code} at ${decoded.error.path} — ${decoded.error.message}`,
    );
    continue;
  }

  const ts = isOp ? encodeOp(decoded.value) : encodeNode(decoded.value);
  if (ts !== wire) {
    failures++;
    console.error(`MISMATCH ${f} (F#→TS): TS canonical diverges from F# — ${firstDiff(wire, ts)}`);
  }
  writeFileSync(join(tsDir, f), ts);
}

if (failures === 0) {
  console.log(
    `Cross-host F#→TS leg: ${files.length} generated samples re-encoded byte-identically; ` +
      `TS-canonical samples written to ${tsDir} for the converse (F# --check-fuzz-samples).`,
  );
} else {
  console.error(`\nCross-host F#→TS leg: ${failures}/${files.length} generated samples diverged.`);
  process.exit(1);
}
