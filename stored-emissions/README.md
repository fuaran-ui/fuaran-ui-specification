# `stored-emissions/` — real model emissions, and what every host says about them

Every other family in this corpus is authored: a fixture is written to pin one rule. This family is
**sampled**. Each file is a document a model actually emitted, taken byte for byte from the stored
evaluation corpus, and the manifest records the answer every conformant node decoder gives it.

The reason is coverage the authored families cannot buy. The decoder fuzzers and the reject family
agree on what they were written to probe; neither reaches the defects models really produce, which is
where two hosts are most likely to part company without anyone noticing. Before this family, the only
way to learn that two hosts disagreed on a real emission was to run both over the whole evaluation
store, which nothing did in CI.

## What a host asserts

For every entry in `manifest.json`, a host's node decoder, which is **strict** (WIRE_FORMAT.md 28.1),
must:

| `verdict` | Required answer |
|---|---|
| `accept` | the decode succeeds |
| `reject` | the decode fails with exactly `expectedErrorCode` at exactly `expectedPath` |

A host that implements repair (28) additionally asserts each entry's `repair` member: what `repair`
returns for the emission (`repaired` with the `applied` catalogue ids, or `not-repairable` with its
refusal token), and `repairedVerdict`, the strict decode of the repaired text. A document that
already parses is repaired to itself with nothing applied.

A host certifies against this family the same way it certifies against the others: its own suite
reads the committed declaration and asserts its answers. Two hosts that each match the declaration
agree with each other on every sampled emission, so a change to either decoder that moves its answer
on a real emission reddens that host's gate.

The sample is fixed and small (38 emissions), and it is committed, so the evaluation store is never a
CI dependency. It is stratified: accepts (with and without a chart or data grid), refusals of every
decode error class the store produced, and the repair class below.

## Repair, resolved (`repair`)

Measured on 2026-09-29 over every unique stored emission (12,707), the reference host accepted 282
documents the TypeScript host refused. All 282 were malformed JSON the reference host repaired
**inside decode**, by one of two recoveries: `implied-node-close` (a node wrapper's dropped closing
brace re-inserted) and `over-close-unique` (a surplus closer deleted when exactly one deletion
decodes). The specification described neither, so this family first recorded it as an open question.

The ruling (2026-09-30, WIRE_FORMAT.md 28): **decode is strict on every host, and repair is a
separate, specified function a caller invokes deliberately**, naming every repair it applies. The
reference host's default decoder no longer repairs anything. Re-measured over the same 12,707 on
2026-09-30 (`snapshot`): the two hosts' strict decoders accept exactly the same set (7,667); `repair`
returns byte-identical text, identical ids and identical refusals on both hosts for every emission;
316 emissions are repaired, and 282 of those then decode.

A fixture whose `repair.applied` is non-empty is one of those documents. Its `verdict` is the strict
answer, `INVALID_JSON` at `$`. One of the four `over-close-unique` fixtures
(`stored-recovery-over-close-unique-62782c6f2c99a7da`) is worth reading beside 20.2 row 2: its
surplus closer falls after the root value, so the strict parser sees **content after the root
value** and refuses it, exactly as row 2 requires, and `repair` returns it repaired with
`over-close-unique` named. The `repair/` family pins the repaired bytes of all eight.

## Regenerating

The sample is chosen, not generated: re-drawing it is a deliberate change to a conformance
declaration. A regeneration re-measures the whole store on every host, keeps only emissions the
hosts answer identically with their strict decoders (same code, same path), and records the new counts in
`manifest.json` `snapshot`.
