# Proposal — `relay@1.4`: what a peer that holds no tree advertises

**Status: NON-NORMATIVE. Nothing here is in force.**

This document states an open question about [`../DEVTOOLS_RELAY.md`](../DEVTOOLS_RELAY.md), sets out
the three answers available to it, costs each against a `relay@1.3` client that does not know
`relay@1.4`, and recommends one. It is a proposal put to the specification's owner; it is not an
amendment.

Concretely, and so that no reader mistakes its standing:

- `DEVTOOLS_RELAY.md` is unchanged and still declares `relay@1.3`. No text in it has moved.
- [`manifest.json`](manifest.json) is unchanged and still declares `profile: "relay@1.3"`. No
  fixture has been added to it, and nothing in [`draft-1.4/`](draft-1.4/) is listed there — a draft
  is not a conformance obligation. The three implementations that drive this family drive it from
  the manifest, so those files are inert until somebody lists them.
- The §6 and §8 amendment text in §6 below is **draft wording for the recommended option**, written
  out in full so the decision can be taken against the actual sentences rather than against a
  summary of them. It becomes normative only if the recommendation is accepted, and only by being
  moved into `DEVTOOLS_RELAY.md` with the profile bumped there.

---

## 1. The question

Every capability in `relay@1.3` is stated in terms of a tree the **page** holds.

§1.1 defines the page peer as "code running in the page's own JavaScript context, alongside the
Fuaran host that rendered the tree". §6.4 makes `capabilities` the whole authorisation surface.
§7.7's `read.nodeJson` returns "the node's own wire-format JSON — the host's canonical encoding of
this node", and its rule 1 requires that encoding to come from "the host's canonical wire encoder"
with "no second projection". §8.3 puts the decode → validate → policy sequence in the page.

There is a shipped tier for which none of that is true: a **server-driven** page, where the session
tree lives on the server and the browser half holds only a patch applier. Its in-page surface is a
patch/effect API — `start`, an event-source adapter, `applyPatches`, `applyPatch`, `performEffects`
— and no introspection object at all. Of the relay's seven reads, exactly one is servable from
inside such a page: `read.renderedDom` (§7.4), which asks the DOM a geometry question and never
asks the tree anything.

So a server-driven page facing this contract has two moves, and both are bad:

- **advertise the tree reads anyway**, which is a claim about where the tree is that is not true of
  the page; or
- **advertise nothing**, which makes the entire tier invisible to every relay client — a page that
  a user is looking at, that a client can see marked-up elements in, and that answers `hello` with
  an empty `capabilities` array.

Neither is a defect in any implementation. It is a gap in this document: **there is no treeless
text anywhere in the contract**, and the shape the contract cannot express is one that exists.

**This is a minor bump on a shared gate.** Additive change is a minor (§5.3), so the mechanics are
routine; what is not routine is that several independent implementations certify against this
document and its corpus, and a wire decision is expensive to unwind once they have. That is why
this is a proposal and not a change.

---

## 2. What any answer has to satisfy

Six constraints the current text already imposes. They are listed first because they eliminate more
candidate designs than the option comparison does.

1. **§7.7 rule 1 — the host's own encoder, and no second projection.** Whatever is chosen, a
   treeless page peer MUST NOT reconstruct a tree from the patches it has applied and encode
   *that*. A patch-derived reconstruction is precisely the "second projection" the rule forbids, and
   it would be wrong in a way no client could detect: it would carry the shim's idea of the tree,
   not the host's. The only conformant way to answer a tree read from a treeless page is to ask the
   side that holds the tree and relay its encoder's output. **All three options below are therefore
   proxy designs.** They differ in what the client is told, never in where the answer comes from.

2. **§6.3 — `host` is opaque, and a client MUST NOT branch on it.** "A client MUST NOT branch on it
   to select behaviour; the `capabilities` array is the only thing that determines what is
   available." So the answer cannot be "clients will recognise the server-driven host string". If a
   client needs to know where the tree lives, the contract has to say it in a field meant for it.

3. **§6.3 — capabilities are reported at the session profile.** "A capability whose request type
   was introduced after the session profile MUST NOT be advertised, and MUST be refused with
   `CAPABILITY_ABSENT` if requested." Any option that introduces a new request type is, by that
   rule, invisible to every `relay@1.3` client — permanently, not until they upgrade.

