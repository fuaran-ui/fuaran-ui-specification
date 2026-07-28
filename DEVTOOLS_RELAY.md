# Fuaran DevTools relay contract (`relay@1.0`)

The **page ↔ extension relay**: a `postMessage` envelope that carries a Fuaran host's already-shipped
in-page introspection surface across the page/extension boundary, so a browser extension (or any
other in-page peer) can inspect — and, where the host permits, edit — a live Fuaran UI.

This document is **normative**. A relay implementation is written from this document; it does not
need to read any host's source. The executable companion is the [`devtools-relay/`](./devtools-relay/)
fixture family, enumerated by its own [`devtools-relay/manifest.json`](./devtools-relay/manifest.json).

---

## 1. Scope and shape

### 1.1 What this specifies

A **request/response/event message protocol** over `window.postMessage`, between two peers inside one
browser tab:

- the **page peer** — code running in the page's own JavaScript context, alongside the Fuaran host
  that rendered the tree; and
- the **client peer** — code running in an extension content script (or any other same-page script)
  that wants to read or edit that tree.

The protocol carries five reads, one gated mutation, a change subscription, and a detection
handshake. Every message is a JSON-compatible object passed through the browser's structured-clone
algorithm.

### 1.2 What this is NOT

**This is a relay over a host's existing in-page introspection surface — not a second introspection
protocol.** Every read entry point below returns the payload the host's own in-page surface already
computes. Where a payload shape is described here, that description is a *statement of the canonical
form the relay carries*, and hosts converge on it (§1.4); it is not a new computation the host must
invent for the relay.

Three further exclusions, stated so implementers do not over-build:

- **Not a transport across processes.** Both peers are in the same tab. Carrying relay messages to a
  different process — a background service worker, a devtools page, a remote agent — is that
  implementation's own concern, outside this contract. A relay message that has left the tab is no
  longer governed by §3's origin rules.
- **Not a hashed or canonically-ordered artefact.** Relay envelopes are transport. They are never
  hashed, never appended to an op stream, and carry no byte-parity obligation. The one exception is
  the `TreeOp` payload of an `apply` request, which **is** canonical wire JSON — see §8.2.
- **Not an authorisation mechanism.** The relay *reports* a host's decision (§9). It never makes one,
  and it grants nothing a host has not already opted into offering.

### 1.3 Relationship to the wire format

The relay is a **client of** the Fuaran wire format specified in [`WIRE_FORMAT.md`](./WIRE_FORMAT.md),
not an extension of it. It borrows three things and nothing else:

| Borrowed | From | Used for |
|---|---|---|
| Profile-id grammar `<name>@<major>.<minor>` + the Current/Behind/Foreign negotiation table | §15.1, §15.2 | Relay version negotiation (§4) |
| The `DecodeError` envelope — `Code` / `Path` / `Message` / `ExpectedShape` | §6 | The `DECODE_FAILED` refusal's `detail` (§9.3) |
| Canonical `TreeOp` JSON | §2, §3 | The `apply` request's `op` payload (§8.2) |

The relay profile is `relay@1.0`. It versions **independently** of the wire profile `core@1.0`: a
host may advance its wire profile without advancing its relay profile, and the reverse. The two
profile names are distinct namespaces, so a peer that confuses them negotiates `Foreign` and refuses
— which is the correct outcome.

### 1.4 Where hosts differed, and what the relay carries

Three shapes were not identical across the hosts that shipped the in-page surface first. The relay
picks one canonical form for each, and a conformant page peer emits that form regardless of what its
host's own local surface returns:

| Shape | Divergence | Canonical relay form | Why |
|---|---|---|---|
| Binding-value result | One host returned a tagged envelope carrying `status` + `expression` + `source`; another returned the bare resolution without the binding's identity | The **tagged envelope** (§7.3) | A relay client renders a slot inspector; it needs to show *what the binding is*, not only what it resolved to. The bare form cannot be recovered into the tagged one, so the richer shape is the only one that can be canonical. |
| `findNodes` result | Hosts returned a bare JSON array | An **object** `{ "nodeIds": [...] }` (§7.5) | Every other response payload is an object; a bare array in one slot blocks additive fields (a future `truncated` flag) and makes generic envelope handling special-case one type. |
| `apply` op argument | Hosts took the op as a **string** of JSON | An embedded **JSON object** (§8.2) | `postMessage` is a structured-clone channel, not a text channel. Requiring a pre-serialised string would force the client to canonicalise, which is the host's job (§8.2). |

A host whose local surface differs adapts at the relay boundary. That adaptation is the page peer's
responsibility and is invisible to the client.

---

## 2. Terminology

| Term | Meaning |
|---|---|
| **Page peer** | The relay endpoint in the page's JS context, adjacent to the Fuaran host. |
| **Client peer** | The relay endpoint that issues requests (typically an extension content script). |
| **Surface** | The host's in-page introspection object the page peer relays. |
| **Opted in** | The host has explicitly enabled its introspection surface *and* relay exposure (§11.1). |
| **Capability** | A named entry point the page peer offers, advertised in `hello.ok` (§6.3). |
| **Tree revision** | An opaque token identifying the current tree state (§5.4). |

