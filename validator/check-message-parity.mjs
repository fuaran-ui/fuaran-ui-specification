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
// TWO ARMS, and until Phase 1659 the second one was believed rather than checked:
//
//   * a host that carries prose has its templates extracted and checked against the
//     contract's concept groups;
//   * a host that declares `messageForm: "structured"` — findings as typed records
//     with no message string — is now VERIFIED against its own source. A declaration
//     nothing checks turns the strongest claim in this contract into an opt-out, and
//     that was demonstrated rather than supposed: on 2026-08-29 a host that falsely
//     declared it went from nine codes checked to `exempt`, exit 0. The probe that
//     verifies it is itself proved against a sample on every run, because a probe
//     that has quietly stopped matching reads exactly like a host with nothing to
//     hide — the failure mode this whole file exists to avoid one level down.
//
//   node validator/check-message-parity.mjs [--verbose] [--workspace <dir>]
//
// `--workspace` points host discovery at an alternative root. That is how the go-red
// proof beside this file (`validator/check-message-parity-selftest.mjs`) runs the
// gate against fixture hosts without perturbing the committed corpus or reading any
// real checkout.
//
// Exits non-zero on a host whose message drops a required concept, and on a
// `structured` declaration its own source refutes.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const verbose = argv.includes('--verbose');
const wsFlag = argv.indexOf('--workspace');
if (wsFlag !== -1 && !argv[wsFlag + 1]) {
  console.error('--workspace needs a directory');
  process.exit(2);
}
const workspace = wsFlag === -1 ? resolve(here, '..', '..') : resolve(argv[wsFlag + 1]);

const parity = JSON.parse(readFileSync(join(here, 'message-parity.json'), 'utf8'));

// Member names that carry PROSE rather than a typed fact. Deliberately short and
// unambiguous: a `text` or `label` member is plausibly a typed field on a finding
// about text, and accusing a genuinely-structured host is as much a defect as
// believing a false one.
const MESSAGE_MEMBER = /\b(?:message|msg|detail|details|hint|explanation|description)\s*:/;

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
    file: 'fuaran-py/src/fuaran_ui/validator/validate.py',
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
    // where that difference has to be visible. Since Phase 1659 it is not merely
    // read either — `structured` below is what VERIFIES it.
    host: 'fuaran-ts',
    file: 'fuaran-ts/packages/ui/src/preEmitValidate.ts',
    // Kept, and kept dead. This host carries no prose to extract; the guard further
    // down turns a zero-template extraction into a FAILURE for any host that stops
    // being exempt, so dropping `messageForm` from the declaration surfaces here
    // loudly rather than passing as "nothing to check".
    re: /$^/g,
    structured: {
      // Where a finding is constructed. The probe reads the ARGUMENT of each site,
      // brace-balanced and comment-aware, so a FUARAN code in a doc comment can
      // neither satisfy nor refute anything.
      site: /\b(?:defects|findings)\.push\s*\(/g,
      // The sample the probe must match before its silence on the real source is
      // worth anything. This is the shape a false declaration takes: the typed
      // record grows a prose member.
      sample:
        "defects.push({ code: 'UNGROUNDED_SWITCH_STATE_KEY', nodeId: n.id, message: `stateKey is empty — name it` });",
    },
  },
];

// ── The structured-exemption probe ──────────────────────────────────────────────
//
// Hand-rolled rather than parsed: this file has no dependencies and no build step by
// design, so any host's CI can run it. What the mask understands is line and block
// comments and single-, double- and backtick-quoted strings. A template's `${…}`
// interior is treated as string, which errs in the direction that matters — a
// message's literal chunks are still seen. What it does NOT understand is a
// regular-expression literal containing a quote or a comment opener; a host source
// carrying one needs its `site` regex narrowed rather than this mask widened.
//
// Comment and string INTERIORS are blanked to spaces, length and newlines preserved,
// so a regex run over the mask can never match inside either and line numbers still
// resolve against the original. The quotes themselves survive, so `message: '…'` is
// still recognisably a member with a literal value.
function maskSource(src) {
  const out = src.split('');
  const strings = [];
  const blank = (from, to) => {
    for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      const start = i;
      while (i < src.length && src[i] !== '\n') i += 1;
      blank(start, i);
      continue;
    }
    if (c === '/' && d === '*') {
      const start = i;
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i += 1;
      i = Math.min(i + 2, src.length);
      blank(start, i);
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      const start = i;
      i += 1;
      while (i < src.length) {
        if (src[i] === '\\') {
          i += 2;
          continue;
        }
        if (src[i] === c) {
          i += 1;
          break;
        }
        i += 1;
      }
      strings.push({ start, end: i, text: src.slice(start, i) });
      blank(start + 1, Math.max(start + 1, i - 1));
      continue;
    }
    i += 1;
  }
  return { masked: out.join(''), strings };
}

// The parenthesised argument of a construction site, by paren balance over the mask.
function argumentSpan(masked, from) {
  const open = masked.indexOf('(', from);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < masked.length; i += 1) {
    if (masked[i] === '(') depth += 1;
    else if (masked[i] === ')') {
      depth -= 1;
      if (depth === 0) return [open + 1, i];
    }
  }
  return [open + 1, masked.length];
}

const lineOf = (src, index) => src.slice(0, index).split('\n').length;