4. **§4.2 — capability and request type are the same name.** "Every request type except `hello` is
   named identically to the capability that gates it. A page peer's authorisation check is
   therefore a set membership test on `type`, not a lookup table — one fewer place for a capability
   and its entry point to drift apart." A "capability token" that is not also a request type breaks
   this invariant.

5. **§8.3 — a refused op MUST leave the tree unchanged.** "There is no partial application, and
   there is no silent no-op." Any new refusal class must be raisable only in circumstances where
   the peer can actually assert that. §7 below is where this bites.

6. **§12.1 — the corpus's profile advances with the FIXTURES, not with the document.** "A fixture
   for a request type introduced by a minor bump lands when a **second** host serves it, and the
   manifest's `profile` advances with the fixtures." So whichever option is chosen, `manifest.json`
   stays at `relay@1.3` until a second implementation serves the addition. This is not a
   formality: one shipped host's conformance suite asserts `manifest.profile === 'relay@1.3'`
   directly, and a premature bump turns that gate red for a change it has nothing to do with.

---

## 3. Option A — advertise the existing reads over a server-resolved tree

**Shape.** The treeless page peer advertises `read.nodeJson` (and, as it can serve them, the other
tree reads) exactly as a page-tree peer does. On receiving one, it forwards the question over the
live channel to the side that holds the tree, and returns that side's encoder output in the ordinary
`read.nodeJson.ok` payload. Nothing in the contract changes. `relay@1.3` is not bumped at all.

**What changes in the text.** Nothing. That is the option's entire case.

**What it costs a `relay@1.3` client that does not know `relay@1.4`.** Nominally nothing — and that
nominal answer is the problem. The client cannot tell this peer from a page-tree peer, so it makes
three assumptions the contract entitles it to make and this peer cannot honour:

- **Latency.** Every read is a network round trip. §7 says nothing about read latency because until
  now a read was a local computation; a client that issues one read per selected node, or one per
  keystroke in a filter, is issuing network traffic it does not know it is issuing. No client will
  crash over this. Every client will render badly over it — no spinner, no cancellation, no
  batching, because none of those are warranted by the contract it read.
- **Failure.** The channel can be down. §9.3's set has no class for it, and every existing class the
  peer could reach for is a false statement: `NODE_NOT_FOUND` says look somewhere else, which is the
  one remedy that cannot help; `ENCODE_FAILED` says this host cannot produce the encoding, when the
  host can and merely could not be reached; `POLICY_DENIED` says a policy layer refused, when none
  was consulted. §9.3's own `ENCODE_FAILED` rationale is the precedent and it decides this: "A
  closed refusal set that forces an implementation to misreport is not a stricter contract, it is a
  less truthful one." Option A leaves exactly that situation standing, permanently.
- **Read-modify-write.** §7.7 carries `treeRevision` so a client can detect that a read it derived
  an edit from is stale. Against an upstream tree the window between read and commit now contains a
  network round trip in each direction. The mechanism still works — the token is opaque and
  compared, never parsed (§5.4) — but the client's assumption about how often it will fire is wrong
  by an order of magnitude, and a client that treats a revision mismatch as an exceptional
  condition will treat a routine one as exceptional.

**What it costs the host.** Nothing at handshake, and a permanent inability to say anything true
when the channel fails.

**What it costs the specification.** §1.1's definition of a page peer — "alongside the Fuaran host
that rendered the tree" — silently stops describing a conformant peer. §1.2's "not a transport
across processes" does not forbid this (it says carrying relay messages out of the tab is "that
implementation's own concern, outside this contract"), but that sentence was written to scope the
protocol, not to bless an unspecified remote leg inside a specified entry point. A reading that
turns a scoping clause into a licence is the kind of thing that is discovered later by someone who
had no reason to look.

**Verdict.** A is not incompatible with anything. It is *silent*, and the specific silence is about
the two facts a client would act on: where the tree is, and what happened when it could not be
reached. It buys its zero-cost compatibility by declining to say either.

---

## 4. Option B — a distinct capability token

**Shape.** `relay@1.4` introduces a separate entry point — say `read.nodeJson.upstream` — for the
proxied read, alongside the existing page-tree one. A treeless peer advertises the new token; a
page-tree peer advertises the old. A client knows which world it is in by which token it was
offered.

