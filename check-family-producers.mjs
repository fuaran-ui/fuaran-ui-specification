#!/usr/bin/env node
// Every corpus family has a producer (or a stated reason it is authored), a source stamp, and a
// section holding its normative sentence — WIRE_FORMAT.md 27.8.
//
//   node check-family-producers.mjs
//
// The family SET is derived from the tree by the one derivation the change-set runner uses
// (conformance/change-set.mjs `corpusFamilies`, WIRE_FORMAT 27.7), never listed here. The RECORDS
// live in corpus-producers.json `families`, one per family. A finding is any of:
//
//   * a family the tree enumerates with no record (a family with no producer is the finding the
//     27.8 rule exists to raise), or a record naming a family the tree no longer has;
//   * a record with neither, or both, of `producer` and `authored`;
//   * a producer with no `repository` or `emit`, or no `source` stamp (`since`, `kitVersion`, or
//     `{commit}` of 40 lowercase hex), or a `kitVersion` source over a file that carries none, or a
//     `since` source over root rows that do not all carry one;
//   * an `authored` record with an empty reason;
//   * a `spec` naming a section the document does not have;
//   * a `tier` other than `ui` (the one tier 27.8.1 defines).
//
// Exit 0 when there are no findings, 1 otherwise.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { corpusFamilies } from './conformance/change-set.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const readJson = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));

const families = corpusFamilies(root);
const records = readJson('corpus-producers.json').families ?? {};
const rootRows = readJson('manifest.json').fixtures;

const headings = new Map();
const headingsOf = (file) => {
  if (!headings.has(file)) {
    const text = existsSync(join(root, file)) ? readFileSync(join(root, file), 'utf8') : '';
    const ids = new Set();
    for (const line of text.split('\n')) {
      const m = /^#{2,4} (\d+(?:\.\d+)*)[. ]/.exec(line);
      if (m) ids.add(m[1]);
    }
    headings.set(file, ids);
  }
  return headings.get(file);
};

// The file a self-enumerated family's vectors live in, for a `kitVersion` source.
const familyFile = (family) => {
  const slash = family.indexOf('/');
  if (slash < 0) return null;
  const dir = family.slice(0, slash);
  const id = family.slice(slash + 1);
  const entry = (readJson(join(dir, 'manifest.json')).families ?? []).find((f) => f?.id === id);
  return entry?.file ? join(dir, entry.file) : null;
};

const findings = [];
const add = (family, what) => findings.push(`${family}: ${what}`);

for (const family of families) {
  const r = records[family];
  if (!r) {
    add(family, 'no producer record (corpus-producers.json families)');
    continue;
  }
  if (typeof r.spec !== 'string' || r.spec === '') add(family, 'no spec section');
  else {
    const m = /^(?:([A-Z_]+\.md) )?(\d+(?:\.\d+)*)$/.exec(r.spec);
    if (!m) add(family, `spec '${r.spec}' is not '<n>' or '<FILE>.md <n>'`);
    else if (!headingsOf(m[1] ?? 'WIRE_FORMAT.md').has(m[2]))
      add(family, `spec '${r.spec}' names a section ${m[1] ?? 'WIRE_FORMAT.md'} does not have`);
  }
  if (r.tier !== undefined && r.tier !== 'ui') add(family, `tier '${r.tier}' is not 'ui'`);
  const hasProducer = r.producer !== undefined;
  const hasAuthored = r.authored !== undefined;
  if (hasProducer === hasAuthored) {
    add(family, 'needs exactly one of producer and authored');
    continue;
  }
  if (hasAuthored) {
    if (typeof r.authored !== 'string' || r.authored.trim() === '') add(family, 'authored with no reason');
    continue;
  }
  if (!r.producer?.repository || !r.producer?.emit) add(family, 'producer needs repository and emit');
  const s = r.source;
  if (s === 'since') {
    const rows = rootRows.filter((f) => f.kind === family);
    if (rows.length === 0) add(family, "source 'since' but the root manifest has no rows of this kind");
    else if (rows.some((f) => typeof f.since !== 'string')) add(family, "source 'since' but a root row carries none");
  } else if (s === 'kitVersion') {
    const file = familyFile(family);
    const stamp = file && existsSync(join(root, file)) ? readJson(file).kitVersion : undefined;
    if (typeof stamp !== 'string' || stamp === '') add(family, "source 'kitVersion' but the family file carries none");
  } else if (!(s && typeof s === 'object' && /^[0-9a-f]{40}$/.test(s.commit ?? ''))) {
    add(family, "producer needs a source: 'since', 'kitVersion' or {commit: <40 hex>}");
  }
}
for (const family of Object.keys(records))
  if (!families.includes(family)) add(family, 'a record for a family the corpus tree no longer has');

if (findings.length > 0) {
  console.log(`${findings.length} family producer finding(s) (WIRE_FORMAT.md 27.8):\n`);
  for (const f of findings) console.log(`  - ${f}`);
  process.exit(1);
}
const authored = families.filter((f) => records[f].authored !== undefined).length;
console.log(
  `${families.length} corpus families: ${families.length - authored} emitted by a named producer, ${authored} authored with a stated reason; every one has a spec section.`,
);
