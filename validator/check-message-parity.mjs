#!/usr/bin/env node
// Assert each host's defect MESSAGE conveys the same fix as the reference's.
//
// `check-coverage.mjs` answers "does this host implement the code it claims". This
// answers the question underneath it: a shared code is worthless if two hosts mean
// different things by it, and "FUARAN083" pointing at one message that names the
// remedy and another that does not is exactly that.
//
// Checked against `message-parity.json`, which is hand-authored — "conveys the same
// fix" is a judgement, and deriving it from the reference's own wording would only
// assert that the reference matches itself.
//
// Message templates are recovered by SOURCE SCAN, one small regex per host, because
// the alternative is running each host's validator over a tree that triggers every
// rule — and the rules no such tree reaches are the ones most likely to have drifted.
//
//   node validator/check-message-parity.mjs [--verbose]
//
// Exits non-zero on a host whose message drops a required concept.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const workspace = resolve(here, '..', '..');
const verbose = process.argv.includes('--verbose');

const parity = JSON.parse(readFileSync(join(here, 'message-parity.json'), 'utf8'));

// One extractor per host: (code -> message template). The regexes are deliberately
// narrow — they match the finding-construction site and nothing else, so a code
// named in a doc comment cannot satisfy the check.
const HOSTS = [
  {
    host: 'fuaran-dotnet',
    role: 'reference',
    file: 'fuaran-dotnet/src/Fuaran.UI/PreEmitValidate.fs',
    // `"FUARAN083",` then severity then the message, which may be a sprintf block.
    re: /"(FUARAN[0-9A-Z-]+)",\s*\n?\s*DefectSeverity\.\w+,\s*\n?\s*([\s\S]{0,600}?)(?=\n\s*\| PreEmitDefect\.|\n\nlet |\n\/\/\/)/g,
  },
  {
    host: 'fuaran-py',
    file: 'fuaran-py/src/fuaran_py/validator/validate.py',
    re: /Finding\(\s*"(FUARAN[0-9A-Z-]+)"\s*,\s*[^,]+?,\s*([\s\S]{0,600}?)\)\s*\n/g,
  },
  {
    host: 'fuaran-go',
    file: 'fuaran-go/validator/validate.go',
    re: /Code:\s*"(FUARAN[0-9A-Z-]+)"[\s\S]{0,200}?Message:\s*([\s\S]{0,600}?),\n\s*Severity/g,
  },
  {
    host: 'fuaran-rs',
    file: 'fuaran-rs/src/validator/mod.rs',
    re: /"(FUARAN[0-9A-Z-]+)"\s*,\s*[\s\S]{0,200}?format!\(\s*([\s\S]{0,600}?)\)\s*[,)]/g,
  },
  {
    // Listed even though it is exempt: an exemption that is never READ is
    // indistinguishable from a host nobody remembered to add, and this file is
    // where that difference has to be visible.
    host: 'fuaran-ts',
    file: 'fuaran-ts/packages/ui/src/preEmitValidate.ts',
    re: /$^/g,
  },
];

const declaredHosts = new Map();
for (const h of HOSTS) {
  const declPath = join(workspace, h.host, 'validator-coverage.json');
  if (existsSync(declPath)) declaredHosts.set(h.host, JSON.parse(readFileSync(declPath, 'utf8')));
}

const failures = [];
const rows = [];

for (const h of HOSTS) {
  const decl = declaredHosts.get(h.host);
  // A host that carries no prose at all is exempt BY SHAPE — there is nothing to
  // compare, and its consumer writes the human-readable rendering. Declared, not
  // assumed: `messageForm` has to say so.
  if (decl?.messageForm === 'structured') {
    rows.push({ host: h.host, checked: 0, exempt: 'structured — findings carry no message' });
    continue;
  }
  const srcPath = join(workspace, h.file);
  if (!existsSync(srcPath)) {
    rows.push({ host: h.host, checked: 0, exempt: 'source not present in this checkout' });
    continue;
  }
  const src = readFileSync(srcPath, 'utf8');
  const templates = new Map();
  for (const m of src.matchAll(h.re)) {
    // Keep the FIRST site per code: a code raised from several places states the
    // same defect each time, and the first is the canonical wording.
    if (!templates.has(m[1])) templates.set(m[1], m[2]);
  }

  let checked = 0;
  for (const [code, spec] of Object.entries(parity.codes)) {
    const template = templates.get(code);
    if (template === undefined) continue; // not implemented here — coverage's job, not this one
    checked++;
    const hay = template.toLowerCase();
    const missing = spec.mustConvey.filter((group) => !group.some((word) => hay.includes(word.toLowerCase())));
    if (missing.length > 0) {
      failures.push(
        `${h.host} ${code}: message does not convey ${JSON.stringify(missing)}\n` +
          `      note: ${spec.note}\n` +
          `      template: ${template.replace(/\s+/g, ' ').trim().slice(0, 160)}`
      );
    }
    if (verbose) console.log(`  ${h.host.padEnd(14)} ${code.padEnd(16)} ${missing.length === 0 ? 'ok' : 'MISSING'}`);
  }
  // A non-exempt host that extracted NOTHING for codes it declares is a broken
  // extractor, not a clean pass. Without this the two are indistinguishable in the
  // output and identical in the exit code, which is the failure mode this whole
  // file exists to avoid one level down.
  const owed = Object.keys(parity.codes).filter((c) => (decl?.implemented ?? []).includes(c));
  if (checked === 0 && owed.length > 0) {
    failures.push(
      `${h.host}: declares ${owed.length} code(s) this contract covers (${owed.join(', ')}) but no ` +
        `message template was extracted from ${h.file}. Either the extractor regex no longer matches ` +
        `this host's finding-construction site, or the file moved — fix the extractor rather than ` +
        `reading zero-checked as zero-problems.`
    );
  }

  rows.push({ host: h.host, checked, exempt: null });
}

console.log('\nMessage parity — concepts every host raising a code must convey\n');
for (const r of rows.sort((a, b) => a.host.localeCompare(b.host))) {
  console.log(`  ${r.host.padEnd(16)} ${r.exempt ? `exempt (${r.exempt})` : `${r.checked} code(s) checked`}`);
}

if (failures.length > 0) {
  console.error(`\nMessage parity drift (${failures.length}):\n`);
  for (const f of failures) console.error(`  - ${f}\n`);
  process.exit(1);
}
console.log(`\nmessage parity: every checked message conveys its required concepts`);