// Everything at a finding-construction site that looks like PROSE. Two shapes, and
// they are not redundant: a member named `message` is prose whatever its value (so a
// host that assembles the string elsewhere is still caught by the member), and a
// string literal with an interior space is prose whatever the member is called.
function messageShapedConstructions(src, siteRe) {
  const { masked, strings } = maskSource(src);
  const re = new RegExp(siteRe.source, siteRe.flags.includes('g') ? siteRe.flags : `${siteRe.flags}g`);
  const found = new Map();
  for (const m of masked.matchAll(re)) {
    const span = argumentSpan(masked, m.index);
    if (span === null) continue;
    const [from, to] = span;
    const member = MESSAGE_MEMBER.exec(masked.slice(from, to));
    if (member) {
      const line = lineOf(src, from + member.index);
      found.set(`${line}:member`, `line ${line}: a \`${member[0].trim()}\` member on a constructed finding`);
    }
    for (const s of strings) {
      if (s.start < from || s.end > to) continue;
      const inner = s.text.slice(1, -1);
      if (!/\S\s+\S/.test(inner)) continue; // a discriminant or a slot name, not prose
      const line = lineOf(src, s.start);
      found.set(
        `${line}:prose`,
        `line ${line}: a prose string literal at a constructed finding — ${JSON.stringify(inner.length > 70 ? `${inner.slice(0, 70)}…` : inner)}`
      );
    }
  }
  return [...found.values()];
}

const declaredHosts = new Map();
for (const h of HOSTS) {
  const declPath = join(workspace, h.host, 'validator-coverage.json');
  if (existsSync(declPath)) declaredHosts.set(h.host, JSON.parse(readFileSync(declPath, 'utf8')));
}

const failures = [];
const rows = [];

for (const h of HOSTS) {
  const decl = declaredHosts.get(h.host);
  const srcPath = join(workspace, h.file);
  // A host that carries no prose at all is exempt BY SHAPE — there is nothing to
  // compare, and its consumer writes the human-readable rendering. Declared, not
  // assumed: `messageForm` has to say so. And since Phase 1659, CHECKED and not
  // trusted: the declaration is a claim about the host's source, so the source is
  // where it is answered.
  if (decl?.messageForm === 'structured') {
    const cfg = h.structured;
    if (!cfg) {
      failures.push(
        `${h.host}: declares \`messageForm: "structured"\` but this contract carries no probe for ` +
          `this host, so the exemption cannot be verified — and an exemption nothing can check is an ` +
          `opt-out from the strongest claim in this contract. Add a \`structured\` block beside this ` +
          `host's extractor: a \`site\` regex naming where it constructs a finding, and a \`sample\` ` +
          `of the message-shaped construction the probe must be able to match.`
      );
      rows.push({ host: h.host, checked: 0, note: 'structured claimed — NOT VERIFIABLE (no probe for this host)' });
      continue;
    }
    // Prove the probe before believing its silence. `verify the probe, not just the
    // verdict`: a site regex that no longer matches this host's idiom finds nothing
    // in a false declaration exactly as it finds nothing in an honest one.
    const proof = messageShapedConstructions(cfg.sample, cfg.site);
    if (proof.length === 0) {
      failures.push(
        `${h.host}: the structured-exemption probe found nothing in its OWN sample, so its silence ` +
          `on this host's source means nothing. The \`site\` regex no longer matches the idiom the ` +
          `sample is written in — fix the probe rather than reading an unverifiable exemption as a ` +
          `clean one.`
      );
      rows.push({ host: h.host, checked: 0, note: 'structured claimed — NOT VERIFIED (the probe is broken)' });
      continue;
    }
    if (verbose) console.log(`  ${h.host.padEnd(14)} probe proved on its sample (${proof.length} hit(s))`);
    if (!existsSync(srcPath)) {
      // Reported as unverified rather than as exempt: a bare corpus checkout has no
      // host sources at all, and "I could not look" must never render as "I looked
      // and it was clean".
      rows.push({ host: h.host, checked: 0, note: 'structured claimed — source not in this checkout, so NOT verified' });
      continue;
    }
    const refutations = messageShapedConstructions(readFileSync(srcPath, 'utf8'), cfg.site);
    if (refutations.length > 0) {
      failures.push(
        `${h.host}: declares \`messageForm: "structured"\` — findings carrying no message — but ` +
          `${h.file} constructs ${refutations.length} message-shaped finding(s). The exemption is ` +
          `refuted by the host's own source: either the findings carry prose, in which case drop ` +
          `\`messageForm\` and let the templates be checked like every other host's, or the ` +
          `construction is not a finding, in which case narrow this host's \`site\` regex.\n` +
          refutations.map((r) => `      ${r}`).join('\n')
      );
      rows.push({ host: h.host, checked: 0, note: "structured claimed — REFUTED by this host's own source" });
      continue;
    }
    rows.push({ host: h.host, checked: 0, exempt: `structured — verified against ${h.file}` });
    continue;
  }
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
  const verdict = r.note ?? (r.exempt ? `exempt (${r.exempt})` : `${r.checked} code(s) checked`);
  console.log(`  ${r.host.padEnd(16)} ${verdict}`);
}

if (failures.length > 0) {
  console.error(`\nMessage parity drift (${failures.length}):\n`);
  for (const f of failures) console.error(`  - ${f}\n`);
  process.exit(1);
}
console.log(`\nmessage parity: every checked message conveys its required concepts`);
