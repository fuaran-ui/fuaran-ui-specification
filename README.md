# fuaran-specification

The **canonical, language-neutral specification of the Fuaran UI wire format** — the typed UI
tree and tree-op contract that every Fuaran host implements — together with its **executable
conformance corpus**.

## What's here

| Artefact | Role |
|---|---|
| [`WIRE_FORMAT.md`](WIRE_FORMAT.md) | The specification. The authority on the contract — every host (F#, TypeScript, Python, Go, Rust, and any third-party implementation) implements from this document, not from another host's source. |
| [`schema.json`](schema.json) | Canonical JSON Schema (Draft 2020-12) describing the wire shape. Generated from the reference encoder's surface — never hand-edited. |
| [`manifest.json`](manifest.json) | The authoritative index of every fixture family and count. |
| Fixture directories (`nodes/`, `ops/`, `reject/`, `lenient/`, `envelope/`, `markdown/`, …) | The executable conformance suite: round-trip, reject, and lenient-accept families. A conformant codec must pass every assertion the manifest enumerates. |

## Conformance

A host is **conformant** when it round-trips every round-trip fixture byte-identically,
rejects every reject fixture with a diagnostic, and normalises every lenient-accept fixture
to its canonical form — as enumerated by `manifest.json`. The specification's host roster
(WIRE_FORMAT.md §11.0) distinguishes full codec hosts from decode-only render projections.

Fixtures are **generated** by the reference implementation's emitter, which proves each
family's law at generation time — do not hand-edit fixture payloads; corpus updates arrive
as regenerated sets.

## Licence

Apache-2.0 — see [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE).
Copyright 2026 Diametrical Ltd.