The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** are to be interpreted
as described in RFC 2119.

---

## 3. Transport and origin discipline

### 3.1 Channel

Both peers use `window.postMessage` on the **page's own `window`**, and receive with a
`"message"` event listener on the same `window`.

```js
// sending
window.postMessage(envelope, window.origin);

// receiving
window.addEventListener('message', (event) => { /* §3.2 checks */ });
```

### 3.2 Mandatory receive-side checks

A conformant peer MUST apply **all** of the following to every inbound `message` event, in order,
and MUST silently ignore the event if any check fails:

1. `event.source === window` — the message originated in this same window, not a frame, opener, or
   embedded document.
2. `event.origin === window.origin` — same-origin. A peer MUST NOT accept `"*"`, a wildcard match, or
   an origin from an allow-list supplied by the message itself.
3. `event.data` is a non-null object (not a string, array, or primitive).
4. `event.data.$relay` is present and is a string.

"Silently ignore" means **no reply of any kind** — not even a refusal. A refusal sent to an
unverified peer is itself a disclosure (it confirms a Fuaran host is present); §12.3 covers this.

### 3.3 Mandatory send-side rules

- A peer MUST pass `window.origin` as the `targetOrigin` argument. It MUST NOT pass `"*"`.
- A peer MUST NOT post relay envelopes to any window other than its own (`frames[i]`, `parent`,
  `opener`, or a `MessageChannel` port are all out of scope for this contract).

### 3.4 Frames

Each frame is a separate document with its own `window` and its own host instance. A relay session is
therefore **per-frame**: a client peer that wants to inspect a Fuaran tree inside an iframe must run
its own instance in that frame and complete its own handshake there. Cross-frame relay is not part of
this contract.

---

## 4. The envelope

Every message — request, response, and event alike — is exactly this object:

```json
{
  "$relay": "relay@1.0",
  "dir": "request",
  "id": "c-1",
  "type": "read.nodeState",
  "payload": { "nodeId": "metric-1" }
}
```

| Field | Type | Rule |
|---|---|---|
| `$relay` | string | The sender's relay profile id (§5). **Required on every message.** Its presence is what marks an envelope as a relay message (§3.2 check 4) — this single field does both detection and negotiation. `$`-prefixed to mark it spec-reserved, per the reservation posture of [`WIRE_FORMAT.md`](./WIRE_FORMAT.md) §2.1. |
| `dir` | string | One of `"request"`, `"response"`, `"event"`. A peer MUST ignore a message whose `dir` it does not handle (a client ignores `request`; a page peer ignores `response`), applying §3.2's silence rule. |
| `id` | string | Correlation id (§4.1). |
| `type` | string | The message type token (§4.2). |
| `payload` | object | Type-specific. **Always an object**, never a bare array or primitive, and never absent — a type with no data carries `{}`. |

A peer MUST ignore unrecognised **top-level envelope fields** rather than refusing, so the envelope
stays additively extensible (§10.2).

### 4.1 Correlation

- A client peer MUST set `id` to a value unique within its session. The format is unconstrained;
  `"<prefix>-<counter>"` is conventional.
- A page peer MUST echo the request's `id` **verbatim** on the response, including on a refusal.
- An `event` message carries the `id` of the `subscribe` request that established it (§9... see §8.4),
  so a client can route events to the subscription that asked for them.
- A page peer MUST NOT reuse an `id` it did not receive, and MUST NOT send more than one `response`
  per request.

### 4.2 Type tokens and the derived response type

Request types are dotted lower-camel tokens. The protocol is deliberately regular:

> **A successful response's `type` is the request's `type` with `.ok` appended.**
> **A refused response's `type` is always `refusal`.**

So `read.nodeState` → `read.nodeState.ok` or `refusal`. There is no third outcome. A client can
therefore dispatch on `type` generically without a per-request table.

The full closed set of request types:

| Request `type` | Capability required (§6.3) | Success response |
|---|---|---|
| `hello` | *(none — always available once opted in)* | `hello.ok` |
| `read.nodeState` | `read.nodeState` | `read.nodeState.ok` |
| `read.bindingValue` | `read.bindingValue` | `read.bindingValue.ok` |
| `read.renderedDom` | `read.renderedDom` | `read.renderedDom.ok` |
| `read.tree` | `read.tree` | `read.tree.ok` |
| `read.findNodes` | `read.findNodes` | `read.findNodes.ok` |
| `apply` | `apply` | `apply.ok` |
| `subscribe` | `subscribe` | `subscribe.ok` |
| `unsubscribe` | `subscribe` | `unsubscribe.ok` |

**Every request type except `hello` is named identically to the capability that gates it.** A page
peer's authorisation check is therefore a set membership test on `type`, not a lookup table — one
fewer place for a capability and its entry point to drift apart.

