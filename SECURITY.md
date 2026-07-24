# Security Policy

## Supported versions

The specification and its conformance corpus are pre-1.0. Fixes are applied to the latest
revision on the `main` branch; older snapshots are not maintained.

## Reporting a vulnerability

Please report suspected vulnerabilities privately — do **not** open a public issue.

- **Preferred:** GitHub's private vulnerability reporting (the repository's **Security** tab →
  **Report a vulnerability**).
- **Or email:** andrew@fuaran.com — include a description, the affected section or fixture, and
  steps to reproduce.

We aim to acknowledge a report within five business days and to agree a disclosure timeline with
you. Please allow a reasonable window to ship a fix before any public disclosure.

## Scope

This repository contains the wire-format specification, its JSON Schema, and the executable
conformance corpus — no runtime code. Its security surface is therefore the specification itself:

- **Specification ambiguity with security consequences:** wording that permits a conformant
  implementation to accept malformed wire as valid, to skip a mandated reject, or to resolve a
  string→DOM seam (`href`/`src`, raw HTML) without the mandated filtering is in scope.
- **Corpus defects:** an accept fixture that a correct implementation must reject (or the
  reverse), or a reject fixture whose canonical reject path would mask an injection or
  resource-exhaustion vector, is in scope.
- **Schema laxity:** a `schema.json` constraint that is weaker than the prose specification in a
  way that admits dangerous wire is in scope.

Vulnerabilities in a particular *implementation* of the wire format belong with that
implementation's repository, not here.
