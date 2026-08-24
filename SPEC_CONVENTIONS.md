# Specification conventions

The conventions shared by the wire specifications in this family: rules about **how a specification
and its conformance corpus are written**, as distinct from what any one of them specifies. They are
collected here so a new specification inherits them rather than re-deriving them, and so that a
change to a convention has one home instead of several drifting copies.

**Status:** normative for any specification in this family that cites this document. A cited
convention is binding on that specification unless it states an exception, in the form
convention 12 requires.

**On origin citations.** Each convention records where it was established. Where that is this
specification — the tree wire format, the eldest of the family — it says so, and the section
reference is live. Where a convention was arrived at later, by a specification adopting this pattern
for a different subject, the citation gives the date and not a title: a title versions, is
superseded, and would put a maintenance burden on this page that buys the reader nothing. A
convention's force here is that it is **stated here**; which document first arrived at it is history.

---

## A. Canonical bytes

### 1. The bytes are the contract, and byte-stable round-trip is the conformance property

A conformant host asserts `encode(decode(fixture)) == fixture`, **byte for byte** — not that the
decoded value is equivalent, not that the re-encoded document parses to the same tree. Equivalence
is unfalsifiable in a corpus; byte identity is not. Everything downstream — a digest that names a
value, a hash chain, a cache key — rests on two independent implementations producing the same
bytes from the same values, and only a byte assertion tests that.

*Origin: this specification (§1).*

### 2. The canonical encoding is stated exhaustively, never delegated to a library

Every rule that decides a byte is written out: whitespace, encoding and byte-order mark, member
order, absent-member policy, string escaping, integer and real formatting, instants, array order,
and what happens to a payload the document declines to interpret. "Canonical JSON" is not a thing a
specification can name and move on from — implementations disagree, and the disagreements are
narrow enough to survive a test suite that was written against one of them.

Two rules within this that are worth stating as rules, because they are where implementations
actually diverge:

- **A member ordering is named precisely enough to be reproduced.** "Ordinal" and "by code point"
  give different answers above the Basic Multilingual Plane, and agree everywhere an implementer is
  likely to test. A specification that says only "sorted" has not specified the order. Where a
  sort is culture-sensitive, a document's bytes depend on the machine that produced them, so a sort
  is ordinal and never culture-aware.
- **A specification says what it is not.** These encodings are close to RFC 8785 (JCS) and are not
  JCS, so each carries a **field-by-field divergence table** with a reason per row and the claim
  that there are no others. An implementer reaching for a JCS library needs to know exactly which
  parts of it are safe to use.

*Origin: a later specification in this family (2026-08). This specification predates the divergence
table and states its rules in §2–§4.*

### 3. Identity digests are distinguished, and each names what it is computed over

Where a specification carries more than one kind of digest — a content address, a stamp over a
document, a signing input — they are separated explicitly and each says which bytes it covers.
Conflating them is the most consequential error available, because two documents that agree on
every field can disagree on an identity that a join depends on, and the failure surfaces a long way
from its cause. A stamp is never inside the bytes it covers.

*Origin: a later specification in this family (2026-08).*

---

## B. The corpus

### 4. The corpus is the oracle; no host's behaviour is

A host certifies against the committed vectors and the specification text. It never certifies
against another host's output, and a disagreement between a host and the corpus is the host's
defect until the text is shown to be at fault. This is what makes a reference implementation *one
conformant host* rather than the definition.

*Origin: this specification (§11).*

### 5. `manifest.json` is the authoritative enumeration, and counts live nowhere else

The manifest names every family, every vector, each vector's kind, and — where a specification is
profile-scoped — the profile partition. **A count is never written in prose**, in the specification
or in a README or in a contributing guide. A number written beside a directory drifts from it; a
manifest cannot. A harness enumerates from the manifest, and a reader who wants to know how large
the corpus is reads the manifest.

*Origin: this specification (the corpus preamble and §12); the prohibition on counts in prose, a
later specification in this family (2026-08).*

### 6. A vector declares its kind, from a small closed taxonomy

| Kind | What certifying means |
|---|---|
| `round-trip` | Decode, re-encode, produce byte-identical output. |
| `hash` | Round-trip, **and** reproduce the digest the manifest records by recomputing it from the document's own content. |
| `reject` | The reader must refuse the document, **for the class the manifest names**. A refusal for another reason is not a pass — it lets a reader certify by being broken in a convenient way. |
| `accept` | The reader must not refuse the document, and must interpret it as the manifest states. These are the forward-compatibility vectors: an implementation that refuses one will break on the next additive change. |

Where more than one family carries `hash` vectors, the specification states **per family** what the
digest is and what it is recomputed from — the same vector kind can ask for two different
recomputations, and a table is the honest way to say so.

*Origin: the round-trip / reject / lenient-accept families are this specification's (§12, §16); the
per-vector `kind` member and the `hash` and `accept` kinds, a later specification in this family
(2026-08).*

### 7. Conformance scope is declared: whole-corpus or profile-scoped

A specification says which it is, and why.

- **Whole-corpus** where every family is a facet of one thing, so any implementation that reaches
  one reaches all of them, and partitioning would produce claims nobody needs.
- **Profile-scoped** where genuinely different deployments carry genuinely different obligations. A
  profile-scoped specification partitions the families in the manifest, every vector declares the
  lowest profile that must run it, and **a conformance claim that names no profile is
  unfalsifiable** — so the claim names one, or it is not a claim.