**What changes in the text.** §4.2 gains a row per proxied read; §6.3's advertisement rule applies
to them unchanged; §7 gains a subsection per new entry point, each of which is the existing
subsection with a different failure story; §9.3 gains at least one class.

**What it costs a `relay@1.3` client that does not know `relay@1.4`.** Everything, and by design.
§6.3 forbids advertising a capability introduced after the session profile, so a `relay@1.3` session
against a treeless peer sees `capabilities: ["read.renderedDom"]` and correctly concludes it can
read geometry and nothing else. That is honest — it is the *most* honest of the three options at the
handshake — and it is also total: every already-shipped client is locked out of the tier
permanently, not until it upgrades, because the lockout is a property of the session profile it
negotiated. A client that never adds `relay@1.4` to its `accepts` never sees the tier at all.

**What it costs the specification.** Two structural costs, and the second is the serious one.

- **A parallel vocabulary.** Each proxied read is a second name for the same question, and the two
  names' payloads are identical by construction (§7.7 rule 1 forces the same encoder output). The
  document then carries two entry points that differ only in where the answer came from — a fact
  §6.3 already says a client should not be selecting behaviour on.
- **§4.2's invariant, if the token is not a request type.** The natural reading of "a distinct
  capability token" is a *single* new capability that flags treeless-ness, rather than a duplicate
  of each read. But a capability in this contract **is** a request type: §4.2's "one fewer place for
  a capability and its entry point to drift apart" is an invariant, not a coincidence, and a
  capability with no entry point breaks it. So B is either a duplicated vocabulary (the first cost)
  or a broken invariant (this one). There is no third shape of B.

**Verdict.** B tells the truth at the handshake and pays for it with a permanent partition of the
client population and a doubled vocabulary. It is the right answer if — and only if — a treeless
peer's reads are genuinely a different question from a page-tree peer's. §7.7 rule 1 says they are
not: the payload is the same host encoder's output either way.

---

## 5. Option C — the peer declares where its tree is, and the entry points stay as they are

**Shape.** `relay@1.4` adds one **optional field** to the `hello.ok` payload — `treeSource`, with
values `"page"` and `"upstream"` — and one refusal class, `UPSTREAM_UNAVAILABLE`. No request type is
added, no capability is added, and no existing entry point changes its payload. A treeless peer
advertises whichever of the existing capabilities it can serve, declares `treeSource: "upstream"`,
and proxies (per §2 constraint 1). A page-tree peer omits the field, exactly as it does today.

**What changes in the text.** §6.3's table gains a row; §6 gains one short subsection saying what
`"upstream"` obliges and what it does not; §8 gains a paragraph stating where the §8.3 sequence runs
for such a peer; §9.3 gains a row. Full draft wording is in §6 below.

**What it costs a `relay@1.3` client that does not know `relay@1.4`.** One ignored field, and
nothing else. §10.2 is explicit and unconditional: "Both peers MUST ignore unrecognised fields, at
every level … unrecognised **payload** fields on any message. A peer MUST NOT refuse a message
solely because it carries a field the peer does not know. This is what makes §5.3's 'additive =
minor' safe." So a `relay@1.3` client negotiates a `relay@1.3` session, receives a `hello.ok` with a
field it drops on the floor, sees the capabilities it already understands, and behaves exactly as it
does today.

Which means **C degrades to A for a `relay@1.3` client, by construction** — the latency and staleness
costs in §3 are still paid by the old client, because there is no way to spare it a cost that comes
from where the tree is. What C adds is that the cost is no longer *invisible*: a `relay@1.4` client
is told the fact, and the failure has a name.

**What it costs the host.** One field to emit, and a new refusal class to raise correctly (see §7).

**What it costs the specification.** A field whose absence has meaning. §8.2.1's `actorClass` is the
precedent and it is exact: "Absent means `human` … the default is chosen to leave existing recordings
correct rather than retroactively unlabelled." Absent `treeSource` means `"page"` for the same reason
— it is what every pre-`relay@1.4` peer meant — and a peer whose tree IS in the page SHOULD omit the
field, keeping its handshake byte-identical to one an earlier peer would have sent.

