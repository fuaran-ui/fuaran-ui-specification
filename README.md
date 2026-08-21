# fuaran-specification

The **canonical, language-neutral specification of the Fuaran UI wire format** — the typed UI
tree and tree-op contract that every Fuaran host implements — together with its **executable
conformance corpus**.

## What's here

| Artefact | Role |
|---|---|
| [`WIRE_FORMAT.md`](WIRE_FORMAT.md) | The specification. The authority on the contract — every host (F#, TypeScript, Python, Go, Rust, and any third-party implementation) implements from this document, not from another host's source. |
| [`schema.json`](schema.json) | Canonical JSON Schema (Draft 2020-12) describing the wire shape. Generated from the reference encoder's surface — never hand-edited. |
| [`render-fidelity.json`](render-fidelity.json) | The per-`NodeKind` **render-fidelity** declaration (WIRE_FORMAT.md §13): what the wire carries, what the parity-checked fallback render pins, and what is declared client-only rich. Generated from the reference declaration — never hand-edited. |
| [`manifest.json`](manifest.json) | The authoritative index of every **wire-format codec** fixture family and count. |
| Fixture directories (`nodes/`, `ops/`, `reject/`, `lenient/`, `envelope/`, `markdown/`, …) | The executable conformance suite: round-trip, reject, and lenient-accept families. A conformant codec must pass every assertion the manifest enumerates. |
| [`DEVTOOLS_RELAY.md`](DEVTOOLS_RELAY.md) + [`devtools-relay/`](devtools-relay/) | The **DevTools relay contract** — a companion specification and its own fixture family. See below. |

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

[`DEVTOOLS_RELAY.md`](DEVTOOLS_RELAY.md) specifies the **page ↔ extension relay** (`relay@1.1`): a
`postMessage` envelope that carries a host's in-page introspection surface across the page/extension
boundary, so a browser extension — or any same-page peer — can inspect a live Fuaran UI and, where
the host permits, edit it.

It is a **companion specification, not part of the wire format**. It is a *client of* the wire format:
it borrows the profile-id grammar and negotiation table (WIRE_FORMAT.md §15), the `DecodeError`
envelope (§6), and canonical `TreeOp` JSON for its one mutating entry point — and nothing else. The
two profiles version independently.

What it covers: a detection handshake with capability advertisement, five read entry points, a
capability-gated `apply(op)`, change subscription, a closed set of ten machine-readable refusal
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

## Licence

Apache-2.0 — see [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE).
Copyright 2026 Diametrical Ltd.