The one event type is `changed` (§8.4).

---

## 5. Profile id and version negotiation

### 5.1 Grammar

`<name>@<major>.<minor>`, exactly as [`WIRE_FORMAT.md`](./WIRE_FORMAT.md) §15.1 defines it. The relay
namespace is `relay`; the profile defined by this document is **`relay@1.0`**.

### 5.2 Negotiation

Each peer compares the `$relay` it receives against its own, using the §15.2 table unchanged:

| Outcome | When | Behaviour |
|---|---|---|
| **Current** | same `name` + `major`, received `minor` ≤ own `minor` | Proceed. |
| **Behind** | same `name` + `major`, received `minor` > own `minor` | Proceed. The sender may use types or fields this peer does not know; §10 governs what happens when it does. |
| **Foreign** | different `name`, **or** different `major` | Refuse with `FOREIGN_PROFILE` (§9.3) and process nothing further from that peer until it re-handshakes with a compatible profile. |

A page peer MUST evaluate this on **every** inbound request, not only on `hello` — a client peer
cannot be assumed to keep its profile constant, and the check is a string comparison.

### 5.3 Evolution policy

Additive change — a new request type, a new capability, a new optional payload field, a new refusal
class — is a **minor** bump. Removing or renaming any of those is a **major** bump. This mirrors
§15.4 and is what makes `Behind` safe to proceed on: within a major, everything a newer peer adds is
something an older peer can ignore.

### 5.4 Tree revision

A **tree revision** is an opaque string token that changes whenever the host's tree changes. Clients
MUST treat it as opaque: compare for equality, never parse, order, or attribute meaning to its
content. It appears in `hello.ok`, `apply.ok`, `subscribe.ok`, and `changed`.

Its purpose is staleness detection: a client that read a node at revision `r` and then observes
revision `r'` knows its cached read is stale. A host with no cheap revision counter MAY emit a fresh
random token on every tree change; that satisfies the contract, since only equality is specified.

---

## 6. Detection and the `hello` handshake

### 6.1 Detection

There is **no ambient detection signal** — no injected DOM marker, no global sentinel that a page
peer is required to publish, no announcement broadcast. A client peer detects a Fuaran host by
**sending `hello` and seeing what comes back**:

| Observation | Meaning |
|---|---|
| `hello.ok` | A relay-exposing Fuaran host is present; its capabilities are in the payload. |
| `refusal` with `NOT_OPTED_IN` | A Fuaran host is present but has not opted into relay exposure. |
| Nothing, within the client's own timeout | No page peer is listening. |

A client MUST NOT interpret silence as an error condition to retry aggressively; §12.4 covers the
probing posture. A client SHOULD wait at least 1000 ms before concluding no peer is present, since
the page peer may install its listener after the client's first probe.

> A host MAY *additionally* mark rendered elements with an identifying DOM attribute for its own
> rendering purposes, and a client MAY use such a marker as a heuristic hint about where to look. But
> a marker is **not** part of this contract, MUST NOT be relied on for detection, and its presence
> says nothing about whether the relay is opted in — which is the only question that matters.

### 6.2 The `hello` request

```json
{
  "$relay": "relay@1.0",
  "dir": "request",
  "id": "c-1",
  "type": "hello",
  "payload": {
    "client": "fuaran-devtools",
    "clientVersion": "1.0.0",
    "accepts": ["relay@1.0"]
  }
}
```

| Payload field | Type | Rule |
|---|---|---|
| `client` | string | Free-form client identifier. Informational; a page peer MUST NOT gate behaviour on it. |
| `clientVersion` | string | Free-form. Informational. |
| `accepts` | array of string | Relay profile ids this client can speak, most-preferred first. MUST be non-empty. |

### 6.3 The `hello.ok` response

```json
{
  "$relay": "relay@1.0",
  "dir": "response",
  "id": "c-1",
  "type": "hello.ok",
  "payload": {
    "host": "fuaran-ts",
    "hostVersion": "0.6.0",
    "surfaceVersion": "0.1.0",
    "profile": "relay@1.0",
    "capabilities": ["read.nodeState", "read.bindingValue", "read.renderedDom", "read.tree", "read.findNodes"],
    "treeRevision": "r-41"
  }
}
```

| Payload field | Type | Rule |
|---|---|---|
| `host` | string | Host implementation identifier. **Opaque to the client** — a client MUST NOT branch on it to select behaviour; the `capabilities` array is the only thing that determines what is available. It exists for display and bug reports. |
| `hostVersion` | string | The host implementation's version. Informational. |
| `surfaceVersion` | string | The version of the host's underlying in-page surface shape. Informational; the relay contract's own version is `profile`. |
| `profile` | string | The profile the page peer will speak for the rest of the session. MUST be one the client listed in `accepts`, or the page peer MUST refuse with `FOREIGN_PROFILE` instead of responding `hello.ok`. |
| `capabilities` | array of string | The request types this peer will serve, from the §4.2 closed set (excluding `hello`). MAY be empty. |
| `treeRevision` | string | §5.4. |

