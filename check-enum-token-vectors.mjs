#!/usr/bin/env node
// Every EMITTABLE wire token in `enum-tokens.json` has a round-trip vector in
// this corpus, in a slot that carries its own enum.
//
//   node check-enum-token-vectors.mjs [--matrix]
//
// ── What this is for ────────────────────────────────────────────────────────
//
// `enum-tokens.json` (Phase 1691) publishes, per enum, the wire token each case
// encodes to. Publishing the table pins what a host MUST write; it says nothing
// about whether any committed document ever exercises it. Those are different
// properties, and the gap between them was measured rather than supposed: on
// 2026-09-10, six emittable mapped tokens had no vector anywhere in this corpus
// — `SortDirection.asc`, `TextFormat.url`, `TextFormat.tel`, and `CompareOp`
// `neq` / `lt` / `lte`. A host could have spelled any of the six wrongly and
// every cross-host conformance gate in the estate would have stayed green,
// because a gate can only disagree about bytes somebody wrote down.
//
// So this closes the loop from the other side: the table says what the tokens
// are, and this says the corpus exercises them. A new enum case added to the
// table with no vector beside it is red HERE, at the moment it is published,
// rather than latent until a host spells it wrong.
//
// ── Everything is DERIVED; nothing here is a list ───────────────────────────
//
//   * the tokens come from `enum-tokens.json`;
//   * the SLOT KEYS each enum may appear under come from `idl.json` — every
//     record, kind and op field whose type is that enum. So an enum used in a
//     new slot is covered with no edit here, and a token found under a slot key
//     no declaration gives its enum does not count, which is what stops the
//     string `asc` in a Transform window's `orderBy[].dir` from being read as
//     coverage of `SortDirection` (it is a different slot on a different type,
//     and it is exactly the near-miss the 1691 measurement had to exclude);
//   * EMITTABILITY comes from the same declarations. A case every slot declares
//     as its `omitDefault` default can never appear in canonical bytes, so
//     requiring a vector for it would be requiring a document that cannot
//     exist. `TextDirection.auto` is the one such case today, and it is
//     reported as unemittable rather than skipped silently.
//
// ── SCOPE: a MAPPED token is refused, an IDENTITY token is reported ─────────
//
// Only the six MAPPED enums — the ones whose wire token differs from the case
// name — make a missing vector RED. That is a judgement about risk and it is
// worth stating rather than leaving to be inferred from the code. A mapped
// token is a fact a host can only get right by consulting the table: nothing in
// `CompareOp.Lte` tells an implementer the bytes read `lte`, so an unexercised
// mapped token is a plausible silent wrong answer. An identity token is the
// case name, so a host that writes what it reads is right by construction, and
// the byte-parity round trip over any document already pins the spelling
// machinery that would carry it.
//
// The identity gap is REPORTED rather than excluded, because scoping a check
// quietly is how a limit becomes a claim. Measured on the corpus this landed
// against: 33 identity tokens have no accepted vector either — three badge
// variants, four chart kinds, two heading variants, and so on. Nothing here
// says that is fine; it says it is a different phase's subject, and the run
// prints the list every time so the number cannot quietly grow unwatched.
//
// ── The second limit: an enum no IDL FIELD declares is not measured at all ──
//
// Slot keys come from field declarations, so an enum reached only through a
// union arm or a nested constructor has no key to look under and every one of
// its cases is reported `no-slot` rather than covered or missing. Ten enums are
// in that position today — DateStyle, DateVariant, DurationStyle, DurationUnit,
// EmbedPermission, FileReadEncoding, Motion, NavigateTarget, RelativeTimeUnit,
// TimeGrain — carrying 43 cases between them, and NONE of them is mapped, which
// is the only reason this limit is tolerable rather than disqualifying: every
// token this check refuses to measure is a token equal to its own case name.
// A future mapped enum reached only through a union would be silently
// unmeasured, so the count is printed on every run and a mapped enum appearing
// in it is the signal to widen the derivation, not to widen the exclusion.
//
// ── The go-red obligation (SPEC_CONVENTIONS §8.2, §13) ──────────────────────
//
// A coverage check is the kind that passes by finding nothing to look at, so
// the proof runs INSIDE the ordinary invocation, before the verdict is
// believed: a synthetic token nothing could carry is injected into an in-memory
// copy of the table and must be reported missing. If the proof fails, the run
// is red whatever the real answer was. Nothing is written or perturbed on disk
// — the whole check is a read.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wantMatrix = process.argv.includes('--matrix');

const read = (name) => {
  const p = join(here, name);
  if (!existsSync(p)) {
    console.error(`${name} not found at ${p} — regenerate the corpus.`);
    process.exit(2);
  }
  return JSON.parse(readFileSync(p, 'utf8'));
};