The two are not a matter of taste: the question is whether an implementation can be complete
without touching a family, and the answer is a property of the subject.

*Origin: a later specification in this family (2026-08).*

### 8. Two obligations fall on the harness, not on the emitter

A conformance suite is exactly the kind of code that passes by doing nothing, so a certifying
implementation must:

1. **assert that the number of vectors it executed equals the number the manifest enumerates** for
   its scope — not that they all passed, that the expected count *ran*; and
2. **prove at least once that a mutated document makes it go red.**

A green run that exercised nothing is indistinguishable from a green run that exercised everything.
A corpus's own tooling is expected to hold itself to the same two obligations, against a scratch
copy — a self-test that perturbs the committed corpus is a defect of its own.

*Origin: a later specification in this family (2026-08).*

### 9. Two emitters, and a divergence between them is a defect in the text

Round-trip and hash vectors are minted by a conformant implementation and **independently
reproduced** by a second emitter written against the normative text alone, in a different language
and runtime, from unsorted and unstamped input models. One emitter cannot distinguish the protocol
from its own accidents: whatever it happens to do becomes "the format" by default, and the corpus
then records the accident as though it were the rule.

So a disagreement between the two is **a defect in the specification by definition** — either a
rule is missing, or a rule that is stated is not the rule being followed. It is not fixed in either
emitter before asking what the text left open. A rule the text leaves open is precisely the rule a
single emitter cannot fail.

Reject vectors are deliberately not reproduced: reproducing the bytes of a document a reader must
refuse demonstrates nothing about it.

*Origin: a later specification in this family (2026-08).*

---

## C. Change

### 10. Forward coupling: one change-set, and it enumerates every artefact

A change to any specified member, ordering, encoding, refusal class or derived value updates **every
coupled artefact in the same change-set**, and the specification enumerates them explicitly rather
than saying "and the corpus". The list differs per specification — normative text, schemas, each
emitter, the manifest's vectors and digests, and **the codec of every host that certifies against
the corpus**.

The host entry is the one most often left out and the one that makes the other entries mean
something: a corpus the hosts have not caught up with is a specification of nothing. A corpus that
lags its emitter certifies nothing; a specification that lags either is worse than absent, because
it is believed.

Where the coupled artefacts live in more than one repository, "the same commit" means **the same
change-set across those repositories**, landed and published together.

*Origin: this specification (§11).*

### 11. Additive and breaking are defined against the bytes, and version members are kept distinct

Adding an optional member, a registry entry, a refusal class for a document that was already
ill-formed, or a vector, is **additive** and does not move the format version. Changing an existing
member's meaning, type, presence or ordering — or changing the canonical encoding — is **breaking**
and takes a new version, because every such change alters bytes a digest was computed over, and an
identity that changed for a reason a reader cannot see silently splits an evidence base in two.

Where several version numbers appear (a format version, a profile version, a payload's own version),
the specification states that they move independently and **must not be conflated**. A reader
refuses a document whose version exceeds what it accepts, naming both versions, and never reads such
a document partially.

*Origin: this specification (§15); the byte-centred formulation, a later specification in this
family (2026-08).*

### 12. Extension enumerates rather than renumbers, and an exception stays enumerated

Two halves of the same discipline:

- **A reserved name is a statement.** A manifest may carry a list of family names the specification
  intends to add. A name reserved there is a family that is *not missing*, and a certifying
  implementation is *not failing* to run it. Adding it later is additive. The list is retained when
  it empties, because the mechanism is what makes the next extension cheap — and an empty list is a
  statement rather than an omission.
- **An enumerated exception is never silently normalised.** Where a specification governs a shape
  whose wire form predates it, the exception is written down as an exception, with its reason and
  its cost, and the tooling is arranged so that encoding it the ordinary way **fails** rather than
  quietly erasing it. Unifying it is a migration with a version bump, not a tidy-up.

*Origin: a later specification in this family (2026-08).*

---

## D. Posture

### 13. Each home carries a gate, and the gate proves it can go red

A specification home is executable: a single command re-derives what can be re-derived, checks the
committed bytes, checks that the manifest still describes the tree it sits in — a question an
emitter structurally cannot answer, since it only ever reads what the manifest already lists — and
then proves each of those checks can fail, against a scratch copy. That command is the gate a change
to the home must pass.

Where a home's gate runs in continuous integration rather than as a script in the tree, the
obligation is unchanged and the self-test still belongs to it.

*Origin: a later specification in this family (2026-08).*

### 14. Normative text names no implementation, product, vendor or language

The specification is the authority and an implementation conforms to it; the direction never
reverses. So normative text carries no implementation name, no product name, no vendor identifier
and no language-specific type — a conformant implementation must be writable from the document and
the corpus, without reading anyone's source. Where a repository ships an emitter of its own, it is
described in a **non-normative** appendix, and nothing normative depends on it.

A registry of certified implementations is not part of a specification home unless it is added
deliberately; it is a commercial artefact, not a conformance one.

*Origin: a later specification in this family (2026-08). This specification predates the rule and
names its reference host, which is a recorded divergence rather than a counter-example.*

---

## Licence

Apache-2.0 — see [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE).
Copyright 2026 Diametrical Ltd.