### 6.4 Capabilities are the whole authorisation surface

**A read-only host is fully conformant.** A page peer that offers only the five `read.*` capabilities
— omitting `apply` and `subscribe` — implements this specification completely. Nothing in this
contract obliges a host to offer mutation.

Consequently:

- A client MUST check `capabilities` before issuing any request other than `hello`.
- A page peer MUST refuse a request whose capability it did not advertise, with `CAPABILITY_ABSENT`
  (§9.3) — it MUST NOT serve it, and MUST NOT respond `UNKNOWN_MESSAGE` (which would wrongly tell
  the client the type does not exist).
- A page peer MAY advertise a capability and still refuse individual requests to it. Advertising
  `apply` promises that the entry point exists, **never** that any particular op will be accepted.
  Per-op decisions are §8.3.

---

## 7. Read entry points

All five are non-mutating. Each takes the payload below and returns `<type>.ok` with the stated
payload, or `refusal`.

### 7.1 `read.nodeState`

**Request payload:** `{ "nodeId": "<string>" }`

**Response payload** — the node's typed snapshot:

```json
{
  "id": "metric-1",
  "kind": "Metric",
  "bindings": [
    { "slot": "Value", "expression": "$state.revenue", "source": "State" }
  ],
  "childIds": []
}
```

| Field | Type | Meaning |
|---|---|---|
| `id` | string | The node's id. |
| `kind` | string | The node's wire kind discriminator — the same token used as `kind.$type` in the wire format (§3 of `WIRE_FORMAT.md`). |
| `bindings` | array of object | Every **bound** binding slot on this node, in the host's canonical slot order. An optional slot that is absent does not appear. |
| `bindings[].slot` | string | Slot name. |
| `bindings[].expression` | string | The binding's wire-form expression — `$static`, `$state.<key>`, `$queries.<name>`, `$filters.<name>`, `$selection.<nodeId>`, `$i18n.<key>`, or `$computed` for the computed family. |
| `bindings[].source` | string | The binding case token: `Static`, `Query`, `Filter`, `Selection`, `State`, `I18n`, or `Computed`. |
| `childIds` | array of string | Ids of this node's structurally addressable children, in order. |

Refusals: `NODE_NOT_FOUND`.

### 7.2 `read.tree`

**Request payload:** `{}`

**Response payload** — the same per-node shape as §7.1, made recursive by one added field:

```json
{
  "id": "root",
  "kind": "Box",
  "bindings": [],
  "childIds": ["metric-1"],
  "children": [
    { "id": "metric-1", "kind": "Metric", "bindings": [], "childIds": [], "children": [] }
  ]
}
```

`children` holds the full snapshot of each child, in the same order as `childIds`. A leaf node has
`"children": []`.

### 7.3 `read.bindingValue`

**Request payload:** `{ "nodeId": "<string>", "slot": "<string>" }`

**Response payload** — a tagged resolution envelope (the canonical form chosen in §1.4). `status` is
a closed set of five:

| `status` | Meaning | Additional fields |
|---|---|---|
| `resolved` | The slot resolved to a value. | `value` (any JSON value, including `null`), `expression`, `source` |
| `notResolved` | The slot's data source is registered but has not produced a value yet. | `expression`, `source` |
| `errored` | Resolution was attempted and failed. | `message`, `expression`, `source` |
| `i18nUnresolved` | An i18n binding has no translation for its key. | `key`, `expression`, `source` |
| `noOverride` | The slot is declared on this node's kind but is currently absent — it exists, with no value set. `expression` is `"$none"`. | `expression`, `source` |

```json
{ "status": "resolved", "value": 42, "expression": "$state.revenue", "source": "State" }
```

`expression` and `source` carry the same meanings as in §7.1 and are present on **every** status, so
a client can always render what the binding *is*, even when it has no value.

Note the deliberate distinction, which a client SHOULD surface differently: `noOverride` means *this
slot exists on this kind and holds nothing*; the `SLOT_NOT_DECLARED` refusal (§9.3) means *this slot
is not a binding slot on this kind at all*. The first is a state; the second is a client error.

Refusals: `NODE_NOT_FOUND`, `SLOT_NOT_DECLARED`.

### 7.4 `read.renderedDom`

**Request payload:** `{ "nodeId": "<string>" }`

**Response payload** — live geometry of the node's rendered element:

```json
{ "x": 24, "y": 180.5, "width": 320, "height": 96, "overflowing": false, "hidden": false }
```

| Field | Type | Meaning |
|---|---|---|
| `x`, `y`, `width`, `height` | number | The element's bounding box in CSS pixels, relative to the viewport. |
| `overflowing` | boolean | The element's scroll size exceeds its client size in either axis. |
| `hidden` | boolean | The element is rendered but not visible — `display: none`, `visibility: hidden`, or a zero-area box. |