const tokens = read('enum-tokens.json');
const idl = read('idl.json');
const manifest = read('manifest.json');

// ── Slot keys and defaults, from the IDL's own field declarations ───────────
//
// `records`, `kinds` and `ops` all carry `fields`; the walk takes every group
// that does, so a fourth group of declarations is covered without an edit.
const slotKeys = new Map(); // enum name -> Set<field name>
const defaultedEverywhere = new Map(); // enum name -> Set<case> defaulted in EVERY slot
const slotCount = new Map();

for (const group of Object.values(idl)) {
  if (!Array.isArray(group)) continue;
  for (const decl of group) {
    if (!decl || !Array.isArray(decl.fields)) continue;
    for (const field of decl.fields) {
      const t = field.type;
      if (!t || t.$type !== 'enum' || typeof t.name !== 'string') continue;
      const name = t.name;
      if (!slotKeys.has(name)) slotKeys.set(name, new Set());
      slotKeys.get(name).add(field.name);
      slotCount.set(name, (slotCount.get(name) ?? 0) + 1);

      const opt = field.optionality ?? {};
      const dflt = opt.$type === 'omitDefault' ? opt.default?.case : undefined;
      // Intersection across slots: a case is unemittable only when EVERY slot
      // carrying the enum omits it as that slot's default.
      if (!defaultedEverywhere.has(name)) {
        defaultedEverywhere.set(name, dflt === undefined ? new Set() : new Set([dflt]));
      } else {
        const acc = defaultedEverywhere.get(name);
        for (const c of [...acc]) if (c !== dflt) acc.delete(c);
      }
    }
  }
}

// ── Every token an ACCEPTED document carries, keyed by its slot ─────────────
//
// Read through `manifest.json` (§5: it is the authoritative enumeration), and
// deliberately NOT by walking the directories. A directory walk is shorter and
// WRONG, which is worth recording because it was written that way first and the
// error looked exactly like a pass: `reject/` holds documents a conformant host
// must REFUSE, so a token appearing only there is never encoded by anybody.
// `SortDirection.asc` is precisely that case — the corpus carries
// `{"direction":"asc"}` twice, in two reject fixtures whose declared defect is
// the COLUMN index beside it — so the walk reported that token covered while it
// was the very token Phase 1691 had measured as uncovered. A coverage check
// that counts refused bytes as coverage is worse than none.
//
// So a fixture contributes its canonical output (`expectedFile`, the bytes a
// host must re-encode) or, where its family has no expected document, its
// accepted input — and no fixture of a `*reject*` kind contributes anything.
// Both rules read the KIND rather than the directory, so a new family is
// classified with no edit here.
const seen = new Map(); // "<key> <value>" -> first file that carried it
const contributing = [];

const note = (key, value, file) => {
  if (typeof value !== 'string') return;
  const k = key + ' ' + value;
  if (!seen.has(k)) seen.set(k, file);
};

const walkDoc = (o, file) => {
  if (Array.isArray(o)) {
    for (const v of o) walkDoc(v, file);
    return;
  }
  if (!o || typeof o !== 'object') return;
  for (const [k, v] of Object.entries(o)) {
    note(k, v, file);
    walkDoc(v, file);
  }
};

for (const f of manifest.fixtures) {
  if (typeof f.kind === 'string' && f.kind.includes('reject')) continue;
  const rel = f.expectedFile ?? f.inputFile;
  if (typeof rel !== 'string') continue;
  const p = join(here, rel);
  if (!existsSync(p) || statSync(p).size > 8 * 1024 * 1024) continue;
  let doc;
  try {
    doc = JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    continue;
  }
  contributing.push(rel);
  walkDoc(doc, rel);
}

if (contributing.length === 0) {
  console.error(
    'No accepted fixture document could be read from the manifest. Refusing to report coverage: an empty ' +
      'read looks identical to a corpus in which every token is missing, and neither of those is "covered".'
  );
  process.exit(1);
}
const documents = contributing.length;

// ── The check, as a function of the table, so the proof can re-run it ───────
const evaluate = (table) => {
  const rows = [];
  for (const e of table.enums) {
    const keys = slotKeys.get(e.name) ?? new Set();
    const unemittable = defaultedEverywhere.get(e.name) ?? new Set();
    for (const c of e.cases) {
      if (keys.size === 0) {
        rows.push({ enum: e.name, case: c.case, token: c.token, mapped: e.mapped === true, state: 'no-slot' });
        continue;
      }
      if (unemittable.has(c.case)) {
        rows.push({ enum: e.name, case: c.case, token: c.token, mapped: e.mapped === true, state: 'unemittable' });
        continue;
      }
      let where;
      for (const k of keys) {
        const hit = seen.get(k + ' ' + c.token);
        if (hit) {
          where = `${k} in ${hit}`;
          break;
        }
      }
      rows.push({
        enum: e.name,
        case: c.case,
        token: c.token,
        mapped: e.mapped === true,
        state: where ? 'covered' : e.mapped === true ? 'MISSING' : 'unexercised',
        where,
        keys: [...keys].sort().join(' / '),
      });
    }
  }
  return rows;
};