**Verdict.** C is the smallest change that answers the question that was actually asked. It keeps
§4.2's invariant, keeps one vocabulary, costs a `relay@1.3` client one ignored field, and turns the
fact a client needs into a declared datum rather than something inferred from a `host` string that
§6.3 forbids inferring from.

---

## 6. Recommendation — Option C

**Recommended: Option C.** Five reasons, in the order they decided it.

1. **It answers the question the gap is about.** The gap is not "there is no entry point for a
   remote read" — §7.7 rule 1 says the payload is identical either way, so there is nothing to add
   an entry point *for*. The gap is that a client cannot learn where the tree is, and §6.3 forbids
   the one channel by which it might have guessed. C adds exactly that fact and nothing else.
2. **It is the only option that costs the shipped population nothing.** A costs them a silence; B
   costs them the tier. C costs them one ignored field, by §10.2's unconditional rule.
3. **It keeps §4.2's capability ≡ request-type invariant.** B cannot, in either of its two shapes.
4. **It makes the failure sayable.** §9.3's `ENCODE_FAILED` rationale already settled the general
   question: a closed set that forces an implementation to misreport is less truthful, not stricter.
   `UPSTREAM_UNAVAILABLE` is the same argument applied to the same document a second time.
5. **It has a shippable first stage that does not wait on anything.** See §7 — this is the practical
   reason, and it is the one that most changes what happens next.

**Rejected within C: the per-request half.** The question as posed offers "declares itself treeless
and negotiates *per request*". The declaration half is recommended; the per-request negotiation is
not. Two reasons. §5.2 already requires profile negotiation "on **every** inbound request, not only
on `hello`", so a second per-request mechanism would be a second answer to a question the contract
already answers. And where the tree lives does not change within a session — it is a property of how
the page was built — so renegotiating it per request would spend a round trip re-establishing a
constant. If a future tier genuinely migrates a tree between page and upstream mid-session, that is
a `treeRevision` change and a fresh `hello`, which the contract already supports.

### Draft §6 amendment