A node that is in the tree but has **no rendered element** (not yet mounted, or in a non-DOM context)
is `NODE_NOT_FOUND` — the refusal `detail` SHOULD distinguish it via `"reason": "not-rendered"` so a
client can tell "no such node" from "not currently on screen".

Refusals: `NODE_NOT_FOUND`.

### 7.5 `read.findNodes`

**Request payload:** `{ "kind": "<string>" }` — a wire kind discriminator.

**Response payload:**

```json
{ "nodeIds": ["metric-1", "metric-2"] }
```

Ids of every node whose kind discriminator equals `kind`, in tree order (depth-first, root first). An
unmatched kind yields `{ "nodeIds": [] }` — **not** a refusal. Asking about a kind that is not in the
tree is a legitimate question with the answer "none"; and a kind token this host does not recognise
at all is likewise `[]`, since the honest answer to "which nodes have this kind" is still "none".

---

## 8. `apply` — capability-gated mutation

### 8.1 Posture

`apply` is the **only** mutating entry point in this contract. It is gated three times over, and each
gate is independent:

1. The host must have opted the relay in at all (§11.1) — otherwise every request is `NOT_OPTED_IN`.
2. The host must have advertised the `apply` capability (§6.4) — otherwise `CAPABILITY_ABSENT`.
3. The individual op must survive decode, validation, and the host's policy layer (§8.3).

A host that stops at gate 1 or 2 is fully conformant (§6.4).

### 8.2 Request

```json
{
  "$relay": "relay@1.0",
  "dir": "request",
  "id": "c-7",
  "type": "apply",
  "payload": {
    "op": { "$type": "UpdateProp", "path": "Columns[0].Label", "target": "grid-1", "value": "Channel name" },
    "attribution": { "actor": "fuaran-devtools", "reason": "renamed column from the inspector" }
  }
}
```

| Payload field | Type | Rule |
|---|---|---|
| `op` | object | A **`TreeOp` in canonical wire JSON**, exactly as [`WIRE_FORMAT.md`](./WIRE_FORMAT.md) specifies. Embedded as a JSON object, not a string (§1.4). |
| `attribution` | object | Optional. `actor` (string) and `reason` (string), both optional within it. Advisory metadata for the host's audit trail. |

**The canonical-serialisation obligation is the page peer's.** The client sends a structurally-cloned
object; the page peer serialises it to canonical JSON per `WIRE_FORMAT.md` §2 before handing it to
the host's decode path. This is deliberate: canonical ordering is a property of the wire format the
host already implements, and requiring every relay client to re-implement it would put a
byte-sensitive obligation on the least-qualified peer.

**Attribution is advisory and untrusted.** A host MUST NOT grant any privilege on the basis of
`attribution`, MUST NOT let it influence the §8.3 decisions, and SHOULD treat it as untrusted text
when recording it (§12.5).

### 8.3 Outcome

The page peer MUST evaluate the op in this order, stopping at the first failure:

1. **Decode** the op against the wire format. Failure → `DECODE_FAILED` (§9.3), carrying the wire
   format's own `DecodeError` in `detail`.
2. **Validate + apply** through the host's normal apply path. Rejection → `VALIDATOR_REJECT`.
3. **Policy** — the host's policy layer decides whether this mutation is permitted at all. Refusal →
   `POLICY_DENIED`.

A host MAY consult its policy layer **before** decoding (default-deny postures typically do, so an
undecodable op from an unpermitted peer is refused as denied rather than parsed). The ordering above
constrains only which refusal class is reported when a stage is reached, not the order stages run in.

On success:

```json
{ "applied": true, "treeRevision": "r-42" }
```

`treeRevision` is the revision **after** the op. A client holding subscriptions will also receive a
`changed` event carrying the same revision (§8.4); the two are consistent by construction, and a
client MUST tolerate receiving them in either order.

**A refused op MUST leave the tree unchanged.** There is no partial application, and there is no
silent no-op: every `apply` request receives either `apply.ok` or a `refusal` naming its class.

### 8.4 The three mandated refusal classes

These three are **distinct, machine-readable, and MUST NOT be conflated** — a client is expected to
render each differently, because each implies a different user action:

| Class | Means | What the user should do |
|---|---|---|
| `NOT_OPTED_IN` | The host has not enabled relay exposure. Nothing about this op was examined. | Enable the host's debug/relay flag and reload. |
| `VALIDATOR_REJECT` | The op was understood but is not a legal edit of this tree. | Change the edit. |
| `POLICY_DENIED` | The op was understood and legal, but the host's policy layer refused it. | Nothing the edit can fix — the host's policy is the gate. |

Collapsing these — reporting a policy refusal as a validation failure, say — sends the user to fix a
tree that was never the problem. That is why they are separate wire values rather than one `refused`
flag with prose.

### 8.5 Change subscription

**`subscribe` request payload:** `{ "events": ["tree"] }`

`events` is an array from the closed set `["tree"]` in `relay@1.0`. It MUST be non-empty. Additional
event names are a minor bump (§5.3); a peer MUST ignore event names it does not recognise rather than
refusing the whole subscription, provided at least one name is recognised. If none is, refuse with
`MALFORMED_MESSAGE`.

