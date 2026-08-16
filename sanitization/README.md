# `sanitization/` — the render-time floor, as semantic invariants

Every other family in this corpus is a **byte-parity** suite: a host decodes a
fixture, re-encodes it, and the bytes must match. That shape does not fit the
render-time sanitisation floor ([`WIRE_FORMAT.md` §19](../WIRE_FORMAT.md)), because
the floor's obligation is about *markup a host emits*, and the markup around a URL
differs legitimately between an F# React renderer, a Go static-HTML emitter and a
Rust WASM client. Comparing those bytes would pin accidents, not the contract.

So this family states **invariants** instead:

| `invariant` | The host must |
|---|---|
| `reject` | refuse the payload — omit the attribute, or substitute the literal `about:blank` (§19 rule 6) |
| `accept` | accept it **and emit `expected`**, which is the §19 rule 1 normalised form and is not always the input |

Each case also carries a `reason` describing what the **URL parser** does with the
payload — `off-origin`, `same-origin`, or `scheme-refused`. That is the claim which
makes a case meaningful: "the floor must reject this" is worthless unless the
payload really does reach another origin.

## The manifest is hand-authored

`manifest.json` here is **not** emitted by any host's corpus generator, unlike the
root `manifest.json`, which is generated and would overwrite hand-added entries on
the next regen. Counts live in the manifest and nowhere else.

## Verifying the fixtures themselves

```
node sanitization/verify-against-url-parser.mjs
```

This is the corpus checking **itself**, not a host checking the corpus: it resolves
every case's `input` against a WHATWG-conformant URL parser and fails if the
declared `reason` disagrees. The `off-origin` / `same-origin` claims are exactly
the kind that is easy to get subtly wrong by reading a specification rather than
resolving the string, and every one of them was established this way rather than by
argument. Node only — no build step, no dependencies.

One case carries `"overRejects": true`: the floor deliberately refuses a payload the
parser resolves harmlessly, because §19 rule 2 strips everything at or below U+0020
from the scheme candidate and is therefore stricter than rule 1's TAB/LF/CR removal.
Over-rejection is the safe direction. The checker still asserts the parser resolves
that case same-origin, so the flag cannot be used to wave through a fixture that is
simply wrong.

## Running it from a host

The family is deliberately trivial to consume — one manifest, string in, verdict
out — so a host needs no fixture loader beyond a JSON parse:

1. read `manifest.json`;
2. for each case, call the host's URL-floor entry point with `input`;
3. `reject` ⇒ the call refuses (and the `or-blank` variant yields `about:blank`);
   `accept` ⇒ the call succeeds and returns `expected`.

All five conformant hosts run it as part of their own suites.
