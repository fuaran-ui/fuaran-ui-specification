#!/usr/bin/env node
// The go-red proof for `check-message-parity.mjs`'s structured-exemption arm.
//
//   node validator/check-message-parity-selftest.mjs [--verbose]
//
// SPEC_CONVENTIONS §8 puts two obligations on a conformance harness, and the second
// is the one this file discharges: prove at least once that the check can go red.
// A gate that has never been seen to fail is indistinguishable from one that cannot.
//
// It also discharges the harder half, which §8 does not name and which this arm
// needs more than most: prove the check can still go GREEN. `messageForm:
// "structured"` was a trusted declaration until Phase 1659, and replacing "always
// believed" with "always refused" would be no better — it would simply relocate the
// wrong answer.
//
// Four assertions, over two committed fixture hosts under `go-red/`:
//
//   1. the FALSE fixture — a declaration claiming `structured` beside a source whose
//      findings carry prose — REFUSES under the current checker, and the refusal
//      names the constructions it found;
//   2. the same fixture PASSES under `go-red/check-message-parity.pre-1659.mjs`, the
//      frozen pre-change gate. This is what makes assertion 1 a proof about the
//      CHANGE rather than about the fixture: the pairing was accepted before, so the
//      new arm is what refuses it;
//   3. the TRUE fixture — an honest `structured` claim, beside every shape a naive
//      scan would misread as prose (FUARAN codes and backticks in comments, a `//`
//      inside a string, a slot name, a rendering function that is not a finding) —
//      PASSES, and reports itself VERIFIED rather than merely exempt;
//   4. the probe proves itself: run with `--verbose`, the checker reports the probe
//      matching its own sample. A `site` regex that has stopped matching the host's
//      idiom finds nothing in a false declaration exactly as it finds nothing in an
//      honest one, so the checker asserts this on every ordinary run too.
//
// Nothing here writes, copies or perturbs anything: the fixtures are read-only inputs
// reached through `--workspace`, and a self-test that mutated the committed corpus
// would be a defect of its own (§8 again).
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const verbose = process.argv.includes('--verbose');

const CHECKER = join(here, 'check-message-parity.mjs');
const FROZEN = join(here, 'go-red', 'check-message-parity.pre-1659.mjs');
const FALSE_FIXTURE = join(here, 'go-red', 'false-structured-exemption');
const TRUE_FIXTURE = join(here, 'go-red', 'true-structured-exemption');

const run = (script, fixture, extra = []) => {
  const r = spawnSync(process.execPath, [script, '--workspace', fixture, ...extra], {
    encoding: 'utf8',
  });
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

console.log('\nMessage parity — go-red proof for the structured-exemption arm\n');

// 1. The false declaration is refused, and the refusal is specific.
{
  const { exit, out } = run(CHECKER, FALSE_FIXTURE);
  if (verbose) console.log(out);
  check(
    'a FALSE `messageForm: "structured"` declaration fails the current checker',
    exit === 1,
    `expected exit 1, got ${exit}`
  );
  check(
    'the refusal names the message-shaped constructions it found',
    /REFUTED/.test(out) && /a `message:` member on a constructed finding/.test(out) && /a prose string literal at a constructed finding/.test(out),
    'the output named neither the refutation nor the two shapes; a refusal that does not say what it saw cannot be acted on'
  );
}

// 2. The same fixture passed the gate as it stood before the change. Without this,
//    assertion 1 shows only that the fixture is refusable, not that the change is
//    what refuses it.
{
  const { exit, out } = run(FROZEN, FALSE_FIXTURE);
  if (verbose) console.log(out);
  check(
    'the same fixture PASSES the frozen pre-1659 checker',
    exit === 0 && /exempt \(structured — findings carry no message\)/.test(out),
    `expected exit 0 and the old trusted-exemption row, got exit ${exit}`
  );
}

// 3. An honest declaration still passes, and says it was verified.
{
  const { exit, out } = run(CHECKER, TRUE_FIXTURE);
  if (verbose) console.log(out);
  check(
    'a TRUE `messageForm: "structured"` declaration passes the current checker',
    exit === 0,
    `expected exit 0, got ${exit} — the arm refuses an honest host, which relocates the wrong answer rather than fixing it`
  );
  check(
    'the passing row reports the exemption VERIFIED, not merely declared',
    /exempt \(structured — verified against /.test(out),
    'the row did not distinguish a verified exemption from a believed one, which is the whole change'
  );
}

// 4. The probe is proved against its own sample on every run.
{
  const { out } = run(CHECKER, TRUE_FIXTURE, ['--verbose']);
  check(
    'the checker proves its probe against its own sample before trusting silence',
    /probe proved on its sample \([1-9][0-9]* hit\(s\)\)/.test(out),
    'no probe-proof line — a probe that cannot match reads exactly like a host with nothing to hide'
  );
}

if (failures.length > 0) {
  console.error(`\ngo-red proof FAILED (${failures.length}):\n`);
  for (const f of failures) console.error(`  - ${f}\n`);
  process.exit(1);
}
console.log('\ngo-red proof: the structured-exemption arm refuses a false claim, accepts a true one,');
console.log('and the fixture it refuses is one the pre-change gate accepted.');