**`subscribe.ok` response payload:**

```json
{ "subscriptionId": "s-1", "events": ["tree"], "treeRevision": "r-41" }
```

`events` echoes the subset actually established. `treeRevision` is the revision at the moment of
subscription, so a client has a known baseline before the first event arrives.

**The `changed` event:**

```json
{
  "$relay": "relay@1.0",
  "dir": "event",
  "id": "c-9",
  "type": "changed",
  "payload": { "subscriptionId": "s-1", "event": "tree", "treeRevision": "r-42", "cause": "apply" }
}
```

| Field | Rule |
|---|---|
| `id` | The `id` of the `subscribe` request that established this subscription (§4.1). |
| `subscriptionId` | From `subscribe.ok`. |
| `event` | The event name, from the subscribed set. |
| `treeRevision` | The revision **after** the change. |
| `cause` | `"apply"` (a relay `apply` caused it) or `"host"` (the host changed its own tree). A peer that cannot distinguish them MUST emit `"host"`. |

A page peer SHOULD coalesce rapid successive changes into a single event carrying the latest
revision, rather than emitting one per intermediate state. Events are a staleness signal, not a
change log — a client that needs the new state re-reads it.

**`unsubscribe` request payload:** `{ "subscriptionId": "s-1" }` →
**`unsubscribe.ok` payload:** `{ "subscriptionId": "s-1" }`

Unsubscribing an unknown or already-released `subscriptionId` returns `unsubscribe.ok`, not a
refusal — the caller's desired end state is reached either way. A page peer MUST release every
subscription on page unload and MUST stop emitting events for a released subscription.

---

## 9. Refusals

### 9.1 Shape

Every refusal is a `response` with `type: "refusal"`, echoing the request's `id`:

```json
{
  "$relay": "relay@1.0",
  "dir": "response",
  "id": "c-7",
  "type": "refusal",
  "payload": {
    "class": "POLICY_DENIED",
    "requestType": "apply",
    "message": "The host's policy layer refused this mutation."
  }
}
```

| Payload field | Type | Rule |
|---|---|---|
| `class` | string | One of the closed set in §9.3. **This is the machine-readable field** — a client branches on `class` and never on `message`. |
| `requestType` | string | The `type` of the request being refused. Echoed so a client can route a refusal without holding request state. For a refusal of an unrecognised type, this is the unrecognised token verbatim. |
| `message` | string | Human-readable. **Not machine-readable, not stable across versions**, and MUST NOT be parsed. |
| `detail` | object | Optional, class-specific (§9.3). A client MUST tolerate its absence. |

### 9.2 Rules

- A page peer MUST send exactly one response per request — a refusal **is** that response.
- A refusal MUST NOT be sent to a peer that failed the §3.2 checks (silence instead — §12.3).
- A client peer MUST treat an unrecognised `class` as a generic failure and MUST NOT crash (§10.3).

### 9.3 The closed class set

| Class | Raised when | `detail` |
|---|---|---|
| `NOT_OPTED_IN` | The host has not opted into relay exposure. Applies to **any** request type including `hello`. | — |
| `FOREIGN_PROFILE` | Profile negotiation returned `Foreign` (§5.2), or a `hello` whose `accepts` contains no profile this peer speaks. | `{ "received": "<profile>", "supported": ["relay@1.0"] }` |
| `UNKNOWN_MESSAGE` | The `type` is not in the §4.2 closed set for this peer's profile. | `{ "received": "<token>" }` |
| `MALFORMED_MESSAGE` | The envelope or payload is structurally invalid — a missing required payload field, a wrong JSON type, an empty `accepts` or `events`. | `{ "path": "<payload.field>" }` |
| `CAPABILITY_ABSENT` | The `type` is recognised but its capability was not advertised (§6.4). | `{ "capability": "<name>" }` |
| `NODE_NOT_FOUND` | No node with the requested id (or, for `read.renderedDom`, no rendered element). | `{ "nodeId": "<id>", "reason": "not-rendered" }` — `reason` optional |
| `SLOT_NOT_DECLARED` | The named slot is not a binding slot on that node's kind. Distinct from the `noOverride` **status** (§7.3). | `{ "nodeId": "<id>", "slot": "<name>", "kind": "<kind>" }` |
| `DECODE_FAILED` | The `apply` op is not decodable as a `TreeOp`. | The wire format's `DecodeError` verbatim: `{ "Code", "Path", "Message", "ExpectedShape"? }` (§6 of `WIRE_FORMAT.md`) |
| `VALIDATOR_REJECT` | The op decoded but the host's validator / apply engine rejected it. | `{ "code": "<host diagnostic code>" }` — optional |
| `POLICY_DENIED` | The host's policy layer refused the operation. | — (see §12.5: `detail` SHOULD stay empty here) |

`NOT_OPTED_IN`, `VALIDATOR_REJECT`, and `POLICY_DENIED` are the three mandated `apply` classes of
§8.4. The others are protocol- and lookup-level refusals that apply across request types.