// ── The proof, before the verdict (§8.2) ────────────────────────────────────
//
// A synthetic case on a real enum, whose token no document can carry. If the
// check does not report it missing, the check is not looking, and its silence
// about the real tokens means nothing.
const proofSubject = tokens.enums.find((e) => e.mapped === true && (slotKeys.get(e.name)?.size ?? 0) > 0);
if (!proofSubject) {
  console.error('go-red proof cannot run: no MAPPED enum in the table is carried by any IDL slot.');
  process.exit(1);
}
const probeToken = '__no-document-carries-this__';
const perturbed = {
  ...tokens,
  enums: tokens.enums.map((e) =>
    e === proofSubject ? { ...e, cases: [...e.cases, { case: '__Probe', token: probeToken }] } : e
  ),
};
const proofRow = evaluate(perturbed).find((r) => r.token === probeToken);
if (!proofRow || proofRow.state !== 'MISSING') {
  console.error(
    `go-red proof FAILED: an uncarried token on ${proofSubject.name} reported ` +
      `'${proofRow ? proofRow.state : '<not evaluated>'}' rather than MISSING. The coverage answer below ` +
      `is not trustworthy — a check that cannot report a missing token cannot report a present one either.`
  );
  process.exit(1);
}

const rows = evaluate(tokens);
const missing = rows.filter((r) => r.state === 'MISSING');
const unexercised = rows.filter((r) => r.state === 'unexercised');
const noSlot = rows.filter((r) => r.state === 'no-slot');
const unemittable = rows.filter((r) => r.state === 'unemittable');

if (wantMatrix) {
  console.log(`\nEnum token vector coverage — ${rows.length} case(s) across ${tokens.enums.length} enum(s)\n`);
  console.log('enum                  case                  token                 state        where');
  console.log('--------------------  --------------------  --------------------  -----------  -----');
  for (const r of rows) {
    console.log(
      `${r.enum.padEnd(20).slice(0, 20)}  ${r.case.padEnd(20).slice(0, 20)}  ${r.token.padEnd(20).slice(0, 20)}  ` +
        `${r.state.padEnd(11)}  ${r.where ?? (r.state === 'unemittable' ? 'omitDefault in every slot' : '')}`
    );
  }
  console.log('');
}

// The second limit, ENFORCED rather than merely written down. Every unmeasured
// enum is identity-token today, which is what makes the limit tolerable; a
// MAPPED enum arriving there would be a published token this check silently
// declines to measure, and a limit that can quietly widen is not a limit.
const unmeasurableMapped = noSlot.filter((r) => r.mapped);
if (unmeasurableMapped.length > 0) {
  console.error(
    `
${unmeasurableMapped.length} MAPPED token(s) belong to an enum no IDL field declares, so this check ` +
      `cannot measure them:
`
  );
  for (const r of unmeasurableMapped) console.error(`  - ${r.enum}.${r.case} ("${r.token}")`);
  console.error(
    `
Widen the slot derivation to reach that enum (a union arm or a nested constructor, not a record
` +
      `field) rather than widening what this check declines to look at.
`
  );
  process.exit(1);
}

if (missing.length > 0) {
  console.error(`\n${missing.length} emittable token(s) with no round-trip vector in this corpus:\n`);
  for (const r of missing) {
    console.error(`  - ${r.enum}.${r.case} encodes to "${r.token}", and no document carries it under ${r.keys}`);
  }
  console.error(
    `\nA published token nothing exercises is a token any host may spell wrongly with every gate green.\n` +
      `Mint a fixture carrying it in one of those slots, or — if the case genuinely cannot be emitted —\n` +
      `the IDL should say so as an omitDefault, which this check reads.\n`
  );
  process.exit(1);
}

const coveredMapped = rows.filter((r) => r.mapped && r.state === 'covered').length;
if (unexercised.length > 0) {
  console.log(
    `
${unexercised.length} IDENTITY token(s) are also unexercised, reported and not refused ` +
      `(see this file's scope note):
`
  );
  for (const r of unexercised) console.log(`  · ${r.enum}.${r.case} under ${r.keys}`);
  console.log('');
}
console.log(
  `enum token vectors: every MAPPED emittable token is carried — ${coveredMapped} of them, ` +
    `across ${documents} corpus document(s) (${manifest.fixtures.length} fixtures enumerated); ` +
    `${unexercised.length} identity token(s) unexercised (reported, not refused); ` +
    `${unemittable.length} unemittable by omitDefault; ${noSlot.length} carried by no IDL slot; ` +
    `go-red proof passed`
);
