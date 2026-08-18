# `validator/` — the pre-emit defect vocabulary, and who implements it

The wire families in this corpus answer "is this document legal?". This one answers
a different question the byte-parity legs are structurally blind to: **which defects
may a conformant host's pre-emit validator refuse, and which of them does each host
actually implement?**

The gap was real and nothing measured it. Before this landed, each sibling host had
whichever rules it happened to port, so the same emission was "valid" or "defective"
depending on which conformant host received it. That is an authoring-contract
divergence, not a wire one, which is exactly why no existing gate could see it.

## The three artefacts

**`defect-vocabulary.json` is GENERATED** from the reference host's own defect
projection, by reflecting over its defect type and asking it to describe one
instance of each case. It is never hand-maintained: a new defect case appears here
with no edit, which is the only arrangement under which the vocabulary cannot
silently fall behind the implementation it claims to describe. Counts live in the
file; do not restate them here or anywhere else.

**Each host declares its own coverage** in a `validator-coverage.json` at its repo
root — declare local, project central. A host may legitimately implement a subset:
a headless codec carries fewer rules because the rules that warn a human author as
they type have no author to warn, and the native surfaces delegate validation
entirely. What a host may **not** do is diverge silently, which is what the
declaration and its gate exist to prevent. An abstention with a stated reason is a
decision; an unlisted code is drift.

## Running the gate

```
node validator/check-coverage.mjs           # check
node validator/check-coverage.mjs --matrix  # check, and print the coverage table
```

Node only, no build step, no dependencies, so any host's CI can run it. With no
arguments it discovers host declarations as siblings of this checkout.


## Message parity — `message-parity.json` + `check-message-parity.mjs`

A shared code is worthless if two hosts mean different things by it. The vocabulary
fixes the code and its severity; this fixes what each host's **message** must
convey, so `FUARAN083` cannot point at one message that names the remedy and
another that stops at describing the situation.

```
node validator/check-message-parity.mjs [--verbose]
```

It is **hand-authored**, unlike the vocabulary beside it, and deliberately so:
"conveys the same fix" is a judgement, and deriving it from the reference's own
wording would only assert that the reference matches itself.

Requirements are **concepts, not phrases** — each code carries groups of accepted
spellings, and a message must hit one spelling from every group. Requiring exact
wording across five languages would be a formatting rule wearing a semantics
costume, and would fail on the reference's own `Switch` against a host's `switch`.

Two exemptions, both declared rather than inferred:

- A host whose findings are **structured records with no message string** declares
  `messageForm: "structured"`. There is nothing to compare, and the
  human-readable rendering belongs to its consumer. Declared rather than inferred
  from "no messages found", because that is also what a broken extractor looks like.
- A code **fewer than two non-reference hosts implement** is out of scope: parity
  needs two parties.

A non-exempt host from which zero templates were extracted **fails**, rather than
reporting zero problems. That is the same hazard the gate exists to catch, one
level down.

## Two limits, stated because a gate that implied otherwise would be worse than none

**The FUARAN code space is shared with a second validator family.** The reference
host also has a build-time source-AST walker whose codes are drawn from the same
numbering and are **not** enumerated here. Sibling hosts today raise codes from both
families without distinguishing them, so a host that implements one of those rules
as a tree-time check is conforming to a reference this vocabulary does not describe.
Declarations record such codes under `otherFamilies` so the gate reads them as a
different family rather than as an invented code. Enumerating that second family is
open work, and until it lands the `otherFamilies` lists are declarations of intent
that nothing verifies.

**Three of the five hosts cannot be machine-checked against their own
declarations.** They embed the FUARAN code inside the human-readable message text
rather than carrying it as a field on the finding, so there is no value to compare a
declaration against: such a host could implement a rule and never declare it, or
declare one it does not implement, and the gate would pass. Those hosts declare
`machineChecked: false` and say so in their own files. Making the code a first-class
value per host is the prerequisite for closing this, and is open work.

So what the gate catches today is: a host claiming a code the vocabulary does not
define (the failure that actually bites, when the reference retires or renames one),
a vocabulary code a host neither implements nor accounts for, and the reference's own
generated declaration being hand-edited away from the artefact generated out of it.
That is less than the phase's ambition and more than existed before, and the
difference between the two is written down rather than assumed.