---

## 10. Unknown-message posture and forward compatibility

The relay is designed so a peer meeting something newer than itself **degrades rather than breaks** —
the same posture `WIRE_FORMAT.md` §15.3 takes for unknown node kinds.

### 10.1 Unknown request type

A page peer receiving a `type` it does not recognise MUST respond `refusal` with `UNKNOWN_MESSAGE`
and MUST NOT throw, log noisily, or drop the message silently. Silence is reserved for messages that
failed the §3.2 origin checks; a well-formed message from a verified peer always gets an answer.

Note the ordering with §6.4: a **recognised** type whose capability was not advertised is
`CAPABILITY_ABSENT`, not `UNKNOWN_MESSAGE`. Reporting the wrong one of these tells the client
something false about the host — either that a real entry point does not exist, or that a
non-existent one is merely switched off.

### 10.2 Unknown fields

Both peers MUST ignore unrecognised fields, at every level:

- unrecognised **envelope** fields (§4);
- unrecognised **payload** fields on any message;
- unrecognised **capability** names in `hello.ok` (a client keeps the ones it knows);
- unrecognised **event** names in a `subscribe` request (§8.5).

A peer MUST NOT refuse a message solely because it carries a field the peer does not know. This is
what makes §5.3's "additive = minor" safe.

### 10.3 Unknown enumerated values

A client peer MUST tolerate an unrecognised value in any closed set it consumes — a `refusal.class`,
a `read.bindingValue` `status`, a `changed` `cause` — by treating it as the generic case of that set
and continuing. It MUST NOT crash and MUST NOT discard the surrounding message.

### 10.4 Unsolicited responses

A client peer MUST ignore a `response` whose `id` does not match an outstanding request. It MUST NOT
apply state changes from it. A page peer likewise ignores anything with `dir: "response"`.

---

## 11. Security notes

The relay puts a channel into a live application's typed state, so the security posture is part of
the contract rather than deployment advice.

### 11.1 Opt-in, default-off

**A conformant page peer is absent unless the host has explicitly enabled it.** Not merely inert —
absent: no listener installed, so a `hello` gets no response at all.

- Relay exposure MUST be off by default, and MUST require an explicit host opt-in to enable.
- A host SHOULD gate it behind a development/debug build in addition to the runtime opt-in, so a
  production bundle cannot expose it even if a flag is set wrongly.
- A host that has an introspection surface but has not opted into *relay* exposure MAY install a
  minimal listener that answers `NOT_OPTED_IN`. This is a deliberate trade: it tells an honest client
  why it cannot proceed, at the cost of confirming a Fuaran host is present. Absence is the safer
  default and SHOULD be preferred in production-like builds.

There is no message in this contract that turns the relay on. Opting in is a host-side act, never a
protocol-side one — otherwise the opt-in would be reachable by exactly the peer it protects against.

### 11.2 Origin discipline

§3.2 and §3.3 are security requirements, not hygiene. Specifically:

- `targetOrigin` MUST be `window.origin`, never `"*"`. A `"*"` post is readable by any document that
  can obtain a reference to the window, which for a page with embedded third-party frames is a real
  disclosure of application state.
- `event.origin` MUST be checked on receive. Without it, any frame that can post to this window can
  drive the relay.
- `event.source === window` MUST be checked. The origin check alone does not exclude a **same-origin
  frame**, and a same-origin frame is a different document with a different trust story.
- A peer MUST NOT take an allow-list, a target origin, or any other trust parameter **from a message**
  — a message-supplied trust boundary is not a trust boundary.

### 11.3 The relay has no side door

This is the central security property, and it is a property of the *architecture*, not of the
protocol's own checks:

> **Every mutation crosses the host's own decode → validate → policy path, in the page, in that
> order. The relay has no privileged entry point that bypasses any of them.**

Concretely, an op arriving over the relay is subject to exactly the same treatment as one originating
inside the page: it is decoded from canonical wire JSON by the host's decoder (§8.2), validated and
applied by the host's apply engine, and permitted or refused by the host's policy layer (§8.3). The
relay contributes no apply engine, no validator, and no policy of its own.

Three consequences worth stating explicitly, because each closes an assumption an implementer might
otherwise make:

1. **A relay client cannot construct a tree state the host would not accept from its own code.** The
   client's reach is exactly the set of legal, permitted `TreeOp`s — no more.
2. **A relay client cannot weaken the gates.** No message adjusts policy, disables validation, or
   raises the client's privilege. There is no such message in the closed set, and adding one would be
   a major version change with this section as the reason it should not be made.
3. **Capability advertisement is not a security boundary on its own.** It is a *discovery* mechanism.
   A page peer MUST re-check on every request rather than trusting that a client only asks for what
   was advertised — a client is not a trusted component, and §6.4's per-request `CAPABILITY_ABSENT`
   refusal exists precisely so the check has a defined outcome.

### 11.4 Probing and disclosure

