# `decode-policy/` — host-declared kind admission, as paired outcomes

Every codec family in this corpus asks one question of a document: *what does a
conformant host produce from these bytes?* This family asks a different one,
because [`WIRE_FORMAT.md` §23](../WIRE_FORMAT.md) describes a narrowing a **host
declares** rather than a property the wire has. The same bytes have two correct
outcomes, and which one is correct depends on a declaration that is not in the
document.

So a case here is a **pair**: a document, a declared policy, and the outcome. The
assertion that matters is the pairing rather than either half — `custom-1.json`
decoding is not interesting, and `custom-1.json` being refused is not interesting;
the two together are the claim that the narrowing is host-side and that the
default is unchanged.

## The default is what is really being pinned

`admit-all` is not a policy anyone deploys. It is here so that every refusal case
has a control proving the bytes were valid all along — which is the §22 boundary
(*"a tree carrying a hostile payload is a valid wire document and a decoder MUST
NOT reject it"*) stated as a test rather than as prose. A host whose default
decoder refuses any document in this family has narrowed the **wire**, which §23
does not permit.

Conformance for every other family in this corpus is therefore measured with **no
policy declared**. A document refused under a policy is still a valid wire
document; the refusal is a fact about a deployment, not about the format.

## Reading a case

| Field | |
|---|---|
| `document` | path to the bytes, relative to this directory. Most point back into `nodes/` or `reject/` so the document is one the root corpus already pins byte-for-byte. |
| `policy` | the `identity` of one of the declared `policies`. |
| `outcome` | `admit` — the decode succeeds; `refuse` — it fails with the stated code and path. |
| `expectedErrorCode`, `expectedPath` | on a `refuse` case only, exactly as the root manifest's reject entries carry them. |
| `refusedKind` | the wire discriminator the policy declined, where the refusal is a `KIND_NOT_ADMITTED`. |

`policies[].excludesFromVocabulary` is resolved against the **root**
`manifest.json`'s `kinds` array. That indirection is deliberate: writing the
admitted set out literally would make this file a second enumeration of a
vocabulary the root manifest already owns, and the two would drift the first time
a kind was added.

## What this family does NOT cover

A kind gate reaches the kinds. It does not reach the action vocabulary, a
declared field rule, or anything a host registers outside a tree — so a case here
proving `closed-no-escape-hatches` refuses `Custom` and `Mount` is not evidence
about any other seam, and §23 says so at greater length. Recording the limit is
what keeps the asserted cases a gate rather than a reassurance.

## The manifest is hand-authored

`manifest.json` here is **not** emitted by any host's corpus generator — the same
posture as [`sanitization/`](../sanitization/README.md), and for a sharper reason:
the root emitter deletes and rewrites `nodes/`, `ops/`, `reject/`, `lenient/`,
`envelope/` and `elicitation/` on every regeneration, so a fixture added to one of
those by hand does not survive. `nested-custom.json` lives here for exactly that
reason. Counts live in the manifest and nowhere else.

## Running it from a host

One manifest, one document per case, a verdict out — no fixture loader beyond a
JSON parse:

1. read `manifest.json`;
2. build each policy: `all` ⇒ the host's default decoder; `allowlist` ⇒ the root
   manifest's `kinds` minus `excludesFromVocabulary`;
3. for each case, decode `document` under `policy`;
4. `admit` ⇒ the decode succeeds; `refuse` ⇒ it fails with `expectedErrorCode`
   at `expectedPath`.

A host that has not implemented §23 declares the family **not-applicable** with a
reason, exactly as a host with no markup sink does for `sanitization/`. What a
host may not do is be silently untested.
