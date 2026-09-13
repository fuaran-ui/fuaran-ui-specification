#!/usr/bin/env node
// The go-red proof for `check-coverage.mjs`'s CITATION arm (Phase 1692).
//
//   node validator/check-coverage-selftest.mjs [--verbose]
//
// SPEC_CONVENTIONS §8 puts two obligations on a conformance harness, and the
// second is the one this file discharges: prove at least once that the check can
// go red. A gate that has never been seen to fail is indistinguishable from one
// that cannot — and this arm is the kind most at risk of that, because its green
// is the ordinary state and its red is a token nobody typed on purpose.
//
// It discharges the harder half too, which §8 does not name: prove the check can
// still go GREEN, and go green on a fixture that differs from the red one by
// three characters. A citation arm that refused every FUARAN code the pre-emit
// vocabulary does not define would be red on every host in the estate — the code
// space is shared with the reference's build-time source-AST walker — so "it went
// red" says nothing on its own about whether it went red for the right reason.
//
// Four assertions, over two committed fixture hosts under `go-red/`:
//
//   1. the STALE fixture — an impeccable declaration beside a decoder citing
//      FUARAN150, the code Phase 1666 renumbered to FUARAN152 — is REFUSED, and
//      the refusal names FUARAN150 and the file it is in;
//   2. the same fixture PASSES under `go-red/check-coverage.pre-1692.mjs`, the
//      frozen pre-change gate. This is what makes assertion 1 a proof about the
//      CHANGE rather than about the fixture: every arm that existed before this
//      one accepted the pairing, so the citation arm is what refuses it;
//   3. the ACCOUNTED fixture — the same declaration and the same decoder with the
//      citation corrected to FUARAN152 — PASSES;
//   4. the arm DISCRIMINATES rather than blankets: the accounted fixture also
//      cites FUARAN050, a walker-family code the vocabulary does not define, and
//      passes on the strength of its `otherFamilies` declaration alone. Deleting
//      that declaration must make it red. This is the assertion that would catch
//      an arm reduced to "is it in the vocabulary", which would be green on the
//      fixtures above and red on every real host.
//
// Nothing here writes, copies or perturbs anything committed: assertion 4 builds
// its perturbed declaration in a temporary directory the run removes, and the
// two fixtures are read-only inputs reached by an explicit host-directory
// argument. A self-test that mutated the corpus would be a defect of its own (§8
// again).
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const verbose = process.argv.includes('--verbose');

const CHECKER = join(here, 'check-coverage.mjs');
const FROZEN = join(here, 'go-red', 'check-coverage.pre-1692.mjs');
const STALE = join(here, 'go-red', 'stale-citation', 'fuaran-go');
const ACCOUNTED = join(here, 'go-red', 'accounted-citation', 'fuaran-go');

const run = (script, hostDir) => {
  const r = spawnSync(process.execPath, [script, hostDir], { encoding: 'utf8' });
  if (r.error) throw r.error;
  return { exit: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
};

const failures = [];
const check = (name, ok, detail) => {
  if (ok) {
    console.log(`  ok    ${name}`);
    return;
  }
  console.log(`  FAIL  ${name}`);
  failures.push(`${name}\n      ${detail}`);
};

console.log('\nValidator coverage — go-red proof for the citation arm (Phase 1692)\n');

// 1. The stale citation is refused, and the refusal is specific.
{
  const r = run(CHECKER, STALE);
  check(
    'a decoder citing a RENUMBERED code is refused',
    r.exit === 1,
    `expected exit 1, got ${r.exit}\n${r.out}`
  );
  check(
    'the refusal names the stale code and the file it is in',
    r.out.includes('FUARAN150') && r.out.includes('decode.go'),
    `refusal did not name FUARAN150 in decode.go:\n${r.out}`
  );
  if (verbose) console.log(`\n${r.out}`);
}

// 2. The SAME fixture passed before the arm existed — so the refusal is about
//    the change, not about the fixture.
{
  const r = run(FROZEN, STALE);
  check(
    'the same fixture PASSES the frozen pre-1692 gate',
    r.exit === 0,
    `expected exit 0 from the frozen gate, got ${r.exit}\n${r.out}`
  );
}

// 3. The corrected citation passes.
{
  const r = run(CHECKER, ACCOUNTED);
  check(
    'the same decoder citing the code the renumbering LANDED on passes',
    r.exit === 0,
    `expected exit 0, got ${r.exit}\n${r.out}`
  );
}

// 4. The arm reads the host's `otherFamilies` rather than the vocabulary alone.
{
  const tmp = mkdtempSync(join(tmpdir(), 'fuaran-citation-selftest-'));
  try {
    const hostDir = join(tmp, 'fuaran-go');
    mkdirSync(join(hostDir, 'wire'), { recursive: true });
    copyFileSync(join(ACCOUNTED, 'wire', 'decode.go'), join(hostDir, 'wire', 'decode.go'));
    const decl = JSON.parse(readFileSync(join(ACCOUNTED, 'validator-coverage.json'), 'utf8'));
    decl.otherFamilies = {};
    writeFileSync(join(hostDir, 'validator-coverage.json'), `${JSON.stringify(decl, null, 2)}\n`);

    const r = run(CHECKER, hostDir);
    check(
      "dropping the host's otherFamilies declaration makes the SAME source red",
      r.exit === 1 && r.out.includes('FUARAN050'),
      `expected exit 1 naming FUARAN050, got ${r.exit}\n${r.out}`
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (failures.length > 0) {
  console.error(`\n${failures.length} assertion(s) failed:\n`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log('\nthe citation arm goes red on a stale citation, green on a corrected one, and reads the declaration\n');
