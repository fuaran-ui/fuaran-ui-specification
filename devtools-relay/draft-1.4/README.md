# `draft-1.4/` — draft vectors for the treeless-peer proposal

**Status: NON-NORMATIVE DRAFT. These vectors bind nobody.**

They accompany [`../PROPOSAL-relay-1.4-treeless-peer.md`](../PROPOSAL-relay-1.4-treeless-peer.md),
which puts three answers to an open question about
[`../../DEVTOOLS_RELAY.md`](../../DEVTOOLS_RELAY.md) and recommends one. These are hand-authored
vectors for the **recommended** option — a peer that declares where its tree lives (`treeSource`)
and adds no request type — in the shape of the existing `hello-*` pairs one directory up.

## What "draft" means here, mechanically

- **They are not listed in [`../manifest.json`](../manifest.json).** The relay family is
  self-enumerated (`DEVTOOLS_RELAY.md` §12.1) and every implementation that drives it drives it from
  that manifest — not from a directory walk. An unlisted file is therefore inert: no host's
  conformance gate reads it, and adding these cost no host a green build.
- **`../manifest.json` still declares `profile: "relay@1.3"`, and that is correct.** §12.1: "a
  fixture for a request type introduced by a minor bump lands when a **second** host serves it, and
  the manifest's `profile` advances with the fixtures, not with the document." No host serves any of
  this yet, so nothing here is listed and the profile has not moved.
- **`../../DEVTOOLS_RELAY.md` is unchanged** and still declares `relay@1.3`. The `relay@1.4`
  envelopes below describe a peer that would exist *if* the proposal were adopted. They are the
  decision's evidence, not its enactment.

**What would have to be true before any of these is listed:** the proposal is accepted, its §6/§8
text is moved into `DEVTOOLS_RELAY.md` and the document's profile bumped, and — separately, and
later — a **second** implementation serves the addition. Only then does a vector move up one
directory and gain a manifest entry.

## The vectors

### `hello-treeless` — the handshake this is all about

A `relay@1.4` client meets a peer whose tree lives on the server. The peer answers `hello.ok` with
`treeSource: "upstream"` and advertises `read.renderedDom` and nothing else.

That capability set is not an abbreviation — it is the honest one for the tier **today**. Of the
seven reads, `read.renderedDom` (§7.4) is the only one that asks the DOM a question rather than
asking the tree; the rest need the tree, the tree is upstream, and reaching it needs a correlated
response leg the channel does not yet have (the proposal's §7). So this vector pins the *first*
shippable shape: a peer that says truthfully what it is and offers what it can genuinely serve. A
peer that later serves the proxied reads advertises more, which is exactly the growth §5.3 and §6.3
are built to absorb.

### `hello-treeless-1-3-client` — the same peer, a `relay@1.3` client

The peer is unchanged; only the client is older. Three things are worth reading off it:

- **`payload.profile` is `relay@1.3`.** §6.3's selection rule: the highest profile both listed in
  `accepts` and serveable by the peer. A `relay@1.4` peer keeps speaking to a `relay@1.3` client;
  that is the whole point of a minor bump.
- **`$relay` on the response is `relay@1.4` — the peer's own id, not the fixture's.** §12.1 states
  this explicitly and warns that a runner comparing that field against the fixture "will fail every
  peer that ever advances a minor". Compare it against the peer's own id.
- **`treeSource` is still emitted, into a `relay@1.3` session.** Unlike a capability (§6.3), it is
  not withheld at an older session profile. The `relay@1.3` client drops it by §10.2's unconditional
  ignore-unknown-fields rule and is not harmed; withholding it would spare that client nothing and
  would leave a `relay@1.4` client that negotiated down unable to tell two genuinely different peers
  apart.

**And note what does NOT happen: nothing is refused.** The proposal's §8 records the finding — under
the recommended option there is no `relay@1.4`-only capability for an older client to collide with,
so the "1.3 client meets a 1.4-only capability" reject vector cannot exist. Its absence is the
compatibility evidence.

### `refusal-capability-absent-treeless` — the nearest true form of that reject

A `relay@1.3` client, having negotiated the session above, asks the treeless peer for
`read.nodeJson`. It was not advertised, so the answer is `CAPABILITY_ABSENT` — a `relay@1.0` refusal
class doing the job it has always done (§6.4: "a page peer MUST refuse a request whose capability it
did not advertise, with `CAPABILITY_ABSENT` … it MUST NOT respond `UNKNOWN_MESSAGE`, which would
wrongly tell the client the type does not exist"). The type does exist here; this peer does not offer
it. That distinction is §10.1's, and it is the right one.

### `refusal-upstream-unavailable` — the one class the proposal adds

A `relay@1.4` client asks a **later-stage** treeless peer — one that has the response leg and does
advertise the proxied reads — for `read.nodeJson`, and the peer cannot reach the side that holds the
tree.

Read the `detail.reason` carefully: `"no-channel"`. The proposed class is raised **only** where the
peer can assert the request was never dispatched. A request that WAS dispatched and then went
unanswered gets no response at all and is governed by the client's own timeout — because §8.3's "a
refused op MUST leave the tree unchanged" is a promise a peer in that position cannot make, and
making it anyway would be the same defect §9.3's `ENCODE_FAILED` note describes: a refusal set that
forces an implementation to misreport is less truthful, not stricter.

This is the one vector here that describes a peer nobody can build today. It is included because the
class it pins is the substantive half of the proposal, and a class with no vector is a class nobody
has had to write down twice.