> *(insert into §6.3's payload table, after `capabilities`)*
>
> | `treeSource` | string | **Optional, since `relay@1.4`.** Where the tree this session reads
> lives: `"page"` or `"upstream"`. **Absent means `"page"`** — what every peer before `relay@1.4`
> meant — so a peer whose tree is in the page SHOULD omit it, keeping its handshake byte-identical
> to one an earlier peer would have sent. §6.5. |
>
> *(new subsection, after §6.4)*
>
> ### 6.5 A peer whose tree is not in the page *(since `relay@1.4`)*
>
> A **page peer** is defined in §1.1 as running alongside the host that rendered the tree. There is
> a deployed shape for which that is not true: the tree lives on the server, and the page holds only
> a renderer applying pushed patches. Such a peer is conformant, and this subsection is what it
> says about itself.
>
> `treeSource: "upstream"` declares that this peer does not hold the tree. It obliges four things
> and permits nothing.
>
> 1. **It is a declaration, not a capability.** It changes no entry point, adds none, and gates
>    none. `capabilities` remains the whole authorisation surface (§6.4), and a client checks it
>    exactly as before. A peer that declares `"upstream"` and advertises only `read.renderedDom`
>    (§7.4) — the one read that asks the DOM rather than the tree — is fully conformant, in the same
>    sense §6.4 makes a read-only host fully conformant.
> 2. **Every tree read it advertises is proxied, never reconstructed.** §7.7 rule 1's "the host's
>    own encoder, and no second projection" is binding here and is the whole reason this subsection
>    is normative rather than advisory. A peer MUST NOT answer a tree read by encoding a tree it
>    derived from the patches it has applied. It relays the question to the side that holds the tree
>    and returns that side's own encoder output, unchanged. A patch-derived reconstruction is a
>    second projection, and a client has no way to detect that it received one.
> 3. **The fact is stable for the session.** A peer MUST NOT change `treeSource` within a session.
>    A client that needs to re-establish it re-handshakes.
> 4. **It is reported regardless of the session profile.** Unlike a capability (§6.3), this field is
>    emitted whatever profile the session settled on. A `relay@1.3` client ignores it by §10.2, at no
>    cost; withholding it from that client would buy nothing and would leave a `relay@1.4` client
>    that happened to negotiate down unable to tell two genuinely different peers apart.
>
> What it does **not** say: nothing about *what* is upstream, *how far* away it is, or *what
> protocol* carries the question. §1.2's exclusions are unchanged — a relay message that has left
> the tab is no longer governed by §3's origin rules, and how a peer reaches its host is that
> implementation's own concern. `"upstream"` is deliberately not `"server"` for this reason: the
> contract does not know, and should not appear to.

### Draft §8 amendment

> *(new paragraph at the end of §8.1, "Posture")*
>
> **Where the three gates run, for an upstream-tree peer** *(since `relay@1.4`)*. A peer declaring
> `treeSource: "upstream"` (§6.5) does not hold the tree, and therefore does not hold the decode,
> validate or policy stages either: all three are performed by the host at the other end of the
> channel, and the page peer relays the op to it and reports the outcome it receives. **This changes
> nothing about §8.3's ordering, its refusal classes, or which class means what.** It is stated
> because §8.3 reads as though the page peer performs the sequence, and for this peer it does not.
>
> Two consequences, and they are both strengthenings rather than relaxations:
>
> - §11.3's "the relay has no side door" holds *more* firmly here, not less. The page holds no tree
>   and no policy, so there is nothing in the page for a relay client to reach past; the op crosses
>   the host's own decode → validate → policy path because that path is the only thing on the far
>   side of the channel.
> - §1.2's "not an authorisation mechanism — the relay reports a host's decision, it never makes
>   one" becomes literal rather than a posture. The peer's entire contribution is transport.
>
> `treeRevision` in `apply.ok` (§8.3) is the upstream tree's revision after the op, and is opaque
> under §5.4 exactly as any other revision is. A `changed` event caused by a server push carries
> `cause: "host"` (§8.5) — a push is the host changing its own tree — and no new `cause` value is
> needed.

### Consequential §9.3 amendment

> | `UPSTREAM_UNAVAILABLE` *(since `relay@1.4`)* | The peer declares `treeSource: "upstream"` (§6.5)
> and **could not dispatch** the request to the side that holds the tree. Raised **only** when the
> peer can assert the request was not delivered — see the note below. | `{ "reason": "no-channel" }`
> or `{ "reason": "timeout-before-dispatch" }` — a closed set; §10.3 governs an unrecognised value.
> A peer SHOULD NOT put upstream diagnostics here (§11.4). |
>
> **On `UPSTREAM_UNAVAILABLE` specifically, and on the case it deliberately does NOT cover.** §8.3
> states that "a refused op MUST leave the tree unchanged", with no partial application and no
> silent no-op. A peer that dispatched a request and then heard nothing **cannot assert that**, so
> reporting it as a refusal would put a promise on the wire that the peer is not in a position to
> make — which is the same defect, in the other direction, that the `ENCODE_FAILED` note above
> describes.
>
> So the class is restricted to the case the peer *does* know: the request never left. No channel is
> established, or the channel rejected the send. A request that was dispatched and not answered gets
> **no response at all**, and the client's own timeout governs — which is not a gap but the posture
> §6.1 already takes for a peer that does not answer, and the only honest report available when the
> op's fate is genuinely unknown. A client SHOULD render that outcome differently from any refusal,
> because a refusal promises the tree is unchanged and a timeout promises nothing.
>
> The restriction applies to reads as well as to `apply`. A read has no such invariant to protect,
> but one rule is easier to implement correctly than two, and a client branching on the class should
> not have to know which entry point it came from.

### Consequential §12.1 amendment

> *(append to the "Waiting on a second implementation" list)*
>
> `treeSource` and `UPSTREAM_UNAVAILABLE` (§6.5, §9.3, added at 1.4) are specified and served by no
> host yet. Their fixtures land when a second host serves them, per this section's rule; until then
> the family's `profile` stays where the fixtures are.

---

## 7. How the correlated-response blocker interacts with each option

The server-driven channel today is **push-frames outbound and fire-and-forget inbound**: a frame
carries patches and effects to the page, and an inbound message carries no correlation id. There is
no way for the page to ask a question and match an answer to it. That is the open blocker recorded
as **B2** on the phase that raised this question (Phase 741) — its "correlated response leg" — and it
is not a same-day fix: the change is in the tier's own repository, and reaches a consumer only after
a version cut and a publish.

Every option in this document is a proxy design (§2 constraint 1), so **every proxied read and every
`apply` needs B2 before it can be served at all**. That is common to A, B and C and is not a
discriminator.

What *is* a discriminator is whether the option has anything to say before B2 closes:

| | Reads / `apply` servable pre-B2 | Anything shippable pre-B2 | What a client sees pre-B2 |
|---|---|---|---|
| **A** | No | **No** | A peer advertising `read.renderedDom` only, indistinguishable from a page-tree host that offers little. |
| **B** | No | **No** — the new tokens exist precisely to be advertised, and cannot be served. | The same, plus a `relay@1.4` vocabulary nothing uses. |
| **C** | No | **Yes — the declaration** | A peer advertising `read.renderedDom` and declaring `treeSource: "upstream"`: honestly narrow, and correctly explained. |

**This is the practical case for C and it is worth stating plainly.** Under A or B, nothing about the
server-driven tier can ship until B2 lands, because the only thing either option offers is entry
points that need the response leg. Under C, the declaration is servable *today*: a treeless peer can
say what it is, advertise the one read it can genuinely serve, and be rendered correctly by a client
— which converts the page-side task from "blocked" into "shipped, honestly narrow", with the proxied
reads arriving later as a capability set that grows when B2 closes. A capability set growing is
exactly what §5.3 and §6.3 are built to absorb.

Two further interactions worth recording before the decision:

- **Typed refusals from the far side need B2 in every option.** A refusal raised by the upstream
  host — its policy layer denying an op, its validator rejecting one — has to travel back over the
  channel to become a `POLICY_DENIED` or `VALIDATOR_REJECT` on the wire, and that is the B2 leg.
  Without it those classes are unreachable from a treeless peer, whatever this document says.
- **`UPSTREAM_UNAVAILABLE` is the one refusal a treeless peer can raise WITHOUT B2**, and §6's
  restriction on it is why: "no channel established" is a fact the page peer holds locally, needing
  no answer from anywhere. That is a small thing, but it means C's refusal class is not itself
  blocked on the blocker it exists to describe.

---

## 8. The draft vectors

[`draft-1.4/`](draft-1.4/) holds hand-authored vectors for the recommended option, in the shape of
the existing `hello-*` pairs. They are **not listed in [`manifest.json`](manifest.json)** and are
therefore not a conformance obligation for anybody; [`draft-1.4/README.md`](draft-1.4/README.md)
says what each one shows and what would have to be true before it is listed.

One finding from writing them, because it bears on the decision rather than on the files:

> **Under the recommended option, the "reject vector for a `relay@1.3` client meeting a
> `relay@1.4`-only capability" cannot exist — and its absence is the evidence for C.** Such a vector
> presupposes that `relay@1.4` introduces a capability, which is option B's shape and not C's. Under
> C a `relay@1.3` client meets a treeless peer, negotiates a `relay@1.3` session, receives a
> `hello.ok` carrying one field it ignores, and is refused nothing at all. The nearest true vector
> is a `relay@1.3` client asking that peer for a capability it did not advertise and receiving the
> ordinary `CAPABILITY_ABSENT` of §6.4 — which is drafted, and which is a `relay@1.0` refusal class
> doing exactly the job it has always done.

---

## 9. What this proposal does not decide

- **Whether to adopt C at all**, and if so whether `treeSource` is the right field name and
  `"page"` / `"upstream"` the right values. `"server"` was considered and rejected in §6's draft
  wording for a stated reason; the reason is arguable and the decision is not this document's.
- **Whether `UPSTREAM_UNAVAILABLE` should carry a `detail.reason` at all.** §9.3's `POLICY_DENIED`
  carries none deliberately (§11.5), and the same disclosure argument could be made here. The draft
  proposes a two-value closed set because a client renders "reconnect" and "retry" differently;
  a reviewer may reasonably prefer no `detail`.
- **Anything about implementations.** No host is asked to do anything by this file, and no entry
  point is added to any of them.

## Provenance

Drafted against `DEVTOOLS_RELAY.md` at `relay@1.3` and the 28-fixture `devtools-relay/` family, for
the development phase that raised the question (Phase 1590), whose predecessor (Phase 741) recorded the
gap as its B3 blocker and the correlated-response leg as B2.