A relay-exposing page is discoverable by any same-origin script that sends `hello`. That is inherent
— a channel that answers is a channel that can be found. The contract limits what discovery yields:

- Silence is the response to any message failing §3.2, so a cross-origin or cross-frame prober learns
  nothing at all.
- `NOT_OPTED_IN` confirms a host without disclosing its tree, capabilities, or version.
- A page peer SHOULD NOT include host build details beyond `host` / `hostVersion` / `surfaceVersion`
  in `hello.ok`, and MUST NOT include paths, credentials, or configuration.

### 11.5 Untrusted content in both directions

- **Client-supplied strings are untrusted.** `client`, `clientVersion`, and `attribution` are free-form
  text from an unprivileged peer. A page peer MUST NOT interpolate them into HTML, use them in a
  security decision, or let them reach a log sink unescaped.
- **Host-supplied strings are untrusted at the client.** `message`, binding `expression`s, node ids,
  and resolved binding `value`s originate from application data. A client rendering them in an
  extension UI MUST escape them; an extension panel is a privileged context, and injecting page-controlled
  strings into it is the classic extension escalation path.
- **Refusal `detail` SHOULD NOT carry policy internals.** A `POLICY_DENIED` detail explaining *why*
  policy refused hands an attacker a map of the policy. §9.3 leaves that class's `detail` empty by
  design.

### 11.6 Auditability

A host that offers `apply` SHOULD record every relay-originated mutation and every refusal through
the same audit path it uses for in-page mutations, so a relay session is as answerable as any other.
A mutation channel whose activity leaves no trace is an unrecorded side channel; the relay's
architecture (§11.3) is what makes recording it straightforward, since the ops pass through the
host's existing path anyway.

---

## 12. Conformance corpus

The executable companion is [`devtools-relay/`](./devtools-relay/), enumerated by its **own**
[`devtools-relay/manifest.json`](./devtools-relay/manifest.json).

### 12.1 Enumeration posture

The relay family is **self-enumerated** and does **not** appear in the corpus root
[`manifest.json`](./manifest.json). This follows the precedent already set by
[`merge-conformance/`](./merge-conformance/), which likewise carries its own manifest.

The reason is a compatibility one. The root manifest is the index of the **canonical wire-format codec
families** — `node-round-trip`, `op-round-trip`, `reject`, `lenient-accept`, `envelope-*`,
`elicitation-*` — and every codec host's conformance runner reads it and dispatches on `kind`. Adding
a family with a shape those runners cannot execute (relay exchanges are not codec round-trips) would
put entries in front of every host that each would have to learn to skip. A separate manifest means
existing runners see an unchanged file and match an unchanged set, while a relay implementation reads
one manifest that contains only what it can run.

Relay fixtures are therefore **shape fixtures, not byte-parity fixtures** (§1.2): they pin message
structure and refusal classification. They carry no canonical-ordering obligation and are not
generated by the wire-format emitter.

### 12.2 Manifest shape

```json
{
  "version": 1,
  "profile": "relay@1.0",
  "spec": "../DEVTOOLS_RELAY.md",
  "fixtures": [
    {
      "id": "hello-read-only",
      "kind": "relay-exchange",
      "requestFile": "hello-read-only.request.json",
      "responseFile": "hello-read-only.response.json",
      "description": "..."
    }
  ]
}
```

Three fixture kinds:

| `kind` | Files | Assertion |
|---|---|---|
| `relay-exchange` | `requestFile` + `responseFile` | Feed the request to the page peer; the response MUST match the fixture's `type` and payload shape. |
| `relay-refusal` | `requestFile` + `responseFile` + `expectedClass` | As above, and the response MUST be `type: "refusal"` with `payload.class == expectedClass`. |
| `relay-event` | `eventFile` | An unsolicited `event` envelope shape a client MUST accept. |

### 12.3 What a runner asserts

A relay implementation is conformant when, for every fixture:

- the response's `type` is the request's `type` + `.ok`, or `refusal`;
- the response's `id` echoes the request's `id` verbatim;
- for `relay-refusal`, `payload.class` equals `expectedClass`;
- every field the fixture's payload declares is present with the stated JSON type.

Runners MUST compare **shapes and enumerated values**, not bytes: `treeRevision` values, geometry
numbers, resolved binding `value`s, and `message` strings are environment-specific and will legitimately
differ. Fixture payloads use representative values for these; a runner asserting byte-equality on them
is testing the fixture author's choices, not the implementation.

Every message type in §4.2 has at least one fixture, and every refusal class in §9.3 has one.

---

## See also

- [`WIRE_FORMAT.md`](./WIRE_FORMAT.md) — the canonical wire format. §6 (`DecodeError`), §15 (profile
  ids + negotiation), §2/§3 (canonical `TreeOp` JSON) are the parts this contract builds on.
- [`README.md`](./README.md) — the repository's artefact index.
- [`devtools-relay/manifest.json`](./devtools-relay/manifest.json) — the relay fixture family.
