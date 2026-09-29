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

For every entry in `manifest.json`, a host's node decoder, **with decode-time recovery off**, must:

| `verdict` | Required answer |
|---|---|
| `accept` | the decode succeeds |
| `reject` | the decode fails with exactly `expectedErrorCode` at exactly `expectedPath` |

A host certifies against this family the same way it certifies against the others: its own suite
reads the committed declaration and asserts its answers. Two hosts that each match the declaration
agree with each other on every sampled emission, so a change to either decoder that moves its answer
on a real emission reddens that host's gate.

The sample is fixed and small (38 emissions), and it is committed, so the evaluation store is never a
CI dependency. It is stratified: accepts (with and without a chart or data grid), refusals of every
decode error class the store produced, and the recovery class below.

## The open question: decode-time recovery (`openQuestions`)

Measured on 2026-09-29 over every unique stored emission (12,707), the reference host accepted 282
documents the TypeScript host refused. All 282 are malformed JSON the reference host **repairs**
before decoding, by one of two bounded recoveries:

- `implied-node-close` — a node wrapper's closing brace dropped at a `children[]` / `cases[]`
  boundary, re-inserted;
- `over-close-unique` — a surplus closing bracket, deleted when exactly one deletion decodes.

With recovery off, the two hosts accept exactly the same set. The disagreement is therefore one
question and not 282 bugs: **may, or must, a conformant node decoder repair malformed JSON before it
decodes?** WIRE_FORMAT.md specifies neither repair, and §16 lists no JSON-syntax leniency, so the
specification is silent. The answer is a specification decision, not a host fix, and this family
does not pre-empt it.

A fixture carrying `referenceRecovery` is one of those documents. Its `verdict` is the recovery-off
answer, `INVALID_JSON` at `$`, which every measured host returns today. The reference host
additionally asserts that its default decoder repairs it by the named recovery and nothing else, so
the size of the open question cannot grow without a gate noticing.

One of the four `over-close-unique` fixtures (`stored-recovery-over-close-unique-62782c6f2c99a7da`)
is worth reading beside §20.2 row 2: its surplus closer falls after the root value, so a
recovery-off parse sees **content after the root value**, the input class row 2 requires
`INVALID_JSON` for.

## Regenerating

The sample is chosen, not generated: re-drawing it is a deliberate change to a conformance
declaration. A regeneration re-measures the whole store on every host, keeps only emissions the
hosts answer identically with recovery off (same code, same path), and records the new counts in
`manifest.json` `snapshot`.
