# `relay@1.4`, the treeless peer — DECIDED. This file is a pointer.

**Status: RETIRED. The question this file put is answered, and the answer is normative.**

This document proposed three ways for the contract to describe a peer whose tree does not live in
the page, and recommended one: the peer **declares where its tree is** and no request type, no
capability token and no payload shape changes. That recommendation was accepted. Its text is now in
[`../DEVTOOLS_RELAY.md`](../DEVTOOLS_RELAY.md), which declares `relay@1.4`:

| What | Where it is now |
|---|---|
| `treeSource` in the `hello.ok` payload | §6.3's payload table |
| What `treeSource: "upstream"` obliges, and what it does not | §6.5 |
| Where the decode → validate → policy gates run for such a peer | §8.1 |
| The `UPSTREAM_UNAVAILABLE` refusal class, and the case it deliberately does not cover | §9.3 |
| Why a fixture may declare the peer shape it addresses, and what a runner owes one it cannot present | §12.2, §12.3 |
| What is still waiting on a second implementation | §12.1 |

The vectors that were drafted alongside it are no longer a draft. They sit in this directory beside
every other fixture — `hello-treeless`, `hello-treeless-1-3-client`,
`refusal-capability-absent-treeless`, `refusal-upstream-unavailable` — and are listed in
[`manifest.json`](manifest.json), each declaring `"peer": "upstream"`. The `draft-1.4/` directory
they were held in is gone, along with the README that explained what "draft" meant mechanically;
nothing in this family is a draft any more.

**Why this file survives at all, rather than being deleted.** Two of its findings are load-bearing
and are not restated in the normative text, because a specification says what is in force and not
what was weighed:

- **The reject vector that cannot exist is the compatibility evidence.** A "`relay@1.3` client meets
  a `relay@1.4`-only capability" vector presupposes that 1.4 introduces a capability — which is what
  the two rejected options did and this one does not. Under the accepted design an older client
  negotiates an older session, receives one field it ignores by §10.2, and is refused nothing at
  all. `refusal-capability-absent-treeless` is the nearest true form, and it is an unchanged
  `relay@1.0` class doing an unchanged job.
- **The two rejected options are recorded, in shortened form, in §6.5's closing paragraph.** The
  reasoning that eliminated them — that §7.7 rule 1 makes every option a proxy design, so the only
  thing they differ in is what the client is told; that §6.3 forbids branching on `host`; that §4.2
  makes a capability and a request type the same name — is what a later reader needs before
  proposing either of them again.

A reader who wants the full comparison, with what each option costs a `relay@1.3` client, will find
it in this file's own history.
