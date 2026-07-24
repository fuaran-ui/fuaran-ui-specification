# Contributing to fuaran-specification

This repository is licensed **Apache-2.0** (see [`LICENSE`](LICENSE)). Contributions are welcome
under the same licence. It holds three artefacts, and each has its own contribution path:

- **`WIRE_FORMAT.md`** — the canonical, language-neutral specification prose.
- **`schema.json`** — the machine-readable JSON Schema of the wire format.
- **The fixture corpus** (`manifest.json` + the fixture families) — the executable conformance
  suite every host certifies against.

## Contribution licensing — Developer Certificate of Origin

Every commit must be signed off under the [Developer Certificate of Origin 1.1](https://developercertificate.org/)
to certify you have the right to contribute the content under Apache-2.0. Add a `Signed-off-by:`
trailer to each commit:

```
git commit -s -m "docs: your change"
```

A pull request without DCO sign-off on every commit will not be merged.

## How changes land

1. **Spec wording fixes** (typos, clarifications that change no normative behaviour) — a plain PR
   against `WIRE_FORMAT.md` is welcome.
2. **Normative changes** (a new kind, a changed encoding, a new reject rule) — open an issue
   first. The specification, the schema, and the corpus move **together**: a normative change
   that updates one without the others breaks the cross-host parity gate, so maintainers
   coordinate these as a single change-set (see `WIRE_FORMAT.md` §11, the forward-coupling rule).
3. **Fixture corpus** — the corpus is **generated from the reference implementation's fixture
   definitions and committed here**; hand-edited fixture files will not be merged. If you believe
   a fixture is wrong, open an issue citing the fixture id and the spec section it contradicts.

## Per-PR checks

- `manifest.json` remains the authoritative enumeration of the corpus — a PR that adds or removes
  a fixture file without the matching manifest entry will fail review.
- Markdown prose keeps the file's existing wrapping and heading conventions.

## Pull request flow

1. Branch from `main` with a descriptive name (`docs/<short-name>`, `fix/<short-name>`).
2. Make focused, DCO-signed commits; do not bundle unrelated changes.
3. Open a PR describing the change and, for anything normative, the issue it was agreed on.
4. A maintainer reviews and merges.
