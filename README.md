# fuaran-specification

The **canonical, language-neutral specification of the Fuaran UI wire format** — the typed UI
tree and tree-op contract that every Fuaran host implements — together with its **executable
conformance corpus**.

## What's here

| Artefact | Role |
|---|---|
| [`WIRE_FORMAT.md`](WIRE_FORMAT.md) | The specification. The authority on the contract — every host (F#, TypeScript, Python, Go, Rust, and any third-party implementation) implements from this document, not from another host's source. |
| [`SPEC_CONVENTIONS.md`](SPEC_CONVENTIONS.md) | The conventions this specification and its corpus are written under — canonical bytes, the corpus as oracle, the manifest as the authoritative enumeration, forward coupling, extension. Normative for `WIRE_FORMAT.md`, and cited by the other specifications in this family. |
| [`schema.json`](schema.json) | Canonical JSON Schema (Draft 2020-12) describing the wire shape. Generated from the reference encoder's surface — never hand-edited. |
| [`idl.json`](idl.json) | The canonical **IDL vocabulary** artefact (WIRE_FORMAT.md §13): the structural source — field tables, optionality classes, omit-at-default values and enum vocabularies, none of which survive a JSON Schema projection. Where `schema.json` answers "is this payload legal?", this answers "what IS the vocabulary?". Generated — never hand-edited. |
| [`render-fidelity.json`](render-fidelity.json) | The per-`NodeKind` **render-fidelity** declaration (WIRE_FORMAT.md §13): what the wire carries, what the parity-checked fallback render pins, and what is declared client-only rich. Generated from the reference declaration — never hand-edited. |
| [`manifest.json`](manifest.json) | The authoritative index of every **wire-format codec** fixture family and count. |
| Fixture directories (`nodes/`, `ops/`, `reject/`, `lenient/`, `envelope/`, `cards/`, `markdown/`, …) | The executable conformance suite: round-trip, reject, and lenient-accept families. A conformant codec must pass every assertion the manifest enumerates. |
| [`DEVTOOLS_RELAY.md`](DEVTOOLS_RELAY.md) + [`devtools-relay/`](devtools-relay/) | The **DevTools relay contract** — a companion specification and its own fixture family. See below. |
| [`laws/`](laws/) | **Conformance-law vectors** — the (input, expected) pairs a `Fuaran.Core` conformance law family draws from a declared seed, so a host that is not the reference can run the same family over the same sample. Its own fixture family, enumerated by its own manifest. See below. |

## Conformance

A host is **conformant** when it round-trips every round-trip fixture byte-identically,
rejects every reject fixture with a diagnostic, and normalises every lenient-accept fixture
to its canonical form — as enumerated by `manifest.json`. The specification's host roster
(WIRE_FORMAT.md §11.0) distinguishes full codec hosts from decode-only render projections.

Fixtures are **generated** by the reference implementation's emitter, which proves each
family's law at generation time — do not hand-edit fixture payloads; corpus updates arrive
as regenerated sets.

**Accepted ≠ preferred.** Conformance ranks nothing: a host must accept every lenient form, but an
*emitting* host or authoring surface should also read WIRE_FORMAT.md §16.1 ("Emitter preference"),
which states which of the accepted forms to write.

## The DevTools relay contract

[`DEVTOOLS_RELAY.md`](DEVTOOLS_RELAY.md) specifies the **page ↔ extension relay** (`relay@1.4`): a
`postMessage` envelope that carries a host's in-page introspection surface across the page/extension
boundary, so a browser extension — or any same-page peer — can inspect a live Fuaran UI and, where
the host permits, edit it.

It is a **companion specification, not part of the wire format**. It is a *client of* the wire format:
it borrows the profile-id grammar and negotiation table (WIRE_FORMAT.md §15), the `DecodeError`
envelope (§6), and canonical `TreeOp` JSON for its one mutating entry point — and nothing else. The
two profiles version independently.

What it covers: a detection handshake with capability advertisement — including, since `relay@1.4`,
a peer's declaration of whether the tree it reads lives in the page or upstream — the read entry
points, a capability-gated `apply(op)`, change subscription, a closed set of machine-readable refusal
classes (three of them mandated and deliberately distinct for `apply` — not-opted-in, validator
reject, and policy denied), a defined unknown-message posture, and a normative security section
(opt-in default-off, origin discipline, and why the relay has no side door around a host's own
decode → validate → policy path).

**A read-only host is fully conformant.** Nothing in the contract obliges a host to offer mutation;
capabilities are the whole authorisation surface.

### Enumeration

The relay fixtures live in [`devtools-relay/`](devtools-relay/) and are enumerated by their **own**
[`devtools-relay/manifest.json`](devtools-relay/manifest.json). They are deliberately **not** indexed
by the root `manifest.json`, which indexes the canonical wire-format codec families only — the same
posture [`merge-conformance/`](merge-conformance/) already takes. A codec host's conformance runner
reads the root manifest and dispatches on `kind`; a relay exchange is not a codec round-trip, so
listing it there would put entries in front of every host that each would have to learn to skip.

Relay fixtures are **shape fixtures, not byte-parity fixtures**: they pin message structure and
refusal classification, carry no canonical-ordering obligation, and are not produced by the reference
emitter. A runner compares shapes and enumerated values — tree-revision tokens, geometry numbers,
resolved binding values and human-readable messages are environment-specific and legitimately differ.

## Conformance-law vectors

[`laws/`](laws/) carries the sample one `Fuaran.Core` conformance law family draws from a declared
seed, rendered host-neutrally: the inputs and the verdicts the reference gave for them. It exists
because several families are **self-contained** — they take only `(seed, iterations)` and build
their own inputs — so their content is not otherwise readable from anywhere but the reference's
source. A host reproduces the sample from the parameters recorded in the file, then asserts the
verdicts.

Every `expected` is **computed by calling the kit**, never by restating what the law says should
happen, and the reference's own suite asserts each computed verdict is the one the law demands
before the file can be published. So a vector that disagreed with its law would fail at generation
rather than reach a host.

These are **behaviour vectors, not byte-parity fixtures**: a host asserts the verdicts and the
derived values (an effect-identity key, a codec round-trip, an enumeration order), not the framing
of the file.

### Enumeration

Like [`devtools-relay/`](devtools-relay/) and [`merge-conformance/`](merge-conformance/), the law
vectors are enumerated by their **own** [`laws/manifest.json`](laws/manifest.json) and are
deliberately **not** indexed by the root `manifest.json`, which indexes the canonical wire-format
codec families only. A law run is not a codec round-trip, so listing it there would put entries in
front of every codec host that each would have to learn to skip.

That manifest also carries a `notExported` list. A family named there is one the reference
**declined** to export, with the reason — a *parity* family, for instance, whose vectors would be
meaningless drawn from a reference compared against itself. It is the reserved-name posture of
[`SPEC_CONVENTIONS.md`](SPEC_CONVENTIONS.md) applied to absence: a family recorded there is not
missing, and a host reading the manifest can tell a decision from an oversight.

## Continuous integration

Two workflows run here, and they answer different questions. Neither is a substitute for the other.

| Workflow | Trigger | What it answers |
|---|---|---|
| [`consumers.yml`](.github/workflows/consumers.yml) — *Consumer conformance* | push to `main`, pull request to `main`, manual dispatch | Per host, against **this** corpus commit: does that host's own gate still pass? Plus this repository's own defect-code registry checks. |
| [`notify-conformance.yml`](.github/workflows/notify-conformance.yml) — *Notify downstream conformance gate* | push to `main` | Nothing, by itself. It POSTs a `repository_dispatch` so a cross-host gate elsewhere runs; that verdict lands in another repository's run history, not here. Operator-gated: it skips when its credentials are not granted. |

### What each leg actually runs

`consumers.yml` reassembles the side-by-side layout every host resolves the corpus in — this
repository at the commit under report, each host beside it — and runs **that host's own declared
blocking gate**, nothing else. Nothing in this workflow defines conformance.

Each leg checks the host out at `main` — or, under the `ref` dispatch override, at the single
revision named there, which the report banners as "not a report about `main`".

| Leg | Corpus it reads | Codec families its gated suite runs |
|---|---|---|
| `fuaran` (F#) | The sibling checkout only — `FUARAN_WIRE_FIXTURES` if set, else an upward walk for a `wire-format-fixtures/` holding `manifest.json`. No bundled snapshot. A set-but-wrong env var raises rather than falling back. | All fifteen. |
| `fuaran-ts` (TypeScript) | **Both, in two different suites.** The gated wire suite reads the sibling checkout directly and does *not* skip when it is absent — it fails. The published kit certifies the snapshot bundled in that repository, which a separate gated test compares byte-for-byte against the sibling checkout (and which does skip when that is absent). | node/op round-trip, reject, lenient-accept, both envelope families, all four elicitation families; the kit adds both contract-card families. `teleport-decode`, `teleport-reject` and `style-observer` are deliberately not run here and are pinned as such in that repository, not merely absent. |
| `fuaran-py` (Python) | The sibling checkout **when it is present**, and the snapshot bundled in that repository when it is not. A set-but-wrong env var is refused rather than ignored. | node/op round-trip, reject, lenient-accept, both envelope families, all four elicitation families, style-observer. Not the contract-card or teleport families. |
| `fuaran-go` (Go) | The sibling checkout only, by upward walk. No bundled snapshot, and deliberately undeclared in [`copies.json`](copies.json). Its gate is a residue gate: it runs the whole suite and compares the set that failed against a named list, red in **either** direction, so a newly-passing entry is a finding too. | node/op round-trip, reject, lenient-accept, both envelope families, all four elicitation families, style-observer. Not the contract-card or teleport families. |
| `fuaran-rs` (Rust) | The sibling checkout only. It is the strictest of the five about absence: a missing corpus *beside sibling hosts* panics rather than skipping, on the ground that a corpus-driven suite silently skipping in an assembled workspace is a disabled oracle rather than a standalone clone. | node/op round-trip, reject, lenient-accept, both envelope families, all four elicitation families, style-observer. Not the contract-card or teleport families. |

Every host additionally runs some of the sub-corpora that carry their own manifests
(`merge-conformance/`, `dag/`, `chain/`, `laws/`, and others), and which of them is per host. The
relay fixtures in [`devtools-relay/`](devtools-relay/) are run by the `fuaran` and `fuaran-ts` legs
and by no other — they carry their own manifest and their own `kind` vocabulary, and a relay peer
need not be a codec host at all, so they are not part of what the roster above measures.

**Why "the corpus path it reads" is a question at all.** Two of the five certify against a snapshot
bundled in their own repository, and one of those prefers the sibling checkout but falls back to its
snapshot when the sibling is absent. So "this host's gate passed beside our checkout" and "this
host's gate read our checkout" are genuinely different claims, and no amount of reading the workflow
settles the second. Two mechanisms do: the layout assert each leg runs before its gate, which fails
the leg outright if the corpus is not where that host resolves it; and the `perturb` go-red proof
below, which is the only thing that establishes a leg would have NOTICED.

### The reports are green by construction — read the table, not the tick

Every host job carries `continue-on-error: true`, because a host that is behind is that host's
obligation and this repository is the specification. That flag **rewrites the job's conclusion to
success**, so the check list shows a green tick beside every host whatever its verdict. The verdict
itself is in the run's **job summary table** and in the `verdict-<host>` artifact, and a host that
does not certify is additionally raised as a `::warning` annotation naming it.

This is worth stating plainly because it has misled a reader at least once: at the Phase 1821 corpus
commit four of the five hosts reported **drift** — correctly, since that commit moved five fixtures'
canonical bytes and no host had adopted the rename yet — while the check list showed five green
ticks. Reading the job conclusions reproduces the wrong answer; reading the table gives the right
one.

The one job that **can** fail the run about the corpus's content is the defect-code registry, which
measures this repository's obligations about itself. The report job fails on exactly two things: a
rostered host that produced no verdict at all, and — under the go-red proof below — a leg that
passed when it should not have. Both are the mechanism admitting it did not measure what it claims.

### Proving the checks can still fail

A check that has stopped being able to fail reports a clean estate exactly as a clean estate does, so
each of these is proved rather than assumed.

- **Hermetic, on every run.** `validator/check-coverage-selftest.mjs` and
  `validator/check-message-parity-selftest.mjs` run before the checks they are about, against
  committed fixture hosts under `validator/go-red/`. They read no real checkout.
- **A leg can report drift** — dispatch `consumers.yml` with a single `host` and a `ref` naming a
  revision of it that is behind the corpus. The table must show that host, and only that host, as
  drift.
- **A leg actually reads THIS corpus** — dispatch `consumers.yml` with `perturb` set. One canonical
  fixture file named by `manifest.json` is given a leading space in the corpus checkout each leg
  reads: still valid JSON, still the same value, no longer the canonical bytes. Every measured leg is
  then expected to go **red**, and a leg that passes is reported as `proof-blind` and fails the run.
  Nothing is committed and no fixture in this repository is touched — the perturbation lives for one
  job, in one runner's workspace.

  ```
  gh workflow run consumers.yml --ref main -f perturb=true
  ```

  The proof exists because "the host's gate passed beside our checkout" and "the host's gate read our
  checkout" are different claims, and two of the five hosts certify against a snapshot bundled in
  their own repository. The run is **green when every leg went red**: the verdicts are inverted, not
  the conclusion.

## Licence

Apache-2.0 — see [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE).
Copyright 2026 Diametrical Ltd.
