# Fuaran wire format (canonical JSON)

**Status:** stable (see [`STABILITY.md`](../fuaran-dotnet/STABILITY.md) → "Wire format"). **Version:** wire format v1 – profile `core@1.0`, language rev **0.2.0** (see §15 for the version/profile + forward-compatibility contract, and §1.1 for the 0.2.0 revision summary).

This document is the **permanent, language-neutral specification** of the Fuaran UI tree's JSON wire format. It is the authority; the F# encoder ([`Fuaran.UI.OpStream.Abstractions.CanonicalJson`](../fuaran-dotnet/src/Fuaran.UI.OpStream.Abstractions/CanonicalJson.fs)) and decoder ([`Fuaran.UI.Ops.JsonDecode`](../fuaran-dotnet/src/Fuaran.UI.Ops/JsonDecode.fs)) are one *conformant host* – the reference – of this contract. The other conformant codec hosts (TypeScript, Python, Go, Rust) and any third-party host implement the same contract from this doc + the conformance corpus – **without reading F# source**. The **§11.0 roster** is the authoritative list of hosts and their roles (codec host vs native render projection).

The executable conformance suite is the fixture corpus [in this repository](./), indexed by [`manifest.json`](./manifest.json) – the authoritative enumeration of every fixture family and count. A decoder/encoder pair built from this document alone must pass every fixture assertion the manifest enumerates.

The conventions this specification and its corpus are written under – canonical bytes, the corpus as oracle, the manifest as the authoritative enumeration, forward coupling, and how a specification in this family extends – are stated once in [`SPEC_CONVENTIONS.md`](./SPEC_CONVENTIONS.md) and are **normative here**.

---

## 1. Scope and shape

The wire format serialises two top-level artefacts:

| Artefact | F# type | Encode | Decode | Round-trip target |
|---|---|---|---|---|
| **Node** (a UI tree) | `Node<'Msg>` | `encodeNode` | `decodeNode` | `Result<Node<obj>, DecodeError>` |
| **TreeOp** (a tree edit) | `TreeOp<'Msg>` | `encodeOp` | `decodeOp` | `Result<TreeOp<obj>, DecodeError>` |

Both are produced as a single JSON document (RFC 8259) with no leading/trailing whitespace. The decode side is **storage-shape erased**: it always yields `Node<obj>` / `TreeOp<obj>` because the wire form carries no typed-`'Msg` information (every `'Msg` payload encodes as the `"<closure>"` sentinel – see §4). Typed callers re-attach a real `'Msg` downstream via their own `moduleMsgDecoder`.

The fundamental conformance property is **byte-stable round-trip**:

```
encode(decode(encode(x))) == encode(x)     for every value x
```

The corpus stores `encode(x)` for each round-trip fixture; a conformant host asserts `encode(decode(inputFile)) == inputFile` byte-for-byte.

### 1.1 The 0.2.0 revision (pre-publish coordinated rev – clean break)

The 0.2.0 language rev is a **single coordinated change** to the canonical bytes, taken while the
language is pre-launch so no legacy aliases for the *retired* names ship (retired vocabulary is a
hard decode error, not a deprecation). Sanctioned by §15.4's pre-1.0 posture; every corpus fixture
was regenerated on the new bytes in the same change-set. The six strands:

1. **Rename law – scalar `value`, collection `source`.** A *scalar displayed value* is named
   `value` (`Metric` / `LabelValueRow` / `Fact`); `source` is reserved for *collection feeds*
   (`Sparkline` / `DataGrid` / `Chart` / `Map` / `Select`, `Binding.Format.source`,
   `Binding.Transform.source`). The old `Metric.source` / `LabelValueRow.source` are **not**
   accepted (clean break); the web-prior `data` alias remains (§3.6).
2. **Filters unification.** The parallel `FilterKind` DU (`TextFilter` / `ChoiceFilter` /
   `RangeFilter` / `SegmentedFilter`) is **retired**; a filter chip's control is an ordinary
   `FormFieldKind`, and a new `FormFieldKind.Range` absorbs the dual-thumb range control. A chip
   control with **no `value` field** decodes to the auto binding `Filter(<chip name>)` – the
   declarative floor for filters (§3.3).
3. **`Binding.Filter.defaultValue`.** The Filter binding gains an optional slot-typed
   `defaultValue` (mirror of `State.defaultValue`) – the value the resolver yields before the
   filter is first written (§3.3).
4. **Bare-string `TextSource.Literal` is canonical.** The bare JSON string is the *encoder's*
   Literal form; the `{"$type":"Literal"}` envelope moves to the lenient-accept side (§16).
5. **Sentinel omission.** The three no-information closure sentinels are off the wire:
   `Binding.Query.accessor`, `Binding.Selection.accessor`, `Action.Dispatch.msg` (§4).
6. **Behavioural omitted-when-default.** Five behavioural flags join the §3.6 omit-when-default
   discipline on BOTH boundaries: `DataGrid.editable` (false), `Progress.indeterminate` (false),
   `Tabs.orientation` (`Horizontal`), `Toast.dismissable` (**true** – the one omit-when-TRUE),
   `Callout.dismissable` (false); segmented `orientation` omission becomes encoder-symmetric.

**0.2.1 addendum – the symmetric form-field auto-bind.** Strand 2's omission rule extends to its
fixpoint: a **Form field** whose `value` slot is absent decodes to
`{"$type":"State","key":<the field's own id>,"defaultValue":<the slot's typed placeholder>}` and
the encoder symmetrically omits a `value` that is exactly that auto-binding – so ONE rule covers
the whole control vocabulary: *every control may omit `value`; a filter chip auto-binds
`$filters.<name>`, a form field auto-binds `$state.<field id>`*. The typed placeholders (empty
string / `0` / `false` / null-choice / `{min 0, max 0}` / ISO-empty date) are pinned by the
reference implementations and the `form-declarative-minimal` fixture; input carrying the explicit
auto-shape normalises to the omitted form (`lenient-596-form-explicit-auto-state`). Eval-driven:
the first 0.2.0 cohort's largest failure class (38/122 first-time parse fails, every provider) was
exactly this omission – the intent was unambiguous, so the language legalised it.

---

## 2. JSON syntax conventions (the canonical encoder rules)

These twelve rules make the encoding **deterministic**: two structurally-equal inputs (modulo closures) produce byte-for-byte identical output across .NET, Fable, process restarts, and machines. This is load-bearing for hash-chain integrity and for the AI pre-emit wire-shape gate. A conformant *encoder* MUST follow all twelve; a conformant *decoder* MUST accept the output and (per rule 2) any key ordering.

1. **UTF-8 source, ASCII for control chars only.** Structural punctuation is ASCII. Non-ASCII characters inside strings pass through as their literal UTF-8 sequence – **no `\uXXXX` escaping for non-control characters** (escaping would inflate output and confuse the wire-shape gate).

2. **Object keys are sorted alphabetically by Ordinal comparison** on encode (`StringComparer.Ordinal` – *not* culture-aware, *not* case-insensitive). Empty objects render `{}`. **Decoders MUST accept any key order** – the structural shape is what matters, not the byte order. (Encoder enforces order; decoder tolerates any order. Field lookup is by name.)

3. **Lists / arrays preserve source order.** A list is an *ordered* structure (sibling order matters for layout). Empty arrays render `[]`.

4. **`None` / null fields are EXCLUDED from object output.** An `option` that is `None` does **not** render as `"key":null` – the key is omitted entirely. `Some x` renders the unwrapped `x`. This keeps emissions minimal. **Corollary for decoders:** an absent optional key means `None`; never synthesise `null`.

   **There is NO exception (Phase 677).** `null` does not appear anywhere in a canonical Fuaran emission. It is not a value in this model: **absence is structural**, expressed by a missing key. Until 0.2.x the obj-erased `Binding.Static` seam and `Binding.State.defaultValue` carved themselves out and emitted `"value":null` / `"defaultValue":null`; they now omit the key, and the carve-out is gone. That exception was not free — it left `Fuaran.Core.Wire.JVal` unable to parse two of this corpus's own fixtures, and produced a host bridge that silently turned a null into an empty string.

   **Decoders still ACCEPT `null` at those two positions** as a §16 lenient shorthand for absence (models emit null naturally, and the intent is unambiguous), normalising it to the omitted form. Accepting is not emitting: `encode(decode(x))` never reproduces a null. Everywhere else — the rule 12 structured-payload positions — `null` remains a hard decode error.

5. **Numbers.**
   - **Integers** render as decimal with no leading zeroes, no decimal point, no exponent (`42`, `-7`, `0`).
   - **Floats** render in the **canonical layout** of .NET `Double.ToString("R", InvariantCulture)` – the shortest digit sequence that round-trips (`parse(toString(x)) == x`), laid out as follows. This layout is **mandatory for every finite double across the whole range**, not implementation-defined outside int53 (Phase 117):
     - The **shortest round-trip significant digits** (both .NET `"R"` and the JS `Number.prototype.toString()` produce the same digit sequence since .NET Core 3.0 / V8 – they differ only in *layout*, which this rule pins).
     - Let `e` be the base-10 exponent of the leading significant digit (`x = d₀.d₁d₂… × 10ᵉ`). Use **fixed-point** notation iff `-4 ≤ e ≤ 16`; otherwise **scientific** notation.
     - Scientific notation is `<mantissa>E<sign><exp>`: an uppercase `E`; an **always-present** exponent sign (`+`/`-`); the exponent **zero-padded to at least two digits** (`1E+21`, `1E-07`, `1.2345678901234568E+17`, `5E-324`). The mantissa has no decimal point when it is a single digit (`1E+21`), otherwise a single leading digit then `.` then the rest (`1.602E-19`).
     - This differs from the JS native `String(x)` form (lowercase `e`, no sign-padding, a wider fixed-point threshold), so the TypeScript host **normalises** `String(x)` into this layout (see `@fuaran-ui/ops` `encode.ts` `formatFiniteDouble`); the F# host emits it natively via `ToString("R")`. The two are byte-identical over the full finite-double range – exercised by the `metric-float-*` corpus fixtures (1e21, 1e-7, a 17-significant-digit value, an integer > 2^53) and the cross-host property fuzzer.
   - **Negative zero collapses to positive zero** (`0`, never `-0`).
   - **Special values** `NaN`, `+∞`, `-∞` render as the **quoted strings** `"NaN"`, `"Infinity"`, `"-Infinity"` (RFC 8259 forbids them as bare numbers). See §7 for the decode side.

6. **Strings** are quoted with these escapes, and **only** these:
   - `"` → `\"`
   - `\` → `\\`
   - control chars `U+0000`–`U+001F` → `\uXXXX` (lower-case hex, four digits)
   - everything else passes through literally – including `/`, which is **not** escaped (RFC 8259 permits `\/` but does not require it; the canonical form is un-escaped).

7. **Booleans** render `true` / `false`.

8. **DU cases** render as an object with a `"$type"` discriminator (sorted by rule 2 it lands before any lower-case data key) whose value is the case's **short name** (`"Static"`, `"Query"`, `"EditNode"` – never fully-qualified), followed by the case's payload fields. Example: `Binding.Static 42.0` → `{"$type":"Static","value":42}`. See §3 for the full discriminator map.

9. **Tuples** render as positional arrays (`(1, "x")` → `[1,"x"]`).

10. **Closures / function values / unobservable runtime payloads** render as the sentinel string `"<closure>"`. See §4.

11. **`obj`-typed values** (the remaining erased seams: untyped `Binding.Static` statics, a `PropValue.Native` op value) are best-effort: if the runtime type matches a recognised JSON primitive (string, bool, `int`, `int64`, `float`, `float32`, `DateTimeOffset`, `DateTime`), encode that. `DateTimeOffset`/`DateTime` encode as Unix **seconds** (`int64`). Anything else renders the sentinel `"<opaque>"`. **No reflection over arbitrary CLR objects.** The slot-typed `Static` payloads the language enumerates (options / values / series / markers / **row feeds**) bypass this rule with typed encodings – see §5 for the table and the residual-opaque boundary. Rule 11 still governs *inside* a row, at the individual cell.

12. **Structured JSON payload positions** – `Custom` props, `Action.Notify` / `SetState` / `AiTool` payloads, `I18n` args, and a wire-form `UpdateProp` value – carry a structured JSON value (`JVal` on the F# host) and round-trip **faithfully at any nesting depth within the §21 resource limits**: objects re-encode with Ordinal-sorted keys, numbers under rule 5, no `"<opaque>"` collapse. (This rule read "at any nesting depth" unqualified until §21 landed, which made unboundedness normative and put the format's totality guarantee out of reach – see §21.3.) A JSON `null` anywhere inside such a position is **rejected at decode** (`WRONG_TYPE`, message naming the rule) – the wire model has no null (rule 4): omit the field instead.

### 2.1 Reserved `$`-prefixed keys

**Object keys beginning with `$` are reserved for this specification and its certified extensions; a host MUST NOT mint one.** The spec uses `$`-keys for the two structural roles a canonical wire needs: the DU discriminator `$type` (§3) and the versioning-envelope keys `$profile` / `$payload` / `$requiredProfile` (§15). Two properties follow from the reservation:

- **Canonical sort position.** Because rule 2 sorts keys by Ordinal and `$` (`U+0024`) precedes every letter and digit, a `$`-key always sorts **before** any lower-case data key on the same object – so a reserved key is deterministically first, never interleaved with a host's data fields.
- **Forward tolerance.** An **unknown** `$`-key on an otherwise-known kind is treated exactly as any unknown key under rule 2 – **ignored on decode**, not an error – so a newer spec revision may reserve a further `$`-key without breaking an older decoder. (This is distinct from an unknown *kind*, which §15.3's transport-only `Unknown` preserves; a `$`-key is object-local metadata, not a kind.)

Host-specific opaque data does **not** ride a `$`-key: it rides the sanctioned wire-omitted / extension slots (`Node.ExtraAttributes`, §9; the theme manifest's `$extensions` pocket) – those are lower-case, host-filled, and outside the reserved namespace by construction.

---

## 3. `"$type"` discriminator dispatch

Every DU position on the wire is a JSON object carrying a `"$type"` string + that case's payload fields. A decoder reads `$type`, dispatches to the per-case parser, and surfaces `UNKNOWN_DU_CASE` (see §6) for unrecognised discriminators, with an `ExpectedShape` hint enumerating the valid cases.

### 3.1 Node envelope

A `Node` has exactly two **required** keys – `id` and `kind`. `state`, `style`, `accessibility` and `tooltip` are **optional** and omitted when empty / all-default / `None`. A fully-default node is just `{ "id": …, "kind": … }`.

```json
{ "id": "<non-empty string>",
  "kind": <NodeKind>,
  "state": <StateBehaviour>,         // optional — omitted when empty
  "style": <SemanticStyle>,          // optional — omitted when all-default
  "accessibility": <Accessibility>,  // optional — omitted when None
  "tooltip": <TextSource>            // optional — omitted when None
}
```

- `state` (`StateBehaviour`) is an object with optional keys `onLoading` (Node), `onEmpty` (Node), `onError` (always the `"<closure>"` sentinel when present – the `ErrorPayload -> Node` callback is unobservable). **Omitted entirely from the node when all three are `None`** (the common case); a decoder restores the empty `StateBehaviour` on absence.
- `style` (`SemanticStyle`) is `{ "emphasis": <Emphasis>, "tone": <ToneVariant>, "weight": <StyleWeight> }`, each a bare enum string (§3.5), plus the Phase 147 `role`/`voice`. **Omitted entirely when all fields are the default** (`emphasis` = `"Normal"`, `tone` = `"Default"`, `weight` = `"Standard"`, `role`/`voice` default); a decoder restores the default on absence. Each of `emphasis`/`tone`/`weight` is **individually** omitted-when-default on both boundaries (§3.6, Phase 460), matching `role`/`voice`: an absent field restores its identity default on decode, and the encoder omits a field at its identity default even when the object is emitted for the other fields. The Phase 1472 `direction` (`TextDirection`, default `"auto"`) joins them on exactly those terms and is documented below — it is the one member of this record that is not presentational.
- `accessibility` carries optional keys `label` (`Binding<string>`), `labelledBy` (NodeId string), `describedBy` (NodeId string), `role` (ARIA role string), `liveRegion` (`"polite"`/`"assertive"`/`"off"`), `hidden` (`Binding<bool>`). Omitted entirely when `None`.

  > **Ruling (2026-08-25): the trait's `Binding` slots are ordinary `Binding` slots, and the §3.6
  > bare-scalar shape coercion applies to them — stated here explicitly because two hosts have
  > already mis-read this position once.** A bare JSON string in `label` (`"label": "Home"`) and a
  > bare bool in `hidden` decode as `{"$type":"Static","value": …}` under the general "any
  > `Binding<'T>` slot" rule, decode-only, re-encoding to the canonical envelope — they are the
  > sanctioned lenient shorthand, not invalid wire, and equally not a second canonical form. The
  > considered alternative — rejecting the bare string with a didactic — was declined: the general
  > §3.6 scalar rule already normatively covered every `Binding` slot when the question arose (its
  > own admission evidence was measured: `fraction: 0.9` / `activeStep: 1` in the launch evals),
  > and carving this one position out of it would have made the trait the single exception to a
  > position-independent rule. What the defect that raised the question actually showed was two
  > hosts implementing the slot as bare-string-ONLY (dropping the canonical envelope) — the
  > opposite error, fixed host-side. Pinned cross-host by
  > `lenient/lenient-shape-a11y-label-bare-scalar`; per §16 the profile is decode-only and does
  > not change the negotiated wire version (§15) — no optional field is added, so §15.4's
  > additive-minor question does not arise.

- `tooltip` (`TextSource`) is a supplementary **hint** about the node — the text a reader is shown on hover or focus, and which assistive technology receives as the node's description. Omitted entirely when absent. It takes every `TextSource` arm, and note that the CANONICAL encoding of a literal hint is a BARE STRING (`"tooltip": "Updated nightly."`) rather than an object: `Literal` is `TextSource`'s transparent case wherever it appears, and `Bound` / `I18n` are the arms that carry a `$type` envelope. The `{"$type":"Literal","text":…}` spelling is decode-accepted and normalises to the bare form on re-encode, exactly as at every other `TextSource` slot.

#### The declared direction (Phase 1472)

**It is a `SemanticStyle` member, and it is the only one that is not presentational.** `emphasis`,
`role`, `tone`, `voice` and `weight` are all statements a host may ignore and still render a document
that says the same thing. `direction` is a **correctness** statement: a value declared `"ltr"` inside
right-to-left prose is reordered by the Unicode bidirectional algorithm unless the run is isolated,
and the reader then reads its digits back in the wrong order (WCAG 1.3.2, Meaningful Sequence). A
host that drops it renders a document that says something else.

```json
{ "id": "reference",
  "kind": { "$type": "Badge", "label": "RR123456789IL", "variant": "Neutral" },
  "style": { "direction": "ltr" } }
```

**The vocabulary is closed and lower-case** — `"auto"` | `"ltr"` | `"rtl"` — spelled in the
values the isolation is ultimately expressed in, on the `liveRegion` posture. `"auto"` is the
identity and is omitted at it (§3.6), so a document that declares nothing is byte-identical to
what it was before this member existed. **An unrecognised token MUST be REFUSED, never coerced to
the default**: a document that meant `"rtl"` and misspelled it would otherwise render as reordered
digits with nothing said anywhere, which is the failure this member exists to prevent. The refusals
are pinned on both arms the member reaches — the node envelope's `style` and `UpdateStyle`'s —
because they are separate decoder paths in every host and a vector on one proves nothing about the
other.

**What it declares is ONE VALUE's own base direction, and nothing else.** Nothing here names the
document's direction, the reader's locale, or which side the layout runs from. **Layout mirroring is
host chrome and has no vocabulary in this format, deliberately**: a mirrored tree and an unmirrored
one are identical in every respect a consumer can observe, and the reader's locale is a fact the host
holds and the emitter does not. A direction declared at a document root would be a per-emitter guess
at a per-reader fact.

**Why a document can say this and a host cannot.** A host is handed a string. It cannot know that
`RR123456789IL` is an opaque identifier rather than more prose, and the bidirectional algorithm's
own inference — first strong character wins — is exactly what gets such a value wrong. Only the
tree knows which of its values are identifiers.

**Normative render obligations.** A conformant rendering host, given a node whose `style.direction`
is `"ltr"` or `"rtl"`:

1. MUST emit the declared direction on the element that carries the node's run — as HTML `dir`, or
   the receiving surface's equivalent — so the run resolves in the declared direction rather than
   from its own characters.
2. MUST **isolate** the run from the surrounding bidirectional context (`unicode-bidi: isolate`, a
   `<bdi>` element, or the surface's equivalent). Direction without isolation is half the contract
   and leaves the neighbouring text reordered around the value.
3. MUST let the declaration WIN over any direction the host would otherwise infer for that node. The
   inference exists for values whose direction is unknown; the declaration exists for the values the
   inference gets wrong.
4. MUST treat `"auto"` as the absence of a declaration — identical in every respect to a node that
   omits the member.
5. MUST NOT derive any other behaviour from it: not a layout side, not a locale, not a text
   alignment, and not a direction for the node's descendants beyond whatever the receiving surface's
   own inheritance already does.

**The pure-SSR degradation is stated here rather than left to hosts, and there is nothing to
degrade.** Obligations 1–5 are satisfiable with markup and stylesheet alone — no script
participates in any of them — so a server-rendered page with no hydration carries the same
isolation as a fully interactive one. This is stated normatively because a reader who has met the
tooltip trait next door, where one obligation genuinely needs script, would otherwise be right to
wonder which half of this one survives without it. Both halves do.

**Host adoption.** The reference host (`fuaran`) emits and decodes the member; every other codec host
in the §11.0 roster is **pending** until its own change-set lands, on the §11 step-5 terms. A
pending host is not exempt: an undeclared direction is unaffected, but a document that declares one
decodes on a pending host with the member dropped, which is silently the pre-1472 rendering.

#### The tooltip trait (Phase 1112)

**It is a node-level TRAIT, not a field of any kind.** A hint is uniform across kinds — nothing about
"a short supplementary description of this thing" varies with whether the thing is a button or a
metric — so it sits on the envelope beside `accessibility`, and a per-kind spelling of it is not this
trait. In particular `ButtonSpec` carries a legacy host-only `tooltip` slot (§10.1) which is **never
emitted and never decoded**: a `tooltip` inside a `kind` object is an unknown key, tolerated and
ignored under rule 2, and is not a second spelling.

**It is a DESCRIPTION, never a NAME.** `accessibility.label` names the element; the tooltip
supplements a name that already exists. A host MUST project it as `aria-describedby` and MUST NOT
project it as `aria-label` — an icon-only control needs both slots, saying different things, and a
host that conflated them would leave such a control with two competing names and no description.

**The gesture is not on the wire.** Hover, focus, long-press, touch reveal, placement and delay are
the renderer's own affordance: nothing here names any of them, no event enters the vocabulary, and a
document says WHAT the hint is and never HOW it appears.

**Normative render obligations.** A conformant rendering host, given a node whose `tooltip` resolves
to non-empty text:

1. MUST emit the hint as a rendered element carrying `role="tooltip"` and a stable id, and MUST
   reference that id from `aria-describedby` on the node.
2. MUST place `aria-describedby` on **the element that takes keyboard focus**, and MUST ensure such
   an element exists — giving the node's wrapper a focus stop where the node's own body is not one.
   A description on an element the keyboard never reaches is announced on no interaction at all, and
   a description on a control while a different element is the focus stop is the same failure with
   the parts swapped.
3. MUST render the hint so that moving the pointer onto the hint itself does not dismiss it
   (**hoverable**), and so that it does not disappear on a timer (**persistent**) — WCAG 1.4.13.
   Emitting the hint as a descendant of the hover target satisfies both structurally.
4. MUST merge, not replace, an `accessibility.describedBy` already present: `aria-describedby` is an
   id list, and the document has declared two descriptions.
5. MUST emit nothing at all — no hint element, no `aria-describedby`, no focus stop — when the hint
   resolves to empty or whitespace. Advertising a description that is not there is worse than
   silence.
6. SHOULD bound the hint's size so that its own text is never clipped and it never exceeds the
   viewport's usable width.

**The pure-SSR degradation is stated here rather than left to hosts.** Obligations 1–5 are all
satisfiable with no script at all, and a server-rendered page therefore carries the hint, its
description, and a CSS-driven hover/focus reveal. **Dismissal — WCAG 1.4.13's third half — is not
achievable without script and is NOT required of a pure-SSR host**: a host with a client tier MUST
provide it (Escape, without moving pointer or focus); a host without one degrades to a rendered,
adjacent, always-described hint. Collision-aware repositioning at a viewport edge requires
measurement, is likewise a client-tier concern, and is **not** claimed by any conformance leg.

**Not byte-compared.** These are render obligations, not wire shape: the corpus pins that the slot
round-trips, and the emitted markup is fixed by each host's own render tests. Nothing in
`manifest.json` measures them — stated plainly, because §11.2 vocabulary attestation enumerates
CASES and so covers no field (§11).

#### Near-miss slot names are refused, not ignored (Phase 959)

Rule 2's tolerance of unknown keys has a second **enumerated** exception, on the `accessibility`
trait — the §3.2 grid narrowing applied at the position where its cost is highest. These names decode
to a `WRONG_TYPE` error naming the canonical slot:

| Family | Name | Canonical slot |
|---|---|---|
| ARIA attribute name | `aria-label`, `aria-labelledby`, `aria-describedby`, `aria-role`, `aria-live`, `aria-hidden` | `label`, `labelledBy`, `describedBy`, `role`, `liveRegion`, `hidden` |
| its camelCase (JSX) spelling | `ariaLabel`, `ariaLabelledBy`, `ariaDescribedBy`, `ariaRole`, `ariaLive`, `ariaHidden` | the same six |
| the un-prefixed or un-cased slot name | `labelledby`, `describedby`, `live`, `liveregion` | `labelledBy`, `describedBy`, `liveRegion` |

**Why the trait is the sharpest position for this rule.** Everywhere else a tolerated near miss has
*some* feedback channel: a mislabelled column is on screen, an ignored `currentPage` shows a pager
that does not move. The accessibility trait has **no visible output at all**. An ignored `ariaLabel`
looks identical to an honoured one from the author's side and from the emitting model's side, so the
declaration silently reaches assistive technology as nothing, and nothing anywhere will ever say so.
The refusal is the only feedback that can exist.

**Why they are refused rather than aliased — and note the argument differs from §3.2's.** There the
names were not synonyms. Here `ariaLabel` *is* an unambiguous synonym, so admission turns on §16's
other half: a shorthand earns its place by being a **genuine assist to the emitting model**, and a
six-character key rename is not one. Aliasing would buy no tokens and spend the only channel that
teaches the vocabulary. `live` is the case that settles it — it is not merely a rename, because the
HTML idiom it is borrowed from also spells a **boolean**, so an alias would bind a possibly-boolean
prior onto a closed three-token set. Refusing names the key *and* the tokens.

**Two entries are named by measured evidence, not derived.** Across 12,722 language-tier emissions in
the evaluation corpora, `live` appears 6 times against `liveRegion`'s 12 — a third of every
live-region declaration was being discarded — and `ariaLabel` once against `label`'s 44. The other
fourteen are the rest of those two names' families: a set refusing only the spellings that happened
to be observed would teach nothing about the third one.

**The enum TOKENS need no entry, and that is not an omission.** An unrecognised bare-enum token
already raises `UNKNOWN_DU_CASE` naming the closed set (§3.5, `reject/reject-a11y-liveregion-unknown`),
and `role` is deliberately open to any role *name*. Only the keys were ever silent, because only
unknown keys are tolerated.

`schema.json` forbids each name with `not: { required: [...] }`, so the two artefacts agree, and the
`reject/reject-nearmiss-a11y-*` fixtures pin one per family plus the two measured spellings.

### 3.2 `NodeKind` discriminators (`kind.$type`)

The `kind` object's `$type` is the node's primitive discriminator **directly** – the wire is **flat**, with no behavioural-category envelope and no `spec` wrapper. A node carrying a label/value row is `{"$type":"LabelValueRow","emphasis":…,"label":…,"value":…}` – the spec's fields hoisted directly under `$type`, exactly as `Custom`/`ErrorBoundary` and every nested DU carry their fields. The four behavioural categories – Layout / Display / Input / Visualisation – are a **host-side classification recovered on decode** (each primitive belongs to exactly one category), not a level of wire nesting. A fifth category, **Meta**, holds the structural cases: they are node kinds with no behavioural role of their own.

The `kind.$type` is one of – and **only** one of – the following primitives or structural cases. Anything else is `WRONG_NODE_KIND` (a dedicated code distinct from `UNKNOWN_DU_CASE`, because the AI-emission eval surface pattern-matches specifically on "AI emitted something other than a valid node kind"):

> **This table is generated** from [`idl.json`](idl.json) (§13) and must not be hand-edited — see
> [§12.2](#122-generated-tables-in-this-document). Field names are listed in the canonical wire key
> order (Ordinal), spelled `field` when required, `field?` when optional, `field?=X` when
> omitted-at-default `X` (§3.6 carries the full default table), and `field*` when the slot is
> host-only and carries `"<closure>"` on the wire (§4).

<!-- fuaran:spec-kinds -->
| `kind.$type` | Recovered category | Fields (hoisted under `$type`) | Notes |
|---|---|---|---|
| `Box` | _Layout_ | `breakBefore?=false`, `children`, `heading?`, `keepTogether?=false`, `layout`, `role` | `layout` names how children arrange, `role` what the container means (element, ARIA landmark, chrome). See "The `Box` container" below. |
| `Disclosure` | _Layout_ | `children`, `defaultOpen`, `heading`, `onToggle?`, `open` |  |
| `Modal` | _Layout_ | `anchor?`, `children`, `dismissable`, `heading?`, `modality?=Modal`, `onDismiss?`, `open` |  |
| `ScrollArea` | _Layout_ | `children`, `maxHeight?`, `maxWidth?`, `orientation` |  |
| `SplitPanel` | _Layout_ | `children`, `weight` |  |
| `Stepper` | _Layout_ | `activeStep`, `children`, `onSelect?` |  |
| `SummaryList` | _Layout_ | `children`, `heading?` |  |
| `Tabs` | _Layout_ | `activeIndex`, `activeTag?`, `children`, `onSelect?`, `onSelectTag?`, `orientation?=Horizontal`, `tabHeaders?`, `tabTags?` |  |
| `Badge` | _Display_ | `label`, `variant` |  |
| `Callout` | _Display_ | `body`, `dismissable?=false`, `heading?`, `icon?`, `tone?=Default` |  |
| `CodeBlock` | _Display_ | `code`, `copyable`, `highlightLines`, `language`, `lineNumbers` | The parity-checked render is a deterministic `<pre><code>`; syntax highlighting is a client-only post-hydration enhancement, outside the cross-host byte-diff. |
| `Drawing` | _Display_ | `description?`, `shapes`, `style`, `title?`, `viewBox` |  |
| `Embed` | _Display_ | `aspectRatio?=Natural`, `permissions?=[]`, `src`, `title` |  |
| `Fact` | _Display_ | `emphasis?=false`, `help?`, `icon?`, `label`, `tone?=Default`, `value` |  |
| `Heading` | _Display_ | `level`, `text`, `variant` |  |
| `Icon` | _Display_ | `icon`, `label?`, `size?=Medium`, `tone?=Default` |  |
| `Image` | _Display_ | `alt`, `aspectRatio?=Natural`, `caption?`, `expandable?=false`, `fit?=Natural`, `loading?=Eager`, `src`, `srcSet?=[]`, `variant` | `src` is a `Binding<string>` the renderer routes through the §19 URL-scheme floor: sanitisation is a render-time obligation, so a URL that fails the floor is still a valid wire document. `alt` is mandatory. |
| `LabelValueRow` | _Display_ | `emphasis?=false`, `format?=None`, `help?`, `label`, `value` |  |
| `Link` | _Display_ | `download`, `href`, `label`, `protection?`, `rel?`, `target?` | `protection` names an anti-scraper render STRATEGY, never a content constraint — the wire carries the real `mailto:` href and a decoder MUST NOT alter it. See "Link protection" below. |
| `List` | _Display_ | `items`, `ordered` |  |
| `Markdown` | _Display_ | `text` |  |
| `Math` | _Display_ | `display`, `source` | The parity-checked render is a deterministic escaped-source fallback; KaTeX is a client-only post-hydration enhancement, outside the byte-diff. |
| `Media` | _Display_ | `controls?=true`, `kind`, `label`, `loop?=false`, `src`, `tracks?=[]`, `transcript?` | One kind, two variants: `kind` selects `Video` (carrying `autoplay` and an optional `poster`) or `Audio` (carrying neither). `src` and `poster` are both routed through the §19 URL-scheme floor at render time, and `label` is mandatory — a transport is never decorative. `autoplay` is a wire DECLARATION whose rendering is constrained: see §3.6.6 for the obligations, none of which the bytes can carry. `tracks` carries the timed-text tracks and `transcript` the text alternative (Phase 1110); a track's `src` is routed through the same §19 floor, and both slots are render-obligation-bearing in the way `autoplay` is — authored track order preserved, at most one `default` per kind, and the transcript rendered as a disclosure BESIDE the transport, none of which the bytes can carry. |
| `Metric` | _Display_ | `emphasis?=Normal`, `format?=None`, `icon?`, `label`, `subtext?`, `tone?=Default`, `trend?`, `trendFormat?`, `trendPolarity?=HigherIsBetter`, `value`, `weight?=Standard` |  |
| `Progress` | _Display_ | `caveat?`, `fraction`, `indeterminate?=false`, `label?`, `tone?=Default` |  |
| `Skeleton` | _Display_ | `rows` |  |
| `Sparkline` | _Display_ | `source` |  |
| `Toast` | _Display_ | `dismissable?=true`, `message`, `open`, `tone?=Default` |  |
| `Tree` | _Display_ | `expandedStateKey?`, `items`, `onSelect?`, `selectionStateKey?` | Rows are `TreeItem` records, not `Node`s, and `children` is a list of the SAME record — the format's first self-referential shape. `items` is required; a leaf omits `children` entirely. Both reader-driven behaviours are named State keys and there is no `expandable` boolean: the key IS the affordance. The slot shapes are fixed — `expandedStateKey` holds an array of row ids, `selectionStateKey` a bare row id — see §3.6.12, which also carries the render obligations (the full ARIA tree pattern, the roving tabindex and the six key bindings), none of which the bytes can carry. Item nesting is bounded on its own axis, per §21.5. |
| `Button` | _Input_ | `disabled?`, `icon?`, `label`, `onClick`, `tooltip*`, `variant` |  |
| `FileUpload` | _Input_ | `accept`, `acceptPaste?=false`, `capture?`, `destination?`, `disabled?`, `dropTarget?=false`, `label`, `multiple`, `onSelect?` |  |
| `Filters` | _Input_ | `items` |  |
| `Form` | _Input_ | `disabled?`, `fields`, `onSubmit`, `submitLabel` |  |
| `Select` | _Input_ | `disabled?`, `label`, `multiple?`, `onChange?`, `onChangeMulti?`, `placeholder?`, `source`, `value`, `values?` |  |
| `Chart` | _Visualisation_ | `dataLabels?`, `kind`, `legendPosition?`, `onPointClick?`, `source`, `stacked`, `subtitle?`, `title?`, `valueFormat?`, `xField`, `xScale?`, `xTitle?`, `yFields`, `yTitle?` |  |
| `DataGrid` | _Visualisation_ | `columns`, `defaultSort?`, `editStateKey?`, `editable?=false`, `exportable?=false`, `keepRowsTogether?=false`, `onRowClick?`, `pageSize?`, `pageStateKey?`, `reorderable?=false`, `repeatHeader?=false`, `rowKey?`, `rowKeyField?`, `sortStateKey?`, `source`, `staticRows?`, `transferInKey?`, `transferOutKey?` | The wire discriminator is `DataGrid`; the F# display tag is `Grid`. The former `Grid` collision with the CSS-grid container is resolved — that container is a `Box`. |
| `Map` | _Visualisation_ | `centreLatitude`, `centreLongitude`, `onMarkerClick?`, `source`, `zoom` |  |
| `Custom` | _Meta_ | `componentId`, `contentHash?`, `exposedNodeIds?`, `moduleId`, `props` | The host-registered escape hatch. `props` is opaque to the wire; the host renderer is a trust boundary. |
| `ErrorBoundary` | _Meta_ | `child`, `fallback` |  |
| `FragmentDecl` | _Meta_ | `body`, `effect?`, `holes?`, `name` | NOT an isolation boundary — its `body` is walked, so id uniqueness there is pre-expansion. |
| `FragmentRef` | _Meta_ | `args?`, `name` | An isolation boundary (§8.1): the referenced body is not part of the referring tree. Interior ids are namespaced by the referring node at render time. |
| `Mount` | _Meta_ | `capabilities`, `channel`, `inputs?`, `onBubble?`, `scopeId` | An isolation boundary (§8.1): the guest interior is a separate id scope, produced host-side by the guest loader and never inlined into the host document. |
| `Switch` | _Meta_ | `autoAdvanceMs?`, `cases`, `default`, `on?`, `stateKey?` | The declarative branch — `cases` are matched against `on`, `default` is taken when none matches. A `Switch` is resolved on the decoded tree, not by host code. |
<!-- /fuaran:spec-kinds -->

Every `kind.$type` is globally unique. The former `Grid` collision (a Layout grid and a Visualisation data-grid both once named `Grid`) is fully resolved: the CSS-grid container is now a **`Box`** with `layout: {"$type":"Grid",…}` (Phase 390 – see below), and the data-bound grid is **`DataGrid`** (payload `GridSpec`). This global uniqueness is what lets the wire be flat – a single discriminator unambiguously selects both the primitive and its category.

A primitive's spec fields are emitted **directly under `$type`**, with no `spec` wrapper (e.g. `Markdown` → `{"$type":"Markdown","text":…}`; `Box` → `{"$type":"Box","children":[…],"layout":…,"role":…}`). `Filters` carries an `"items"` array. The corpus is the exhaustive reference for each spec's field set – read `nodes/<id>.json` for the canonical shape of each.

#### The `Box` container (Phase 390 / 459)

The four container near-synonyms (`Stack` / `GridLayout` / `Dashboard` / `Card`) are unified into a single **`Box`** kind, whose **`layout`** names how children arrange and whose **`role`** names what the container means (driving the HTML element, ARIA landmark, and `fuaran-*` chrome). `BoxSpec` carries `children` (required), `layout` (required), `role` (required), and an optional `heading` (emitted only when `Some` – the `Card` heading), plus the two Phase 1473 print-break booleans `keepTogether` / `breakBefore`, each omitted at `false` (see "Print break control" below):

```json
{"$type":"Box","breakBefore":<bool?>,"children":[…],"heading":<TextSource?>,"keepTogether":<bool?>,"layout":{…},"role":"Group"|"Card"|"Dashboard"|"Separator"}
```

`layout` is a discriminated object:

- `{"$type":"Flex","direction":"Vertical"|"Horizontal","gap":<int?>,"wrap":<bool>}` – `gap` omitted when `None`. (`direction` + `wrap` required.)
- `{"$type":"Grid","cols":<int>,"gap":<int?>,"templateColumns":<string?>}` – `gap` / `templateColumns` omitted when `None`. (`cols` required; a `Some templateColumns` supersedes `cols`.) Fills by ROW.
- `{"$type":"Masonry","cols":<int>,"gap":<int?>}` – `gap` omitted when `None`. (`cols` required and POSITIVE; there is no `templateColumns` twin.) Fills by COLUMN — see §3.6.7, which makes the realising CSS normative.
- `{"$type":"Auto"}` – responsive auto-tile (the retired `Dashboard`'s renderer-owned behaviour; no author column count).

The four canonical corners (byte-exact): `stack` → `{layout:{$type:Flex,direction,wrap},role:"Group"}`; `gridLayout` → `{layout:{$type:Grid,cols},role:"Group"}`; `dashboard` → `{layout:{$type:Auto},role:"Dashboard"}`; `card` → `{layout:{$type:Flex,Vertical,false},heading,role:"Card"}`. See `nodes/stack-1.json`, `nodes/glayout-1.json`, `nodes/dash-empty.json`, `nodes/card-1.json`.

**Retired container tags are rejected, as are `Spacer` / `Divider`.** The four superseded container `$type` tags (`Stack` / `GridLayout` / `Dashboard` / `Card`) and the superseded `Table` tag are **hard-retired (Phase 673)**: a bare `"$type":"Stack"` is a decode error, not an upgrade. They briefly decode-upgraded to `Box` / `DataGrid` for permalink and op-stream compatibility; that seam was removed once measurement showed nothing depended on it (no persisted artefact carried the tags, and across 6,561 eval runs no model emitted one without being taught it). This restores §1.1's stated 0.2.0 posture — *retired vocabulary is a hard decode error, not a deprecation* — which the upgrade seam had quietly contradicted. The two leaf display primitives `Spacer` and `Divider` were **hard-retired (Phase 459) with no legacy seam**: `Spacer` → the container `gap`; `Divider` → a childless `Box` with `role:"Separator"` (`<hr>`/`role="separator"`; `DividerSpec.Orientation` → the box's `layout` axis, `DividerSpec.Label` → the box's `heading`). A bare `"$type":"Spacer"` / `"Divider"` is rejected (`UNKNOWN_DU_CASE`), and the corpus carries no Spacer/Divider fixtures.

#### Timed advance — the carousel behaviour on `Switch` (Phase 1122)

**One optional integer on `SwitchSpec`, omitted at absence, that says this switch is meant to MOVE
ON ITS OWN and how often.** A document that does not declare it is byte-identical to what it was
before this member existed, and behaves identically on every host.

```json
{"$type":"Switch","autoAdvanceMs":5000,"cases":[…],"default":{…},"stateKey":"slide"}
```

| Member | Says |
|---|---|
| `autoAdvanceMs` | advance to the next case every this-many milliseconds |

**It declares the one fact a host cannot recover from the tree.** Every other half of a carousel is
already composable and was before this phase: the stage is a `Box`, the panels are the `cases`, the
position is the bound key, and the arrows and dots are ordinary controls writing that key. Nothing
in any arrangement of those says a timer exists. It is the `sortStateKey` shape — a behaviour the
host performs, keyed by something only the document can name.

**A duration, never a flag.** "Advances" with no interval is not renderable: a host would have to
invent a period, and two hosts inventing different ones is exactly the divergence this corpus
exists to prevent.

**Non-positive is REFUSED, not canonicalised** (`reject/reject-switch-autoadvance-zero.json`,
`…-negative.json`, `…-fractional.json`). `0` is what an emitter reaches for to mean "off", and the
language already HAS a spelling for off — an absent key. Rewriting a zero to absence would make two
document shapes mean one thing and tell the emitter nothing about its misreading; decoding it to a
live zero-millisecond timer would be a re-render loop. This is the `Masonry.cols` ruling
(§3.3) at a second slot, and the code is the same: `WRONG_TYPE`, a number outside the slot's value
space, with a bound rather than a legal set to name back. A FRACTIONAL value is refused for a
different reason worth stating separately: the slot is an integer count, and a decoder truncating
where another rounded would leave two hosts disagreeing about a document neither refused.

**What advances, and what a conformant client owes the reader.** The advance writes the switch's
OWN selector key, so it is meaningful only where that selector is the compact `stateKey` (or the
`State` form of `on`). A switch selecting on a `Selection` / `Filter` / `Query` binding is driven by
another node, has no key of its own to move, and the declaration is inert there; the reference
host's pre-emit validator reports that shape as **FUARAN128 (Warning)**, alongside a switch carrying
fewer than two cases.

Where it IS live, a client tier that honours the interval **MUST** also, per WCAG 2.2.2
(Pause, Stop, Hide):

  1. **pause** the advance while the reader hovers the stage, holds a touch on it, or holds focus
     anywhere inside it — and resume when they let go;
  2. **stop it permanently** for the life of the mount as soon as the reader interacts with the
     stage at all. There is deliberately no resume path and no timeout back to running: a carousel
     that restarts itself drags the reader off whatever they chose to look at;
  3. **never start it** when the reader's environment reports `prefers-reduced-motion: reduce`. This
     obligation is stated here rather than left to a stylesheet because a stylesheet can suppress a
     TRANSITION and cannot suppress an ADVANCE — the content would still change under the reader,
     silently, which is the harm the preference is about.

**These are recorded normatively rather than left per-host**, and none of them is a wire member. No
gesture, threshold, event name, pause policy or resume rule appears in the vocabulary: a document
says WHAT the switch does and never HOW the reader takes it over. Swipe and the arrow keys are the
same affordance in two input modalities and are likewise renderer-owned.

**The static floor is the bound case, rendered once, with no timer.** A no-script host resolves the
selector from seeded state, renders the matching case (else the `default`), and stops. That is the
conforming answer rather than a gap: advancing means writing a state key on an interval, and a
static document has neither. Nothing about the emitted markup differs from a switch with no
interval, which is also what keeps hydration mismatch-free.

**The two transition tokens are NOT here, and that is the ruling rather than an omission.**
`Motion.CrossFade` and `Motion.SlideBetween` (Phase 1122) name what a renderer does when a `Switch`
replaces the child standing in its stage. They join the `Motion` vocabulary (§9's host-only
enumeration, listed in the enum table above) and therefore **never reach the wire at all**: motion
is consumer-authored, not AI-authored, so a between-children transition is a look the host chooses
and not a fact the document carries. The consequence for this section is exact — no fixture in this
corpus can carry either token, and neither case costs any host a codec change.

#### Print break control — subtree cohesion across a page boundary (Phase 1473)

_(How a reader REACHES a paged rendering is a separate question with a separate answer: `Action.Print`,
§3.6.14. The two are deliberately independent — these members hold whether the print was raised from a
document's own control or from the browser's menu, and a page must be correct on paper with no action
ever having fired.)_

**Four booleans, all omitted at `false`, that say which subtree must stay together when the
rendering is PAGED.** `BoxSpec` carries `keepTogether` and `breakBefore`; `DataGridSpec` carries
`keepRowsTogether` and `repeatHeader`. A document that declares none of them is byte-identical to
what it was before this vocabulary existed.

```json
{"$type":"Box","children":[…],"heading":"Totals","keepTogether":true,"layout":{…},"role":"Card"}
{"$type":"DataGrid","columns":[…],"repeatHeader":true,"rowKeyField":"line","source":{…}}
```

| Member | On | Says |
|---|---|---|
| `keepTogether` | `BoxSpec` | this container and its whole subtree stay on one page |
| `breakBefore` | `BoxSpec` | this container starts at the top of a fresh page |
| `keepRowsTogether` | `DataGridSpec` | no row of this grid is split across a page boundary |
| `repeatHeader` | `DataGridSpec` | the column headers repeat at the top of every page the grid continues onto |

**Each declares the one fact a host cannot recover from a rendering.** A formatter laying out pages
sees boxes; nothing in the rendering carries back that the three lines of a totals block are ONE
THING that reads wrong when halved, and nothing outside a grid knows where a row ends or which row
group is the header. It is the `sortStateKey` shape — a behaviour the host performs, keyed by
something only the document can name.

**No medium vocabulary is here, and none is implied.** Nothing names a page size, a margin, a sheet
number, a running header or footer, or the medium itself: the paged medium is host chrome, and a
host that has no printer at all is unaffected because every one of these is a conditional statement
about a paged rendering that may never happen. Nor is there any screen-only / print-only member —
medium-conditional content is a `Switch` over a host-supplied binding, and a medium is exactly the
kind of fact a host supplies.

**Where each member lives is a decision, not a convenience, and a host should not expect the
missing twins.** There is no `keepTogether` on `SplitPanel`, `Disclosure`, `Tabs`, `SummaryList` or
`ScrollArea`, and none on `DataGrid`: a container that must stay whole is reachable by wrapping it
in a `Box`, so those members would say something already sayable. There is likewise **no
break-AFTER member anywhere** — a break after this container is a break before the next one — and
no `breakBefore` on `DataGrid`, for the same wrapper reason. What survives on `DataGrid` is
precisely what no arrangement of existing kinds reaches.

**Omit-at-`false`, and ABSENT is the only spelling of "not declared".** For a declaration of this
shape "not stated" and "explicitly off" are the same state, so there is no third value and an
encoder MUST omit a member at `false`. **A present member of the wrong JSON kind MUST be REFUSED,
never coerced** (`WRONG_TYPE`): a document that meant `true` and wrote `"true"` would otherwise
render with its declaration silently dropped, which is exactly the split-block the member exists to
prevent. The refusals are pinned on both decoder arms the vocabulary reaches — `BoxSpec`'s and
`DataGridSpec`'s — because they are separate branches in every host and a vector on one proves
nothing about the other.

**Normative render obligations.** A conformant rendering host, given a node declaring one of these:

1. MUST scope the resulting behaviour to the **paged medium**, so a continuous (screen) rendering is
   unchanged. On an HTML surface this is a `@media print` block; on another surface, its equivalent.
   A host MUST NOT apply a repeated header group, or any other of these, to a continuous rendering.
2. MUST realise `keepTogether` as an instruction that this element's box is not fragmented
   (`break-inside: avoid`), and `breakBefore` as one that a page boundary precedes it
   (`break-before: page`).
3. MUST realise `keepRowsTogether` as the same non-fragmentation instruction applied to the grid's
   ROWS, not to the grid as a whole, and `repeatHeader` by projecting the grid's header row group as
   a repeating one (`display: table-header-group`, or the surface's equivalent).
4. MUST satisfy 1–3 **without script**. Every one of them is a formatter instruction, so a
   server-rendered page with no hydration carries the same paged behaviour as a fully interactive
   one. This is stated normatively rather than left implied because the obligation is otherwise easy
   to read as a behavioural tier a static host may defer, and there is no such tier here.
5. MUST NOT derive any other behaviour from them: not a page size, not a margin, not a running
   header, not a pagination affordance the reader can operate, and not a change to a screen
   rendering.

A host whose receiving surface has no paged medium at all satisfies 1–5 vacuously and MUST simply
carry the declarations through decode unchanged.

**Host adoption.** The reference host (`fuaran`) emits, decodes and renders all four members; every
other codec host in the §11.0 roster is **pending** until its own change-set lands, on the §11
step-5 terms. A pending host is not exempt: a document that declares none of these is unaffected,
but one that declares any decodes on a pending host with the member dropped, which is silently the
pre-1473 paged rendering.

#### Vocabulary-completion primitives (Phases 287–293)

The Wave-43 "last-10%" primitives, canonical shapes pinned by the named fixtures:

- **`Image`** (Display) – `{"$type":"Image","alt":<TextSource>,"aspectRatio"?:<ImageAspect>,"caption"?:<TextSource>,"expandable"?:<bool>,"fit"?:<ImageFit>,"loading"?:<ImageLoading>,"src":<Binding>,"srcSet"?:[<SrcSetEntry>,…],"variant":"Default"|"Avatar"|"Rounded"}`. `src` is a `Binding<string>`; the renderer routes it through the §19 URL-scheme floor – sanitisation is a render-time obligation, not a wire constraint, so a URL that fails the floor is still a valid wire document. `alt` is mandatory. Phase 1077 added the three presentation slots, each omitted-when-default on both boundaries – see §3.6.2 for their rules. Phase 1078 added `caption`, which is optional content rather than a presentation token and is omitted when absent (rule 4) – see §3.6.3. Phase 1080 added `srcSet`, a list of alternate renditions omitted when EMPTY – see §3.6.4. Phase 1079 added `expandable`, a bool omitted when `false` that declares the full asset is reachable from the rendered image – see §3.6.5 for the anchor a host MUST emit for it. See `nodes/image-1.json` (none of the five, the pre-phase shape), `nodes/image-presentation-1.json` (all three presentation slots off-default), `nodes/image-caption-1.json` / `nodes/image-caption-i18n-1.json` (the caption, `Literal` and `I18n`), and `nodes/image-srcset-1.json` (three candidates), `nodes/image-expandable-1.json` (the expansion declaration) and `nodes/image-expandable-figure-1.json` (expandable + caption + srcSet on one node).
- **`List`** (Display) – `{"$type":"List","items":[<TextSource>,…],"ordered":<bool>}`. See `nodes/list-1.json`.
- **`Divider`** – **retired (Phase 459)** into a childless `Box` with `role:"Separator"` (see "The `Box` container" above). A bare `"$type":"Divider"` is rejected (`UNKNOWN_DU_CASE`); there is no `divider-1.json` fixture.
- **`Toast`** (Display) – `{"$type":"Toast","dismissable"?:<bool>,"message":<TextSource>,"open":<Binding>,"tone"?:<ToneVariant>}`. 0.2.0: `dismissable` is omitted-when-**TRUE** (a toast is dismissable unless said otherwise – the one inverted default in §3.6's table). See `nodes/toast-1.json`.
- **`Modal`** (Layout) – `{"$type":"Modal","anchor"?:<string>,"children":[<Node>,…],"dismissable":<bool>,"heading"?:<TextSource>,"modality"?:"Modal"|"Popover","onDismiss"?:<Action>,"open":<Binding>}`. `onDismiss` is a **wire-survivable `Action`** (like `FormSpec.onSubmit` – encoded as the action value, not a `<closure>` sentinel), OPTIONAL since Phase 426: omitted, a dismissable modal falls to the write-back default (dismiss writes `false` to a writable `open` slot). `heading` omitted when `None`. `modality` selects WHICH overlay the node is and is **omitted at `"Modal"`** (Phase 1119, §3.6.11), so every document written before that release is byte-unchanged; `anchor` is a NodeId meaningful for `"Popover"` only. See `nodes/modal-1.json`, `nodes/popover-anchored-1.json` and `nodes/popover-open-1.json`.
- **`ScrollArea`** (Layout) – `{"$type":"ScrollArea","children":[<Node>,…],"orientation":"Vertical"|"Horizontal"|"Both","maxHeight"?:<int>,"maxWidth"?:<int>}`. The pixel bounds omit when `None`. See `nodes/scroll-1.json`.
- **`CodeBlock`** (Display, Phase 290) – `{"$type":"CodeBlock","code":<string>,"copyable":<bool>,"highlightLines":[<int>,…],"language":<string>,"lineNumbers":<bool>}`. All five always present (`highlightLines` is an int array, possibly empty). The parity-checked render is a **deterministic `<pre><code>`** (HTML-escaped, no markdown library) identical across all hosts + SSR; **syntax highlighting is a client-only post-hydration enhancement** that targets the `language-{x}` class – explicitly OUTSIDE the cross-host / SSR↔CSR byte-diff. See `nodes/code-1.json`.
- **`Math`** (Display, Phase 293) – `{"$type":"Math","display":"Inline"|"Block","source":<string>}`. `source` is the LaTeX string. The parity-checked render is a **deterministic escaped-source fallback** in a known container; **KaTeX is a client-only post-hydration enhancement** (targets `.fuaran-math-source`), OUTSIDE the byte-diff – the no-JS / SSR reader sees the source, the JS reader sees rendered math. Inline `$…$` math in prose is a separate client-only pass over rendered markdown (soft-coordinated with the deterministic GFM markdown renderer), same pattern. **Mermaid is NOT a node** – a host registers it via the existing `Custom` escape (heavy JS-only library, non-deterministic SVG); promote to a first-class `Diagram` node only if demand warrants. See `nodes/math-1.json`.

#### Link protection (Phase 812)

**`Link`** (Display) – `{"$type":"Link","download":<bool>,"href":<Binding>,"label":<TextSource>,"protection"?:"email","rel"?:<string>,"target"?:<string>}`.
`rel` / `target` / `protection` omit when absent. **`protection`** is an optional closed
enumeration naming an anti-scraper **render strategy** for the link; the only case is `"email"`,
which marks a `mailto:` link whose address must not appear in plaintext in emitted markup. It is a
render-strategy concern, not a content constraint: the wire carries the real `mailto:` href, and a
decoder MUST NOT alter or validate it (the §19 floor still applies at render time). Any other
`protection` value is rejected – `UNKNOWN_DU_CASE` at `$.kind.protection` (see
`reject/reject-unknown-link-protection.json`). **Render-strategy note:** a server-side /
static-markup renderer honouring `"email"` emits the sanitised href AND the label entity-encoded
per character (a working no-JS `mailto:` anchor with no plaintext address in the document source,
wrapped in the protected-link container class pair); a client renderer emits the same structure
with the decoded href – the two DOMs are identical after entity decoding. A renderer that has no
protected strategy MUST still render the link (protection is advisory to the emission strategy,
never to validity). See `nodes/link-1.json` (unprotected) and `nodes/link-protected-1.json`.

#### Drawing primitive (Phase 524)

**`Drawing`** (Display) – a bounded, typed vector-graphics primitive: the shared render target every
`Chart` lowers to and the reusable substrate for maps/diagrams. `DrawingSpec` hoists under `$type`:
`{"$type":"Drawing","shapes":[<Shape>,…],"style":<DrawStyle>,"viewBox":<ViewBox>,"title"?:<TextSource>,"description"?:<TextSource>}`.
`title`/`description` omit when `None` (the accessible name / long description the renderer emits as
`role="img"` + `<title>`/`<desc>`, Phase 525). See `nodes/drawing-1.json` (all shapes) and
`nodes/drawing-empty.json` (the degenerate empty drawing).

- **`ViewBox`** – `{"height":<number>,"minX":<number>,"minY":<number>,"width":<number>}`, the
  user-space coordinate box (SVG `viewBox` semantics). All four required, plain numbers – a `Drawing`
  is a *resolved* geometric artefact (a chart lowers to concrete coordinates), so geometry is static;
  only `DrawStyle` carries `Binding`s.
- **`DrawStyle`** – `{"fill"?:<Binding>,"opacity"?:<Binding>,"stroke"?:<Binding>,"strokeWidth"?:<Binding>,`
  `"textAnchor"?,"fontSize"?,"emphasis"?,"fontFamily"?,"rotation"?,"markId"?,"tip"?:<TextSource>}`,
  every field OPTIONAL and omitted when `None` (an all-default style is `{}`). `fill`/`stroke` are
  `Binding<string>` (colour tokens/literals); `strokeWidth`/`opacity` are `Binding<float>`. Present on
  every shape (as `style`) and on the drawing root (as `style`).
  `textAnchor`/`fontSize`/`emphasis`/`fontFamily`/`rotation` apply only to `Label` and are ignored on
  every other shape. **`tip` is the exception that applies to EVERY shape**: it is the mark's
  hover-readable text, and a renderer emits it as an SVG `<title>` element that is the FIRST CHILD of
  that shape's own element — the native browser tooltip and the element's accessible name, with no
  script, so a statically-served page carries it. A tipped shape therefore cannot be emitted
  self-closing (`<rect …><title>…</title></rect>`); an absent `tip` leaves the emitted bytes
  unchanged, self-closing tags included. An explicitly EMPTY `tip` is a present value and a distinct
  wire shape from an absent one — a host must not omit it on re-encode.
- **`DrawPoint`** – `{"x":<number>,"y":<number>}`.
- **`Shape`** – a closed, `$type`-discriminated DU. There is **no `Path` shape and no raw SVG `d`
  string** (the typed-surface guard – §5): a curve is a typed command list.
  - `{"$type":"Group","children":[<Shape>,…],"style":<DrawStyle>}` (nests shapes under a shared style)
  - `{"$type":"Rectangle","x","y","width","height","cornerRadius"?,"style"}` (`cornerRadius` omitted when `None`)
  - `{"$type":"Line","x1","y1","x2","y2","style"}`
  - `{"$type":"Polyline","points":[<DrawPoint>,…],"style"}` · `{"$type":"Polygon","points":[…],"style"}`
  - `{"$type":"Curve","commands":[<CurveCommand>,…],"style"}`
  - `{"$type":"Circle","cx","cy","r","style"}` · `{"$type":"Ellipse","cx","cy","rx","ry","style"}`
  - `{"$type":"Label","x","y","text":<TextSource>,"style"}`
- **`CurveCommand`** – a closed, typed DU (the `Path`/`d`-string replacement):
  `{"$type":"MoveTo","to":<DrawPoint>}` · `{"$type":"LineTo","to":<DrawPoint>}` ·
  `{"$type":"CubicTo","control1":<DrawPoint>,"control2":<DrawPoint>,"to":<DrawPoint>}` ·
  `{"$type":"QuadraticTo","control":<DrawPoint>,"to":<DrawPoint>}` · `{"$type":"Close"}`.
- **Default-deny by shape.** An unrecognised `Shape` or `CurveCommand` `$type` is `UNKNOWN_DU_CASE`
  (a typed defect, not a pass-through) – see `reject/reject-unknown-drawing-shape.json` and
  `reject/reject-unknown-drawing-curve-command.json`.

**`Select` multi-select (Phase 291).** `SelectSpec` gains two OPTIONAL wire fields: `"multiple":true` (emitted only when multi-select – **omitted when `false`**, so every single-select fixture is byte-identical to the pre-multi-select wire) and `"values":<Binding>` (the multi-select value binding, a `Binding<string list>`, emitted only when present). The multi-select change handler is a closure → no separate wire key (the existing `"onChange":"<closure>"` covers it). Single-select carries `value` (a `Binding<string option>`); multi-select carries `values` instead. See `nodes/multiselect-1.json` (multi) vs the byte-unchanged `nodes/select-1.json` (single). A searchable `Combobox`/autocomplete is noted as a future `Select` variant, deferred.

**Filter chips are `FormFieldKind` controls (0.2.0 filters-unification; superseding the Phase 423 `FilterKind` DU).** A `Filters` item is `{"kind":<FormFieldKind>,"label":<TextSource>,"name":<string>}` – one control vocabulary for forms and filter strips; the retired `FilterKind` discriminators (`TextFilter` / `ChoiceFilter` / `RangeFilter` / `SegmentedFilter`) are a hard `UNKNOWN_DU_CASE`. Two chip-specific rules: (a) **auto-binding** – a chip control with **no `value` key** decodes to `{"$type":"Filter","name":<the chip's own name>}` (the item's declared name IS the store key), and the encoder symmetrically **omits** a `value` that is exactly that auto binding, so the canonical minimal chip is `{"kind":{"$type":"Choice","options":…},"label":…,"name":"status"}`; (b) the Phase 423 handler mechanics carry over unchanged – an omitted `onChange` writes `$filters.<name>` through the host's filter seam, a present `"<closure>"` wins. Since **0.2.1** the synthesis is symmetric: in a **Form**, an absent `value` auto-binds `State(<field id>, <typed placeholder>)` (see the §1.1 addendum) – the context decides the store, never whether omission is legal. See `nodes/filters-1.json` / `nodes/filters-declarative.json` / `nodes/filters-segmented.json`.

**Control write-back default – optional event handlers over writable value bindings (Phase 426).** Every value-carrying event handler on the covered controls is an OPTIONAL wire field, generalising the Phase 423 filter-chip `onChange` mechanics: the `FormFieldKind` handlers (`onChange` / `onToggle`), `SelectSpec.onChange` + `onChangeMulti`, `TabsSpec.onSelect` + `onSelectTag`, `DisclosureSpec.onToggle`, and `ModalSpec.onDismiss` (the one wire-survivable `Action` in the set – the rest are `"<closure>"` sentinels). A present handler encodes exactly as before (closure → sentinel; modal action → the action value) and **wins at run time**; an omitted handler – the shape an AI author emits, and the shape every decoded handler-free control takes – arms the **write-back default**: when the control's own value binding is *directly* `{"$type":"State"}` (→ the renderer's reactive StateStore) or `{"$type":"Filter"}` (→ the FilterStore, Phase 423), the renderer writes the typed change back to that slot – text/textarea/date → string, number/ranged → number, checkbox → bool, choice/segmented/select → the chosen option (a cleared choice clears the slot), multi-select → the value list (against `values`), tabs → the clicked index (against `activeIndex`; with a populated tag overlay, the clicked tag against `activeTag`), modal → `false` on dismiss (against `open`), disclosure → the new open bool (against `open`). Any other binding shape (`Static` / `Query` / `Local` / `Format` / …) means **no write** – the FUARAN069 inert-control check warns at validate time (`Binding.Local` is exempt: its Phase 62 commit pipeline carries the change). Every pre-426 fixture is byte-unchanged (`Some` handlers keep their sentinels; `onSelectTag` / `onToggle` / `onChangeMulti` were previously never encoded and only appear for closure-authored specs). Decoders restore `Some placeholder` from a present sentinel and `None` from an absent key; the `State` binding's `defaultValue` is now decoded through the typed static parser (previously discarded for a typed placeholder – a decoded field reads its own authored default). See `nodes/form-declarative.json` + `nodes/controls-declarative.json` (handler-free) and `nodes/controls-closure.json` (the new closure-authored sentinel keys) vs the byte-unchanged `nodes/form-1.json` / `nodes/tabs-1.json` / `nodes/select-1.json` / `nodes/modal-1.json`.

**`Toast` vs `Action.Notify` – the decided split (Phase 289).** Both ship; they are complementary, not redundant. `Toast` is the **declarative, in-tree, SSR-rendered** notification surface – a real node bound to an `open` `Binding<bool>` that hydrates cleanly and participates in the overlay render-fidelity contract (§ below / `docs/SSR.md`). `Action.Notify` (a wire-survivable `Action` that carries `{channel, payload}` with no rendered node) remains the **imperative** trigger a host maps to ephemeral chrome. Reach for `Toast` when the notification is model-driven and must survive SSR + replay; reach for `Action.Notify` for fire-and-forget host chrome. Adding `Toast` did **not** change `Action.Notify`.

**Overlay + overflow render-fidelity contract (Phase 289).** `Modal` / `Toast` / `ScrollArea` are render-fidelity-sensitive, so the renderers pin an explicit SSR↔CSR contract: overlays render **inline (no React portal)**, positioned + z-indexed purely by CSS, and a closed overlay stays in the DOM behind the native `[hidden]` attribute (never an absent node). The server and client therefore emit **byte-identical class + ARIA structure** (`role="dialog"`+`aria-modal` for Modal; `role="dialog"` and **no** `aria-modal` for a `Popover`-modality Modal, per §3.6.11; `role="status"`+`aria-live="polite"` for Toast; `role="region"`+`tabindex="0"` for ScrollArea), so React hydration finds the DOM it expects with no mismatch. Focus management is an additive client-only enhancement that does not alter the hydrated DOM — and so, for the same reason and under the same rule, is a popover's anchored placement: it is applied imperatively to the mounted element rather than rendered as a `style` attribute, so the hydrated DOM is the one the static host emitted. The contract is executable in the SSR-parity corpus (Phase 142). Full narrative: `docs/SSR.md`.

#### `DataGrid` static-table mode (`staticRows`, Phase 393)

`DataGrid` carries **two** surfaces under one discriminator: the ordinary **data-bound grid**, and a
**static read-only table** selected by the OPTIONAL `staticRows` field. This is where the retired
`Table` kind's surface went (§"The `Box` container" records the retirement; `"$type":"Table"` is a
hard decode error, not an upgrade) — one tabular kind now owns both the static and the data-bound
form, so a host implements one decoder and one renderer branch instead of two primitives.

```json
{"$type":"DataGrid","columns":[],"source":{"$type":"Static","value":[]},
 "staticRows":{"defaultSort"?:{"column":<int ≥ 0>,"direction":"asc"|"desc"},
               "headers":[<TextSource>,…],"rows":[[<TextSource>,…],…],
               "sortable"?:<bool>}}
```

- **Shape.** `staticRows` is an object with exactly two REQUIRED fields: `headers`, an array of
  `TextSource`; and `rows`, an array of rows, each row an array of `TextSource` cells. A missing
  `headers` or `rows` is `MISSING_FIELD`; a non-array in either position is `TYPE_MISMATCH`. Both
  arrays may be empty. The wire does **not** constrain `rows[i]` to the length of `headers` — a
  ragged matrix decodes, and cell/header alignment is a renderer concern.
- **`TextSource` cells.** Headers and cells are full `TextSource` values, not bare strings by type —
  so the bare-string `Literal` (the canonical form since 0.2.0, §16 rule 1), `Bound`, and `I18n` all
  apply inside a static table. Localisation and binding substitution therefore reach table content;
  this is the reason the mode carries `TextSource` rather than `string`.
- **Optionality — omitted means data-bound.** `staticRows` is emitted **only when present**
  (rule 4). Every ordinary data-bound grid omits it, so the canonical bytes of a bound grid are
  exactly what they were before the mode existed. `nodes/grid-1.json` pins the omitted form;
  `nodes/table-1.json` pins the present form.
- **Mode semantics.** `staticRows` present ⇒ the node **is** a static read-only table: a conformant
  renderer emits semantic `<table>` markup from the headers and cells, and **ignores `source` and
  `columns`** entirely. The mode is **non-interactive** — no row-click surface, no editing, no cell
  kinds; a static table participates in no store write-back.
- **What `source` / `columns` carry canonically.** They remain REQUIRED fields of the spec (§13), so
  a static-mode grid still emits both, carrying the degenerate values the encoder produces for a
  table that has no data feed and no column model: `"columns":[]` and `"source"` an **empty** `Static`
  row feed, `{"$type":"Static","value":[]}` (§5 — an empty feed encodes `[]`, never `null`). Before
  Phase 665 this position carried the `"<opaque>"` sentinel instead; a decoder still accepts that
  form here, under the same indefinite read-compat rule (§5).
  An emitter authoring a static table SHOULD write exactly those two values; see
  `nodes/table-1.json`, which is the byte-exact canonical corner for the whole mode. A decoder MUST
  NOT read meaning into either field when `staticRows` is present.

##### Declared sort intent — `sortable` / `defaultSort` (Phase 801)

`staticRows` carries two further fields, both **OPTIONAL** and both emitted only when present
(rule 4). A table declaring neither is byte-identical to the pre-801 form — `nodes/table-1.json`
is the anchor for that, and `nodes/table-sortable-1.json` is the canonical corner with both present.

- **`sortable`** (`bool`) — the table **invites** interactive column sorting.

  This is a declaration of INTENT, not a behaviour guarantee, and the distinction is the point of
  putting it on the wire rather than leaving sorting to host policy. A host with no sorting
  affordance is fully conformant: it renders the authored order, and a static table is complete and
  readable without any interaction at all. A host that HAS an affordance honours the declaration with
  whatever it has — a progressive-enhancement script over the rendered `<table>`, or a grid
  component's own sorting.

  `false` is the load-bearing value. A host that enables sorting broadly (every table on every page)
  is expressing a default; a table saying `"sortable": false` is expressing a decision about its own
  content — a running order, a stepwise procedure, a ranked list whose order IS the information. The
  decision beats the default: a host MUST NOT offer sorting on a table that declares `false`, and
  SHOULD suppress the affordance markers too, so the table never advertises an interaction it will
  not perform.

- **`defaultSort`** (`{"column": <int ≥ 0>, "direction": "asc" | "desc"}`) — the table's **initial**
  order. `column` indexes `headers`.

  This is **configuration**, not a data transform, and it is deliberately distinct from the transform
  pipeline's `sort` (§3.3), which re-orders the DATA a binding resolves. `defaultSort` states a
  presentation order over rows the emitter has already written, and the authored order remains
  meaningful — a host that offers a restore-to-authored state (as the reference enhancement's
  ascending → descending → authored cycle does) MUST keep the emitter's order reachable rather than
  treating the declared sort as a state outside the cycle.

  Declaring `defaultSort` does not imply `sortable`. The two are independent: a table may arrive
  ordered by a column and still decline interactive re-sorting.

- **Rejections.** `direction` is a closed two-value set: any other string is `UNKNOWN_DU_CASE` at
  `$…staticRows.defaultSort.direction`, naming both legal values
  (`reject/reject-unknown-static-sort-direction.json`). `column` is a NON-NEGATIVE integer: a
  negative value is `WRONG_TYPE` at `$…staticRows.defaultSort.column`
  (`reject/reject-wrongtype-static-sort-column.json`). Both are expressible in `schema.json`
  (`enum` and `minimum: 0` respectively), so the two artefacts agree. Within `defaultSort` both
  fields are REQUIRED — a `defaultSort` missing either is `MISSING_FIELD`.

- **What is NOT rejected.** A `column` at or past `headers.length` decodes successfully. It is a
  relation between two sibling values, which a per-object codec does not judge — the same reasoning
  that leaves a ragged `rows[i]` to the renderer above. A host that cannot resolve the declared
  column MUST fall back to the authored order rather than guessing at one.

#### `DataGrid` behaviour declarations — the state-key rule (Phase 860 charter)

A **data-bound** grid declares the behaviours a user drives by naming the State key that carries each
behaviour's position, under one rule:

> A grid behaviour the user drives is declared as a named State key that the grid both writes and
> reads, carrying a descriptor whose shape is fixed by this specification. The affordance belongs to
> the renderer.

That the affordance is renderer-owned is a conformance obligation, not an implementation note. A tree
never carries a pager, a sort button, or any other control for these behaviours, and a host MUST NOT
require one: the node that reads the state also draws what writes it, so a control and the grid it
means to drive cannot come apart. The failure this forecloses is a document that decodes, validates
and renders while doing nothing — a control writing state no grid reads.

Every field below is OPTIONAL and emitted only when present (rule 4), so a grid declaring none is
byte-identical to the pre-860 form.

##### Sort — `sortStateKey` / `defaultSort` / per-column `sortable` (Phases 818, 861)

Three fields, one behaviour, and the whole of how they compose is one page:

- **`sortStateKey`** (`string`, on the grid) — the State key carrying
  `{"column": <int ≥ 0>, "direction": "asc" | "desc"}`. Present since 0.23.0;
  `nodes/grid-sort-state-key.json` is the canonical corner. Its presence is what makes columns
  *interactively* sortable at all.

- **`defaultSort`** (`{"column": <int ≥ 0>, "direction": "asc" | "desc"}`, on the grid) — the
  **initial** order. This is the SAME record and the SAME field name the `staticRows` spelling
  carries above, deliberately: same behaviour, same spelling, and one encoder and one decoder serve
  both paths. A negative `column` is `WRONG_TYPE` at `$…defaultSort.column`
  (`reject/reject-wrongtype-grid-default-sort-column.json`), matching `minimum: 0` in `schema.json` —
  the same posture, same message, different path.

- **`sortable`** (`bool`, on a COLUMN) — narrowing, and narrowing only. Absent **inherits**: the
  column is sortable iff it has a `field` and the grid declares `sortStateKey`. `false` opts the
  column out. `true` is the inherited default made explicit and adds nothing; where the grid declares
  no `sortStateKey`, it is a pre-emit error (`FUARAN094`) rather than a silent no-op, because a
  column that tries to turn a behaviour ON is asking for something the charter's rule does not
  grant — a flag narrows, it never widens.

**How the three compose, stated once.** The grid's sort state key holds one of three things, and the
distinction between the second and third is load-bearing:

| The key… | Order shown |
|---|---|
| is **absent** — the user has not sorted | `defaultSort`, if declared; otherwise the authored order |
| holds a **usable descriptor** | that column and direction |
| holds an object that is **not** a usable descriptor | the **authored** order — the emitter's own row order |

The third row is how the authored order stays reachable. A conformant interactive host cycles a
header **ascending → descending → authored** (the `staticRows` cycle, applied to the bound path), and
the authored state MUST be written as a present-but-empty descriptor rather than by clearing the key:
a cleared key means "not yet sorted", which would re-apply `defaultSort`, so the user would ask for
the emitter's order and be handed the declared one instead. A malformed descriptor a host seeded
lands in the same row and reads the same way — validated rather than trusted, never an arbitrary
order.

A grid may declare `defaultSort` with **no** `sortStateKey`: an initial presentation order without
interactive re-sorting, exactly as a static table may. `nodes/grid-bound-sort.json` is the canonical
corner, and carries a column opting out.

**Relation to the `staticRows` spelling.** Same field names and same semantics wherever the behaviour
is the same — `sortable` and `defaultSort` mean on the bound path what they mean on the static one.
Two differences, both from the paths themselves rather than from the vocabulary: `staticRows.sortable`
is grid-wide (a static table has no per-column model to hang a flag on) whereas the bound path's
`sortable` is per-column, which is what census row #26 asked for; and `defaultSort.column` indexes
`headers` on the static path and `columns` on the bound one, which are the two paths' respective
column sets.

##### Declarative pagination — `pageStateKey` / `pageSize` (Phase 862)

- **`pageStateKey`** (`string`) — the State key carrying `{"page": <int ≥ 1>}`, the **1-based** page
  position. The descriptor is an object rather than a bare integer so a later page-size override is
  an additive field rather than a re-typing.

  A decoder MUST NOT trust the value it finds there. A descriptor that is absent, not an object, or
  carries a `page` that is not an integer ≥ 1 reads as **page 1** — the honest default. This mirrors
  `sortStateKey`, where a malformed descriptor reads as "no sort" so the authored order stands.

- **`pageSize`** (`int ≥ 1`) — how many rows one page holds.

  A page of zero or fewer rows names no page at all, so a `pageSize` below 1 is `WRONG_TYPE` at
  `$…pageSize` (`reject/reject-wrongtype-grid-page-size-zero.json`). The bound is expressible in
  `schema.json` as `minimum: 1`, so the two artefacts agree — the same posture as
  `staticRows.defaultSort.column`'s `minimum: 0`.

- **Who slices — the source shape decides, and there is no second declaration.** If the grid's
  `source` is a `Query` whose `dependsOn` (§3.3) names the `pageStateKey`, the **host** pages: the
  query re-runs on a page change and returns the page, and the grid MUST NOT slice again. For every
  other source shape the grid resolves the whole set and slices it client-side.

  A host-paged grid cannot know the row total, so it cannot state a page count; its pager gives
  previous/next only. A declared total is not part of this version.

- **A page past the end clamps to the last page**, rather than rendering empty. The row count can
  shrink under a filter while the position stays where the user left it; an empty grid there reads as
  data loss rather than as the end of the list. Page 1 of an empty grid is "page 1 of 1", never "of 0".

- **Static hosts.** A host that cannot honour a click still performs the **slice** — it is a data
  operation the seeded State determines — and emits the pager with its steps **inert**. Omitting the
  pager entirely would drop every row past the first page with nothing to say so; emitting a live one
  would advertise an interaction the host cannot perform. A disabled control states plainly that it is
  unavailable, and the page status still tells the reader where they are.

- **`pageSize` without `pageStateKey`** decodes successfully and is inert: nothing carries the
  position, so the grid renders every row. It is a relation between two sibling fields, which a
  per-object codec does not judge — the same reasoning that leaves an out-of-range
  `defaultSort.column` to the renderer. Pre-emit validation refuses it (`FUARAN093`), which is where
  a shape that decodes but cannot work belongs.

`nodes/grid-paged.json` is the canonical corner; `nodes/grid-paged-sorted.json` pins paging and
sorting composed on one grid, which is where the one-rule claim is cashed in.

##### Editing — `editStateKey` / per-column `editable` (Phase 863)

The write side, and the one member of the family whose key is a **destination** rather than a
descriptor. Sort and page each need a small piece of view state that has nowhere else to live; an
edit's state is the data itself, which the grid already reads through `source`.

- **`editStateKey`** (`string`, on the grid) — the State key an edited cell's **whole updated rows
  value** is committed to.

  Absent, the shipped behaviour stands unchanged: the grid writes back to its own `source` when that
  source is a direct `State` binding, and is display-only otherwise. Present, it names the
  destination explicitly. That is the whole of what this field adds, and why it was needed: a
  *decoded* editable grid previously could not say where its edits land, because the only spelling
  was a host closure, which crosses the wire as `"<closure>"` and carries no destination at all.

- **`editable`** (`bool`, on a COLUMN) — narrowing, exactly as `sortable` is. Absent **inherits** the
  grid-level `editable`. `false` makes the column read-only under a grid-level `true`, which is the
  declaration that read-only-by-omission could not make. `true` under a non-editable grid is a
  pre-emit error (`FUARAN095`), the write-side twin of `FUARAN094`'s widening refusal.

- **The closure still wins.** A column whose cell kind carries a host edit closure keeps it, and the
  declared destination does not override it — the same precedence the `value` / `field` pair has
  carried since field-named columns landed. An existing closure-authored grid is byte-for-byte and
  behaviourally unchanged.

- **Rejections.** An editable column with no reachable destination — no `editStateKey`, and a
  `source` that is not a direct `State` binding — decodes successfully and is refused pre-emit
  (`FUARAN095`). It is a relation across three fields, which a per-object codec does not judge.

`nodes/grid-declared-edit.json` is the canonical corner: an editable grid with a declared
destination, a `Query` source that could not otherwise receive a write, and a third column
explicitly read-only.

##### Near-miss names are refused, not ignored (Phase 863)

Rule 2's tolerance of unknown keys has one **enumerated** exception, on `DataGrid` and its columns.
These names decode to an error naming the canonical field:

| On | Name | Canonical form |
|---|---|---|
| grid | `currentPage`, `page`, `pageIndex` | `pageStateKey` — the position lives in State as `{"page": N}` |
| grid | `sortable` | `sortStateKey` + per-column `sortable` (grid-wide `sortable` is the `staticRows` spelling) |
| grid | `onEdit` | `editStateKey` |
| grid | `behaviour`, `behavior` | the sibling behaviour fields; grid behaviour is not a nested record |
| column | `readOnly` | `editable: false` |

**Why these are refused rather than tolerated.** Tolerance is right for a field a future profile may
add; it is wrong for a name that is a near miss of one that exists, because the tree then decodes,
validates and renders while the declaration does nothing — the same fake-affordance failure the
behaviour rule exists to foreclose, arriving through a spelling mistake instead of a missing
vocabulary. A tolerated near miss is indistinguishable, from the emitter's side, from a declaration
that worked.

**Why they are refused rather than aliased.** Elsewhere this specification aliases an unambiguous
synonym (`header`/`title` for a column's `label`). These are not synonyms. `currentPage` carries a
literal page number, which the vocabulary cannot express at all — the position must be addressable by
a control. `readOnly` is the *inverse* of `editable`, and an alias that inverts a boolean makes a
read-only column editable when it guesses wrong. Refusing names the canonical form without guessing.

The set is closed and small by design: a name is admitted only where accepting it would require a
guess, or where it is a spelling this specification deliberately rejected. `schema.json` forbids each
with `not: { required: [...] }`, so the two artefacts agree, and the `reject/reject-nearmiss-*`
fixtures pin them.

#### Parameterised fragments (`holes` / `effect` / `args`)

A `FragmentDecl`/`FragmentRef` is an **artifact-function**: the decl declares typed **holes**, a ref **applies** it by binding **args**. These fields are **additive** – a zero-hole, pure-deterministic decl omits `holes`+`effect` and a zero-arg ref omits `args`, so a fixed-body fragment is byte-identical to the pre-parameterisation shape (the degenerate case).

- **`holes`** – an ordered array of `HoleDecl`, each `$type`-discriminated:
  - `{"$type":"Value","name":<string>,"space":<HoleValueSpace>,"default"?:<Scalar>}`
  - `{"$type":"Slot","name":<string>,"kindConstraint"?:<string>}`
  - `{"$type":"Repeat","name":<string>,"countSpace":<HoleValueSpace>}` – `countSpace` MUST be a bounded `IntRange` (totality).
- **`HoleValueSpace`** – `{"$type":"IntRange","min","max"}` | `{"$type":"FloatRange","min","max"}` | `{"$type":"StringLen","minLen","maxLen"}` | `{"$type":"Enum","choices":[…]}` | `{"$type":"AnyString"}`.
- **`Scalar`** (a value default or value arg) – self-describing: `{"$type":"Int","value":<int>}` | `{"$type":"Float","value":<number>}` | `{"$type":"Bool","value":<bool>}` | `{"$type":"Str","value":<string>}`.
- **`effect`** – `{"hostEffect": "Pure"|"ReadsHost"|"WritesHost", "determinism": "Deterministic"|"Clock"|"Random"|"Network"}`. Omitted when pure-deterministic.
- **`args`** – an object keyed by hole name; each value is a `FragmentArg`: a `Scalar` branch (`Int`/`Float`/`Bool`/`Str`) for a value arg, or `{"$type":"SlotArg","tree":<Node>}` for a slot subtree.

See `nodes/frag-decl-param.json` + `nodes/frag-ref-args.json` for the canonical shapes; `nodes/frag-decl-1.json` + `nodes/frag-ref-1.json` remain the degenerate fixed-body fixtures.

### 3.3 Nested DU positions

`$type`-dispatched objects also appear at every nested DU: `TextSource` (`Literal`/`Bound`/`I18n`), `Binding<'T>` (`Static`/`Query`/`Filter`/`Selection`/`State`/`Computed`/`I18n`/`Local`/`Format`/`Transform`/`Invoke`), `Action<'Msg>` (`Dispatch`/`Call`/`Notify`/`Navigate`/`SetState`/`AiTool`/`Chain`/`CommitLocal`/`WriteToClipboard`/`ReadFileBody`/`Invoke`/`Print`), `CellFormat`, `CellValue`, `ColumnWidth`, `Format`, `LocaleSource`, `FormFieldKind`, `CellKindErased`, `LocalFlushTrigger`. Each renders `{"$type":"<CaseName>", …fields}`, with two 0.2.0 exceptions: `TextSource.Literal`'s canonical form is the **bare JSON string** (the `{"$type":"Literal","text":…}` envelope stays decode-accepted and normalises down, §16), and `Action.Dispatch` renders the bare `{"$type":"Dispatch"}` (no `msg` sentinel, §4). `Action.Print` renders `{"$type":"Print"}` and is not an exception at all — it is the general rule with an empty field set, and a member beside the discriminator is refused there rather than dropped (§3.6.14). Field names and presence are pinned by the corpus.

`Binding.Transform` (Phase 282) is the declarative-compute case – a serialisable dataframe transform evaluated client-side **as data**: `{"$type":"Transform","pipeline":<array>,"source":<object>}`. `source` is a columnar data source (an embedded `{schema, columns}` table – column-oriented, a `values` array + a `validity` mask per column – or a `{schema, ref}` host-resolved named source); `pipeline` is an ordered array of `$type`-discriminated transform steps (`filter` / `project` / `derive` / `groupBy` / `join` / `window` / `pivot` / `unpivot` / `sort` / `distinct` / `limit` / `union`, each over a scalar `ColExpr` algebra). Both sub-trees are `Fuaran.Core` values serialised in **this same canonical discipline** (§2), so they splice in byte-stably; their detailed per-step shape is owned and conformance-certified by `Fuaran.Core`'s own codec, and the schema (§13) describes them structurally (array / object) rather than re-deriving the full algebra – the same "don't constrain content the host doesn't decompose" posture as an opaque `Static.value` (§5). The case is constrained to the **row-feed** binding at a data-bearing node (`DataGrid` / `Chart` / `Metric`): the host evaluates the pipeline and the result rows resolve as the node's source, in the same row shape §5 defines for a literal feed. See `nodes/grid-transform.json` for the canonical shape.

**`Binding.Transform` params (Phase 424).** The Transform binding gains an OPTIONAL `params` field: `"params":[{"from":<Binding>,"name":<string>},…]`, each entry binding a `ColExpr.param` name the pipeline references (a `{"$type":"param","name":…}` scalar expression, `fuaran-core#77`) to a scalar `Binding` source (`Filter` / `State` / `Static` / `Selection`). **Omitted when empty**, so a param-free Transform is byte-identical to the Phase 282 wire. The host resolves each param to a `Cell`, prunes any `filter` step whose params are unbound (an unset choice filter ⇒ no constraint – the one lenient UI rule), and evaluates the pipeline in that env – so a `filter` step comparing a `col` to a `param` scopes the rows by a live filter/state value, the declarative-data twin of `Query.dependsOn`. The filter→consumer edge is *derived* from the pipeline's params, never separately declared. See `nodes/grid-transform-param.json` (a filter param from a chip) vs the byte-unchanged `nodes/grid-transform.json`.

**LIST-valued `Binding.Transform` params (Phase 610).** A `params` entry is not restricted to a scalar source. Where the pipeline reads the name through the membership test's `param` form – `{"$type":"in","expr":<ColExpr>,"param":"<name>"}`, the `in` spelling that carries `param` in place of `items` – the entry is a **list param**, and its `from` binding resolves to a JSON **array** of scalars. A list param resolves by **substitution**, not through the evaluation env: the host rewrites each `in`/`param` occurrence to the literal `in`/`items` form before evaluating, exactly as `fuaran-core#91` specifies, so a pipeline reaching the evaluator with an `in`/`param` still in it names an unbound param and is a strict error rather than a silent pass. An **EMPTY selection is UNBOUND**, never `items: []`: the dependent `filter` step prunes under the same lenient "unset ⇒ no constraint" rule an unset scalar chip already gets, so deselecting everything shows the **unfiltered** table rather than an empty one. One rule covers both param kinds because a substituted step names no param at all, while an unsubstituted one still names its own – the prune is derived from the pipeline's params either way, and the reactivity edge with it. The canonical chip wiring is a `Select` with `"multiple":true` whose `values` binding names a filter and whose `onChangeMulti` is omitted (the write-back stores the selection there), with the param's `from` naming that same filter: the shared name is the whole wiring. See `nodes/multiselect-chip-list-param.json`.

**Host adoption of the list-param wiring.** Recorded here rather than inferred, on the §11.0 convention: the wire form is decoded by every codec host that decodes `ColExpr` (it is Core vocabulary, not a new node kind), but *resolving* a list param — substitution, the empty-selection prune, and the reactivity edge — is host-side and adopted per host. A host that has not adopted is **not thereby exempt**; it owes the behaviour and has simply not made its answer visible.

| Host | List-param resolution |
|---|---|
| `fuaran` (F#) | **adopted** – substitution + empty-selection prune in the shared Transform frame, on both the .NET and Fable pipelines |
| `fuaran-ts` | **adopted** – the same two rules in the renderer's binding resolver, mirrored from the same specification rather than ported from the F# source |
| `fuaran-py` | **adopted** – substitution + the empty-selection prune in the compute-layer host resolver, carried through the server-HTML renderer and the reactive loop; mirrored from this specification rather than ported from another host's source |
| `fuaran-go` | **adopted** – substitution + the empty-selection prune in the static-emission path, resolved at render time; the reactivity edge is not this host's (it holds no UI session state) |
| `fuaran-rs` | **adopted** – the same two rules in the shared Transform frame seam, on both the server and `wasm32`-client paths (one evaluator, certified on both targets by execution against the same fixture) |
| `fuaran-swift` | **inherited** – a decode-only render projection over the `fuaran-rs` core, which resolves the pipeline and hands back rows; it drives none itself, so it has nothing of its own to adopt. Were it ever to drive one, the obligation would be its own |
| `fuaran-kt` | **inherited** – as above |

A pending host is **unchanged, not broken**: a tree carrying no list param behaves exactly as before, and a tree carrying one reports an unbound param loudly. What such a host cannot say is that it has adopted. An **inherited** host makes a claim about the host it inherits from: it obtains resolved rows from that host and drives no pipeline of its own, so its conformance is that host's. Were it ever to drive one, the obligation would become its own.

**`Binding.Query` dependency edge (Phase 421).** The Query binding gains an OPTIONAL `dependsOn` field: `"dependsOn":["status","date-range"]`, a string array naming the **filters** that scope this host-computed consumer. **Omitted when empty**; the degenerate canonical `Query` is `{"$type":"Query","name":…}` (0.2.0 – the `accessor` sentinel is off the wire, §4). The tree owns the dependency *edge* (so the AI can author it, the validator sees it, the op-stream replays it – restoring symmetry with `Binding.Selection`); the host accessor closure still owns *how* it filters – **no predicate language enters the tree** (that is `Transform.params`, Phase 424, for declarative data). On a filter-store change, a renderer re-resolves every `Query` whose `dependsOn` names the changed filter. Note the paired **decoded-accessor fix**: a decoded `Query` accessor is now an identity projection (F# `unbox`, TS `(raw) => raw`), so a host-populated `queryResults.<name>` value flows through decoded trees (previously it was discarded). See `nodes/query-dependson.json`.

**`Action.Call` result target (Phase 428).** The `Call` action's `onResult` closure is OPTIONAL on the wire (present → the `"<closure>"` sentinel, byte-identical to before; the closure wins at run time), and the case gains an optional declarative **result target**: `"into":{"$type":"State","key":…}` (the response lands in the reactive `$state.<key>` slot – `Binding.State` readers re-render) or `{"$type":"Query","name":…}` (the response lands in the `queryResults` slot `<name>` – `Binding.Query` readers re-render, data-preserving per the Phase 421 identity accessor). Both omitted is a fire-and-forget command call (FUARAN073 warns). A failed / undecodable call never reaches the target – the host's `Call` implementation surfaces it (the default browser host warns) and the slot stays unwritten, so readers keep their `onLoading` surface. The endpoint set + the default-deny dispatch gate are unchanged – `into` adds no new capability, only a destination. Canonical shape: `{"$type":"Call","endpoint":…,"into"?:…,"onResult"?:"<closure>"}`. See `nodes/call-into.json` (closure / into-State / into-Query side by side).

`Binding.Invoke` / `Action.Invoke` (Phase 283) are the invocable-capability cases – the binding dispatches a host-registered compute capability for a value, the action for an effect: `{"$type":"Invoke","args":[{"addr":<string>,"value":<string>}…],"capabilityId":<string>}`. `capabilityId` references a capability the host registry enumerates (the compute analogue of node-introspection); `args` are scalar `(addr, value)` pairs the host validates against the capability's signature before dispatch (default-deny by shape). **The body is never on the wire** – only the typed declaration + this invocation. A `Binding.Invoke`'s value is async (a `Deferred`) and renders through the existing `StateBehaviour` surface (`onLoading` until ready, `onError` on failure) – no new node concept, no `Deferred` wire DU. A non-deterministic invocation's realized value is journaled through the determinism-capture seam for exact replay.

`FormFieldKind.Date` (Phase 288) is the date/time field case: `{"$type":"Date","onChange"?:"<closure>","value":<Binding>,"variant":"Date"|"Time"|"DateTime","min"?:<string>,"max"?:<string>,"step"?:<number>}` (`onChange` optional per Phase 426). `value` is a `Binding<string>` carrying an ISO-8601 string (`YYYY-MM-DD` / `HH:MM` / `YYYY-MM-DDTHH:MM` per `variant`); `min` / `max` are ISO strings and `step` is in seconds – all three optional, omitted when `None` (rule 4), mirroring `RangedNumber`. See `nodes/form-date.json`.

**`Binding.Filter.defaultValue` (0.2.0).** The Filter binding gains an OPTIONAL `defaultValue`: `{"$type":"Filter","defaultValue"?:<typed static>,"name":<string>}`. It is the value the resolver yields – and the renderer seeds the filter store with – **before the filter is first written** (the pre-selected-filter gap: "default to the last 30 days"). The payload is typed via the slot's own static encoding (the same seam as `State.defaultValue`, Phase 429); omitted, behaviour is exactly pre-0.2.0 (`NotResolved` until written). A chip's auto binding (see the filters-unification note above) is `Filter(name)` with **no** default – a chip whose control carries an explicit `value` binding with a `defaultValue` keeps that `value` on the wire (the omission rule keys on the exact auto shape).

**`FormFieldKind.Range` (0.2.0)** is the dual-thumb numeric range control (absorbing the retired `FilterKind.RangeFilter`): `{"$type":"Range","onChange"?:"<closure>","value":<Binding<float*float>>,"min"?:<number>,"max"?:<number>,"step"?:<number>}`. A `Static` pair rides as the **bare** `{"max":<number>,"min":<number>}` object – no `Static` envelope (the Phase 423 range shape, kept as the canonical bytes); a decoder also accepts the `[min,max]` two-element array leniently (the §3.6 bare-array coercion) and the enveloped form. In a filter context the `value` may be omitted per the auto-binding rule. `min`/`max`/`step` bounds are omitted when absent (rule 4).

**`FormFieldKind.DateRange` (0.7.0)** is the single-control date range – `Range`'s pair mechanics with `Date`'s value conventions: `{"$type":"DateRange","onChange"?:"<closure>","value":<Binding<string*string>>,"variant":"Date"|"Time"|"DateTime","min"?:<string>,"max"?:<string>,"step"?:<number>}`. The pair is `(from, to)`, each an ISO-8601 string in the `variant`'s shape (`YYYY-MM-DD` / `HH:MM` / `YYYY-MM-DDTHH:MM`), and it is **ordered**: a *literal* pair whose `from` sorts after its `to` is a decode error (`WRONG_TYPE` at the `value` path, with a message naming the rule – see `reject/reject-daterange-unordered.json`). Same-variant ISO-8601 strings compare lexicographically in chronological order, so the check is an ordinal string compare – no date parsing, no locale, total for every variant. A bound pair is not checked; its ordering is a runtime concern.

A `Static` pair rides as the **bare** `{"from":<iso>,"to":<iso>}` object – no `Static` envelope, exactly the `Range` posture above; a decoder also accepts the `[from,to]` two-element array leniently (the §3.6 bare-array coercion, `lenient/lenient-daterange-bare-array.json`) and the enveloped form (`lenient/lenient-daterange-static-envelope.json`). `variant` is always emitted; `min` / `max` (ISO strings) and `step` (seconds) bound **both** ends and are omitted when absent (rule 4), mirroring `RangedNumber`. In a filter context the `value` may be omitted per the auto-binding rule, and the pair then binds **one** filter param, not two – the reason the case exists rather than two coordinated `Date` fields. See `nodes/form-date-range.json` (all three variants + bound combinations) and `nodes/filters-date-range.json` (the auto-bound chip).

**`FormField.rule` (Phase 864)** is a field's declared constraint — the **accepted set**, where `FormFieldKind` names the **control**. It is an OPTIONAL field on the `FormField` spec record, not a case in any discriminator family, so a form authored before it encodes byte-identically and a host that has never met it decodes the rest of the field unchanged: `{"id":…,"kind":…,"label":…,"required":…,"help"?:…,"rule"?:<FieldRule>}`. `FieldRule` is `{"compare"?:<CompareRule>,"format"?:"email"|"url"|"tel","maxLength"?:<int>,"message"?:<TextSource>,"minLength"?:<int>,"pattern"?:<string>}`, every slot optional; `CompareRule` is `{"against":<Binding>,"op":"eq"|"neq"|"lt"|"lte"|"gt"|"gte"}`, both required. `pattern` carries ECMA-262 source with HTML `pattern` semantics — implicitly anchored to the whole value — so the browser, a static projection and a native surface agree without a second definition.

**The rule slot carries NO numeric or temporal bound, deliberately.** `RangedNumber` already carries `min`/`max` and `Date`/`DateRange` already carry theirs; a rule never duplicates a bound its control already holds, because two sources for one bound are free to disagree. `compare` does not duplicate them either, and the reason is exactly that its operand is a **`Binding`** where theirs is a literal — which is the whole cross-field mechanism rather than an accident of typing. Any read slot may take a `Binding`, and a form field with no `value` already auto-binds `State(<its own id>)`, so `{"$type":"State","key":"<sibling field id>"}` reads a sibling with no addressing vocabulary of its own. Six operators, one operand, and deliberately nothing else: no boolean combinators, no arithmetic, no nesting, no expression language. Ordering is borrowed wholesale from `DateRange` above — same-variant ISO-8601 strings compare lexicographically in chronological order, so a date comparison is an ordinal string compare with no parsing and no locale; numbers compare numerically. **A comparison between values of different shapes is UNMET, not an error**: a half-filled form is a normal state.

Three shapes are **decode errors**, each a relation between slots rather than a shape, which is why none is expressible in the structural schema. A `rule` present with every constraint slot absent is `WRONG_TYPE` at the `…rule` path — a rule that constrains nothing is a defect and not a no-op, and `message` alone does not rescue it, since a message is the prose shown when some *other* slot is unmet (`reject/reject-fieldrule-empty.json`). A `minLength` above its `maxLength` is `WRONG_TYPE` at the same path — the `DateRange` ordered-pair rule applied to a length pair, where an inverted bound admits no value at all (`reject/reject-fieldrule-length-unordered.json`). And `validation` / `constraints` / `validate` on a `FormField` are refused **by name** at `…<key>`, pointing at `rule` — the enumerated near-miss narrowing of rule 2, which is right for a field a future profile may add and wrong for a near miss of one that exists, because the tree would otherwise decode and render while the constraint did nothing (`reject/reject-formfield-near-miss-validation.json`). See `nodes/form-field-rules.json` for the round trip.

**What a declared rule OBLIGES (normative, and split by host class).** Stated as a semantic invariant rather than DOM or byte parity, on the §22 pattern and for the §22.2 reason: two hosts marking an invalid field differently is not a conformance failure, and two hosts disagreeing about whether the form *submits* is.

| Host class | Obligation |
|---|---|
| **Codec host** | MUST round-trip the rule byte-identically. Always, and this is the only unconditional one. |
| **Rendering host** — any host drawing a form's submit affordance | MUST NOT submit that form while a declared rule is unmet, and MUST make visible which field is unmet. |
| **Static / SSR emitter** | MUST project the rule into the platform's own constraint attributes (`type`, `pattern`, `minlength`, `maxlength`) so the platform enforces it. Where the platform has no equivalent — `compare` has none in HTML — the emitter MUST record it as a known limit rather than implying coverage. |

**This is not a security boundary, and the specification says so out loud.** Client enforcement is an affordance, not a gate: a hostile client bypasses HTML5 validation trivially, and a host that accepts submissions MUST re-check every declared constraint server-side. Nothing above claims otherwise, and a host that reads it as a trust floor has read it wrong.

**Three PRE-EMIT refusals name this slot, and they are named here for the reason the grid sub-sections name theirs.** The three decode errors above are relations between slots *within* one field; these three are relations between a rule and the rest of the tree, which no decoder can see and no structural schema can express — so an emitter that only round-trips will pass every check above and still emit a field that reads as constrained and is not. They belong to the pre-emit tier, alongside `FUARAN094`/`FUARAN095`, and a host declaring the pre-emit tier declares them in its `validator/` coverage.

- **`FUARAN099`** (Error) — a `compare` whose `against` reads a state key **no field in the form owns and nothing in the tree writes**. The predicate can then be neither met nor unmet, only absent, so the field is decorated with a constraint that can never fire. Point `against` at a sibling field's id — a form field's value lives in `State` under its own id — or give the key a writer.
- **`FUARAN100`** (Warning) — a rule slot **the control cannot honour**: a `pattern` or `format` on a `Checkbox`, a length bound on a control with no text. The constraint is carried and never applied. Warning rather than Error because "cannot honour" is a statement about the reference control set, and a host with a richer control may honour it.
- **`FUARAN101`** (Warning) — a `compare` against a **literal** duplicating a bound the control already declares. This is the "no numeric or temporal bound" rule two paragraphs up, made checkable: two sources for one bound, free to disagree, with nothing deciding which wins.

The vocabulary of record is `validator/defect-vocabulary.json`; this section names the three because a reader arriving at `rule` from the form side would otherwise meet only the decode errors and conclude the slot is fully specified by them.

`Binding.Format` (Phase 102) is the locale-aware formatted-value case: `{"$type":"Format","format":<Format>,"locale":<LocaleSource>,"source":<Binding>}`. `source` is always a numeric `Binding<float>`; the case produces a display string (constrained to `Binding<string>` use). `Format` is a `$type`-DU – `Number` (optional `decimals` integer), `Currency` (`isoCode` string), `Percent` (optional `decimals` integer), `Date` (`dateStyle` bare-enum), `RelativeTime` (`unit` bare-enum). `LocaleSource` is a `$type`-DU – `Ambient` (no fields; defers to the host locale) or `Explicit` (`tag` BCP-47 string). `Number` / `Percent` omit `decimals` when `None` (rule 4).

### 3.4 `TreeOp` discriminators (top-level `$type`)

For `decodeOp`, the document's own `$type` is the op kind: `EditNode`, `UpdateProp`, `ReplaceBinding`, `UpdateStyle`, `UpdateState`, `InsertChild`, `RemoveNode`, `MoveNode`, `ReorderChildren`, `ReplaceRoot`, `Batch`. See `ops/*.json` for each shape. `ReplaceRoot` carries `"node": <Node>` – the whole new tree; it is the only op that legally changes the root node id (a whole-app swap, vs. a `Batch` of remove/insert). `Batch` carries `"ops": [ <TreeOp>, … ]` (recursive).


**Membership and order are separate ops (0.4.0).** `InsertChild` and `MoveNode` change which children
a parent has, and **both append**; `ReorderChildren` states the order by naming ids. Placing a node
anywhere but last is `Batch [InsertChild …, ReorderChildren …]`.

```jsonc
{"$type":"InsertChild","child":{…},"parentId":"grid"}   // appends
{"$type":"MoveNode","newParentId":"grid","target":"card"} // appends under the new parent
```

These two ops previously carried an integer `position` / `newPosition`. **The rule that removed it:
where a collection's members have identity, they are addressed by it.** Every node has an id, every
other op addresses by one, and `ReorderChildren` already stated order that way — so the ordinal was
the one place the structural surface departed from the tree's own identity model. It also named
something the tree does not store: children are a list, so order is structural and no index exists in
the state. An index is therefore a projection over that list, meaningful only against one snapshot of
it and silently wrong after any preceding or concurrent edit, where a wrong id fails loudly.

**This does not apply to contained data.** `Columns[i]`, `Fields[i]`, `TabHeaders[i]`, `YFields[i]`
and the like stay positional: those are bounded payload collections inside one node, not tree
structure, and their items have no identity to address. An ordinal is legitimate exactly where
identity is absent.

**The field is GONE, not deprecated.** A conformant decoder MUST REFUSE `position` on `InsertChild`
and `newPosition` on `MoveNode`, naming the field: `WRONG_TYPE` at `$.position` / `$.newPosition`.
The refusal is BY NAME and is the enumerated-near-miss narrowing of §2 rule 2 — a genuinely unknown
key is still tolerated, because a slot a future profile may add must stay addable. See
`reject/reject-op-insertchild-retired-position.json` and
`reject/reject-op-movenode-retired-newposition.json`.

There was a **migration window**, and how it closed is worth stating because it is not the obvious
thing. While it stood, a decoder accepted and ignored the field so a stored v1 emission still applied
— as an append — and the hosts could adopt independently. But *silence was the whole mechanism*:
these decoders read named fields and ignore the rest, so **not reading it** was the tolerance. There
was never a read to delete, and a host that merely stopped mentioning the field would have gone on
accepting it forever, indistinguishably from one that had never adopted. Closing the window is
therefore an act of ADDING a refusal, not removing an acceptance.

That asymmetry is the reason the window was gated on evidence rather than on a date, and the reason
the refusal must name the field rather than fall through to a generic unknown-key error. An ordinal
that is ignored does not fail — the op decodes, applies, and puts the node somewhere other than where
the author asked. A wrong id fails loudly; a stale index succeeds quietly. Refusing by name is what
converts the second into the first.

#### `UpdateProp.path` grammar – nested addressing (Phase 364)

`UpdateProp` carries `"path"` as a plain JSON string at codec level – the codec does **not** validate
the grammar (any string decodes; grammar violations surface at **apply** time as structured
`ApplyError`s, never at decode time). The grammar every conformant *apply engine* implements:

```
path     := segment ( "." segment )*
segment  := field ( "[" index "]" )?
field    := [A-Za-z_][A-Za-z0-9_]*        ; a spec-record field name (PascalCase, the §4b vocabulary)
index    := "0" | [1-9][0-9]*             ; 0-based decimal, no sign, no leading zeros
```

Semantics: segments resolve left-to-right against the target node's spec record through **per-kind
typed traversal** (no reflection – each kind's dispatch table declares its nested legs). `field[i]`
indexes a list-typed field; an indexed segment may itself be the leaf when the list's elements are
scalars (`YFields[1]` sets the second y-field string). The applied value gets the same type-checking
a top-level path gets.

**List addressing is positional-only (`[i]`) – decided.** The sub-node lists this grammar exists for
(`Columns`, `TabHeaders`, `Fields`, `YFields`) carry no element identity, and the only
identity-bearing lists (`Children`-like lists of `Node`) are already addressable directly: a child
node is targeted by its own `NodeId` via any node-targeted op, so id-keyed list addressing would add
no reach. An id-keyed form (e.g. `Children[#some-id]`) is **reserved syntax** – a `#` in an index
position is `PathInvalid` today and MUST NOT be given another meaning by a host.

**The v1 nested surface** (typed-traversal legs; everything else that is grammatically valid but
untraversable surfaces `PathNotSupportedYet` with the kind's supported paths in the hint):

| Kind | Nested path | Leaf type (value shape) |
|---|---|---|
| `DataGrid` | `Columns[i].Label` | string |
| `DataGrid` | `Columns[i].Field` | string – Phase 425, the row property projected to the cell; optional, sibling of the `value` closure (closure wins when both present) |
| `DataGrid` | `RowKeyField` | string – Phase 425, the row property for stable row identity; optional, sibling of the `rowKey` closure |
| `DataGrid` | `Columns[i].Format` | `CellFormat` (`$type` object) |
| `DataGrid` | `Columns[i].Width` | `ColumnWidth` (`$type` object) |
| `Chart` | `YFields[i]` | string (indexed scalar leaf) |
| `Tabs` | `TabHeaders[i].Label` | `TextSource` (`$type` object) |
| `Tabs` | `TabHeaders[i].Disabled` | `Binding<bool>` (`$type` object; installs `Some`) |
| `Tabs` | `TabHeaders[i].Icon` | `IconSource` (raw string; installs `Some`) |
| `Form` | `Fields[i].Label` | `TextSource` (`$type` object) |
| `Form` | `Fields[i].Required` | bool |
| `Form` | `Fields[i].Help` | `TextSource` (`$type` object; installs `Some`) |

Closure-bearing sub-fields (`Columns[i].Value`, `Columns[i].Kind`, `Fields[i].Kind`, …) are not
addressable – same posture as every closure slot (§4). `Children`-list edits stay with the
structural ops (`InsertChild` / `RemoveNode` / `MoveNode` / `ReorderChildren`); `Children[i]…` paths
are deliberately not traversed.

**Apply-time error mapping** (codes per `ERROR_CODES.md`; every hint enumerates the alternatives at
the failing segment so an AI consumer recovers in one turn):

| Failure | Code | Hint carries |
|---|---|---|
| malformed syntax (empty segment, bad index literal, missing `]`, reserved `#`) | `PathInvalid` | the grammar + the kind's nested-path patterns |
| list segment without an index (`Columns.Label`) | `PathInvalid` | the indexed form (`Columns[i].…`) + valid index range |
| unknown root / leaf field at any segment | `FieldNotFound` | the available fields / sub-paths **at that segment** |
| index outside `0 ≤ i < list.Length` | `PositionOutOfRange` | the valid index range |
| grammatically valid but no typed-traversal leg | `PathNotSupportedYet` | the kind's supported top-level fields + nested patterns |
| value doesn't coerce to the leaf's type | `KindMismatch` | the expected-type detail |

**Codec round-trip note.** This grammar changes no wire shape (the `path` was always a string), so
the profile stays `core@1.0` (§15). The op's `value` payload is a **structured JSON position**
(rule 12): an object-valued `UpdateProp` value (a `$type` object such as a `CellFormat`) decodes
structurally, *applies* correctly, and re-encodes **byte-identically** – object-valued nested ops
round-trip like every other fixture. (Historical note: pre-`PropValue` the F# encoder collapsed
object values to `"<opaque>"` on re-encode; that defect is closed, and object-valued round-trip
fixtures now pin the faithful behaviour.)

### 3.5 Bare-string enums

These DUs encode as a **bare JSON string** (not a `$type` object), matching the renderer's emission.
Each is a **closed** vocabulary: the list below is exhaustive, and an unrecognised string is
`UNKNOWN_DU_CASE` at that path (e.g. `tone: "Magenta"`).

> **This list is generated** from [`idl.json`](idl.json) (§13) and must not be hand-edited — see
> [§12.2](#122-generated-tables-in-this-document).

<!-- fuaran:spec-enums -->
- `BadgeVariant`: `"Neutral"` / `"Brand"` / `"Success"` / `"Warning"` / `"Critical"` / `"Info"`
- `BoxRole`: `"Dashboard"` / `"Card"` / `"Group"` / `"Separator"`
- `ButtonVariant`: `"Primary"` / `"Secondary"` / `"Tertiary"` / `"Destructive"`
- `CaptureSource`: `"Camera"` / `"Microphone"`
- `ChannelDirection`: `"OutOnly"` / `"TwoWay"`
- `ChartDataLabels`: `"Off"` / `"Ends"`
- `ChartKind`: `"Line"` / `"Bar"` / `"Area"` / `"Pie"` / `"Scatter"` / `"Heatmap"`
- `ChartLegendPosition`: `"Top"` / `"Right"` / `"Bottom"` / `"None"`
- `ChartXScale`: `"Category"` / `"Temporal"`
- `CompareOp`: `"eq"` / `"neq"` / `"lt"` / `"lte"` / `"gt"` / `"gte"`
- `DateStyle` (inside `Format.Date.dateStyle`): `"Short"` / `"Medium"` / `"Long"` / `"Full"`
- `DateVariant`: `"Date"` / `"Time"` / `"DateTime"`
- `DeterminismSource`: `"Deterministic"` / `"Clock"` / `"Random"` / `"Network"`
- `DurationStyle`: `"Compact"` / `"Clock"` / `"Long"`
- `DurationUnit`: `"Seconds"` / `"Minutes"` / `"Hours"`
- `EmbedPermission`: `"AllowScripts"` / `"AllowSameOrigin"` / `"AllowForms"` / `"AllowFullscreen"`
- `Emphasis`: `"Quiet"` / `"Normal"` / `"Loud"`
- `FileReadEncoding` (inside `Action.ReadFileBody.encoding`): `"Text"` / `"Base64"` / `"DataUrl"`
- `FontVoice`: `"Default"` / `"Display"` / `"Structural"`
- `HashStrictness` (inside `Custom.contentHash.strictness`): `"StrictReplay"` / `"AdvisoryWarning"` / `"Enforced"`
- `HeadingVariant`: `"Standard"` / `"Eyebrow"` / `"Caption"` / `"Lead"`
- `HostEffect`: `"Pure"` / `"ReadsHost"` / `"WritesHost"`
- `IconSize`: `"Small"` / `"Medium"` / `"Large"`
- `ImageAspect`: `"Natural"` / `"Square"` / `"FourThree"` / `"ThreeTwo"` / `"SixteenNine"`
- `ImageFit`: `"Natural"` / `"Cover"` / `"Contain"`
- `ImageLoading`: `"Eager"` / `"Lazy"`
- `ImageVariant`: `"Default"` / `"Avatar"` / `"Rounded"`
- `LinkProtection`: `"email"`
- `LiveRegionKind`: `"polite"` / `"assertive"` / `"off"`
- `MathDisplay`: `"Inline"` / `"Block"`
- `ModalityKind`: `"Modal"` / `"Popover"`
- `Motion` (a closed vocabulary that never reaches the wire — `Node.motion` is host-only, §9): `"None"` / `"PulseDuringLoad"` / `"FadeInOnMount"` / `"SlideInFromBelow"` / `"ShakeOnError"` / `"RotateOnRefresh"` / `"SlideInFromRight"` / `"ExpandCollapse"` / `"CrossFade"` / `"SlideBetween"`
- `Orientation`: `"Vertical"` / `"Horizontal"`
- `RelativeTimeUnit` (inside `Format.RelativeTime.unit`): `"Second"` / `"Minute"` / `"Hour"` / `"Day"` / `"Week"` / `"Month"` / `"Year"`
- `ScrollOrientation`: `"Vertical"` / `"Horizontal"` / `"Both"`
- `SortDirection`: `"asc"` / `"desc"`
- `StyleRole`: `"None"` / `"Eyebrow"` / `"Data"` / `"Lede"` / `"Caption"`
- `StyleWeight`: `"Compact"` / `"Standard"` / `"Spacious"`
- `TextAnchor`: `"Start"` / `"Middle"` / `"End"`
- `TextDirection`: `"auto"` / `"ltr"` / `"rtl"`
- `TextFormat`: `"email"` / `"url"` / `"tel"`
- `ToneVariant`: `"Default"` / `"Subdued"` / `"Brand"` / `"Success"` / `"Warning"` / `"Critical"` / `"Info"`
- `TrackKind`: `"Subtitles"` / `"Captions"` / `"Descriptions"` / `"Chapters"`
- `TrendPolarity`: `"HigherIsBetter"` / `"LowerIsBetter"`
<!-- /fuaran:spec-enums -->

One bare-string slot is deliberately **absent** from that list, because it is not a closed
vocabulary and the IDL does not model it as one: **`AriaRole`** encodes the raw ARIA string
(`"button"`, `"link"`, `"dialog"`, …; `AriaRole.Custom raw` emits `raw`), so no enumeration of it
could be exhaustive and none is attempted here.

### 3.6 Stylistic fields – omitted-when-default + lenient-ingest (Phase 460)

The stylistic slots on the spec decoders – `format` (`CellFormat`), `tone` (`ToneVariant`),
`weight` (`StyleWeight`), `emphasis` (`Emphasis`), and `width` (`ColumnWidth`) – are
**omitted-when-default on the decode boundary**: an absent field restores its identity default,
exactly as `role`/`voice` do inside `SemanticStyle` (Phase 147). This is the required-vs-omittable
seam of the Phase 426/430 declarative-floor doctrine, applied to *style* instead of behaviour: an
emission carrying only the semantic fields (`label`, `value`, `kind`) is a complete, valid tree.

**Identity-default table** (absent ⇒ this value; a present explicit-default value keeps decoding,
read-compat):

> **This table is generated** from [`idl.json`](idl.json) (§13) and must not be hand-edited — see
> [§12.2](#122-generated-tables-in-this-document). It is the **exhaustive** set of omitted-when-default
> fields across every kind, record, union case and op: a field with an identity default that is not
> listed here does not exist.

<!-- fuaran:spec-omit-defaults -->
| Field | Type | Identity default | Sites | Notes |
|---|---|---|---|---|
| `acceptPaste` | `bool` | `false` | `FileUploadSpec` |  |
| `allowFreeText` | `bool` | `false` | `FormFieldKind.Combobox` |  |
| `allowFreeText` | `bool` | `true` | `FormFieldKind.Tokens` |  |
| `allowHalf` | `bool` | `false` | `FormFieldKind.Rating` |  |
| `aspectRatio` | `ImageAspect` | `Natural` | `EmbedSpec`, `ImageSpec` |  |
| `autoplay` | `bool` | `false` | `MediaKind.Video` |  |
| `breakBefore` | `bool` | `false` | `BoxSpec` |  |
| `children` | `TreeItem[]` | `[]` | `TreeItem` |  |
| `controls` | `bool` | `true` | `MediaSpec` | Omit-when-TRUE. A media element without a transport cannot be paused, seeked or muted, so the accessible setting is what a document gets for free and taking it away is what costs a key. |
| `default` | `ToneVariant` | `Default` | `CellKindErased.TonedPill` | The tone for a value the `map` does not mention. |
| `default` | `bool` | `false` | `TrackEntry` |  |
| `direction` | `TextDirection` | `Auto` | `SemanticStyle` |  |
| `dismissable` | `bool` | `false` | `CalloutSpec` |  |
| `dismissable` | `bool` | `true` | `ToastSpec` | Omit-when-TRUE: a toast is dismissable unless said otherwise. Note the polarity is the FIELD's, not the type's — `Callout.dismissable` is the same name and the same type omitted at FALSE. |
| `dropTarget` | `bool` | `false` | `FileUploadSpec` |  |
| `editable` | `bool` | `false` | `DataGridSpec` |  |
| `emphasis` | `Emphasis` | `Normal` | `MetricSpec`, `SemanticStyle` |  |
| `emphasis` | `bool` | `false` | `FactSpec`, `LabelValueRowSpec` | The behavioural bool, not the `Emphasis` style DU — a different field that shares a name. |
| `expandable` | `bool` | `false` | `ImageSpec` |  |
| `exportable` | `bool` | `false` | `DataGridSpec` |  |
| `fit` | `ImageFit` | `Natural` | `ImageSpec` |  |
| `format` | `CellFormat` | `None` | `ColumnErased`, `LabelValueRowSpec`, `MetricSpec` |  |
| `indeterminate` | `bool` | `false` | `ProgressSpec` |  |
| `keepRowsTogether` | `bool` | `false` | `DataGridSpec` |  |
| `keepTogether` | `bool` | `false` | `BoxSpec` |  |
| `loading` | `ImageLoading` | `Eager` | `ImageSpec` |  |
| `loop` | `bool` | `false` | `MediaSpec` |  |
| `modality` | `ModalityKind` | `Modal` | `ModalSpec` |  |
| `orientation` | `Orientation` | `Horizontal` | `TabsSpec` | `TabsSpec` only. `FormFieldKind.SegmentedChoice.orientation` is REQUIRED and is not in this table: its decoder restores `Horizontal` when the field is absent (a §16 lenient-ingest accept), but the encoder always emits it, so the omitted form is not canonical there. |
| `permissions` | `EmbedPermission[]` | `[]` | `EmbedSpec` |  |
| `reorderable` | `bool` | `false` | `DataGridSpec` |  |
| `repeatHeader` | `bool` | `false` | `DataGridSpec` |  |
| `role` | `StyleRole` | `None` | `SemanticStyle` |  |
| `size` | `IconSize` | `Medium` | `IconSpec` |  |
| `srcSet` | `SrcSetEntry[]` | `[]` | `ImageSpec` |  |
| `tone` | `ToneVariant` | `Default` | `CalloutSpec`, `FactSpec`, `IconSpec`, `MetricSpec`, `ProgressSpec`, `SemanticStyle`, `ToastSpec` |  |
| `tracks` | `TrackEntry[]` | `[]` | `MediaSpec` |  |
| `trendPolarity` | `TrendPolarity` | `HigherIsBetter` | `MetricSpec` |  |
| `voice` | `FontVoice` | `Default` | `SemanticStyle` |  |
| `weight` | `StyleWeight` | `Standard` | `MetricSpec`, `SemanticStyle` |  |
| `width` | `ColumnWidth` | `Auto` | `ColumnErased` |  |
<!-- /fuaran:spec-omit-defaults -->

`CellFormat`'s own per-case payloads (`Currency.code`, `Date.format`, `SignificantDigits.digits`)
stay **required** – only the parent *field* is omittable, never a DU payload. Note the table carries
`emphasis` **twice**, at two different types: the `Emphasis` style DU (`MetricSpec`, `SemanticStyle`)
and a behavioural **bool** on `FactSpec` / `LabelValueRowSpec`. Both are omitted-when-default; they are
different fields that share a name, which is why the generated table keys on the field *and* its
default rather than on the name alone.

> **Scope note (symmetric omit-when-default).** The seam is symmetric on both boundaries: a
> conformant **decoder** restores the identity default when the field is absent, and a conformant
> **encoder** omits the field at its identity default – a default-styled tree round-trips minimal,
> and the corpus fixtures pin the omitted form as the canonical bytes. Input carrying an explicit
> identity default still decodes (read-compat) but re-encodes to the omitted form, so it is a
> lenient-accept normalisation case (§16), never a round-trip fixture. `SchemaGen` marks these
> fields optional.

**Lenient-ingest aliases (decode-only; never encoded).** A curated set of common synonyms decode to
the canonical case (a re-encode always normalises back to the canonical name, and `SchemaGen` stays
strict-canonical – aliases never appear in the schema or the conformance corpus):

| DU | Alias in | Canonical |
|---|---|---|
| `ToneVariant` | `Positive` | `Success` |
| `ToneVariant` | `Danger`, `Negative` | `Critical` |
| `ToneVariant` | `Neutral` | `Default` |
| `Emphasis` | `Strong`, `Bold` | `Loud` |
| `Emphasis` | `Subtle`, `Muted` | `Quiet` |

`StyleWeight` is **deliberately not aliased**: `Bold`/`Heavy` is font-weight intent, but the language's
`Compact | Standard | Spacious` means layout **density** – any mapping would silently misread the
author. With `weight` omitted-when-default and the vocabulary documented, a model that doesn't know
the cases simply omits the field (the correct outcome); an unknown case still fails loudly with the
`UNKNOWN_DU_CASE` expected-case list.

**2026-07-17 additions** (same law; observed authoring data from the Kimi/GPT smokes):

| DU | Alias in | Canonical |
|---|---|---|
| `HeadingVariant` | `Default` | `Standard` |
| `BadgeVariant` | `Default` | `Neutral` |
| `BadgeVariant` | `Danger` | `Critical` |
| `ButtonVariant` | `Danger` | `Destructive` |
| `Orientation` | `Row`, `row` | `Horizontal` |
| `Orientation` | `Column`, `column` | `Vertical` |

`HeadingVariant`'s other observed guesses (`Title`, `Page`, `Section`) stay rejects – their mapping
is ambiguous (`Standard`? `Lead`?), so an alias would guess the author's intent.

**Lenient-ingest FIELD-NAME aliases (decode-only; 2026-07-17).** The same law extended from enum
values to field names, driven by observed authoring data (a model emitting `Navigate` wrote the
destination under `href` – the dominant web name for the concept – twice, identically). An alias is
admitted only when the foreign name denotes the **same concept at the same semantics**; a name that
betrays a *different* concept is refused (`Progress.value`/`percent` vs `fraction`: the 0–100 prior
would silently mis-scale by 100×). The canonical name wins when both are present; re-encode always
normalises to the canonical name. Pinned cross-host by the `lenient/lenient-alias-*` fixtures:

| Site | Alias in | Canonical |
|---|---|---|
| `Action.Navigate` | `href`, `url`, `to` | `route` |
| `Action.Call` | `url` | `endpoint` |
| `Binding.Query` | `deps`, `dependencies` | `dependsOn` |
| `Binding.State` | `initialValue`, `default` | `defaultValue` |
| `MetricSpec` / `LabelValueRowSpec` | `data` | `value` – 0.2.0 rename law (scalar=`value`, collection=`source`); the retired `source` name is a hard error, NOT an alias (pre-launch clean break) |
| `SparklineSpec` / `ChartSpec` | `data` | `source` |
| `SelectSpec` | `options`, `data` | `source` |
| `GridSpec` (DataGrid) | `data`, `rows` | `source` |
| `MapSpec` | `data`, `markers` | `source` |
| `Grid` layout | `columns` | `cols` |
| `ColumnErased` | `type` | `kind` |
| `ColumnErased` | `header`, `title` | `label` |
| form field | `name` | `id` |
| `Box` / `Modal` / `Disclosure` / `SummaryList` / `Callout` | `title` | `heading` |
| `CellKindErased.TonedPill` | `toneMap`, `tones` | `map` – 2026-07-30 (Phase 750); `map` is the shortest honest name for a value→tone dictionary and the least descriptive |

(`title` is scoped: `Chart.title` and `Drawing.title` are *real canonical fields* and take no alias.)

The **enum-value** aliases above apply inside a `TonedPill`'s `map` values and its `default` exactly
as they do at a `tone` field (`Danger`→`Critical`, `Positive`→`Success`, `Neutral`→`Default`) – the map
values are an ordinary `ToneVariant` position, and a host that read them through a second, private
tone reader would diverge. Pinned by `lenient/lenient-tonedpill-tone-aliases`.

**Lenient-ingest SHAPE coercions (decode-only; 2026-07-17).** The same admission law extended from
*names* to *structure*, driven by observed authoring data (two independent models emitted a choice
chip's options as a bare string array, omitting both the `Binding` envelope and the option
objects). A shape is coerced only when the foreign shape can denote **exactly one** canonical value:

| Site | Coerced shape | Canonical |
|---|---|---|
| any `Binding<'T>` slot | bare JSON **array** | `{"$type":"Static","value": <array>}` – every Binding case is a `$type`-discriminated object, so an array can only mean `Static` (covers `options: ["A","B"]`, the HTML select prior, and `data: [1,2,3]`, the Chart.js prior) |
| any `Binding<'T>` slot | bare JSON **scalar** (string / number / bool) | `{"$type":"Static","value": <scalar>}` – same unambiguity as the array rule (extended 2026-07-17 second wave on launch-eval evidence: `fraction: 0.9`, `activeStep: 1`) |
| plain-value field (`Progress.indeterminate`) | `{"$type":"Static","value": v}` **envelope** | the bare value `v` – the INVERSE confusion (models wrap plain fields); unwrap is unambiguous |
| `SelectOption` element | bare JSON **string** `"A"` | `{"label":"A","value":"A"}` (the HTML `<select>` prior; label canonicalises as the 0.2.0 bare-string Literal) |
| `Transform.params` | name→binding **map** `{"status": <Binding>}` | `[{"name":"status","from": <Binding>}]` – params are a NAME-KEYED SET (`ColExpr.Param` lookup), so object key order carries no meaning; also `value` aliases `from` at the element |
| `Grid` layout with **no** `cols`/`columns`/`templateColumns` | `{"$type":"Grid"}` | `{"$type":"Auto"}` – the CSS auto-grid prior maps to the language's existing responsive auto-tile layout (accept-and-canonicalise) |
| embedded `Transform` source with **no** `schema` | `{"columns":{…}}` | the explicit-schema form – column types INFER deterministically from the cells (all-int→int, any fractional→float, all-bool→bool, all-string→string; NEVER date/timestamp; empty/mixed → didactic reject). Authority: the Fuaran.Core columnar codec (fuaran-core#88); 2026-07-18 |
| embedded `Transform` source column as a bare **array** | `"amount": [100, 200]` | `{"values":[…],"validity":[true,…]}` – the just-the-data prior; the wire has no JSON null, so a bare array can only mean all-present. Same authority; 2026-07-18 |
| embedded `Transform` **source slot** carrying a `State`/`Static`/`Bound` binding **envelope** | `{"$type":"State","defaultValue":[…],"key":…}` | the wrapped data itself – the envelope unwraps to its `defaultValue` (else `value`) BEFORE the columnar decode (initial-snapshot semantics; a LIVE state-sourced Transform is deliberately future charter work, not this). **A wrapper carrying NEITHER payload member is ACCEPTED since fuaran#1085**: `{"$type":"State","key":k}` in a Transform's source slot is a LIVE source over the EMPTY initial snapshot, exactly as a `Selection` / `Query` source already was. It used to refuse downstream (`reject/reject-transform-source-empty-wrapper`, retired), which was correct while nothing else could fill the slot; under §24.4 a SIBLING reader's declaration fills it, so the refusal was rejecting the most direct spelling of "I read this key and carry no data of my own" — the spelling `FUARAN106`'s own remedy text tells an author to write, and the one the shared-data-source charter's pair was written in. A default-less source that nothing seeds and nothing writes therefore derives over an empty table; that silent zero is named at authoring time by `FUARAN105`, where the key and the remedy can be named, and not at render time where neither can. **An EMPTY array payload (`"defaultValue": []`) is the EMPTY TABLE, not a malformed one** — an initially-empty live collection ("count the requests in an empty log") is a complete intent with zero rows and no columns to infer, and it is the spelling a live source used for "I read this key and carry no data of my own" while the bare wrapper was still refused. The two spellings are ONE dialect now and decode to the same live source; each still re-encodes to its own bytes, so neither is normalised into the other. Since §24.4 that spelling is what lets a Transform derive over a slot a SIBLING reader seeds; it declares nothing itself. Read this way by the reference host since 0.23.1, unspecified until fuaran#1075 and therefore refused by a second conformant host for a year — the divergence a rule stated on one implementation and not in the format always eventually produces. Pinned by `nodes/shared-source-seeded-pair`, which keeps the `[]` spelling deliberately: the corpus is a shared gate and the bare form's polyglot adoption is later work, so respelling it here would redden a host that decodes it today. Observed cross-family in the Tier-D pilot (claude, gemini, kimi). Pinned by `lenient/lenient-transform-source-state-rows`. fuaran#815; 2026-08-13; empty-payload rule fuaran#1075, 2026-08-27 |
| embedded `Transform` source as **row-major** rows | `[{"dept":"ops","amount":100},…]` | the canonical columnar `{"columns":{…}}` – transposed with the FIRST row's key set (sorted), absent cells null; ragged / mixed-type rows still refuse didactically downstream. Pinned by `lenient/lenient-transform-source-rowmajor`. fuaran#815; 2026-08-13 |
| grid column `kind` tagged `{"$type":"Pill"}` **carrying** `map` / `toneMap` / `tones` | `{"$type":"Pill","field":"status","map":{…}}` | `{"$type":"TonedPill","field":"status","map":{…}}` – "pill" is the word for the thing, so the declarative tone rule arrives under the closure case's tag. Unambiguous: a closure `Pill` carries only `labelFn`/`toneFn` and can never carry a tone map. **This coercion prevents silent data loss**, not merely a parse failure: before Phase 750 the extra keys were accepted and DISCARDED, so the author's whole intent vanished with no error at any host. 2026-07-30 |

Refused, per the law: the value→label **map** form (`"options": {"A":"Alpha"}`) – JSON object key
order IS meaningful for a displayed option list (contrast `params`, a keyed set, where the map is
admitted); a bare **object without `$type`** in a Binding slot – more plausibly a mistyped binding
than a `Static` value; and `null` in a Binding slot (ambiguous with absent). Pinned cross-host by
`lenient/lenient-shape-*` fixtures.

This table is a decoder obligation – it says what is **accepted**, not which form to write. For which
of these forms an *author* should emit, see §16.1 (Emitter preference).

**The `Fact` kind (same date).** The complementary kind the same evidence demanded: a labeled
TEXT fact (`{"$type":"Fact","label":…,"value":…}` – "Patient: Alice Smith"). `Metric` stays
numeric-only by design (widening it would leave `trend`/`format` semantically dead for text);
`Fact.value` is a `TextSource`, so static / `Bound` / `I18n` values ride the label vocabulary.
New-kind wire posture: only `label` + `value` required; `tone`/`emphasis` omitted-when-default on
BOTH boundaries; optional `help`/`icon`. Pinned by `nodes/fact-1` + `lenient-fact-explicit-defaults`.

**Didactic type errors (same date).** A decode error at a type boundary models systematically
cross now NAMES the right kind: a text value in `Metric.value` appends "a labeled TEXT fact
belongs in `Fact`". Rationale: the launch eval's repair-pass showed one-turn repairs convert at
70–80% when the error signal is actionable, and 38/115 Metric-string failures were repair-proof
against the bare "expected JSON number" – the error channel is part of the language's teaching
surface, not just its rejection surface.

Same date, the omitted-when-default posture (the identity-default table above) extended to the
segmented `orientation` field on **`SegmentedChoice`** (forms and, post-unification, filter chips):
absent ⇒ `Horizontal` (the language default and the universal segmented-control prior; observed
omitted in eval emission data). **This one is asymmetric, and the asymmetry is the point:** the
DECODER restores `Horizontal` when the field is absent, but the ENCODER always emits it on
`SegmentedChoice`, so the omitted form is a §16 lenient-ingest accept there and **not** the canonical
bytes — `lenient/lenient-shape-segmented-orientation-omitted.expected.json` carries
`"orientation":"Horizontal"`. `Tabs` IS encoder-symmetric and appears in the identity-default table
above; `SegmentedChoice` does not, because its field is required on the emit side. (This paragraph
claimed the symmetry for both until the generated table disagreed with it — Phase 699.) The legacy
`Stack` `orientation` stays required (no default is neutral there: vertical and horizontal stacks are
both common).

### 3.6.1 `tone` and `trendPolarity` — the composition rule (Phase 867)

`Metric` carries two slots that both look like judgements about a number, and the whole reason
`trendPolarity` exists is that they are not the same judgement. Stated once, normatively:

> **`tone` says how the reading STANDS. `trendPolarity` says which way the quantity IMPROVES. They
> are never the same statement, and a host never derives one from the other.**
>
> 1. `tone` colours the **metric tile**, exactly as it did before this field existed. Nothing about
>    `trendPolarity` reaches it.
> 2. A host computes the trend's **sentiment** from the resolved trend and the declared polarity
>    alone: `sentiment = sign(trend) × polarity`, where `HigherIsBetter` is `+1` and `LowerIsBetter`
>    is `−1`. A positive product is an improvement, a negative product a regression, a zero trend
>    neither.
> 3. The sentiment is rendered on the **trend element only**, through its own hook. The numeric text
>    — including its sign — is **unchanged** by polarity: a −7.34% trend prints −7.34% under either
>    declaration. Polarity changes how the number READS, never what it SAYS.
> 4. An absent `trendPolarity` is `HigherIsBetter`. An absent `trend` makes the slot inert — a
>    `Metric` with no `trend` that declares a polarity is legal, and says nothing.
> 5. **`Neutral` is RESERVED, not admitted.** The vocabulary is exactly
>    `HigherIsBetter | LowerIsBetter`; a document naming `"Neutral"` is a decode error —
>    `UNKNOWN_DU_CASE` at the `trendPolarity` slot (a bare enum, so the path carries no `.$type`
>    suffix; §6) — refused exactly like a name nobody has ever proposed. The reservation is **not**
>    distinguished at the wire, and a host MUST NOT alias it onto a canonical case or read it as the
>    default: a silent `HigherIsBetter` would give a document a reading its author did not write, and
>    a hint that advertised `Neutral` would tell an author to emit a spelling the format refuses.
>    Admitting the case later must be an ADDITION, never a re-meaning of shipped bytes.

Three consequences, each ruling out a spelling someone will otherwise propose.

**It never negates the value.** The cheap trick — let the emitter flip the sign so up is always good
— is refused by clause 3. A −7.34% error rate printed as +7.34% is a false statement about the world,
and the format would be manufacturing it.

**It never writes to `tone`.** A host that inferred "trend is an improvement ⇒ tile is `Success`"
would re-create in the render the exact conflation the slot was added to remove, and would override
an emitter's deliberate `Critical` on a metric improving from a bad place. `nodes/metric-inverted-polarity.json`
pins that pair on one node: `"tone":"Warning"` with a falling trend under `"trendPolarity":"LowerIsBetter"`,
which is the case a single `tone` slot could never express.

**It is total and it is local.** Sentiment is a function of two things the host already has at render
time. It needs no second binding, no cross-node coordination, and no state.

Sentiment carried by **colour alone fails WCAG 1.4.1**, so a rendering host owes a non-colour channel
for it. That obligation is a §22-class semantic invariant rather than a byte contract — the reference
renderers discharge it with a sentiment glyph carrying an `aria-label`, and a native surface may
discharge it differently — but discharging it somehow is not optional.

### 3.6.2 `Image` presentation — `fit`, `aspectRatio` and `loading` (Phase 1077)

`Image` carries three presentation slots beside `variant`. All three are omitted-when-default on
**both** boundaries (they are in §3.6's identity-default table), so a document written before they
existed decodes to today's behaviour and re-encodes to the bytes it already had — the untouched
`nodes/image-1.json` fixture is that claim's proof rather than a restatement of it.

| Slot | Vocabulary | Absent means | What it declares |
|---|---|---|---|
| `fit` | `Natural` / `Cover` / `Contain` | `Natural` | how the decoded pixels fill the box the layout gives the element |
| `aspectRatio` | `Natural` / `Square` / `FourThree` / `ThreeTwo` / `SixteenNine` | `Natural` | the box the element reserves **before** the image arrives |
| `loading` | `Eager` / `Lazy` | `Eager` | whether the browser fetches during initial load or defers until the element nears the viewport |

Four rules, each ruling out a spelling someone will otherwise propose.

**They are TOKENS, never CSS values.** `aspectRatio` names one of four ratios; it does not carry a
number, a pair, or the stylesheet spelling (`"16 / 9"`, `"16:9"`, `1.7778`). A rendering host maps
each token to a class it owns — the reference renderers emit
`fuaran-image-aspect-{square|four-three|three-two|sixteen-nine}` and
`fuaran-image-fit-{cover|contain}`, and emit **no** class for `Natural` on either axis. Admitting
an arbitrary ratio would put an author-supplied value in a style attribute, which is the free-form
escape this format does not have and which the `ImageVariant` precedent already refused. The
`reject/reject-unknown-image-aspect` fixture pins the refusal, at the bare slot with no `.$type`
suffix (§6).

**`aspectRatio` is a LAYOUT reservation, not a crop.** Declaring it says only how much space the
box occupies before the bytes land; what happens to pixels that do not match the box is `fit`'s
statement, and a host derives neither from the other. The two read as a pair in practice and are
independently declarable in the format, because a host stylesheet may size the element some other
way.

**The reservation is a CSS-only obligation.** A conformant rendering host must hold the space
without script and therefore without hydration — which is what makes the declaration worth anything
in server-rendered output, where the layout settles once and nothing below the image moves when it
loads. It is a §22-class semantic invariant rather than a byte contract: a native surface may
reserve the box its own way.

**`Eager` is the default deliberately, and it is not the "unoptimised" value.** Deferring an
above-the-fold image is a regression — it delays the largest contentful paint rather than helping
it — and only the author knows where the image sits. So the format declines to guess: `Eager` emits
no attribute at all and leaves the browser's own default in place, while `Lazy` is a positive
declaration (the reference renderers emit `loading="lazy"`). A host MUST NOT infer laziness from
position, viewport, or anything else the tree does not say.

### 3.6.3 `Image.caption` — the figure binding (Phase 1078)

`Image` carries a fourth optional slot, `caption`, and it sits in this section for adjacency rather
than membership: it is **not** an identity default and is **not** in §3.6's table. A caption is
CONTENT. There is no default caption the way there is a default fit, so the field takes the ordinary
optional-field posture — omitted from the wire when absent (rule 4), present when authored.

```json
{"id":"image-caption-1","kind":{"$type":"Image","alt":"Fishing boats moored at first light","caption":"The harbour at dawn, 1908. Oil on canvas.","src":{"$type":"Static","value":"/harbour.jpg"},"variant":"Default"}}
```

Three rules.

**It is a `TextSource`, not a string.** Every case of the DU rides the slot, so a caption is
i18n-capable on exactly the terms `alt`, a heading, or any other authored text is — there is no
caption-specific resolution path and no caption-specific shorthand. This is the rule a second host
is most likely to break, because a caption reads like a string and narrowing the slot costs nothing
until somebody needs a locale. `nodes/image-caption-i18n-1.json` carries an `I18n` caption with a
populated arg bag, and `lenient/lenient-image-caption-envelope.json` pins the enveloped
`{"$type":"Literal","text":…}` input canonicalising to the bare string, both on this slot
specifically.

**Present, it means `<figure>` / `<figcaption>` — and that is a §22-class semantic invariant, not a
byte contract.** The claim a rendering host must honour is the BINDING: the caption is presented as
the image's caption, so an assistive technology announces the two together rather than reading the
text as the next paragraph — which is precisely what an ad-hoc sibling text node could never say.
On an HTML host that is `<figure>` wrapping the `<img>` with the resolved text in a `<figcaption>`
(the reference renderers add `fuaran-image-figure` and `fuaran-image-figure-caption`); a native
surface expresses the same binding its own way. Nothing else moves: the accessibility projection,
the sanitised `src` and any egress marker stay on the element they describe.

**Absent, there is no wrapper at all.** Not an empty `<figure>`, not a wrapper with an empty
caption — the emission is the bare `<img>` a pre-1078 document always produced, byte for byte.
`nodes/image-1.json` carries no `caption` and was not touched by the phase, which is that claim's
proof on the wire side.

Why a slot on `ImageSpec` rather than a `Figure` node kind: a captioned image is one thing an author
declares, not two things an author must remember to associate, and the association is exactly what
was missing. A wrapper kind would also admit captioned *anything*, which is a strictly larger
vocabulary question than the one this slot answers — if that demand arrives, it arrives as its own
proposal against §3's kind-admission bar, not as this field widened.

### 3.6.4 `Image.srcSet` — responsive candidate sources (Phase 1080)

`Image` carries a fifth optional slot, `srcSet`: a list of alternate renditions of the SAME picture
at declared intrinsic pixel widths, from which a client picks one. Unlike `caption` it **is** an
omit-at-default field and **is** in §3.6's table — but its identity is the **empty list**, not a
token:

```json
{"id":"image-srcset-1","kind":{"$type":"Image","alt":"Fishing boats moored at first light","src":{"$type":"Static","value":"/harbour.jpg"},"srcSet":[{"src":{"$type":"Static","value":"/harbour-1600.jpg"},"width":1600},{"src":{"$type":"Static","value":"/harbour-800.jpg"},"width":800},{"src":{"$type":"Static","value":"/harbour-400.jpg"},"width":400}],"variant":"Default"}}
```

Each entry is a `SrcSetEntry` — `{"src":<Binding<string>>,"width":<positive integer>}` — with both
members required *within* the entry.

Five rules.

**Absent MEANS the empty list, and `null` is refused.** This is the missing-list-field decode class,
and it is stated here rather than left to each host's reading because it is the single most likely
cross-host divergence in this slot: a decoder that answers `null`, `undefined`, or `None` for an
absent `srcSet` has produced a value its own encoder cannot round-trip. An absent slot and an empty
one denote the SAME document, so a host MUST decode absence to the empty list and MUST omit an empty
list on encode. A present `"srcSet":null` is a REJECT (`WRONG_TYPE` at `$.kind.srcSet`): absence
already has a spelling, and admitting a second would let two conformant hosts emit different
canonical bytes for one document. `lenient/lenient-image-empty-srcset.json` pins the encode
direction (an explicit `[]` canonicalising to the omitted form) and
`reject/reject-image-srcset-null.json` the refusal.

**`width` is a POSITIVE integer, and the floor is a decode rule.** It is the `w` descriptor a client
selects on. Zero and negative values are a REJECT (`WRONG_TYPE` at `$.kind.srcSet[<i>].width`, naming
the entry by index), and zero is refused as firmly as a negative on purpose: a `0w` candidate is not
a small image, it is one a client can never select, so admitting it would let the wire state a
rendition no host can render. The published `schema.json` says the same thing as `minimum: 1`.
`reject/reject-image-srcset-nonpositive-width.json` puts a well-formed entry first so the error path
has to identify the second.

**The ARRAY ORDER is the author's, and a codec MUST NOT re-sort it.** A JSON array is ordered data;
canonicalisation sorts object KEYS (§2) and never array elements. A host that sorted on encode would
emit bytes differing from what it decoded, breaking round-trip identity for every document whose
author did not happen to write the entries in that order. `nodes/image-srcset-1.json` is authored
DESCENDING by width precisely so a re-sorting codec fails it.

**Presentation order is the RENDERER's, and it is ascending by width.** The wire preserves authored
order; a rendering host that emits an HTML `srcset` attribute orders the candidates ascending by
width so its output is canonical for a given tree. The two rules are not in tension — they answer
different questions, and putting the sort in the renderer is what lets both be true.

**Every entry's `src` passes the §19 URL-scheme floor exactly as the primary `src` does.** A srcset
candidate is a URL a client fetches with no user act — the same class as the primary source, and
therefore the same obligation; a slot that skipped the floor would be a documented way around it. A
candidate that fails the floor is **dropped from the emitted candidate list** rather than emitted in
neutered form: the primary `src` must exist so it collapses to the blank/refusal URL, but a candidate
has no such obligation, and offering a client a rendition guaranteed to fail is worse than offering
it one fewer. The primary `src` remains the fallback the whole mechanism rests on. As with the
primary source this is a RENDER-time obligation and not a wire constraint — a document carrying a
candidate that fails the floor is still a valid wire document.

A host that ignores `srcSet` entirely is still conformant as a RENDERER: `src` is the rendition every
host can serve, and the slot names an optimisation. It is not optional as a CODEC — the round-trip,
the reject vectors and the absent-means-empty rule bind every conformant host.

Why widths and not device-pixel-ratio descriptors or per-entry media conditions: those are
alternative candidate-selection algebras, and a list mixing them is one a browser refuses outright,
so admitting either alongside `w` would let the wire state a document no host can render. A media
condition would additionally put a free-form CSS string on the wire, which is the escape §3.6.2's
token vocabularies exist to close. The `sizes` attribute an HTML host emits is therefore bounded and
host-chosen, never author-supplied.

### 3.6.5 `Image.expandable` — the declared expansion (Phase 1079)

`Image` carries a sixth optional slot, `expandable`: a plain bool, `false` by default and omitted
from the wire at that default. It is the only slot on the record that declares an INTERACTION rather
than a picture.

```json
{"id":"image-expandable-1","kind":{"$type":"Image","alt":"Fishing boats moored at first light","expandable":true,"src":{"$type":"Static","value":"/harbour.jpg"},"variant":"Default"}}
```

What it declares is that **the full-size asset is reachable from the rendered image** — not that a
lightbox appears. The distinction is the whole of the design, and the rules follow from it.

**The rendered baseline is a REAL LINK, and this is a normative render obligation.** A rendering host
that honours `expandable` MUST wrap the image element in an ordinary anchor whose target is the
resolved primary `src`, and MUST mark that anchor so an enhancement tier can find it. On an HTML host
that is:

```html
<a class="fuaran-image-expand" href="{the sanitised src}" data-fuaran-expandable>
  <img class="fuaran-image" src="{the sanitised src}" alt="…">
</a>
```

The marker attribute is VALUELESS, because the slot is a bool whose `false` is the absence of the
attribute — there is no second value for it to carry. A host that emitted a scripted control instead
of a link, or a marked-up element with no navigable target, would be conformant to nothing: the
declaration would render as a dead affordance for every reader without JavaScript, which is a crawler,
a text browser, a locked-down client, and every reader whose hydration has not finished yet. The
overlay is a REFINEMENT of a working link, never the mechanism.

**A `src` the render-time URL floor refused emits NO anchor.** This is §3.6.4's dropped-candidate rule
turned on the affordance. The `<img>`'s `src` must exist, so a refused URL collapses to the blank /
refusal substitute; an anchor has no such obligation, and a link to `about:blank` is exactly the dead
control the rule above forbids. The image still renders, carrying its refusal marker, and the reader
is simply not offered an expansion that could not work. As with `src` and the `srcSet` candidates this
is a RENDER-time obligation and not a wire constraint — a document declaring `expandable` over a URL
that fails the floor is still a valid wire document.

**Nothing crosses the dispatch gate.** `expandable` declares no `Action`, adds no handler slot and
reaches no closure-bearing position (§4). It is presentation: the wire says the asset is reachable,
the anchor makes it reachable, and where the picture opens is a rendering choice. That is why the slot
is a bool and not, say, an `Action` — an `Action` would make every expandable image a dispatch site
and put a host's interaction policy in the path of looking at a photograph.

**The overlay, where a host provides one, is a DIALOG.** A host that upgrades the anchor in place owes
the reader the same contract a declarative `Modal` node owes: `role="dialog"` + `aria-modal="true"`,
a focus trap, `Escape` to dismiss, and focus restored to the element that opened it. The upgrade is
CLIENT-ONLY and sits outside every parity comparison — no renderer emits it, exactly as no renderer
emits syntax highlighting or KaTeX output (§3.2 `CodeBlock` / `Math`). A host that ships no
enhancement is fully conformant; its readers get the link.

**Composition with the other five slots**, because this is the slot most likely to be read in
isolation:

- With `caption` (§3.6.3): the `<figure>` wraps the ANCHOR, so the emission nests
  `figure > a > img` with the `<figcaption>` as the anchor's sibling. The caption is deliberately
  OUTSIDE the link target — it is prose a reader selects, quotes and reads, not a second click
  surface, and putting interactive content inside the element whose job is to LABEL the image
  inverts the relationship `<figure>`/`<figcaption>` exists to express.
- With `srcSet` (§3.6.4): the candidates are renditions of the THUMBNAIL, sized for the layout box,
  and stay on the `<img>`. The anchor's target is the primary `src` — the full asset. A host that put
  a candidate behind the link would satisfy every structural check and defeat the feature: the reader
  would click a thumbnail and be shown a thumbnail.
- With `fit` / `aspectRatio` / `loading` (§3.6.2): orthogonal. They describe the thumbnail's box and
  are unchanged by the anchor around it.

`nodes/image-expandable-1.json` pins the declaration alone;
`nodes/image-expandable-figure-1.json` pins the three-slot composition (the gallery thumbnail);
`lenient/lenient-image-explicit-expandable-false.json` pins that an explicit `false` canonicalises
away; and `reject/reject-image-expandable-nonbool.json` refuses the stringified boolean
(`WRONG_TYPE` at `$.kind.expandable`) rather than coercing it — a truthiness rule would have to rule
on `"false"` and `""` as well, and two hosts ruling differently would disagree about whether a
document declares an affordance at all.

---

### 3.6.6 `Media` — the playback surface (Phase 1076)

`Media` is a Display kind carrying a mandatory accessible label, a source, two shared declarations,
and a `MediaKind` variant that says which surface it is:

```json
{"id":"media-video-1","kind":{"$type":"Media","kind":{"$type":"Video"},"label":"Studio walkthrough","src":{"$type":"Static","value":"/walkthrough.mp4"}}}
{"id":"media-audio-1","kind":{"$type":"Media","kind":{"$type":"Audio"},"label":"Curator's commentary","src":{"$type":"Static","value":"/commentary.mp3"}}}
```

**ONE kind, two variants — never two kinds.** Everything a video surface and an audio surface share
is stated once on the record: the source, the accessible name, whether the transport is shown,
whether playback repeats. Only the slots that genuinely differ live in the variant, and there are two
of them, both on `Video`. Minting a second kind would have duplicated four slots, two decoders, two
schema entries and one entry in every host's kind dispatch, in exchange for nothing a `$type` inside
`kind` does not already say.

**`label` is REQUIRED, and this is the one place the media contract differs from `Image`'s.** An
image can honestly be decorative and say so with an empty `alt`; a media element is a TRANSPORT — a
control a reader focuses, plays, pauses and seeks — so it is never decorative. A `<video>` with no
accessible name is announced as "video" and nothing more, which tells the reader that a player exists
and nothing about what it plays. A host emits the resolved label as the element's accessible name
(on an HTML host, `aria-label`), always. A document omitting `label` is refused —
`reject/reject-media-missing-label.json`, `MISSING_FIELD` at `$.kind.label` — because there is no
value to default to that would not be a fabricated name for someone else's recording.

**`controls` is omitted at TRUE.** It is the second such slot in the vocabulary (`Toast.dismissable`
is the first) and the polarity is deliberate: a media element without a transport cannot be paused,
seeked or muted by a keyboard user at all, so the accessible setting is what a document gets for
free, and taking it away is the deviation that costs a key. `loop` takes the ordinary polarity,
omitted at `false`.

**`autoplay` (Video only) is a DECLARATION whose rendering is constrained, and the constraint is
normative.** A host that honours `autoplay` MUST emit it together with a muted attribute:

```html
<video class="fuaran-media fuaran-media-video" src="…" aria-label="…" autoplay muted>
```

There is deliberately **no separate `muted` slot** on the wire, and its absence is the design rather
than an omission. A muted slot would be a second knob free to disagree with the first, and the only
combination it would add is the one no host may render. The pairing is not a default a caller
overrides; it is what the declaration MEANS. It is also the honest rendering: every mainstream
browser blocks unmuted autoplay, so a host emitting `autoplay` alone produces a video that silently
never starts — the document's declaration would mean nothing and the failure would be invisible. The
converse holds too: a host MUST NOT emit a muted attribute where `autoplay` is absent, because muting
a video the reader pressed play on is a defect of the same family in the other direction.

**`Audio` has NO autoplay pathway — in the type, on the wire, or in the emission.** The case declares
no such slot, so there is nothing for a host to read and nothing for a renderer to branch on. This is
stronger than a default of `false`: a slot that defaults to off is one a document can switch on, and
there is no document this format wants to be able to state in which a page begins making sound
unbidden. A document carrying `{"$type":"Audio","autoplay":true}` decodes to an audio surface that
does not autoplay, because the value has nowhere to land.

**`poster` (Video only) is a second URL through the §19 floor, and a refused one is DROPPED.** A
poster frame is fetched by the browser with no user act, exactly as `src` is, so it carries the same
render-time obligation. The two differ in what a refusal means, and the rule is §3.6.4's
dropped-candidate rule applied to a single slot: an element must have a source, so a refused `src`
collapses to the refusal substitute and carries its marker, while an anchorless `poster` simply
leaves. A `<video>` with no poster shows its first frame, which is a working rendering; a poster
pointing at the refusal URL is a broken image painted over the player. As everywhere else in §19,
this is a RENDER-time obligation and not a wire constraint — a document naming a URL that fails the
floor is still a valid wire document.

**The variant is `$type`-discriminated, so an unknown case reports at `$.kind.kind.$type`** — the
`Binding` / `TextSource` position, not the bare-enum one (§6). The set is closed at `Video | Audio`;
`reject/reject-unknown-media-kind.json` refuses `"Stream"` exactly as it would refuse a name nobody
has proposed, so admitting a third surface later is an ADDITION rather than a re-meaning of shipped
bytes.

#### Text tracks and the transcript (Phase 1110)

`tracks` carries the element's timed-text tracks and `transcript` its text alternative. Both live on
the SPEC rather than on `MediaKind.Video`, and the second placement is the one worth explaining: a
transcript is the accessibility affordance an AUDIO surface needs most, because a recording with no
visual channel has nowhere else to put its words, where a video can usually be served by captions
riding the timeline it already has.

```json
{"id":"media-video-captions-1","kind":{"$type":"Media","kind":{"$type":"Video"},"label":"Studio walkthrough","src":{"$type":"Static","value":"/walkthrough.mp4"},"tracks":[{"default":true,"kind":"Captions","label":"English captions","src":{"$type":"Static","value":"/walkthrough.en.vtt"},"srcLang":"en"}]}}
{"id":"media-audio-transcript-1","kind":{"$type":"Media","kind":{"$type":"Audio"},"label":"Curator's commentary","src":{"$type":"Static","value":"/commentary.mp3"},"transcript":"The harbour was rebuilt twice: once after the storm of 1908, and again in 1953."}}
```

A `TrackEntry` carries `kind` (a bare `TrackKind` enum — `Subtitles`, `Captions`, `Descriptions`,
`Chapters`), `src` (a `Binding<string>`), `srcLang`, `label` (a `TextSource`), and `default`. Four of
the five are REQUIRED, which makes it the strictest record on the wire; `default` is the one
omitted-at-`false` slot. `tracks` itself is omitted when EMPTY — an absent list and an empty one
denote the same document — so a decoder restores `[]`, never a null. `transcript` is an ordinary
optional: absent means the document offers no transcript, which is a different statement from
offering an empty one.

**`srcLang` is REQUIRED on every kind**, where HTML makes `srclang` mandatory only on a subtitles
track. The extra strictness costs an author one value and buys a menu a user agent can order, a
speech engine can pronounce, and a reader can tell apart; a track with no language is one nothing
downstream can route, and there is no value to default to that would not be an invented claim about
someone else's recording. A document omitting it is refused —
`reject/reject-media-track-missing-srclang.json`, `MISSING_FIELD` at `$.kind.tracks[0].srcLang`, the
path carrying the array index so a document with four tracks names the one at fault.

**`label` is REQUIRED for the reason `MediaSpec.label` is.** It is the entry a user agent puts in its
track menu and the only thing distinguishing one track from another there, so an unlabelled track is
offered as its kind alone — and a reader choosing between a plain and a verbose captions cut is shown
two identical choices. The wire requires the member; an authoring-side gate refuses the empty value
that satisfies the requirement while meaning nothing.

**`metadata` is NOT a track kind, and its absence is the design.** Its cues are rendered by no user
agent and read only by script, so a declarative document naming it would state an intent no
conformant host could honour without leaving the vocabulary. The set is closed at four; a fifth is an
addition, not a spelling a decoder may guess at.

**RENDER OBLIGATIONS.** Four, none of which the bytes can carry, all of them normative:

1. **Emission.** A host emits each track as a `<track kind srclang label>` child of the media
   element, with `default` where the entry elects it:

   ```html
   <video class="fuaran-media fuaran-media-video" src="…" aria-label="…">
     <track kind="captions" src="…" srclang="en" label="English captions" default>
   </video>
   ```

   The `kind` attribute carries the lower-case HTML token (`subtitles` / `captions` / `descriptions`
   / `chapters`) for the wire's `TrackKind` case, and `srclang` the lower-case HTML spelling of the
   wire's `srcLang`.

2. **Authored order is PRESERVED.** The tracks are emitted in the order the array carries them,
   never re-sorted. This is the OPPOSITE of §3.6.4's `srcSet` rule and the difference is not an
   inconsistency: a browser picks ONE candidate from a srcset by an algorithm, so ordering it is
   canonicalisation, while a reader picks a track from a menu the user agent builds in DOCUMENT
   order, so ordering it would be rewriting someone else's menu. `nodes/media-video-tracks-2.json`
   is authored in an order no sort produces, which is what makes the two rules separately testable.

3. **At most one `default` per KIND, first election wins.** A document electing two default captions
   tracks is legal bytes — the decoder does not refuse it, because a lenient host would render it
   anyway and HTML leaves the case undefined — so the host resolves it, and every host resolves it
   the same way: the FIRST election of a kind is honoured and a later one is emitted WITHOUT the
   attribute. The track is still emitted; only its claim on the menu is dropped. The election is
   per kind, so a captions default and a subtitles default coexist.

4. **A refused track source DROPS the track.** A track file is fetched by the browser with no user
   act, so it carries the same §19 render-time obligation `src` and `poster` do. It takes the
   POSTER's disposition rather than the source's: an element must have a source, but it need not
   have this track, and a `<track>` pointing at the refusal URL is a menu entry that opens onto
   nothing.

**The `transcript` renders as a disclosure BESIDE the transport, never inside it.** `<video>` and
`<audio>` admit only source-ish children, so a transcript placed there would be fallback content a
browser never shows — which is why a present transcript is the one case where the emission gains a
wrapper. The disclosure carries the MEDIA's resolved label as its own accessible name, so a reader
meeting it out of context is told which recording it transcribes. The reference emission is a
`<details class="fuaran-media-transcript">` with a `<summary>` inside a
`<div class="fuaran-media-group">`; absent, the emission is the bare element it would otherwise be.

Fixtures: `nodes/media-video-1.json` (the minimum — both bool defaults omitted and the payload the
bare discriminator), `nodes/media-video-poster-1.json` (the poster inside the case object rather than
beside it), `nodes/media-video-autoplay-1.json` (all three bools off their defaults at once, which is
where an encoder built as a chain of `if`s gets the canonical key order wrong),
`nodes/media-audio-1.json` (the variant whose payload is the discriminator alone),
`nodes/media-video-captions-1.json` (one elected captions track — the whole `TrackEntry` key order in
one line), `nodes/media-video-tracks-2.json` (three tracks in an unsortable authored order, two of
them electing the same kind as default), `nodes/media-audio-transcript-1.json` (the optional
`TextSource` on the spec), `reject/reject-media-missing-label.json`,
`reject/reject-unknown-media-kind.json`, `reject/reject-media-autoplay-nonbool.json` (`WRONG_TYPE` at
`$.kind.kind.autoplay` — the stringified boolean refused rather than coerced, on the slot where a
truthiness rule would make one host start playing a video another host leaves still),
`reject/reject-media-track-missing-srclang.json`, and
`reject/reject-media-track-default-nonbool.json` (`WRONG_TYPE` at `$.kind.tracks[0].default` — the
same stringified boolean one level further in, at the position a host decoding array elements with a
looser walker than its records would get wrong).

---

### 3.6.7 `Masonry` — the column-fill layout mode (Phase 1082)

`BoxLayout` carries a fourth case beside `Flex`, `Grid` and `Auto`. It names a FILL DIRECTION, which
is the one thing `Grid` structurally cannot say:

```json
{"id":"masonry-1","kind":{"$type":"Box","children":[…],"layout":{"$type":"Masonry","cols":3},"role":"Group"}}
{"id":"masonry-gap","kind":{"$type":"Box","children":[…],"layout":{"$type":"Masonry","cols":4,"gap":16},"role":"Group"}}
```

`cols` is REQUIRED; `gap` is an optional pixel spacing omitted at absence (rule 4), exactly as on
`Flex` and `Grid`.

**`Grid` fills by ROW, `Masonry` fills by COLUMN, and no value of any `Grid` field changes that.**
`Grid` carries `cols` and a `templateColumns` sizing function — both statements about how many
columns there are and how wide each is, neither a statement about the order children occupy them. So
a grid of children with unequal intrinsic heights leaves each row as tall as its tallest member, with
whitespace beneath the shorter ones. That is a legitimate look and is often the better one for
similarly-proportioned children; it is not masonry, and it is not reachable from masonry either.
This is why the mode is a fourth CASE and not a fifth field on `Grid`: a fill direction is not a
refinement of a track model.

**The realising CSS is NORMATIVE, and it is the multi-column family.** A rendering host that honours
`Masonry` MUST realise it with CSS multi-column layout — `column-count` carrying the declared `cols`,
and the declared `gap` reaching `column-gap`. On an HTML host that is:

```html
<div class="fuaran-layout-masonry" style="column-count:3">…</div>
```

Naming the mechanism rather than the intent is deliberate, and it follows §3.6.5's lesson: a slot
that declares a BEHAVIOUR and leaves the rendering to each host produces surfaces that agree on the
bytes and disagree on the page. Two mechanisms could plausibly serve here and they do not behave
alike, so the specification picks one.

**`grid-template-rows: masonry` is explicitly NOT the mechanism**, and a host MUST NOT substitute it.
It is the more natural-looking spelling and it is rejected on availability: it is not
deterministically supported across engines, so a document rendered through it would lay out as a
masonry on some readers' browsers and as an ordinary grid on others'. A layout mode whose rendered
result depends on which engine reads it is not a wire contract. Multi-column is chosen because every
engine implements it and because its behaviour is fully determined by the two properties the wire
carries.

**Children MUST NOT be split across a column boundary.** Multi-column layout fragments its content by
default, so a host that emits only `column-count` will cut a card, a picture or a paragraph block in
half down the page. A conformant host applies the break-avoidance rule to the container's direct
children (`break-inside: avoid`); the reference stylesheet does this on `.fuaran-layout-masonry > *`.
This is a render obligation, not a wire constraint — the bytes cannot carry it — but a host that
omits it has not rendered the declared layout.

**Reading order runs DOWN each column, not across the page, and that is a consequence authors must
weigh.** Multi-column fills the first column to the container's height before starting the second, so
document order and visual order agree column-wise and disagree row-wise. For a picture wall, where
each child stands alone, this is invisible. For content meant to be read in sequence it is not, and
`Grid` is the correct mode there. The specification states this rather than leaving it to be
discovered because it is the one respect in which `Masonry` is not a drop-in substitute for `Grid`.

**`cols` MUST be a positive integer.** Zero and negatives are a `WRONG_TYPE` at
`$.kind.layout.cols`, which is also what the published schema's `minimum: 1` says, so the two
expressions of the contract agree (the §3.6.4 `srcSet` width precedent). Zero is refused as firmly as
a negative and is the interesting half: `column-count: 0` is invalid CSS, so a container declaring it
would fall back to whatever the host's own stylesheet last said, and the wire would be carrying a
layout whose rendered result is host-defined.

**There is deliberately NO auto-column leniency here, unlike `Grid`.** §16 canonicalises a `Grid`
carrying no column spec to `{"$type":"Auto"}`, because the language already owns the concept the
author meant — the responsive auto-tile. A `Masonry` with no `cols` has no such case to be rewritten
into: `Auto` is a row-fill mode, so canonicalising to it would silently discard the author's entire
intent rather than recover it. The absence is a `MISSING_FIELD`, and a non-positive value is refused
rather than repaired.

**`Masonry` carries no `templateColumns`.** That field is a verbatim `grid-template-columns` sizing
function, and the multi-column model has no track list for it to name. The omission is what keeps
this case BOUNDED: every property a `Masonry` container can cause a host to emit is fixed by this
section, so the case opens no route for arbitrary CSS to enter the stack and adds no entry to the
escape-hatch inventory. `Grid`'s own `templateColumns` escape is unchanged and unaffected.

**Kind-class hook.** A `Group`-role box in this mode takes `fuaran-kind-masonry`, not
`fuaran-kind-grid-layout`. The two modes fill differently, so a host styling "the grid container"
must not catch both.

Fixtures: `nodes/masonry-1.json` (the minimum — `gap` omitted at absence), `nodes/masonry-gap.json`
(the gap slot present, which is otherwise unreachable on the wire), and
`reject/reject-box-masonry-nonpositive-cols.json` (`WRONG_TYPE` at `$.kind.layout.cols` — the zero
column count refused rather than canonicalised).

---

### 3.6.8 `Embed` — the sandboxed third-party embed (Phase 1111)

`Embed` is a Display kind carrying a document URL, a mandatory accessible title, an optional declared
aspect ratio, and a closed list of sandbox relaxations that is EMPTY by default:

```json
{"id":"embed-1","kind":{"$type":"Embed","src":{"$type":"Static","value":"https://player.example/embed/harbour"},"title":"Harbour restoration, part two"}}
{"id":"embed-permissions-1","kind":{"$type":"Embed","permissions":["AllowFullscreen"],"src":{"$type":"Static","value":"https://player.example/embed/harbour"},"title":"Harbour restoration, part two"}}
```

**A KIND, not a `Mount` variant — and the vocabulary charter's row for it said otherwise until this
phase.** `Mount` (§4o) composes a COOPERATING guest: a scope id, a declared message channel, a
capability request list, a host-side loader that produced the guest tree. A third-party page has none
of those and cannot acquire them, and widening `Mount` to admit an uncooperative third party would
weaken every guarantee `Mount` currently makes — so the two contracts, bidirectional cooperation and
default-deny isolation, take two kinds. It is equally not a `Media` variant: `Media` fetches an asset
and DISPLAYS it, decoded by the user agent's own codec into no scripting context, where an embed
fetches a document and lets it EXECUTE. That difference is why the source takes its own egress class
(§19.1) rather than reusing `Media`'s.

**`title` is REQUIRED, on `MediaSpec.label`'s argument one kind over.** A frame is a focus container a
reader tabs INTO, so there is no decorative embed the way there is a decorative image; a frame with no
accessible name is announced as "frame" and nothing else, telling a reader that something is embedded
and nothing about what. A host emits the resolved title as the element's `title` attribute, always. A
document omitting it is refused — `reject/reject-embed-missing-title.json`, `MISSING_FIELD` at
`$.kind.title` — because an invented title is a claim about somebody else's document.

**`permissions` is omitted at the EMPTY list, and empty means TOTAL DENIAL.** That polarity is the
design rather than a consequence of the omit rule: the wire-cheapest document is also the most
locked-down one, so the default a careless emitter produces is the safe one. `EmbedPermission` is a
BARE enum (§3.5), closed at `AllowScripts` / `AllowSameOrigin` / `AllowForms` / `AllowFullscreen`, so
an unrecognised token reports at the ELEMENT's own path with no `$type` suffix —
`reject/reject-embed-unknown-permission.json`, `UNKNOWN_DU_CASE` at `$.kind.permissions[0]`. A decoder
MUST NOT silently drop an unrecognised permission: that would turn a document asking for something
this vocabulary has no name for into a document asking for LESS, which reads as success.

**Two relaxations are excluded from the vocabulary rather than defaulted off, and are not reserved
either.** A top-level-navigation relaxation would let a framed document navigate the page that framed
it — the drive-by redirect — and a downloads relaxation would put a file-save prompt in a third
party's hands; neither is admitted and neither is a name a later phase should take. Popups, modals,
pointer lock, presentation and orientation lock have no recorded demand and ARE reserved as names a
later addition would use, which is the whole reason this is an enum rather than a set of booleans: a
fifth case is then a bare-string addition rather than a type replacement.

**`aspectRatio` REUSES `ImageAspect`.** The cases are pure layout ratios with nothing image-specific
in them, and the wire carries bare strings, so the type name reaches no document; minting a parallel
enum with identical cases would create two closed sets that must be kept in step, which is the defect
a separate type would be introducing rather than avoiding. It omits at `Natural` rather than being
optional, for the reason every other omit-at-default slot does: an option over an enum that already
contains `Natural` would give one fact two spellings.

**RENDER OBLIGATIONS.** Four, none of which the bytes can carry, all of them normative:

1. **The sandbox declaration is emitted ALWAYS, and EMPTY when nothing is granted.** Omitting the
   attribute on a permissionless embed produces the same markup as an unsandboxed frame, so the
   emission is unconditional rather than derived from the list being non-empty:

   ```html
   <iframe class="fuaran-embed" title="…" sandbox="" loading="lazy"
           referrerpolicy="strict-origin-when-cross-origin" src="https://…"></iframe>
   ```

2. **The tokens are emitted in the vocabulary's DECLARATION order, de-duplicated.** The wire preserves
   whatever order the document authored — the `tracks` rule (§3.6.6), not `srcSet`'s: a JSON array is
   ordered data and this format does not re-sort a document's own list. The determinism the emitted
   markup needs is established at RENDER time instead, so two documents naming the same set produce
   byte-identical markup. `AllowFullscreen` is NOT a sandbox token — it is a permissions-policy
   directive and rides `allow="fullscreen"`, emitted only where declared, because an empty `allow` is
   not the same statement as an absent one.

3. **`loading="lazy"` and a conservative `referrerpolicy` are unconditional.** There is deliberately no
   slot for either. The referrer policy is `strict-origin-when-cross-origin` and deliberately NOT
   `no-referrer`: several ubiquitous providers restrict playback by referring domain, so stripping the
   header outright breaks a legitimate embed, while sending the origin alone leaks no path and no
   query.

4. **A refused source OMITS the source attribute entirely.** This is the one place a refusal does not
   take §19 rule 6's substitute-`about:blank` route, and the reason is the element: an `<iframe>`
   pointed at a refusal URL RENDERS that page, where one with no source is a well-defined empty
   browsing context that fetches nothing. The refusal is still recorded, as the egress-refusal data
   attribute, so "nothing was declared" and "this was refused" stay different facts.

A declared `aspectRatio` is a CLASS on the frame (`fuaran-embed-aspect-sixteen-nine`, and the three
siblings); no value from the tree reaches a style attribute, which is the `Image` presentation rule
(§3.6.2) applied unchanged.

Fixtures: `nodes/embed-1.json` (the minimum — both optional slots at their identity, so neither
appears, and a host emitting `"permissions":[]` differs here and nowhere else),
`nodes/embed-aspect-1.json` (the declared ratio, which is what pins the `ImageAspect` REUSE: a host
that minted a parallel enum with the same case names round-trips its own emission perfectly and
diverges from the schema, where the slot `$ref`s `ImageAspect`), `nodes/embed-permissions-1.json` (one
permission, deliberately the one that does NOT ride the sandbox attribute, so a host that mapped the
whole enum onto sandbox tokens passes every other fixture and fails its render obligation on this
one), `reject/reject-embed-missing-title.json`, `reject/reject-embed-unknown-permission.json` (the
HTML token `"allow-top-navigation"` an author reaches for from memory — refused, because it names a
relaxation this vocabulary deliberately does not admit), and
`reject/reject-embed-permission-nonstring.json` (`WRONG_TYPE` at `$.kind.permissions[0]` — a bare
`true` refused rather than read as a present-and-enabled flag, since a host that coerced it would have
to invent WHICH permission it names).

---

### 3.6.9 `Combobox` — the typeahead / autocomplete field (Phase 1113)

`FormFieldKind.Combobox` is the searchable form of `Choice`. **The line a host and an emitter both
have to hold is one sentence:** a BOUNDED KNOWN set the reader scans is `Choice`; a LARGE, SEARCHABLE
or ASYNCHRONOUS set — or one that admits a value not on the list — is `Combobox`. The failure this
distinction exists to prevent is not an invalid document but a valid one: a `Choice` over two hundred
options parses, validates and renders on every host, and is unusable.

```json
{"$type":"Combobox",
 "allowFreeText":true,
 "onChange":"<closure>",
 "options":{"$type":"Static","value":[{"label":"France","value":"fra"}]},
 "value":{"$type":"Static","value":"fra"}}
```

**Members.** `options` is a `Binding<SelectOption list>` and is the case's only REQUIRED member — a
combobox with no option source is not a control. `value` is a `Binding<string>` whose absent `Static`
payload is "no selection", and `onChange` carries `string option`: **both are `Choice`'s, deliberately
and normatively.** The constrained combobox IS a searchable select, so a document that migrates
between the two changes its `$type` and nothing else, and a host that implemented a different value
contract here would break exactly that migration. With free text admitted, an empty entry is genuinely
no value, so it is `null`/absent rather than `""` — one fact, one spelling.

**`allowFreeText` omits at `false`, and the polarity is load-bearing.** The SHORTEST combobox document
is the CONSTRAINED one: an emitter that says nothing gets the shape a `Select` would have had, and
admitting values outside the option set is the thing it has to ask for. A host MUST read an absent
`allowFreeText` as `false`; a present member of any type other than boolean is `WRONG_TYPE` and MUST
NOT be coerced — the slot decides whether off-list values are admitted, and a lenient truthiness read
would widen the field on `"no"` and `"false"` alike.

**An asynchronous suggestion source needs no vocabulary of its own.** A `Binding.Query` in the
ordinary `options` slot IS the async feed, resolved by the same machinery every other query-bound slot
uses; `dependsOn` gives it the dependency edge. Nothing in this case names a request, a debounce or a
minimum query length.

**Render obligations (normative, both tiers).**

1. **Nothing on the wire names a keystroke.** Arrow / Enter / Escape / Home / End, the popup, the
   highlight and the option-to-value mapping are the RENDERER's affordance under the affordance→op
   rule. A host MUST NOT expect a document to configure them and MUST NOT add wire vocabulary for
   them.
2. **A client-tier host implements the WAI-ARIA combobox pattern**: `role="combobox"` on the text
   input with `aria-expanded`, `aria-controls` naming the listbox, `aria-autocomplete="list"`, and
   `aria-activedescendant` naming the ACTIVE option (absent when none is). **Focus stays on the
   input** — the listbox and its options are not focus stops, which is what lets a reader hear the
   highlighted option while still typing.
3. **A static (no-script) host MUST still produce a working control.** The floor is a native
   `<input type="text" list="…">` bound to a `<datalist>` of the resolved options; that pair is a
   combobox to the user agent, which supplies the popup, the filtering, the keyboard interaction and
   the accessibility semantics itself. A static host **MUST NOT** emit hand-written
   `role="combobox"` / `aria-expanded` on that input: a static `aria-expanded="false"` that can never
   become `true` replaces the user agent's correct semantics with a claim inert markup cannot keep.
4. **`allowFreeText = false` is not enforceable by any static host, and MUST NOT be claimed as if it
   were.** A `<datalist>` is a suggestion list; HTML has no native membership constraint for one. A
   client tier restoring the committed value on an unmatched entry is an AFFORDANCE. Per §22's
   standing posture, client validation is not a trust boundary: **a host that accepts submissions
   MUST re-check membership server-side** for a combobox that declared `allowFreeText = false` over a
   resolvable option set, exactly as it re-checks every other declared constraint.

Fixtures: `nodes/form-combobox-static.json` (a static option source with `allowFreeText` OMITTED —
which is what pins the default's polarity: a host reading absence as "free text admitted" round-trips
these bytes perfectly and is wrong about what the document permits),
`nodes/form-combobox-query.json` (the `Query`-bound suggestion source, declarative — no `onChange` —
and with the `value` slot omitted so the field auto-binds `State("city")` exactly as a `Choice`
would), `nodes/form-combobox-freetext.json` (`allowFreeText` true, carrying a value that matches NO
option, which is the state a constrained combobox can never be in), and
`reject/reject-combobox-allowfreetext-nonbool.json` (`WRONG_TYPE` at
`$.kind.fields[0].kind.allowFreeText` — a string refused rather than coerced).

---

### 3.6.10 `FileUpload` — drop target and paste ingestion (Phase 1115)

`FileUploadSpec.dropTarget` and `.acceptPaste` name two additional INGRESS ROUTES onto a control that
already has one. **Neither names a gesture.** Under the affordance→op rule the wire names a capability
on the node that hosts the gesture and consumes its effect; the drag-over, the drop, the paste, the
visible drop state and the drag image are the RENDERER's, and nothing here names an event, a MIME
negotiation or a keystroke.

```json
{"$type":"FileUpload",
 "accept":[".csv","text/csv"],
 "dropTarget":true,
 "label":"Drop a spreadsheet",
 "multiple":true,
 "onSelect":"<closure>"}
```

**Both members omit at `false`, and the polarity is load-bearing.** The SHORTEST upload document is
the plain picker — which is exactly what every document written before this revision says — and each
route is something an emitter has to ask for. A host MUST read an absent member as `false`; a present
member of any type other than boolean is `WRONG_TYPE` and MUST NOT be coerced. The slot decides
whether a whole ingress route exists, absence already spells the safe answer, and a lenient truthiness
read would open a drop target on `"no"` and `"false"` alike.

**The two routes resolve through the EXISTING selection path.** A dropped or pasted file is the same
selection a picked one is: it reaches `onSelect` with the same `FileSelection` shape, and no new
handler slot, no new `Action` case and no new server-driven event name is introduced. `accept`
filtering applies to all three routes identically — the user agent applies it to the picker before the
reader chooses, and a host applies it itself on the two routes the picker is not on. `multiple` bounds
all three: a control that did not declare it takes ONE file however the file arrived.

**Render obligations (normative, both tiers).**

1. **A declared route is ADDITIONAL, never a replacement.** The `<input type="file">` and its label are
   emitted whatever the document declares. A host that replaced the picker with a drop zone would ship
   a pointer-only control — there is no keyboard equivalent of a drag, and none is invented here
   because the picker already is one.
2. **A client-tier host writes ingested files into the control's own file input** and lets that input's
   ordinary `change` fire, rather than calling the selection handler directly. This is what makes the
   three routes one path: the user agent renders the accepted filenames in its own file-input chrome,
   so a reader sees a dropped file exactly as they see a picked one; and any host mechanism that reads
   the selection off the element — a server-driven tier performing a file-body read, for instance —
   sees an ingested file with no changes of its own.
3. **A file `accept` refuses is not silently swallowed.** On the picker the user agent filters before
   the reader commits, so a refused file never appears; on these routes the reader has already
   committed the gesture, so a host MUST surface the refusal in the control — the reference tier emits
   a `role="status"` line naming how many files were turned away. A host MUST also consume the gesture
   even when every file was refused, so the browser's own default action (navigating to the dropped
   file) does not fire.
4. **A paste is consumed only when it CARRIES FILES.** A text paste keeps its default action, so an
   editable descendant is unaffected.
5. **A static (no-script) host renders the PLAIN PICKER, and that is the conforming answer.** Both
   routes require an event listener, and no CSS observes a drag, so there is no inert markup that could
   honour them; emitting a drop zone a no-script host cannot wire would be an invitation the document
   cannot honour. The floor is therefore the control every host already rendered — a fully working
   upload — and a static host MAY record each declared route in a data attribute (the reference tier
   emits `data-fuaran-upload-drop` / `data-fuaran-upload-paste`) so the declaration is visibly read
   rather than dropped. That marker is **not** coverage and no host may treat it as such.

Fixtures: `nodes/upload-1.json` (both members OMITTED — the plain picker, and what pins the polarity:
a host reading either absence as "route admitted" round-trips these bytes perfectly and is wrong about
what the document permits), `nodes/upload-drop-1.json` (`dropTarget` with `acceptPaste` omitted, over a
populated `accept`), `nodes/upload-paste-1.json` (`acceptPaste` with `dropTarget` omitted, over
`image/*` — the wildcard-MIME arm of the filter), and
`reject/reject-upload-droptarget-nonbool.json` / `reject/reject-upload-acceptpaste-nonbool.json`
(`WRONG_TYPE` at `$.kind.dropTarget` and `$.kind.acceptPaste`; a string and a number refused rather
than coerced, vectored separately because they are separate decoder arms).

### 3.6.11 `Modal` — the modality, and the anchored `Popover` (Phase 1119)

`ModalSpec.modality` names WHICH overlay the node is. The axis is whether the surface **blocks the
page**, and it has exactly two answers, so the enum has exactly two cases:

| `modality` | What it is |
|---|---|
| `"Modal"` (the default, **omitted** on the wire) | A **blocking task surface**. It sits over a scrim, it claims the rest of the page is inert, and the reader finishes it or abandons it before the page continues. |
| `"Popover"` | A **transient anchored surface**. No scrim, no focus trap, no inertness claim; it belongs to the node named by `anchor`, and an ordinary interaction elsewhere dismisses it. |

`anchor` is a **NodeId** — the id of the node the popover is positioned against. It is meaningful for
`"Popover"` only.

```json
{"$type":"Modal",
 "anchor":"swatch",
 "children":[{"id":"picker","kind":{"$type":"Markdown","text":"Pick one"}}],
 "dismissable":true,
 "heading":"Choose a colour",
 "modality":"Popover",
 "open":{"$type":"State","key":"swatchOpen","defaultValue":false}}
```

**Nothing here names a pixel.** There is no placement token, no offset, no delay, no flip strategy,
no keystroke and no event name. Where the surface is put, which way it flips when the viewport runs
out, how far it sits off its anchor and which gestures close it are all the RENDERER's, under the
affordance→op rule: a document says WHAT the surface is and WHICH node it belongs to, never how it
is placed.

**Normative rules.**

1. **`modality` is omitted at `"Modal"`.** An emitter MUST omit the member for a blocking dialog, and
   a decoder MUST restore `"Modal"` on absence. This is what makes every pre-1119 modal document
   byte-unchanged and behaviour-unchanged.
2. **A `modality` outside the pair is `UNKNOWN_DU_CASE`; a non-string `modality` is `WRONG_TYPE`.**
   Neither is coerced and neither falls back. Absence already spells the safe answer, so a decoder
   that recovered from an unreadable value would turn an intended popover into a page-blocking dialog
   — the worst available outcome, and a silent one.
3. **`aria-modal="true"` is emitted for `"Modal"` and for nothing else.** The attribute asserts that
   the rest of the page is INERT; on a non-blocking surface that assertion is false, and a false
   inertness claim is worse than none. It is **omitted entirely** rather than emitted as `"false"`:
   `false` is already the ARIA default, so writing it adds no information and invites a reader to
   think a claim was made and denied. **Both modalities carry `role="dialog"`** — what changes is the
   claim, not the kind of thing the surface is. This obligation is the render-fidelity claim
   `aria-modal-only-when-blocking`.
4. **A `"Popover"` emits no scrim element**, and a host MUST NOT make the page behind it inert,
   because it is not.
5. **A `"Popover"` traps no focus.** A host MUST leave the reader free to `Tab` out. A transient
   surface that captured the keyboard would be a keyboard trap (WCAG 2.1.2) in every case where the
   reader did not want it.
6. **Light dismiss.** Where a `"Popover"` is `dismissable`, a host that runs script MUST dismiss it
   on `Escape` and on a pointer interaction outside both the surface and its anchor, through the same
   path `onDismiss` / the `open` write-back default already takes — never a second dismiss route. The
   ANCHOR is excluded deliberately: it is normally the control that opened the surface, and a dismiss
   on its own pointer-down would race the open it is about to perform.
7. **The static floor is the surface IN FLOW at the node's own document position.** A no-script host
   cannot measure an anchor, so it cannot place a surface against one; what it emits is the popover
   where the node sits, with no positioning of any kind, no scrim, and a closed one held behind
   `[hidden]` exactly as a closed modal is. **An emitter that wants the static render to read
   correctly places the popover node immediately after its anchor** — that is the whole of the
   authoring contract, and it is why the floor is honest rather than a gap. A host MAY record the
   declared anchor in a data attribute (the reference tier emits `data-fuaran-popover-anchor`) so the
   declaration is visibly read rather than dropped; that marker is **not** coverage and no host may
   treat it as such.
8. **An `anchor` that names no node in the tree is a VALIDATOR concern, not a decode failure**, and
   so is a `"Popover"` that declares none. The wire admits any string, because whether an id resolves
   is a fact about the WHOLE tree and no per-node decoder can answer it; the reference validator
   reports both as one Warning (FUARAN122), and an `anchor` on a `"Modal"` — a dead declaration
   nothing reads — as another (FUARAN123). Refusing either at decode would make a well-formed
   document unreadable in order to say something a validator says better.

**Choosing between the three transient surfaces.** `Tooltip` (§3.6, the node-level trait),
`Popover` and `Modal` are chosen at emission time and are easy to confuse, so the boundary is stated
in one sentence: **a hint about something already on screen is the `Tooltip` trait; an anchored
interactive surface, opened from something the reader pointed at, is a `Popover`; a blocking task
that must be finished or abandoned before the page continues is a `Modal`.** The error directions
are not symmetric — a `Modal` where a `Popover` was meant blocks the page and traps focus, which a
reader can at least see is wrong; a `Popover` where a `Modal` was meant lets the reader wander off
mid-task with nothing to stop them, and nothing reports it.

Fixtures: `nodes/modal-1.json` (both members OMITTED — the pre-1119 document, byte-unchanged, and
what pins the polarity), `nodes/popover-anchored-1.json` (the interactive shape — `modality` present,
an `anchor`, a state-bound `open`), `nodes/popover-open-1.json` (the SSR floor — a statically-open
popover, the executable form of rule 7), and `reject/reject-modal-modality-unknown.json` /
`reject/reject-modal-modality-nonstring.json` (`UNKNOWN_DU_CASE` and `WRONG_TYPE` at
`$.kind.modality`, vectored separately because they are separate decoder arms).

---

### 3.6.12 `Tree` — recursive disclosure with tree semantics (Phase 1120)

`Tree` is a Display kind carrying a hierarchy of ROWS and, optionally, the names of the two State
slots through which a reader opens rows and selects one. Its rows are `TreeItem` records — not
`Node`s — and `TreeItem.children` is a list of the same record, which makes this the format's first
**self-referential** shape.

```json
{"id":"tree-1","kind":{"$type":"Tree","items":[{"children":[{"id":"cocoa","label":"Cocoa"},{"id":"yarn","label":"Yarn"}],"id":"goods","label":"Goods"},{"id":"ledger","label":"Ledger"}]}}
{"id":"tree-expanded-1","kind":{"$type":"Tree","expandedStateKey":"openRows","items":[{"children":[{"children":[{"id":"manifest","label":"Manifest"}],"id":"1823","label":"1823"}],"icon":"folder","id":"archive","label":"Archive"}]}}
```

**`TreeItem`.** `id` and `label` are required; `children` omits at the EMPTY LIST and `icon` when
absent. A leaf therefore carries two keys and nothing else, which is most of a real hierarchy — a
host emitting `"children":[]` on a leaf produces different bytes for most of a file listing.

`id` is required because it is what the two State slots NAME. `label` is a `TextSource` because it
is content — authored, translated, bindable.

**The two State slots, and what they hold.** This kind carries no `expandable` and no `selectable`
boolean, and none is coming: a behaviour the reader drives is declared as a named State key that the
host both writes and reads, and a flag with no key behind it is a decorative control writing state
nothing reads. The slot shapes are fixed HERE, because a host reading them must not have to guess:

| Slot | The State value it names | Absent means |
|---|---|---|
| `expandedStateKey` | a JSON **array of row ids** — the rows currently open | the tree renders FULLY EXPANDED and does not toggle |
| `selectionStateKey` | a bare **row-id string** — the selected row | the tree does not select, and emits no `aria-selected` |

An array rather than a map of booleans, because the question a host asks is set membership and a set
has one spelling where a map has two for "closed". A value of any other shape reads as *empty* /
*none* rather than as an error: this is a host's own state slot, not a wire document, so there is
nothing here to refuse, and refusing would blank a tree over a value the reader never authored.

**A tree naming no `expandedStateKey` renders fully expanded**, which is the same reading that lets
a grid honour a declared initial order while offering no interactive sorting: an initial
presentation without a reader-driven affordance is a legitimate shape, and it is the only reading
under which such a tree shows its content at all.

**Row ids MUST be unique within one tree — and that is an EMIT-side obligation, not a decode
refusal.** It is §8.1's position for `NodeId`, and it transfers for §8.1's own reason: duplicate
detection is a whole-tree property, a decoder streaming a document is not required to carry the id
set, and there is no error code for it. A repeat makes both State slots ambiguous — expanding one
row opens two, and a restored selection lands on whichever the host reached first — so the
obligation sits with the emitter and with the whole-tree gates that see a document entire. The
reference host reports it as `FUARAN126` at pre-emit validation. A decoder MAY refuse a duplicate
where its shape makes detection free; a decoder that accepts one is still conformant.

**Item nesting is bounded on its OWN axis** (§21.5): a whole hierarchy lives inside one node, so it
consumes no node depth at all, and at roughly two JSON levels per row it is nowhere near the
syntactic bound either. The `MaxDepth` figure applies to item nesting counted separately, on the
`TreeOp.Batch` precedent. Fixtures: `nodes/limit-tree-item-depth-at-max.json` and
`reject/reject-limit-tree-item-depth.json`.

#### Render obligations (normative; none of them expressible in bytes)

A conformant rendering host MUST:

1. **Emit the ARIA tree pattern.** A container with `role="tree"`, rows with `role="treeitem"`, and
   a nested `role="group"` for each open row's children. Every row carries `aria-level`,
   `aria-setsize` and `aria-posinset`.
2. **Emit `aria-expanded` on rows that HAVE children, and on no others.** On a leaf the attribute
   asserts a collapsed subtree that does not exist, and assistive technology announces such a row as
   closed — a reader told there is more when there is not.
3. **Emit `aria-selected` only where `selectionStateKey` is named.** A tree that never selects must
   not declare a selectable widget with nothing selected.
4. **Give the widget ONE tab stop.** Exactly one visible row carries `tabindex="0"` and every other
   carries `tabindex="-1"`; the arrow keys move focus WITHIN the widget. This is the obligation the
   kind exists for — a composition of independently focusable containers is N tab stops, and no
   arrangement of them produces one. The focusable row is the selected row when it is visible, else
   the first visible row, so a server rendering and a client's first frame agree.
5. **State the accessible name rather than leaving it to be computed.** A `treeitem` owns its child
   group, so a name computed from contents reads the whole branch out as the row's own name. The
   stated name MUST be the row's own visible label.
6. **Bind all six keys on an interactive host**: `Down`/`Up` move to the next/previous visible row;
   `Right` on a CLOSED parent opens it and stays put, and on an open parent moves to its first
   child; `Left` on an open row closes it and otherwise moves to its parent; `Home`/`End` move to
   the first/last visible row. The two-press `Right` is deliberate — the reader sees what they
   revealed before being moved into it.
7. **Reach the whole hierarchy without script.** A server rendering emits the same elements, the
   same ARIA and the same roving tabindex, with `aria-expanded` reflecting the statically-resolvable
   expanded state. Movement is the interactive host's addition over that identical DOM, never a
   precondition for the document being readable.
8. **Derive nothing else from a row.** A host MUST NOT infer expandability from anything but the
   presence of children, and MUST NOT keep a per-row expansion state of its own beside the named
   key — a shadow copy is free to disagree with the slot every other row is drawn from.

**Host adoption.** The reference host (`fuaran`) emits, decodes and renders the kind and enforces
the item-depth bound; every other codec host in the §11.0 roster is **pending** until its own
change-set lands, on the §11 step-5 terms. A pending host is not exempt, and the failure mode here
is louder than for a field addition: a document carrying no `Tree` is unaffected, but one that
carries a `Tree` meets `WRONG_NODE_KIND` on a pending host — refused outright rather than silently
degraded, which is the correct behaviour for an unknown KIND and is why a kind's adoption cost is
the one §11.2 vocabulary attestation exists to make visible.

Fixtures: `nodes/tree-1.json` (two levels, no State key — static and fully expanded, and what pins
the leaf omission), `nodes/tree-expanded-1.json` (three levels, the expansion key named, one `icon`),
`nodes/tree-selection-1.json` (the selection key AND the handler sentinel, both declared), and
`reject/reject-tree-item-missing-label.json` / `reject/reject-tree-item-missing-id.json` /
`reject/reject-tree-nested-item-missing-id.json` (`MISSING_FIELD`, the third one level DOWN, because
a host whose child walker is looser than its root walker passes the other two).

### 3.6.13 `DataGrid` — cross-container transfer (Phase 1123)

`DataGridSpec.transferOutKey` and `.transferInKey` are the two sides of ONE shared State key, and
between them they say exactly one thing: **these grids exchange rows.** A grid declaring
`transferOutKey` K may RELEASE rows onto K; a grid declaring `transferInKey` K ACCEPTS rows arriving
on it; a grid declaring both with one K does each. Nothing else is named — not the drag, not the drop,
not the drag image, not the keyboard route, not the visible drop state.

This is the first pair in the format whose subject is a RELATION BETWEEN TWO NODES rather than one
node's own behaviour, and the affordance→op rule is extended for it in exactly one clause: where a
gesture spans two nodes, the wire names the capability on BOTH ENDS as a shared key each declares its
own side of, and the effect is one record written to that key. Every other node-local rule is unchanged.

```json
{"$type":"DataGrid",
 "columns":[{"field":"card","kind":{"$type":"Text"},"label":"Card"}],
 "rowKeyField":"card",
 "source":{"$type":"State","key":"board-todo"},
 "transferInKey":"board",
 "transferOutKey":"board"}
```

**Both members are optional and emitted only when present (rule 4)**, so a grid declaring neither is
byte-identical to every grid written before this revision. A present member of any type other than
string is `WRONG_TYPE` and MUST NOT be coerced: the slot names a STATE KEY, so an ordinal or a boolean
names no key, and a grid identified by position could not be paired with by any other grid.

**TWO members and not one symmetric key**, because the one-way ends are ordinary: an archive column
that accepts and never releases, a Done column that releases nothing back. A single key would make
every declaration bidirectional and those documents inexpressible. Neither carries the `-StateKey`
suffix the sibling behaviour fields do (`sortStateKey`, `pageStateKey`, `editStateKey`), and that is
deliberate: that suffix marks a key a grid both writes AND READS to change its own presentation, and
neither end reads this one for its own presentation.

#### The transfer record

A drop writes ONE object to the shared key. Its shape is fixed here, exactly as the sort descriptor's
is, so two hosts cannot disagree about what a transfer said:

```json
{"itemId": "<row identity>", "from": "<source node id>", "to": "<target node id>", "index": 0}
```

All four members are ALWAYS present. `itemId` is the moved row's identity, projected through the
`rowKeyField` contract the grid already carries. `from` and `to` are **NodeIds** — identity within the
tree, never store addresses. `index` is the **0-based** position the row took in the receiving grid's
full row set, and it is written even when it is `0`: a record that omitted it at the top of a list
would be indistinguishable from one that failed to state a position at all.

A host MUST NOT trust a value it finds at the key. A descriptor that is absent, not an object, or
missing any member is not a transfer and MUST be ignored — the same posture `sortStateKey` and
`pageStateKey` already take, where a malformed descriptor reads as the honest default rather than as
an arbitrary action.

**Row identity is `rowKeyField`, and no second identity vocabulary is minted.** The closure form
`rowKey` crosses the wire as `"<closure>"` and carries no projection, so a decoded transfer end
naming only a closure has nothing to put in `itemId`. That decodes successfully — a per-object codec
judges no relation between siblings — and is refused pre-emit (`FUARAN130`), which is where a shape
that decodes but cannot describe what it did belongs.

**Render obligations (normative, both tiers).**

1. **The record is written on EVERY transfer, whatever either end's source shape is.** It is the one
   part of a transfer that is promised unconditionally, and it is what makes the capability reach the
   case it exists for: the canonical board's columns are filtered views over one collection, which
   have no writable slot at either end, so on those documents the record IS the whole outcome and the
   application applies it.
2. **A host that CAN apply a half MUST apply it.** Each end commits through the destination that end
   already declares — a declared `editStateKey`, else the grid's own `source` when that source is a
   direct `State` binding — so the source loses the row and the target gains it with no application
   wiring at all. **No second write path is introduced**: a transfer is a write of each end's whole
   rows value, exactly as a reorder and an edit are. An end with no writable destination is simply
   not applied; the record still names what the reader asked for.
3. **A grid never transfers to ITSELF.** A two-way column declares both ends of one key, so a drop on
   the grid the drag began in satisfies the key on both sides — and that gesture is a REORDER, which
   `reorderable` already owns. A host MUST route it there, and MUST NOT write a transfer record for it.
4. **The gesture has a keyboard equivalent, and it is not optional.** A drag has no keyboard analogue
   and none is invented; what a host MUST provide is a SECOND ROUTE to the same effect. The reference
   tier lifts a row with `Control+X` on its row handle, places it with the receiving grid's own place
   control, and positions it from there with `reorderable`'s arrow keys — two affordances that between
   them reach every position the pointer reaches. A host MAY choose a different route; a host that
   provides none has shipped a pointer-only capability.
5. **The route is announced and advertised.** The chord is named on the handle (`aria-keyshortcuts`)
   and every transition — lifted, placed, cancelled, and refused-because-nothing-is-lifted — is
   announced through a live region. An undiscoverable shortcut is a fake affordance, and a lift with
   no announcement is a mode change a screen-reader user cannot detect.
6. **A static (no-script) host renders the grid EXACTLY as it renders one declaring neither member,
   and that is the conforming answer.** A transfer is a gesture plus state writes, and a static
   document has neither; emitting an inert handle or an inert place control would advertise a move the
   page cannot perform. The declaration still rides the wire to a tier that can act on it.

**A declared end whose counterpart is absent from the tree is a dead pairing** and is refused pre-emit
(`FUARAN129`), from either side: an accepting grid nothing releases to is a drop zone no drag can
reach, and a releasing grid nothing accepts from is a handle with nowhere to go. It cannot be a decoder
rule — whether ANY OTHER grid names the key is a whole-tree question and a per-object codec sees one
grid — which is the same split `pageSize`-without-`pageStateKey` already carries.

Fixtures: `nodes/transfer-board.json` (the canonical corner — two two-way columns and a one-way
`archive` that declares `transferInKey` ALONE, which is also what pins the omission polarity: the
archive's bytes carry no `transferOutKey` key at all), and
`reject/reject-wrongtype-grid-transfer-in-key.json` /
`reject/reject-wrongtype-grid-transfer-out-key.json` (`WRONG_TYPE` at `$.kind.transferInKey` and
`$.kind.transferOutKey`, vectored separately because they are separate decoder arms).

**Host adoption.** Recorded here on the §11.0 convention: the reference F# host implements the codec,
the pre-emit rules and every render obligation above. Every other codec host in the §11.0 roster is
**pending** until its own change-set lands, on the §11 step-5 terms. A pending host is not thereby
exempt — it owes the behaviour and has simply not made its answer visible.

---

### 3.6.14 `Action.Print` — the payload-free action (Phase 1124)

`Action.Print` says one thing and takes nothing to say it: **open the reader's own print dialogue.**

```json
{"$type":"Print"}
```

That is the complete encoding. It is the format's first **payload-free `Action` case**, and the
emptiness is the specification rather than an omission in it. Printing has parameters — page size,
margins, orientation, sheet range, copies, which printer — and every one of them belongs either to the
host's page setup or to the dialogue the reader is looking at when the action fires. A document may
therefore ask for the dialogue and may say nothing about what happens in it.

**A member beside `$type` is `WRONG_TYPE` and MUST NOT be ignored**, at the path of the offending
member. This is the one `Action` arm that is strict about unrecognised members, and the asymmetry is
deliberate: everywhere else in this format an unknown member is one the reading host has not learned
yet, and dropping it is the forward-compatible answer. Here there is nothing to learn. A host that
accepted `{"$type":"Print","pageRange":"1-3"}` and printed everything would leave the emitter believing
it had constrained a printing it had not constrained, and no error anywhere would say otherwise. Vector:
`reject/reject-action-print-with-payload.json`.

**Wire survivability: survivable, trivially** (§5.1) — there is no slot for a closure to hide in, so the
decode of an encode is the value itself on every host.

**It composes like any other action.** `Chain` carries it, and the corpus fixture
(`nodes/button-print.json`) places it inside one deliberately: a bare `Print` exercises the case, where
a `Print` beside a sibling exercises what a memberless object can actually break — an encoder that
emits `{}` for a case with no fields, or a decoder that requires at least one member, fails differently
in a list than alone.

**What this case does NOT do, and what carries those obligations instead.** It does not describe the
paged rendering: which subtrees stay whole, which start a fresh page, and whether a grid repeats its
header are `BoxSpec.keepTogether` / `.breakBefore` / `DataGridSpec.keepRowsTogether` / `.repeatHeader`
(the "Print break control" members, Phase 1473), and they apply whether the reader printed through this action or
through the browser's own menu — which is the point: a printed page must be correct without any action
having been raised at all. It does not select medium-conditional content either; a document showing one
thing on screen and another on paper is a `Switch` over a host-supplied binding, not vocabulary here.
And it names no target: `Print` prints the page, never a subtree of it, because a subtree is something
the host already holds and can select for itself.

**Host obligation.** A host performs `Action.Print` by asking its own platform to print the rendered
document — on a browser host, `window.print()`. Three properties are normative:

1. **It is user-visible and user-cancellable.** The obligation is to raise the platform's own dialogue,
   never to print silently. A host with no interactive print path performs nothing.
2. **Nothing is reported back.** The action yields no value, no callback and no event: a host MUST NOT
   tell the tree whether the reader printed, cancelled, or what they chose. A server-driven host
   therefore ships the effect one way and receives no response to it.
3. **A host that cannot print performs nothing, and refuses nothing.** Printing is an act of the
   machine the document is being READ on. A server rendering the document has no printer, but the
   reader's browser does, so a server-driven host **lowers** the effect to its client rather than
   treating it as unserviceable; a host with no display at all simply does nothing, exactly as it does
   with any other affordance it cannot present.

**Host adoption.** Recorded here on the §11.0 convention: the reference F# host implements the codec,
the strict-member refusal and the render obligations above. Every other codec host in the §11.0 roster
is **pending** until its own change-set lands, on the §11 step-5 terms. A pending host is not thereby
exempt — it owes the behaviour and has simply not made its answer visible. Note the failure mode a
pending host presents here is unusually quiet: `{"$type":"Print"}` is the shape a lenient decoder is
most likely to accept and then do nothing with, so the §11.2 vocabulary attestation is what makes an
unimplemented case visible rather than the reject leg.

---

### 3.6.15 `DataGrid` — the export affordance (Phase 1125)

`DataGridSpec.exportable` is a `bool`, omitted at `false`, and it says exactly one thing: **this
grid's rows are the reader's to take.** Nothing else is named — not the file format, not the file
name, not the control, not the gesture that reaches it, and not which rows.

```json
{"id":"grid-exportable-1","kind":{"$type":"DataGrid","columns":[…],"exportable":true,"rowKeyField":"reference","source":{"$type":"Query","name":"settlements"}}}
```

It is the grid-behaviour rule (§3.6.9) reached by a node that writes no state. Every other member of
that family — `sortStateKey`, `pageStateKey`, `editStateKey` — names a State key because the behaviour
it declares WRITES something the grid then reads back, which is why a bare `sortable` / `pageable`
boolean is refused there. An export writes nothing: it produces a file and returns nothing to the
tree, so there is no key it could name, no descriptor whose shape this specification would have to
fix, and no reader of that key to disappoint. The boolean is the whole declaration.

**Host obligation.** A host that admits this member and can present a control performs three things.
Each is normative, and the third is the one a host is most likely to get wrong in a way that looks
right.

1. **The control is the GRID's.** A host draws the export affordance as part of the grid, and a
   conforming host does not require the document to supply a button. This is the same rule the pager
   follows and for the same reason: the control that serialises the rows and the grid that holds them
   must not be able to come apart.
2. **What it exports is what the HOST HOLDS FOR THAT GRID, as the reader is seeing it** — the grid's
   resolved rows in their current order, projected through the columns the document declared, in the
   order it declared them. A host that has sorted the rows for the reader exports them sorted. A host
   that has PAGED them exports the whole resolved set and not the page on screen.
3. **A host that holds only part of the data says so, and exports only what it holds.** Where the row
   source is host-paged — a `Query` whose `dependsOn` names the page key, §3.6.9 — the client holds one
   page, and a control that offered *export* without qualification would promise a dataset it cannot
   deliver. The obligation is to name the scope in the control's accessible name. **A full-dataset
   export over a paged source is host chrome and is deliberately outside this format:** the tree cannot
   substantiate data it does not hold, and a member asking a host to fetch every page would be asking
   the document to describe a fetch rather than a rendering.

**Cell text.** A cell is exported as the text the reader is looking at: the column's own value
projection, rendered through the column's own declared `format`. This is stated normatively because
the alternative is defensible and would produce different bytes — exporting the underlying number or
timestamp would hand back a file matching neither what the reader sees nor what the source would
serve, and a host that chose it would diverge from every other host with nothing in the corpus to
catch it. The consequence is accepted rather than hidden: a currency-formatted column exports as text
a spreadsheet will not sum.

**No new delivery instruction.** Handing the file over uses whatever mechanism the host already has
for a download — on a browser host, a url and a suggested name. Nothing is added to the
client-effect vocabulary for this member.

**Nothing is reported back.** The export yields no value, no callback and no event: a host MUST NOT
tell the tree whether the reader kept the file. It is therefore, like `Action.Print`, an effect the
tree cannot use to observe the reader.

**A host that cannot export draws nothing.** A rendering with no scripting and no way to make a file
— a static server rendering, an email projection — emits the grid exactly as it emits a grid that
declares nothing, and specifically **does not** emit an inert control. An export button that cannot
export is worse than an absent one: it reads as a broken page rather than a degraded one. The
declaration still rides the wire to whatever tier can act on it.

Pre-emit: a host's authoring tier SHOULD report an `exportable` grid that names no row source, and one
that declares no columns (the columns are the file's fields, so with none the file has none). A grid
whose source merely RESOLVES to no rows is NOT a defect — the export of an empty grid is a header
record, which is a true statement about the data.

Fixtures: `nodes/grid-exportable-1.json` (the canonical shape — one new member and nothing else, so a
decoder that dropped it could not round-trip), and
`reject/reject-wrongtype-grid-exportable.json` / `reject/reject-wrongtype-grid-exportable-number.json`
(`WRONG_TYPE` at `$.kind.exportable`, two shapes because a decoder can refuse one non-boolean and
accept another). Omission polarity is pinned by every other grid fixture in the corpus, whose bytes
carry no `exportable` key at all.

**Host adoption.** Recorded here on the §11.0 convention: the reference F# host implements the codec,
the pre-emit rule and every render obligation above. Every other codec host in the §11.0 roster is
**pending** until its own change-set lands, on the §11 step-5 terms. A pending host is not thereby
exempt — it owes the behaviour and has simply not made its answer visible. The failure mode a pending
host presents here is a quiet one, as with `Action.Print`: a lenient decoder accepts the boolean and
draws nothing, so a reader is silently denied their data and no leg goes red — the §11.2 attestations
and this row, not the reject leg, are what make an unimplemented member visible.

---

### 3.6.16 `Action.WriteToClipboard` — the payload is a `TextSource` (Phase 1126)

`Action.WriteToClipboard`'s `text` member is a **`TextSource`**, not a bare string. The reader may
therefore be given a value the tree computed — a figure in the grid in front of them, a link the
session holds — and not only a literal the author typed at authoring time.

```json
{"$type":"WriteToClipboard","text":"https://example.com/share/abc123"}
{"$type":"WriteToClipboard","text":{"$type":"Bound","binding":{"$type":"State","key":"shareUrl"}}}
```

**Both of those are canonical, and the first one is not a legacy spelling.** `TextSource.Literal`'s
canonical form is the bare JSON string (§3.6's first 0.2.0 exception), so every document written
before this member widened carries bytes the encoder still emits and the decoder still reads — the
widening is source-breaking for a host's own construction sites and **wire-neutral**. What is new is
the second shape. The explicit `{"$type":"Literal","text":…}` envelope normalises down to the bare
string here exactly as it does at every other text slot (§16;
`lenient/lenient-1126-clipboard-literal-envelope.json`).

**A `text` that is neither a string nor a `$type`-tagged `TextSource` is `WRONG_TYPE`** at
`$.…​.text`, and a host MUST NOT coerce it. Vector:
`reject/reject-wrongtype-clipboard-payload.json`. The refusal carries more weight at this slot than
at an ordinary label: a host that read the widening as "this member is now open" would put a JSON
literal on the reader's clipboard, and a clipboard is a channel the reader later pastes somewhere
with authority.

**Host obligation — resolution happens at DISPATCH time.** A bound payload is resolved when the
reader raises the action, through the same binding resolution the host renders text slots with, so
what is copied is what the reader was looking at. Resolving at decode time would freeze the value at
the moment the document arrived, which for the shapes this widening exists for is the wrong value.
An unresolvable binding resolves to the empty string, as it does at every text slot; a missing i18n
key resolves the same way it does in a label. A host that cannot resolve at all in a given path
(a zero-JS resume interpreter holding no binding sources, say) MUST NOT write the declaration
itself — it either hydrates first or performs nothing.

**A server-driven host resolves BEFORE it lowers.** The client shim that performs the write holds no
resolver, no store and no catalogue, so the effect that crosses to it carries resolved text. This is
the division `Action.Navigate` already draws: the server decides what crosses, the shim performs it.

**Wire survivability: survivable** (§5.1) — a `TextSource` is data in all three arms.

**There is deliberately NO clipboard READ, and this is a decline rather than an omission.** A tree
that could read the clipboard without a paste gesture is a keylogger-adjacent capability: the
clipboard routinely holds a password, a one-time code or an address the reader copied for somewhere
else entirely, and a document that samples it at will has taken that without asking. Paste is
user-initiated by construction — the reader chooses the moment and the target — and that gesture,
not a vocabulary member, is the consent. Structured paste into an editable grid (below) is inside
that boundary for exactly this reason: it happens because the reader pasted.

**Structured paste into an editable grid is a HOST AFFORDANCE and reaches no member.** A grid that
declares `editable` and an edit destination (`editStateKey`, or a directly-`State`-sourced feed) has
already said that its cells are the reader's to change; whether they change one by typing or twenty
by pasting a tab- or comma-separated block is a property of that affordance, not a second capability
to declare. A host offering it MUST write through the same destination a typed edit uses, and MUST
NOT grow the grid: a block taller or wider than the space below and right of the anchor loses its
surplus, because the format has no row-insert and no column-add, and a `Query`-sourced grid's rows
are the host's to begin with. A host that offers nothing here is conformant — the grid still edits
cell by cell.

**Host adoption.** Recorded here on the §11.0 convention: the reference F# host implements the codec,
the dispatch-time resolution, the server-driven lowering and the paste affordance. Every other codec
host in the §11.0 roster is **pending** until its own change-set lands, on the §11 step-5 terms. A
pending host is not thereby exempt. Note what a pending host owes and what it does not: the
**legacy-accept obligation is already discharged by construction** — a host that decoded the bare
string before this phase decodes it still, because those bytes did not change — so what is pending is
the BOUND payload, which a host typing this member as `string` will refuse outright rather than
mis-handle. That is the loud failure mode, and it is the one to prefer.

---

### 3.6.17 `Rating` and `Color` — the score and the swatch (Phase 1130)

Two `FormFieldKind` cases, specified together because their one shared property is the one a host is
most likely to get wrong: **each carries a rule that is checked in more than one place, and neither
rule is a coercion anywhere.**

```json
{"$type":"Rating","allowHalf":true,"max":5,"onChange":"<closure>","value":{"$type":"Static","value":3.5}}
{"$type":"Color","value":{"$type":"Static","value":"#FFAA00"}}
```

#### `Rating`

**The line an emitter has to hold is one sentence:** a SUBJECTIVE SCORE on a small ordinal scale is
`Rating`; a NUMERIC QUANTITY the reader types or drags is `RangedNumber`. The test is who the number
belongs to — a rating is a judgement a person GIVES, a ranged number is a measurement they REPORT.
Both carry a floating-point value and a ceiling, which is exactly why the sentence is written down
rather than left to be inferred from the shapes.

**Members.** `max` is an `int` and is the case's only REQUIRED member: it is the scale, it is what the
control announces as `aria-valuemax`, and a rating with no declared ceiling is not a scale. **A `max`
of less than 1 is `WRONG_TYPE` and MUST be refused, not clamped** — a scale with no positions has
nothing to draw, nothing to announce and no keystroke that could change anything, so the document
names a control that cannot exist. `value` is a `Binding<float>` whose absent form is the ordinary
auto-bind; `onChange` carries `float`.

**The value is a float even where nothing can type a fraction, and this is normative rather than
incidental.** The commonest rating a reader sees is an AVERAGE — 4.3 of 5 over three hundred reviews,
arriving through a `Query` binding — and an integer slot could not carry it. A host **MUST** render a
fractional value as a partial position rather than rounding it: rounding would show the reader a
figure the document did not state.

**`allowHalf` omits at `false`, and the polarity is load-bearing.** The SHORTEST rating document is
the WHOLE-STAR one; halves are what an emitter has to ask for. A host MUST read an absent `allowHalf`
as `false`; a present member of any other type is `WRONG_TYPE` and MUST NOT be coerced.

**`allowHalf` governs ENTRY, never DISPLAY.** It is the granularity of a keystroke and of a pointer
commit; it says nothing about what a bound value may be. A host **MUST NOT** quantise a resolved
value to the granularity — a 4.3 average on a whole-star control is a correct document, and a host
that snapped it to 4 would be answering a question the author did not ask.

**It is a bool and not a `step`, deliberately.** A `step` slot would admit `0.3`, which is a valid
document naming an interaction no rating control has ever had, so the decoder would owe a refusal
enumerating exactly `{1, 0.5}` — at which point the float is a boolean wearing a wider type. It would
also give `Rating` and `RangedNumber` a third member in common, widening the very confusion pair the
sentence above exists to keep apart.

**Where the VALUE's bounds are checked, and where they are not.** The scale is refused at decode; a
value outside `0 .. max` is **not**, and the asymmetry is the design. A bound value is invisible to a
decoder, and a rule enforced only on literals would be two rules wearing one name. A host therefore
owes the value rule at the two places the value becomes visible: an authoring-time check over a
`Static` literal (the reference host's `FUARAN132`, a warning — the render path clamps, so the
document still renders), and a **server-side re-check on submission**, which is the only one that is a
trust boundary.

**Render obligations (normative, both tiers).**
1. **Nothing on the wire names a keystroke or a role.** Arrow / Home / End, the glyph, the partial
   fill and the announcement are the RENDERER's affordance under the affordance→op rule.
2. **An adjustable rating is `role="slider"`, not `role="radiogroup"`.** It carries
   `aria-valuemin="0"`, `aria-valuemax` from `max`, `aria-valuenow`, and an `aria-valuetext` giving
   the whole reading ("3.5 out of 5") — `aria-valuetext` being the only ARIA member that can announce
   a fraction at all. It is ONE tab stop; Arrow Right/Up and Left/Down move by the granularity and
   STOP at both ends (they MUST NOT wrap: a slider's ends are ends, and wrapping turns "one more
   star" into "none"), Home is 0 and End is `max`. A radiogroup is wrong for three reasons and they
   are worth stating: a rating is a magnitude and not a set of named options; a radiogroup cannot
   announce a fraction; and with `allowHalf` it would need `2·max` radios for one continuous quantity.
3. **A rating nothing can write is `role="img"`, carrying the whole reading as its accessible name,
   and takes no focus.** That is the bound-average display case. A slider a reader can focus and can
   never move is a fake affordance, and the honest markup for a picture of a score is a picture.
4. **A static (no-script) host that renders an ADJUSTABLE rating MUST still produce a working
   control**, and the floor is native radios — one per enterable position, grouped by the field's
   name. Zero-JS, a `role="slider"` element can be neither adjusted nor submitted; radios are
   keyboard-adjustable and submit with the form, and the user agent supplies the group semantics
   itself. A static host **MUST NOT** emit hand-written `role="slider"` / `aria-valuenow` on that
   markup, for §3.6.9's reason: a static value that can never change replaces the user agent's correct
   semantics with a claim inert markup cannot keep. The floor and the hydrated control differ because
   what each medium can HONOUR differs; a display-only rating has no interaction to floor, so both
   tiers emit the identical `role="img"` star row.
5. **A static host's radio floor may check nothing when the current value is a fraction that lands on
   no enterable position.** That is a recorded limit rather than a defect: the floor shows the
   positions a reader can choose, not the average.

#### `Color`

`FormFieldKind.Color` is the platform's own colour picker. Note what it is NOT: it is a CONTROL, and
not a `rule.format` — a `format` constrains the text a reader types into a text box, where this case
is a swatch that opens the operating system's colour picker, which no `format` on a `Text` field can
produce. The two do not overlap, and admitting this case leaves any decision about a `color` rule
format exactly where it was.

**Members.** Both optional: `value` is a `Binding<string>` and `onChange` carries `string`. The case
has no required member, so `{"$type":"Color"}` is a complete, auto-bound colour field.

**The value is `#rrggbb` and nothing else.** Six hexadecimal digits after a `#`, either case. That is
the one form a native colour input can hold or return, so it is the wire form too rather than a wider
colour syntax the control would silently narrow. **A `Static` literal outside that shape is
`WRONG_TYPE` and MUST be refused, not coerced**: `#fff`, `rebeccapurple`, `rgb(0 0 0)` and an alpha
channel are all documents naming a colour this control could never carry, and a host that narrowed one
would show a colour the document did not choose.

**Only the `Static` case is judged at decode, and the split is recorded rather than hidden.** A
`State` / `Query` / `Selection` binding carries its text from outside the document, where a decoder
cannot see it. A host owes the same rule at the two other places the value becomes visible: an
authoring-time check over a literal (the reference host's `FUARAN133`, an **error** — a tree carrying
a non-hex literal encodes to a document no conformant host will read back), and a **server-side
re-check on submission**. One rule, checked wherever the value becomes visible; a coercion at none of
the three.

**Case is PRESERVED, never normalised.** `#FFAA00` is a hex colour and round-trips byte-identically;
a codec that lower-cased it would fail the round-trip this corpus exists to pin. Browsers normalise at
the DOM, which is their business and not the wire's.

**Render obligations (normative, both tiers).** A host renders the platform's native colour input;
there is no ARIA to hand-write and no keyboard model to invent, because the element carries both. A
value that resolves to something the element cannot hold **MUST** fall back to the unset default
rather than being passed through — a native colour input substitutes its own default silently, so
handing it a bad literal would show a colour the document did not choose while the tree still said
otherwise.

#### Corpus

`nodes/form-rating.json` (whole stars, `allowHalf` omitted, a static value on a position),
`nodes/form-rating-halves.json` (`allowHalf` entry beside a ten-scale average whose value slot is
omitted entirely — the auto-bind), `nodes/form-color.json` (UPPER-CASE hex, preserved not normalised),
`nodes/filters-rating-colour.json` (both controls as declarative filter chips — a chip carries the
same control as a field since the 0.2.0 unification, and a corpus covering only the field route would
leave half the vocabulary unpinned), `reject/reject-rating-max-zero.json` (`WRONG_TYPE` at
`$.kind.fields[0].kind.max`) and `reject/reject-color-value-not-hex.json` (`WRONG_TYPE` at
`$.kind.fields[0].kind.value`).

### 3.6.18 `FileUpload` — the capture device (Phase 1116)

`FileUploadSpec.capture` names WHICH of the reader's own recording devices the platform should open
in place of the file browser. It is the **third** ingress route onto the control §3.6.10 gave the
other two, and the only one that PRODUCES a file rather than moving one that already exists.

| `capture` | What it asks for |
|---|---|
| absent (the default) | The ordinary file browser. Every document written before this revision says this. |
| `"Camera"` | The platform camera — a still or a short clip. |
| `"Microphone"` | The platform audio recorder. |

```json
{"$type":"FileUpload",
 "accept":["image/*"],
 "capture":"Camera",
 "label":"Photograph the receipt",
 "multiple":false,
 "onSelect":"<closure>"}
```

**It is a REQUEST, and its scope is exactly the file picker's.** A host asks the platform; the
platform decides. Nothing here opens a stream, previews one, records continuously, or acquires a
standing permission: the reader performs one gesture, the platform returns one file, and the control
is the same control it was. There is no display-capture case and there will not be one by widening
this member — a screen capture reaches every window the reader has open rather than one device
behind the picker, so it is a different class of thing and not a third spelling of this one.

**The member is OPTIONAL, not omit-at-default, and the distinction is real.** "Say nothing" is a
state of its own here: an upload naming no device is asking for the file browser, which is not one of
the two devices wearing a default. A host MUST read an absent member as *the ordinary picker*; a
present value outside `Camera | Microphone` is `UNKNOWN_DU_CASE` at `$.…capture` — a **bare** enum,
so the path carries no `.$type` suffix (§6) — and MUST NOT fall back to either device.

**`capture` and `accept` are ONE statement, and a host emits both exactly as declared.** The capture
request asks the platform for a recording device; WHICH device it opens is decided by `accept`. So a
document declaring `"Microphone"` under `accept:["image/*"]` opens a camera, and one declaring a
device under no filter at all gets whichever the user agent guesses. A host MUST NOT synthesise an
`accept` from the declared device: that would put a filter in the document's mouth that nobody wrote,
make emitted markup depend on renderer defaults, and — the half that settles it — silently repair the
one case most worth reporting. An authoring surface SHOULD report the incoherent pair instead (the
reference tier's FUARAN134, a Warning); the wire carries what was written.

**Render obligations (normative, both tiers).**

1. **The projection is the two HTML attributes and nothing else.** A host emits the file input's
   `accept` from `accept` and its `capture` from this member. `capture`'s value is an enumerated
   HTML attribute whose keywords name a camera FACING, so the projection is `Camera` →
   `environment` and `Microphone` → `user`: both are conforming keywords, the facing constrains only
   a camera, and a host MUST NOT emit the device name itself, which is not a keyword and is
   non-conforming markup.
2. **A device the platform does not have degrades to the picker, and that is the whole desktop
   story.** The user agent ignores an unsatisfiable `capture`; the control remains a fully working
   upload. A host owes NO code for this case and MUST NOT hide, disable or relabel the control on a
   platform it believes has no such device — a control removed on a guess is worse than a request
   the platform declined.
3. **A captured file is the same selection a picked one is.** It reaches the selection handler with
   the same shape, is bounded by `multiple` identically, and is filtered by `accept` identically. No
   new handler slot, no new `Action` case and no new event name is introduced — which is precisely
   what lets a capture reach every mechanism a pick already reaches.
4. **A static (no-script) host emits BOTH attributes, and this floor FULLY holds.** Unlike the two
   routes in §3.6.10 there is nothing to degrade: `capture` needs no listener, the user agent reads
   it off the markup, and a zero-JS document opens the camera exactly as a hydrated one does. A host
   that emitted the keyword without the filter would have a floor that held only by accident.

Fixtures: `nodes/upload-capture-camera-1.json` and `nodes/upload-capture-microphone-1.json` (the two
devices, each over the filter that selects it — a corpus carrying only the keyword would say nothing
about the half that makes it work, and a host reading the device off `accept` alone would decode both
correctly while being wrong about what either document says), `nodes/upload-1.json` unchanged (the
member OMITTED, which is what pins the polarity: every upload written before this revision is
byte-identical), and `reject/reject-unknown-capture-source.json` (`UNKNOWN_DU_CASE` at
`$.kind.capture` on `"Screen"` — the near miss an emitter will actually write, refused rather than
reserved).

---

### 3.6.19 `Tokens` — the multi-token input (Phase 1121)

`FormFieldKind.Tokens` is SEVERAL values accumulated as removable chips, over a suggestion set that
may be open, searchable, asynchronous, or absent entirely. Recipients, labels, skills.

```json
{"$type":"Tokens"}

{"$type":"Tokens",
 "allowFreeText":false,
 "onChange":"<closure>",
 "suggestions":{"$type":"Static","value":[{"label":"France","value":"fra"}]},
 "value":{"$type":"Static","value":["deu","fra"]}}
```

#### THE TRIANGLE — the line an emitter has to hold

**A CLOSED set small enough for a reader to scan is a `Select` with `multiple`; ONE value from a
large, searchable or asynchronous set is a `Combobox`; SEVERAL values — over a set that is open, or
that the document does not enumerate at all — is `Tokens`.** Two axes decide it: *how many values*,
and *whether the set is closed*.

The failure this exists to prevent is not an invalid document but a valid one, and there are two of
them. A multi-`Select` over a closed set parses, validates and renders — and cannot admit a value
nobody listed in advance, which is the whole of what a labels box is for. And **a `Combobox` PER
ITEM is not a smaller version of this control**: it is `N` single-value fields with `N` ids, no
gesture that removes the third entry, no way to say how many there may be, and a submission shaped
like `tag1`, `tag2`, `tag3` rather than one list. That second mistake is the one to watch, because it
is the one an emitter reaches for when it knows `Combobox` and has not met this case.

#### Members

Every member is OPTIONAL, so `{"$type":"Tokens"}` is a complete, useful document — the plain open
token box, which is the commonest shape this control takes.

`value` is a `Binding<string list>`, the SAME slot type the multi-select `values` has carried since
§`Select` multi-select. **The list is ORDERED and the order is the reader's**: chips appear where they
were added. A host **MUST NOT** sort or de-duplicate the decoded list — both would rewrite a fact the
reader can see, and de-duplication would silently repair a document this specification says is wrong
(see *Duplicates*, below). `onChange` carries `string list`: the WHOLE list on every add and every
remove, never a delta, which is what lets the declarative write-back rewrite the slot and keep the
order with no host code.

`suggestions` is a `Binding<SelectOption list>` and is **optional**, which is the difference from
`Combobox.options` and the reason the next paragraph reads the way it does. **An asynchronous
suggestion source needs no vocabulary of its own**: a `Binding.Query` in this slot IS the async feed,
resolved by the same machinery every other query-bound slot uses, with `dependsOn` giving it the
dependency edge. Nothing in this case names a request, a debounce or a minimum query length.

**An ABSENT `suggestions` and an EMPTY one are different facts**, and a host must keep them apart: an
absent source means the control has no candidate set at all, and a resolved-empty one means it has a
set that is currently empty — which is also every asynchronous source's first frame. The render
obligations below turn on that distinction.

#### `allowFreeText` omits at `true`, and the polarity is the OPPOSITE of `Combobox`'s

This is the one thing about this case a host is most likely to get wrong, so it is stated normatively:
**a host MUST read an absent `allowFreeText` as `true` on `Tokens`, and as `false` on `Combobox`.** A
present member of any other type is `WRONG_TYPE` and MUST NOT be coerced.

The two differ because their sets differ. `Combobox.options` is REQUIRED, so a combobox always has a
candidate set and "constrained" is its resting state; `Tokens.suggestions` is optional, so a token box
with nothing to suggest is the commonest shape rather than a degenerate one, and "open" is its resting
state. **The default follows the required-ness of the set** — one rule, not two habits — and it is what
makes the shortest document of each case the useful one.

#### The one decode refusal, and the two rules that are deliberately not refusals

**`allowFreeText: false` with NO `suggestions` member is `WRONG_TYPE` and MUST be refused.** No
gesture could put a token into that field: it admits nothing typed and offers nothing to pick, so the
document names a control that cannot exist rather than a control with a bad value in it. Under the
polarity above it is reachable only DELIBERATELY, which is what makes refusing it right rather than
hostile.

Two rules are **not** decode refusals, and the asymmetry is the design:

- **DUPLICATES.** A token list is a set the reader sees as chips, and two identical chips are one fact
  drawn twice with two remove buttons that do different things. A duplicate is nonetheless **not**
  refused at decode, because duplication is a property of the VALUE and a bound value is invisible to
  a decoder — a rule enforced only on literals would be two rules wearing one name. A host owes it at
  the two places the value becomes visible: an authoring-time check over a `Static` literal (the
  reference host's `FUARAN136`, a warning) and a **server-side re-check on submission**.
- **MEMBERSHIP.** Likewise: whether a token is in the suggestion set is a question about a resolved
  set, which a decoder does not have. A closed field over a `Static` and EMPTY suggestion list is the
  remaining unusable shape and is reported at authoring time (the reference host's `FUARAN135`, a
  warning — the document decodes and renders; what is wrong is that no reader can use it).

#### Render obligations (normative, both tiers)

1. **Nothing on the wire names a keystroke.** Enter, Backspace, Delete, the arrow walk, the chip row
   and the suggestion popup are the RENDERER's affordance under the affordance→op rule. A host MUST
   NOT expect a document to configure them and MUST NOT add wire vocabulary for them.
2. **A client-tier host renders the chips as a `role="list"` of `role="listitem"`, each carrying a
   real `<button>` that removes it.** NOT a `role="listbox"` of `role="option"`, and the three reasons
   are worth stating because the listbox reading is the one a writer reaches for first. A listbox is
   for CHOOSING from candidates, and these are not candidates — they are the value, already chosen,
   and the candidates live in the suggestion popup, which IS a listbox. `aria-selected` has no honest
   value on a chip: every chip is selected, and none can be deselected. And the gesture a chip offers
   is REMOVAL, which is a button — a real one carries the platform's own name, role, focus ring and
   activation, none of which `role="option"` does. **Each remove control's accessible name MUST name
   the token it removes**; a row of buttons all reading "Remove" is a row a screen-reader user cannot
   tell apart.
3. **The entry input carries `role="combobox"` ONLY where a suggestion source was declared** (with
   `aria-expanded`, `aria-controls` naming the popup, `aria-autocomplete="list"` and
   `aria-activedescendant` naming the active suggestion — §3.6.9's pattern exactly, because it is the
   same affordance). With no suggestion source it is a plain text input and a host **MUST NOT** emit
   combobox ARIA: a `role="combobox"` with nothing to expand is the same overclaim §3.6.9 forbids a
   static host to make.
4. **A `allowFreeText = false` refusal MUST be announced, not swallowed.** A control that ignores a
   keystroke without saying why reads as broken. The refusal is an AFFORDANCE and never a gate: per
   §22's standing posture, client validation is not a trust boundary, so **a host that accepts
   submissions MUST re-check membership and uniqueness server-side**, exactly as it re-checks every
   other declared constraint.
5. **A static (no-script) host's floor is ONE TEXT INPUT carrying the tokens comma-and-space
   separated.** A chip row is BUILT by a keystroke handler; zero-JS there is no gesture that adds a
   chip, none that removes one, and a row of static chips with dead remove buttons would be an
   affordance inert markup cannot honour. A `<datalist>` of the resolved suggestions MAY accompany it,
   on §3.6.9's trade. Two limits are **recorded rather than claimed as coverage**: a token CONTAINING
   A COMMA does not survive the projection (it re-parses as two — escaping it would put a quoting
   grammar into a medium no reader can see, trading a visible limit for an invisible one), and
   `allowFreeText = false` is not enforceable, since a text input has no native membership constraint.
   The declaration rides as `data-fuaran-tokens-constrained` so a reader can see it was not silently
   dropped; nothing in the platform reads that attribute.

#### Corpus

`nodes/form-tokens-freetext.json` (the SHORTEST spelling — `allowFreeText` omitted, no suggestion
source, value auto-bound; the omission is what pins the polarity, since a host reading absence as
`false` would refuse these bytes as a control that admits nothing),
`nodes/form-tokens-suggested.json` (the constrained shape over a static source, carrying
`["deu","fra"]` — deliberately not alphabetical, so a host that sorted the list fails the byte
round-trip), `nodes/form-tokens-query.json` (the `Query`-bound suggestion feed with `dependsOn`,
declarative and auto-bound), `nodes/filters-tokens.json` (the same control as a filter chip — a chip
carries the same control as a field, and a corpus covering only the field route would leave half the
vocabulary unpinned), `reject/reject-tokens-value-not-list.json` (`WRONG_TYPE` at
`$.kind.fields[0].kind.value` — a bare string refused rather than lifted into a one-element list) and
`reject/reject-tokens-closed-without-suggestions.json` (`WRONG_TYPE` at
`$.kind.fields[0].kind.allowFreeText` — the one cross-member refusal).

---

### 3.6.20 `FileUpload` — the streamed destination (Phase 1117)

`FileUploadSpec.destination` names the **host-registered destination** an upload streams its selected
files to. It is the fourth thing §3.6.10 and §3.6.18 have added to this control and the only one that
is about what happens AFTER the selection: the other three are ingress routes, this is egress.

```json
{"$type":"FileUpload",
 "accept":["video/*"],
 "destination":"session-recordings",
 "label":"Upload your recordings",
 "multiple":true,
 "onSelect":"<closure>"}
```

**It is a NAME, and it is a name because it must never be an address.** The string is an id the host
has registered with its own upload sink. A host resolves it against that sink's declared set and
refuses an id the set does not contain. It is not a URL, not a path, not a template, and nothing on
this member is ever fetched, joined to a base, or otherwise turned into one — which is the whole
point of the member existing in this shape. A wire document comes from an arbitrary emitter; a URL
here would let that emitter choose where a reader's file goes, and no host-side check on the string
could recover the guarantee that a registered name gives for free.

**What comes back is a REFERENCE and never the bytes.** A completed upload yields four values — a
sink-assigned id, a content digest, the size the sink accepted, and the type it recorded — and it is
those that reach the document's state, the host's telemetry, and any durable authoring record the
host keeps. This is the member's reason for existing: `Action.ReadFileBody` reads a whole body into a
string and hands it to the message loop, where under `Base64` or `DataUrl` it is a third larger than
the file and lands, on a host that persists its authoring channel, in a hash-chained record that
replays forever. `ReadFileBody` remains the correct answer for a small payload a handler needs in
hand. It is the wrong answer for a video, and the two are not deprecating each other.

**The member is OPTIONAL, and the empty string is REFUSED rather than read as absence.** Absent — the
default — is the pre-1117 control: the selection reaches the handler and nothing leaves the client,
so every upload document written before this revision is byte-identical and means what it always
meant. `""` is a name no host registers, so a document carrying it describes an upload that can never
stream: `WRONG_TYPE` at `$.…destination`, on the same line as a `Rating` whose `max` is below one.
Reading it as absence is the coercion this rule exists to refuse — it silently turns an upload the
author meant to stream into a client-only one, and every visible thing about the control still works.

**An UNREGISTERED non-empty id is NOT a decode refusal, and that division is deliberate.** Whether an
id is registered is a fact about the host, not about the document: the same bytes name a live
destination on one deployment and nothing on another. A decoder that judged it would make one
document's validity depend on who was reading it. The refusal belongs at dispatch, where the registry
is — and it is a refusal, loudly, never a fallback.

**Render obligations (normative, both tiers).**

1. **Two refusals stand in front of a transfer, in this order, and a host owes both.** First, the
   host's own dispatch policy decides whether this tree may cause an upload to this destination at
   all — the same gate a host applies to a call, a navigation or an export, and a host that denies by
   default denies this. Second, the host's upload sink is asked whether it serves the named
   destination. **There is NO FALLBACK at the second step**: the id is not tried as a path, as a URL,
   or against a default destination, because a fallback makes registration advisory, which is
   indistinguishable from not having it. A host with no upload sink at all refuses every declared
   destination.
2. **Every refusal is ANNOUNCED, never swallowed.** A reader who selected a file and got nothing must
   be told that nothing was saved, in a live region, whether the cause was policy, an unregistered
   destination, a size limit, a type limit or a transport failure. "Nothing happened" and "this was
   refused" are different facts and only one of them is actionable. A host MAY tell the reader less
   than it tells its operator — the reader is owed the outcome, not the host's configuration.
3. **Progress is surfaced, and an unknown total is an honest state.** A transfer at the size this
   member exists for is not instantaneous, so a host reports it as it goes. Where the sink cannot say
   how many bytes it expects, the host says that a transfer is running rather than inventing a
   proportion.
4. **The selection path is UNCHANGED.** `onSelect` fires exactly as it did before this member
   existed, with exactly the selection it always received. The transfer is a SECOND FACT about one
   gesture, not a second spelling of the first, and a host MUST NOT fold the reference into that
   handler: doing so means either firing it twice for one gesture or delaying it until the transfer
   finishes, which makes every existing upload handler asynchronous the day a destination is
   declared. Where the reference reaches the document, it reaches it by a host write.
5. **A declared destination and a body read are MUTUALLY EXCLUSIVE.** A host MUST refuse an
   `Action.ReadFileBody` against an upload that declares a destination. The document has said its
   bytes go to a sink and only a reference comes back; the body route contradicts that statement, and
   on a server-driven host it is the exact path by which a forged inbound event would put a reader's
   file into a durable record. The refusal is a refusal on both sides of any policy gate — a
   permissive host is refused as a denying one is, or the discipline is merely a preference.
6. **A static (no-script) host emits the plain control, and this floor DOES degrade.** Unlike
   `capture` in §3.6.18, a transfer needs a listener and a sink, so there is nothing a zero-JS
   document can do with the declaration. The control it renders is the fully working picker it was
   before this member existed. A host MAY record that the declaration was READ — the §3.6.10
   read-marker shape — and if it does, it records only THAT a destination was declared and never
   WHICH: the id is the host's registry key and a static document is readable by anyone.

Fixtures: `nodes/upload-destination-1.json` (the streaming upload, carried at the large-file shape
the member exists for — `video/*` and `multiple` — and deliberately WITHOUT `capture`, next to the
two §3.6.18 vectors that carry `capture` without a destination, so no host can read either member as
implying the other), `nodes/upload-1.json` unchanged (the member OMITTED, which pins the polarity),
and `reject/reject-upload-destination-empty.json` (`WRONG_TYPE` at `$.kind.destination` on `""` — the
coercion refused rather than the near miss).

---

### The declarative floor (Phase 430)

The design principle the 423–428 family enforces, stated once so the next spec author designs against it: **closures are overrides, never the floor.** Every interactive control's event surface has a declarative default (an omitted handler writes the change back to the control's own writable value binding – State/Filter/Selection store write-back); every data-display accessor has a declarative field-name form (`field` / `rowKeyField`); every result continuation has a declarative destination (`Call … into`); and — Phase 750, the same principle applied to *appearance* rather than behaviour or data — a cell's value-conditional **tone** has a declarative form (`CellKindErased.TonedPill`'s `field` + value→tone `map`) where the closure `Pill` erased the rule entirely. That last one is worth naming because it was the longest-standing hole in the floor and the least visible: `Pill` parsed, validated and rendered on a decoded tree, and rendered every row in the *same* tone, so the failure looked like a styling omission rather than an inexpressible intent. A slot that only works via a closure is dead on the decoded path – it parses, validates, renders, and does nothing. The machine-checked registry of every closure-bearing slot's posture (`WriteBack` / `FieldName` / `ResultTarget` / `HostOnly-by-design`) is `Fuaran.UI.SlotCapability` – a new closure-bearing spec field MUST add its row (the completeness test fails otherwise), and the dead-on-decode lint (`Fuaran.UI.DeadOnDecode.lint`, FUARAN080/081) flags sentinel slots on decoded trees with the declarative remedy. Relatedly, the **`queryResults` population contract**: `$queries.*` population is a host concern – the host feeds `BindingSources.QueryResults`, or a declarative `Call … into Query <name>` (Phase 428) writes it live; decoded trees own the *names and edges* (`Query.name`, `dependsOn`, `into`), never the fetch itself.

## 4. Closure-bearing slots → `"<closure>"`

Every function-typed payload the encoder cannot observe renders as the sentinel string `"<closure>"`. The decoder reconstructs each as a **placeholder** that re-encodes to the same `"<closure>"` sentinel, keeping the round-trip byte-stable. The slots are:

- `Action.Dispatch _` → encodes as the bare `{"$type":"Dispatch"}` – 0.2.0: the `msg` sentinel field is OFF the wire (no decoder ever read it; pure token weight). On decode `Action.Dispatch (box "<closure>")`.
- `Action.Call(endpoint, _, _)` → endpoint string preserved; a `Some` `onResult` is `"<closure>"` (omitted when `None` – Phase 428; the declarative `into` target IS wire-carried data, not a closure).
- `Action.ReadFileBody(file, encoding, _)` → `file.Id` carried as the `fileRef` string + `encoding` as a bare enum; the blob (`file.Handle`) never serialises and `onRead` is `"<closure>"`. The decoded `FileRef` carries `Handle = None`.
- `FormFieldKind.*` `onChange` / `onToggle`; `SelectSpec.OnChange` / `OnChangeMulti`, `TabsSpec.OnSelect` / `OnSelectTag`, `Disclosure.OnToggle` → emitted **only when present** (Phase 426 – an omitted handler arms the write-back default); a present sentinel decodes to `Some` no-op placeholder. `FileUploadSpec.OnSelect` and `StepperSpec.OnSelect` stay always-emitted closures decoding to a no-op action.
- `CellKindErased.*` handlers (`onEdit` / `onToggle` / `onClick` / `get` / `labelFn` / `hrefFn` / `toneFn` / `fractionFn` / `fn`).
- `GridSpec.OnRowClick`, `ChartSpec.OnPointClick`, `MapSpec.OnMarkerClick` → emitted **only when present** (rule 4); the value is `"<closure>"`. (There is no separate table spec record: a static table is the `staticRows` mode of `GridSpec` (§3.2) and is non-interactive, so it contributes no closure slot.)
- `Binding.Query` / `Binding.Selection` accessors – 0.2.0: **OFF the wire entirely** (the encoder omits the `accessor` key; no decoder ever read it). A decoded case synthesises the **identity projection** (Phases 421/427), so the host-fed `queryResults` / store-written selection flows through. `Binding.Computed` `fn`, `Column.Value`, `GridSpec.RowKey` keep their `"<closure>"` sentinels.
- `Binding.Local` `onCommit` / `format` / `parse` (the `flushOn` DU and `initialFrom` binding ARE encoded).
- `StateBehaviour.OnError` (the whole `ErrorPayload -> Node` callback).

The orchestrator's typed re-attachment happens downstream via `moduleMsgDecoder`. **The decoder is structural; type recovery is the host's responsibility.**

**Consequence (v1 limitation):** two ops differing *only* in an opaque `'Msg` / closure payload (e.g. `Dispatch (SelectRow 1)` vs `Dispatch (SelectRow 2)`) hash identically. The hash chain still detects structural tamper (op kind, NodeId, slot, fixed values, tree shape); it does not detect tamper purely inside an opaque payload.

---

## 5. `Binding.Static` payloads – typed forms + the residual `"<opaque>"` boundary

**Typed Static payloads (Phase 429).** The `Static` payload shapes the language itself enumerates encode **typed** – the encoder emits the same shape the typed decoders parse, so `encode ∘ decode` is byte-stable AND `decode ∘ encode` is value-faithful for them. The typed shapes, per slot:

| Slot(s) | Payload type | Typed wire form | Empty / `None` form |
|---|---|---|---|
| `FormFieldKind.Choice` / `SegmentedChoice` / `Combobox` `.options`, `FormFieldKind.Tokens.suggestions` (forms and filter chips), `SelectSpec.source` | `SelectOption list` | array of `{"label":<TextSource>,"value":<string>}` | `[]` |
| the same specs' `.value` — the single-value ones, i.e. every one above except `Tokens`, whose `.value` is the `string list` row below | `string option` | the plain string | `null` |
| `SelectSpec.values` (multi-select, Phase 291), `FormFieldKind.Tokens.value` (Phase 1121) | `string list` | array of strings, **in the document's own order** — never sorted, never de-duplicated | `[]` |
| `SparklineSpec.source` | `float seq` | array of numbers (rule 5 layout) | `[]` |
| `MapSpec.source` | `MapMarker seq` | array of `{"label":<TextSource>,"latitude":<number>,"longitude":<number>}` | `[]` |
| `GridSpec.source` / `ChartSpec.source` – the grid / chart / table **row feed** (Phase 665) | `Row seq`, where `Row` is an **open** `string`→scalar map (not a fixed record) | array of row objects – see *Row payloads* below | `[]` |
| `FormFieldKind.Range.value` | `float * float` | bare `{"max":<number>,"min":<number>}` – no `Static` envelope (Phase 423 shape, kept at 0.2.0) | – (both bounds always present) |
| `FormFieldKind.DateRange.value` | `string * string` | bare `{"from":<iso>,"to":<iso>}` – no `Static` envelope (the `Range` posture, 0.7.0); ordered, `from <= to` by ordinal compare | – (both ends always present) |

The typed encoding applies at the binding's `State.defaultValue` position too, and recursively through `Local.initialFrom` – the whole `Binding` in a typed slot is typed, not just the `Static` case. **This is not a footnote for the row feed**: the canonical editable-grid authoring shape is a `State`-sourced rows array (`nodes/grid-editable-state.json`), so a host that routes only `Static.value` through its slot-typed parser leaves the *principal* case un-normalised. Route every value-carrying `Binding` arm.

**Row payloads (Phase 665).** A row feed encodes as a JSON **array of row objects** – one object per row, its keys the row's field names, Ordinal-sorted within each row like every other canonical object (§2 rule 2). An empty feed encodes `[]`, **never** `null`. Cells are scalars under rule 11's recognised set (string / bool / int / int64 / float / float32 / `DateTimeOffset` / `DateTime` → Unix seconds); a `null` cell **omits its key** (rule 4 – absence is structural, the wire has no null); anything else renders the `"<opaque>"` sentinel *in that cell position only*. Decoded numbers surface as one number population, and an integral number renders in integer form per rule 5's shortest-round-trip layout – so a host whose runtime has a single numeric type emits bytes identical to one whose boxed types are exact. (That last point is a **conformance requirement, not an optimisation**: a host testing `int` before `float` will diverge on any runtime where every number satisfies every numeric test. Test `float` first.) Canonical fixtures: `nodes/grid-editable-state.json` and `nodes/chart-state-rows.json` (a `State`-sourced feed on both node kinds), `nodes/grid-1.json` and `nodes/chart-1.json` (a `Static`-sourced feed).

Rows carry **scalar cells only**. A cell that is itself an object or an array decodes structurally (so a lenient ingest is not rejected) but is display-opaque and re-encodes as the `"<opaque>"` cell sentinel – the residual boundary, narrowed from the whole slot to the cell seam.

**The residual-opaque boundary (by design).** A `Static` payload the language does NOT enumerate – a host domain record, a `PropValue.Native` op value, and (per *Row payloads* above) a **non-scalar cell inside a row** – still renders `"<opaque>"` under rule 11's best-effort primitives. This is deliberate: the wire never invents structure for content only the host can decompose; the decoder passes the sentinel through and **MUST NOT** attempt to reconstruct the original CLR type – the host's per-app schema re-hydrates downstream (`moduleMsgDecoder`). Nothing else falls through the catch-all silently: a new slot-typed payload shape MUST land its typed encoder + decoder + corpus fixtures in one §11 change-set, or be added to the residual list here.

**The row feed LEFT this list at Phase 665**, and it was the last *enumerable* payload on it. The list above is now exactly the content the wire genuinely cannot decompose – a host's own CLR/runtime object. Note what the removal cost: a row is an open name→scalar map, so a host domain record can no longer *be* a row; an author projects to that map first. That is precisely what makes rows wire-expressible, and it is why the boundary **disappeared** for the slot rather than narrowing within it. The visible consequence in the corpus is that no fixture under `nodes/` carries `"<opaque>"` any more – the sentinel now appears only in `lenient/` inputs (read-compat) and in the two typed *placeholder* re-encodes below.

**Read-compat (indefinite).** Two legacy wire forms – what the earlier encoder produced for a slot before it gained its typed form (pre-429 for the options / values / series / marker slots, pre-665 for the row feed) – stay decode-accepted at every typed slot:

- `"<opaque>"` → a **tagged placeholder**: options → `[ { Value = "<opaque>"; Label = Literal "<opaque>" } ]`; `string option` → `Some "<opaque>"`; `string list` → `[ "<opaque>" ]`; float / marker seqs → empty; **row feeds → the empty feed**, re-encoding as `[]`. A placeholder's re-encode is its **typed** form (e.g. the one-element placeholder options array) – pinned cross-host by the `lenient/lenient-opaque-static-*` corpus fixtures, and for rows by `lenient/lenient-665-rows-opaque-sentinel` (a `State`-sourced feed) and `lenient/lenient-460-explicit-default-column` (a `Static`-sourced one).
- `null` → the typed empty form (`[]` / `None`). This was the pre-429 F# boxes-to-`null` asymmetry (`box ([] : 'a list)` and `box None` are null references, which the old encoder wrote as JSON `null`); pinned by `lenient/lenient-null-static-options`.

**The rows sentinel stays decode-accepted indefinitely**, exactly like the two forms above. Every tree persisted, permalinked, or op-stream-logged before Phase 665 carries `"<opaque>"` in its row-feed position; each such feed decodes to the **empty feed** and re-encodes as `[]`. This is a deliberate, permanent read-compat obligation on every conformant host, not a migration window – decoding is lenient, but the sentinel is never *emitted* for a row feed again. The rows are not recoverable (they were never on the wire); what the rule buys is that an old tree still decodes and renders as an empty grid rather than failing.

For a genuinely residual-opaque slot, the old rule still holds: the substituted placeholder must itself re-encode to `"<opaque>"` (a non-null reference of a non-recognised type). The invariant there remains `encode(decode(encode(x))) == encode(x)`, not value preservation – residual-opaque content is intentionally lost. Since Phase 665 that invariant governs the **cell** seam and the non-enumerated `Static` payloads listed above; the row feed itself is now value-faithful, so for it the stronger invariant holds – `decode ∘ encode` preserves the rows.

**Render semantics of an opaque options source (cross-host contract).** The placeholder above keeps the *codec* round-trip byte-stable, but it is **not** authored data and **MUST NOT** reach the DOM. For an options-bearing control (`Select` / `Choice` / `SegmentedChoice` – forms and filter chips alike) whose options binding is an opaque/non-array `Static` source, every conformant renderer emits **no concrete options** – only the control's own structural placeholder option (the empty-valued ` – ` entry where one is rendered). The decoder's `[ { Value = "<opaque>"; … } ]` placeholder is dropped at render time, never shown as a selectable `<option>`. The TS host realises this through its `asArray` coercion (a non-array source resolves to `[]`); the F# host strips the opaque placeholder in `resolveOptions`. This is a renderer-behaviour contract, not a wire-shape change – the JSON is unchanged and still round-trips identically. (Settled in workspace Phase 131; it superseded the earlier dual-host `form-1` parity gap.)

---

## 5.1 Wire-survivability boundary (Phase 378)

Sections 4 and 5 define the two erasure sentinels – `"<closure>"` (a function value) and `"<opaque>"`
(a non-enumerated `Binding.Static` payload). This section **names the boundary once, across the whole
author-facing vocabulary**: which constructs survive the wire faithfully vs which erase and become
invisible to op-stream replay, structural diffing, AiTools introspection, and the TypeScript / Python
hosts.

**Verdicts.** *survivable* – round-trips value-faithfully. *host-only* – the whole case erases to a
sentinel; a decoded / replayed / introspected tree sees an inert placeholder (dead on decode).
*partial* – a survivable skeleton with a closure/opaque **sub-field** that erases (the sub-field's
posture is enumerated per-slot in Section 4 and machine-checked by `Fuaran.UI.SlotCapability`).

This table is a projection of **`Fuaran.UI.WireSurvivability`** (the authoritative, code-side
classification), which the `WireSurvivability` coverage test asserts covers **every** union case of
every DU below – so a new `NodeKind` / `Binding` / `Action` / ... case cannot ship unclassified. The
build-time `Fuaran.UI.Validator` `WireSurvivabilityCheck` (**FUARAN084**) steers authors off the one
cleanly-detectable whole-case escape, `Binding.Computed` (advisory when hand-authored, Error in
orchestrated / AI-emitted contexts); the runtime `DeadOnDecode` lint (FUARAN080/081) covers the
type-dependent cases (opaque `Static`, closure grid columns).

**The declarative escape ladder** – every host-only / partial case has a wire-survivable alternative
(the *Recoverable alternative* column): omit an event handler to arm the renderer's **write-back
default** (`Binding.State` / `Binding.Filter`); use `Column.Field` + `CellFormat` instead of a closure
grid column; use `Binding.Transform` (data derivation) / `Binding.Format` (formatting) / `Binding.State`
instead of `Binding.Computed`; use `Action.Call ... into: State/Query` instead of an `onResult` closure.
**`NodeKind`**

| Case | Wire | Recoverable alternative |
|---|---|---|
| `NodeKind.Layout` | survivable | – |
| `NodeKind.Display` | survivable | – |
| `NodeKind.Input` | survivable | – |
| `NodeKind.Visualisation` | survivable | – |
| `NodeKind.Custom` | survivable | – |
| `NodeKind.ErrorBoundary` | survivable | – |
| `NodeKind.Switch` | survivable | – |
| `NodeKind.FragmentDecl` | survivable | – |
| `NodeKind.FragmentRef` | survivable | – |
| `NodeKind.Mount` | partial | – |

**`LayoutKind`**

| Case | Wire | Recoverable alternative |
|---|---|---|
| `LayoutKind.Box` | survivable | – |
| `LayoutKind.SplitPanel` | survivable | – |
| `LayoutKind.Tabs` | partial | omit the handler – the renderer's write-back default writes the change to the control's writable Binding.State / Binding.Filter value slot |
| `LayoutKind.Stepper` | partial | – |
| `LayoutKind.SummaryList` | survivable | – |
| `LayoutKind.Disclosure` | partial | omit the handler – the renderer's write-back default writes the change to the control's writable Binding.State / Binding.Filter value slot |
| `LayoutKind.Modal` | survivable | – (both Phase 1119 members are plain wire data: `modality` a bare enum, `anchor` a string) |
| `LayoutKind.ScrollArea` | survivable | – |

**`DisplayKind`**

| Case | Wire | Recoverable alternative |
|---|---|---|
| `DisplayKind.Heading` | survivable | – |
| `DisplayKind.Markdown` | survivable | – |
| `DisplayKind.Metric` | survivable | – |
| `DisplayKind.Badge` | survivable | – |
| `DisplayKind.Sparkline` | survivable | – |
| `DisplayKind.Callout` | survivable | – |
| `DisplayKind.Progress` | survivable | – |
| `DisplayKind.Skeleton` | survivable | – |
| `DisplayKind.LabelValueRow` | survivable | – |
| `DisplayKind.Link` | survivable | – |
| `DisplayKind.Image` | survivable | – |
| `DisplayKind.List` | survivable | – |
| `DisplayKind.Toast` | survivable | – |
| `DisplayKind.CodeBlock` | survivable | – |
| `DisplayKind.Math` | survivable | – |
| `DisplayKind.Fact` | survivable | – |
| `DisplayKind.Drawing` | survivable | – |

**`InputKind`**

| Case | Wire | Recoverable alternative |
|---|---|---|
| `InputKind.Form` | survivable | – |
| `InputKind.Filters` | survivable | – |
| `InputKind.Button` | survivable | – |
| `InputKind.FileUpload` | partial | – |
| `InputKind.Select` | partial | omit the handler – the renderer's write-back default writes the change to the control's writable Binding.State / Binding.Filter value slot |

**`FormFieldKind`**

| Case | Wire | Recoverable alternative |
|---|---|---|
| `FormFieldKind.Text` | partial | omit the handler – the renderer's write-back default writes the change to the control's writable Binding.State / Binding.Filter value slot |
| `FormFieldKind.Number` | partial | omit the handler – the renderer's write-back default writes the change to the control's writable Binding.State / Binding.Filter value slot |
| `FormFieldKind.Checkbox` | partial | omit the handler – the renderer's write-back default writes the change to the control's writable Binding.State / Binding.Filter value slot |
| `FormFieldKind.Choice` | partial | omit the handler – the renderer's write-back default writes the change to the control's writable Binding.State / Binding.Filter value slot |
| `FormFieldKind.TextArea` | partial | omit the handler – the renderer's write-back default writes the change to the control's writable Binding.State / Binding.Filter value slot |
| `FormFieldKind.Range` | partial | omit the handler – the renderer's write-back default writes the change to the control's writable Binding.State / Binding.Filter value slot |
| `FormFieldKind.RangedNumber` | partial | omit the handler – the renderer's write-back default writes the change to the control's writable Binding.State / Binding.Filter value slot |
| `FormFieldKind.SegmentedChoice` | partial | omit the handler – the renderer's write-back default writes the change to the control's writable Binding.State / Binding.Filter value slot |
| `FormFieldKind.Date` | partial | omit the handler – the renderer's write-back default writes the change to the control's writable Binding.State / Binding.Filter value slot |
| `FormFieldKind.DateRange` | partial | omit the handler – the renderer's write-back default writes the change to the control's writable Binding.State / Binding.Filter value slot |
| `FormFieldKind.Combobox` | partial | omit the handler – the renderer's write-back default writes the change to the control's writable Binding.State / Binding.Filter value slot. `allowFreeText` and the option source are DATA and survive intact; the erasure here is the handler alone |
| `FormFieldKind.Rating` | partial | omit the handler – the renderer's write-back default writes the change to the control's writable Binding.State / Binding.Filter value slot. `max` and `allowHalf` are DATA and survive intact; the erasure here is the handler alone |
| `FormFieldKind.Color` | partial | omit the handler – the renderer's write-back default writes the change to the control's writable Binding.State / Binding.Filter value slot |
| `FormFieldKind.Tokens` | partial | omit the handler – the renderer's write-back default rewrites the WHOLE token list into the control's writable Binding.State / Binding.Filter value slot on every add and remove, which is what preserves the reader's own chip order on a decoded tree. `allowFreeText` and the suggestion source are DATA and survive intact; the erasure here is the handler alone |

_(The `FilterKind` table is retired at 0.2.0 – filter chips are `FormFieldKind` controls; see the rows above.)_

**`VisKind`**

| Case | Wire | Recoverable alternative |
|---|---|---|
| `VisKind.DataGrid` | partial | use Column.Field + CellFormat instead of a closure Value; RowKeyField instead of RowKey; the click write-back default for OnRowClick. The **row feed on `source` is survivable** since Phase 665 (§5) – the remaining erasure in this kind is its closure slots, not its data |
| `VisKind.Chart` | partial | – |
| `VisKind.Map` | partial | – |

`GridSpec.staticRows` is itself **survivable**: its `TextSource` headers and cells round-trip
value-faithfully, so a static table's content is visible to op-stream replay, structural diffing,
and every host. Since Phase 665 the same is true of the row feed a data-bound grid's `source`
carries (§5), so the two modes no longer differ in survivability — only in meaning (§16.1). There is
no separate table spec record on the wire (§3.2); the retired `Table` kind's surface lives here.

**`CellKindErased`**

| Case | Wire | Recoverable alternative |
|---|---|---|
| `CellKindErased.Text` | survivable | – |
| `CellKindErased.Numeric` | survivable | – |
| `CellKindErased.Date` | survivable | – |
| `CellKindErased.Editable` | **host-only** | Column.Field + CellFormat for display; interactive edit needs host wiring |
| `CellKindErased.Checkbox` | **host-only** | – |
| `CellKindErased.Button` | partial | – |
| `CellKindErased.ButtonGroup` | partial | – |
| `CellKindErased.Link` | **host-only** | Column.Field projecting the href row property + a Text cell |
| `CellKindErased.Pill` | **host-only** | `CellKindErased.TonedPill` – a `field` + value→tone `map`, fully wire-expressible |
| `CellKindErased.TonedPill` | survivable | – |
| `CellKindErased.Progress` | **host-only** | – |
| `CellKindErased.Custom` | **host-only** | – |

**`CellFormat`**

| Case | Wire | Recoverable alternative |
|---|---|---|
| `CellFormat.None` | survivable | – |
| `CellFormat.Number` | survivable | – |
| `CellFormat.Currency` | survivable | – |
| `CellFormat.Percent` | survivable | – |
| `CellFormat.SignificantDigits` | survivable | – |
| `CellFormat.Date` | survivable | – |
| `CellFormat.Custom` | **host-only** | one of the six typed CellFormat cases – they are the declarative set |

**`Binding`**

| Case | Wire | Recoverable alternative |
|---|---|---|
| `Binding.Static` | partial | a language-enumerated slot payload round-trips – including the grid/chart row feed since Phase 665; a non-enumerated value (a host domain record, a non-scalar cell inside a row) erases to "<opaque>" – prefer a typed slot, Binding.State / Binding.Filter, or Binding.Transform |
| `Binding.Query` | partial | – |
| `Binding.Filter` | survivable | – |
| `Binding.Selection` | partial | – |
| `Binding.State` | survivable | – |
| `Binding.Computed` | **host-only** | Binding.State / Binding.Filter for reactive values; Binding.Transform for derivation; Binding.Format for formatting |
| `Binding.I18n` | survivable | – |
| `Binding.Local` | partial | Binding.Format is the declarative twin of the Local format/parse closures |
| `Binding.Format` | survivable | – |
| `Binding.Transform` | survivable | – |
| `Binding.Invoke` | survivable | – |

**`Action`**

| Case | Wire | Recoverable alternative |
|---|---|---|
| `Action.Dispatch` | **host-only** | the substrate actions – Action.SetState / Action.Call / Action.Notify / Action.Navigate / Action.AiTool |
| `Action.Call` | partial | Action.Call with into: IntoState / IntoQuery is the declarative result target |
| `Action.Notify` | survivable | – |
| `Action.Navigate` | survivable | – |
| `Action.SetState` | survivable | – |
| `Action.AiTool` | survivable | – |
| `Action.Chain` | survivable | – |
| `Action.CommitLocal` | survivable | – |
| `Action.WriteToClipboard` | survivable | – |
| `Action.Print` | survivable | – |
| `Action.ReadFileBody` | partial | – |
| `Action.Invoke` | survivable | – |

**`TextSource`**

| Case | Wire | Recoverable alternative |
|---|---|---|
| `TextSource.Literal` | survivable | – |
| `TextSource.Bound` | survivable | – |
| `TextSource.I18n` | survivable | – |

**Design note - the `Binding.Computed` replacement spike (deferred, Phase 378).** Phase 378 assessed
introducing a bounded scalar-expression binding as a wire-survivable replacement for `Binding.Computed`,
to let the host-only escape retire entirely. **Decision: defer, do not adopt now.** Rationale: the
declarative, wire-survivable derivation path already exists - `Binding.Transform` carries a serialisable
`Fuaran.Core.DataFrame` pipeline *as data* (no closure on the wire) for data-bearing nodes, and
`Binding.Format` / `Binding.State` / `Binding.Filter` cover formatting and reactive scalars. The residual
gap is only *arbitrary scalar expressions*, for which no concrete demand is yet recorded, so
`Binding.Computed` stays as a clearly-marked F#-only escape (named here, in its `///` doc-comment, and
flagged by FUARAN084) rather than being replaced speculatively. This is **not pre-publish-gated**:
`Binding.Computed` already erases to `"<closure>"`, so keeping it does not shape the frozen wire, and a
future scalar-expression binding would be a purely *additive* `Binding` case (a minor-version change per
Section 15.4) - it can land post-publish if demand materialises. Tracked as a candidate follow-on, not a
blocker.

---

## 6. `DecodeError` envelope + the eight codes

Every wire-shape violation surfaces a **structured, recoverable** error (never a throw). The envelope:

```json
{ "Code": "<one of the eight codes>",
  "Path": "<JSONPath-ish location, e.g. $.kind.text>",
  "Message": "<human/AI-readable description>",
  "ExpectedShape": "<optional hint string>" }
```

`Path` uses a `$`-rooted dotted form. **`$type` appears literally in the path when, and only when, the DISCRIMINATOR is at fault** — that is, when the document carries a literal `"$type"` member whose value is not a recognised case (e.g. `$.kind.$type`, `$.kind.text.$type`, `$.kind.shapes[0].$type`). A **bare enum** — a plain JSON string in a named field, with no `$type` member at that position (`style.tone`, `kind.trendPolarity`, `accessibility.liveRegion`, `kind.protection`, `kind.staticRows.defaultSort.direction`) — carries no discriminator on the wire, so its `Path` is the **field's own, with no suffix** (`$.style.tone`). Both populations raise `UNKNOWN_DU_CASE`; they differ only in the path. A suffix appended to a bare enum names a JSON member the document does not contain and an author cannot repair at, which is why this is a rule rather than a stylistic preference. _(Phase 1073 ruled the bare-enum spelling. It is a clarification of the sentence this paragraph already carried, not a new decision — but it had to be made explicit, because three hosts including BOTH reference implementations appended the suffix uniformly and the §11 reject leg's prefix matching, below, is structurally blind to it.)_ The eight codes:

| Code | Raised when |
|---|---|
| `INVALID_JSON` | The input is not syntactically valid JSON (garbage, truncation, empty string). `Path` is `$`. |
| `MISSING_FIELD` | A required key is absent on a Node / Spec / Op object. `Path` names the missing key. |
| `WRONG_TYPE` | A value is present but the wrong JSON kind (e.g. `id` is a number, `children` is an object). |
| `UNKNOWN_DU_CASE` | A `$type` discriminator (or bare-enum string) is not a recognised case. `ExpectedShape` enumerates valid cases. |
| `WRONG_NODE_KIND` | The **top-level** `kind.$type` is not a recognised node kind – i.e. not one of the discriminators the §3.2 table enumerates, in any of its five recovered categories. Raised at `$.kind.$type`. (Deliberately not re-listed here: §3.2's table is generated and this sentence would be the copy that goes stale.) (Distinct from `UNKNOWN_DU_CASE` for the eval gate-1 surface.) |
| `EMPTY_NODE_ID` | An `"id"` field is present but the empty string. (Same defect the post-apply validator catches; surfaced at decode time to save the round-trip.) |
| `LIMIT_EXCEEDED` | A **§21 resource limit** is breached – node depth, JSON depth, string length, array length, or total node count. The input is well-formed JSON; it is refused for being structurally unbounded, which is why this is not `INVALID_JSON`. `Message` names the limit and the observed value. |
| `KIND_NOT_ADMITTED` | The document names a kind that a **§23 host-declared admission policy** does not admit. UNREACHABLE unless a host declared one, so it is the only code in this table that says nothing about the document: the same bytes decode clean at the default. Deliberately distinct from `WRONG_NODE_KIND` — that one means the vocabulary has no such kind, this one means the kind exists and this deployment does not take it, and the author repairs them differently. `Message` names the kind and the policy; `ExpectedShape` carries the admitted vocabulary. |

The <!-- fuaran:count kind=reject -->125<!-- /fuaran:count --> reject fixtures in the corpus exercise every code **except `LIMIT_EXCEEDED`**, whose fixtures are deliberately deferred until the hosts adopt §21 together (§21.5), **and `KIND_NOT_ADMITTED`**, which cannot appear in this family at all: a reject fixture asserts what the bytes are worth, and that code is raised by a declaration the bytes do not carry. Its cases live in [`decode-policy/`](decode-policy/) (§23), where each one names the policy alongside the document. Each manifest entry pins the `expectedErrorCode` and an `expectedPath` prefix. Node-side rejects additionally populate `ExpectedShape`; op-side rejects assert Code + Path only.

---

## 7. Number-edge handling (decode side)

Symmetric with rule 5. At a float slot, a conformant decoder accepts **both** forms:

- `JNumber n` → `n`
- `JString "NaN"` → NaN
- `JString "Infinity"` → +∞
- `JString "-Infinity"` → −∞

Integer slots truncate the parsed number via integer cast; round-trip is exact across the int53 range (any 32-bit int).

---

## 8. NodeId invariants

- `"id"` **present, non-empty string** → ok.
- `"id"` present but **empty string** → `EMPTY_NODE_ID`.
- `"id"` **absent** → `MISSING_FIELD` at `$.id`.
- `"id"` **wrong JSON kind** (number, object, …) → `WRONG_TYPE` at `$.id`.

The same rules apply at nested NodeId positions (e.g. an `InsertChild` child's `id` → `$.child.id`).

### 8.1 Uniqueness within a tree

**A NodeId identifies at most one node in a document.** No two nodes in one tree — at any depth, in
any slot — may carry the same `"id"`. Ids are scoped to the document, so the same id appearing in two
separate documents is unrelated and legal.

Two constructs are **isolation boundaries** and so start a fresh id space rather than extending the
host tree's: `Mount` (§3.2 — the guest interior is a separate scope, produced host-side by the guest
loader, and is never inlined into the host document) and `FragmentRef` (the referenced body is not
part of the referring tree). `FragmentDecl` is *not* a boundary — its `body` is walked, so uniqueness
there is **pre-expansion**: at render time interior ids are namespaced by the referring node, so one
body referenced twice yields DOM-unique ids without an authoring duplicate.

The invariant is load-bearing rather than tidy: **every `TreeOp` addresses its target by NodeId
alone** (§3.4). On a tree that repeats one, `UpdateProp`, `RemoveNode` and `MoveNode` name two nodes
and there is no tie-break — the op is ambiguous by construction, and an apply engine that picks one
is guessing. State re-seat has the same dependency: §17 step 6 **refuses** a teleport bundle whose
tree carries a duplicate, because re-seating state is keyed on stable identity.

**Where it is enforced — emit side, not decode side.** There is deliberately no eighth code for it:
duplicate detection is a whole-tree property, and a decoder streaming a document is not required to
carry the id set needed to detect one. So the obligation sits with the **emitter**, which must not
produce such a tree, and with the two whole-tree gates that see one entire — pre-emit validation
(before a tree goes on the wire) and bundle re-seat (§17). A decoder MAY reject a duplicate when its
shape makes detection free; a decoder that accepts one is still conformant, and the corpus's
round-trip family therefore proves nothing about uniqueness either way.

That gap is exactly how four `nodes/` fixtures came to repeat an id and round-trip cleanly for
months. The corpus now carries its own guard: every `nodes/` fixture is checked for duplicates as a
set, independently of round-tripping (§12).

---

## 9. Wire-omitted fields (by design)

The `Node` record's **host-only** fields are never emitted at all — no key appears for them — and a
decoder always sets them to their host-language default:

> **This table is generated** from [`idl.json`](idl.json) (§13) and must not be hand-edited — see
> [§12.2](#122-generated-tables-in-this-document). Its membership is exactly the node-envelope fields
> the IDL classes `hostOnly`.

<!-- fuaran:spec-wire-omitted -->
| Field | Host surface (F#) | Default on decode | Why omitted |
|---|---|---|---|
| `extraAttributes` | `Map<string, string> option` | `None` | The AI-opaque consumer-side hatch for `data-*` / `aria-*` test-hook attributes; the §4d JSON wire shape omits it on emit. |
| `motion` | `Motion option` | `None` | Motion is consumer-authored, not AI-authored. |
<!-- /fuaran:spec-wire-omitted -->

A conformant host that emits these fields would diverge from the canonical wire shape and fail the corpus.

**Not the same claim: the OPTIONAL node fields.** `accessibility`, `state` and `style` are optional
per rule 4 — absent from the wire when unauthored, and **present when authored**. They are therefore
not wire-omitted, and a host that dropped them would fail the corpus for the opposite reason. (This
section counted `accessibility` among the never-emitted fields until Phase 699, while its own row
said "present only when authored"; the generated table resolves the contradiction from the IDL.)

---

## 10. Known v1 limitations

A conformant host MUST reproduce these *exactly* so the corpus stays byte-stable across hosts. Any change that closes one of them is a single coordinated change across encoder + decoder + corpus + every host (§11).

### 10.1 Type fields not carried on the wire

One field exists on the typed surface but is **not part of the wire format**: the encoder does not emit it, and a conformant decoder restores the type's default. A host MUST NOT expect it on the wire:

- `ButtonSpec.Tooltip` – optional `TextSource`; decodes to `None`.

**Closed by Phase 126** (previously listed here as dropped – now carried, so these round-trip losslessly): `ChartSpec.Stacked` (`bool`, carried as `stacked`), `TabsSpec.ActiveIndex` (`Binding<int>`, carried as `activeIndex`). `TabsSpec.OnSelect` is a closure – it is now carried as the `"<closure>"` sentinel (§4) and decodes to a no-op action (its behaviour cannot round-trip, but the slot is no longer silently dropped). A decoder still tolerates the absence of `stacked` / `activeIndex` (legacy wire predating the change), defaulting to `false` / `Binding.Static 0`.

### 10.2 Other v1 limitations

- **Closures are placeholders** (§4); typed re-attachment is `moduleMsgDecoder`'s job.
- **Residual-opaque `Binding.Static` values lose typed content** (§5 – host-typed payloads only; the enumerated slot-typed payloads round-trip value-faithfully since Phase 429, and the grid/chart row feed joined them at Phase 665, leaving only host domain records, `PropValue.Native`, and non-scalar row cells); the host's per-app schema re-hydrates.
- **`AriaRole.Custom` vs named roles** both encode as the raw string (e.g. `"button"`); a decoder cannot distinguish `AriaRole.Custom "button"` from `AriaRole.Button` and prefers the named case. Encoder-side discriminator tagging would close this.

---

## 11. Forward-coupling rule (load-bearing)

### 11.0 The conformant-host roster

This table is the **single authoritative list of hosts** the forward-coupling obligations below (and
the §11.1 gate) are defined over. The numbered steps and the gate legs no longer name hosts inline – 
they reference *"every codec host in the roster"*, so adding a host is a one-line edit **here**, not a
sweep across the steps (the drift class this section closes: the step-5 list rotting behind the host
set as Python, Go, and Rust hosts came online).

| Host | Language | Package / repo | Role | Conformance bar |
|---|---|---|---|---|
| `fuaran` | F# | `Fuaran.UI.*` | **codec host** – the reference (generates the corpus) | round-trip byte-identity (§11.1 Leg A) |
| `fuaran-ts` | TypeScript | `@fuaran-ui/*` | **codec host** | round-trip byte-identity vs the corpus |
| `fuaran-py` | Python | `fuaran-py` | **codec host** | round-trip byte-identity vs the corpus |
| `fuaran-go` | Go | `fuaran-go` | **codec host** (headless) | round-trip byte-identity vs the corpus |
| `fuaran-rs` | Rust | `fuaran-rs` | **codec host** (headless + WASM client) | round-trip byte-identity vs the corpus |
| `fuaran-swift` | Swift | `fuaran-swift` | **render projection** over the Rust core – *not* a codec host | render-coverage over the node corpus |
| `fuaran-kt` | Kotlin | `fuaran-kt` | **render projection** over the Rust core – *not* a codec host | render-coverage over the node corpus |

**Codec hosts** independently encode + decode the canonical wire and are held to the §11.1
byte-identity legs. **Render projections** consume a codec host's already-decoded tree for native
rendering only; they never canonically *encode*, so they carry **no** byte-parity leg – their bar is a
render-coverage checklist over the node corpus (a new `NodeKind` lacking a renderer arm is a build
error in that native tier, but is not a *wire*-conformance failure). A native render surface sits on
the cheap side of the host/surface line precisely because it inherits the certified codec from the
Rust core rather than re-implementing one – the §11 forward-coupling tax lands on `fuaran-rs` once and
the native surface rides it.

**Render-obligation adoption (§13).** The render obligations are a *second* bar, orthogonal to the
byte-parity one above: a codec host can be byte-perfect and still fail every render obligation, and a
render projection that carries no codec leg at all still owes them for the kinds it renders. A host
adopts by driving its render suite from `render-fidelity.json`'s `obligations` arrays and reporting
every claim it does not assert, in the three-outcome shape §13 specifies. Adoption is per host and is
recorded here rather than inferred:

| Host | Render-obligation adoption |
|---|---|
| `fuaran` (F#) | **adopted** – the server-renderer suite enumerates from the artefact; nothing exempt |
| `fuaran-ts` | **adopted** – the server-renderer suite enumerates from the artefact; nothing exempt. Asserts all 19 declared claims in emitted HTML, the Phase 1128 batch's nine included |
| `fuaran-py` | **adopted** – asserts all 19 declared claims in emitted HTML; nothing exempt |
| `fuaran-go` | **adopted** – asserts all 10 in emitted HTML; nothing exempt. The hand assertions its renderer already carried are now reached *through* the artefact's enumeration rather than standing beside it |
| `fuaran-rs` | **adopted** – asserts all 10 in emitted HTML; nothing exempt. Stated over the server render emission, which is the single surface both its headless and WASM-client roles produce |
| `fuaran-swift` | **adopted** – asserts 8 of 10 over its render projections; declares 2 *exemptions*, `Image/alt-always-emitted` and `Image/figure-caption-outside-link`, both being claims about an emitted document this projection does not produce (no attribute bag, no anchor element, no network image loader) |
| `fuaran-kt` | **adopted** – asserts 3 of 10 (`Media/accessible-name-always`, `Media/no-autoplay-pathway`, `Custom/unregistered-custom-labelled`); declares 7 *exemptions* – with no playback engine and no network image loader the media arm is a labelled transport tile and the image arm a labelled placeholder box, so those claims are vacuous-and-stated rather than asserted |

A host that has not adopted is **not thereby exempt**: it owes the obligations and has simply not made
its answer visible. "Pending" here and "unchecked" in a host's own report are the same statement at two
scales, and both are recorded rather than silent.

**A declared exemption is a conformant answer; a silently absent obligation is not.** The two native
render projections carry exemptions because they render into a widget tree rather than a document, and
a checker asserting the absence of output a surface never produces would be a green that guards
nothing. What the bar requires of them is the same thing it requires of a host that asserts everything:
that the enumeration be the artefact's, so a newly declared claim arrives as a failing gate rather than
as a paragraph, and that whatever is not asserted be printed with its section and its reason on every
run.

**Contract-card adoption (§25).** A THIRD bar, and orthogonal to both above. Reading a contract card
is not implied by driving a render suite from the manifest: a host can enumerate
`unregistered-custom-labelled` from `render-fidelity.json`, correctly report it unchecked, and hold no
card reader at all. A host adopts by decoding the `cards/` corpus family (its `contract-card` /
`contract-card-bundle` decoder names) and by emitting the §25.4 degradation placeholder — the three-way
verdict marker included, since that is the part a conformance suite can assert.

| Host | Contract-card adoption |
|---|---|
| `fuaran` (F#) | **adopted** – codec, card store, and the server renderer's degradation path |
| `fuaran-ts` | **adopted** – card reader + validator in `@fuaran-ui/schema`, degradation path in the server renderer |
| `fuaran-py` | pending |
| `fuaran-go` | pending |
| `fuaran-rs` | pending |
| `fuaran-swift` | pending – a render projection owes §25.4 for the kinds it renders, and owes no codec leg |
| `fuaran-kt` | pending – as above |

**A pending host is unchanged, not broken.** §25.4's obligation is conditional on a card being
*available*, and a host with no card reader has none available for any identity, so its existing
identity-only placeholder is the conformant answer. What it cannot say is that it has adopted.

That is exactly the state the five roster hosts are now in, and it is why the two tables disagree.
Each adopted the render-obligation bar above while holding no card reader, so each asserts
`unregistered-custom-labelled` **for the uncarded path alone** — that the placeholder carries the
component identity, echoes no prop value, and invents no description — and each says so in its own
suite. Taking the obligation is not taking §25: these rows stay `pending` deliberately, and a reader
should not infer a card reader from an `adopted` row in the table above.

**Timed-advance adoption (`SwitchSpec.autoAdvanceMs`, Phase 1122).** A FOURTH bar, and narrower than
the three above because it is a single optional field rather than a family: a host adopts by decoding
the member (refusing a non-positive or fractional value, per §3), and — where it is a client tier that
drives interaction — by honouring the three WCAG 2.2.2 obligations recorded normatively with the
field. A codec-only or headless host owes the decode leg alone; the timer is not something a headless
emitter can run.

| Host | Timed-advance adoption |
|---|---|
| `fuaran` (F#) | **adopted** – decode + refusal, the client-tier advance/pause/stop state machine, the reduced-motion floor, swipe + arrow keys, and the static SSR floor |
| `fuaran-ts` | **decode adopted** (Phase 1128) – the member, and the refusal of a non-positive or fractional value. The three WCAG 2.2.2 interaction obligations are NOT claimed: this host has a client tier, so it genuinely owes them, and the row says so rather than reading its decode leg as the whole bar |
| `fuaran-py` | **decode adopted** (Phase 1128) – the member and the refusal. Its rendering tier is the static floor, which is the conforming answer here rather than a gap: advancing means writing a state key on an interval, and a static document has neither |
| `fuaran-go` | pending – headless, so the decode leg only |
| `fuaran-rs` | pending – decode leg, plus the interaction obligations in its WASM-client role |
| `fuaran-swift` | pending – a render projection owes the interaction obligations for what it renders, and owes no codec leg |
| `fuaran-kt` | pending – as above |

**A pending host is unchanged, not broken**, on this section's standing reading: the member is
optional, so a host that has not adopted it decodes every pre-1122 document exactly as before and
meets a document that carries the key with an `UNKNOWN` field it ignores or refuses per its own
policy. What it cannot say is that it advances.

**Streamed-upload adoption (`FileUploadSpec.destination`, Phase 1117).** A FIFTH bar, and the one
whose two halves are furthest apart. The decode leg is small — an optional string, with `""` refused
per §3.6.20 — and every host owes it. The DISPATCH leg is where the substance is, and only a host
that actually performs transfers owes it: the two refusals in front of a transfer, the announcement
of every refusal, the progress report, the unchanged selection path, and the mutual exclusion with a
body read. A codec-only or headless host owes the decode leg alone; it has no sink and performs no
transfer, so there is nothing there for it to get wrong.

| Host | Streamed-upload adoption |
|---|---|
| `fuaran` (F#) | **adopted** — decode + the empty-string refusal, the seam and its default-deny registry, the client-tier transfer with its gate, its typed refusals and its announced status line, the host write-back of the reference, the body-read refusal at the server-driven boundary, and the static floor |
| `fuaran-ts` | **decode adopted** (Phase 1128) — the member and the empty-string refusal, plus the static floor's read-marker, which records only THAT a destination was declared and never which. The DISPATCH leg is not claimed: this host has a client tier and therefore owes it |
| `fuaran-py` | **decode adopted** (Phase 1128) — the member, the empty-string refusal and the same read-marker. It performs no transfer, so it has no sink and owes the decode leg alone |
| `fuaran-go` | pending — headless, so the decode leg only |
| `fuaran-rs` | pending — decode leg, plus the dispatch obligations in its WASM-client role |
| `fuaran-swift` | pending — a render projection owes the dispatch obligations for what it renders, and owes no codec leg |
| `fuaran-kt` | pending — as above |

**A pending host is unchanged, not broken**, on the same reading: the member is optional, so a host
that has not adopted it decodes every pre-1117 document exactly as before and renders a document
carrying the key as the client-only upload it was. What it cannot say is that it streams — and,
specifically, it must not claim the §3.6.20 obligation that a body read is refused on a streaming
upload, because a host with no transfer has no streaming upload to refuse one on.

A machine-readable mirror of this roster (plus the generated vocabulary enumerations – see §11.2) is
the intended executable anchor in [`wire-format-fixtures/manifest.json`](./manifest.json),
so the roster can be mechanically enforced rather than doc-maintained; **until that lands this table is
authoritative.**

Adding a case to **any discriminator family on the wire** MUST, **in the same commit**, do all of the
following. A *discriminator family* is any union whose members are distinguished by a `$type` tag —
`NodeKind` and the per-kind `Spec`s are the visible ones, but the rule is deliberately stated over the
whole class, because the families nested *inside* a spec are exactly the ones that get missed:
`FormFieldKind` (the control vocabulary shared by `Form.fields[]` and `Filters.items[]`),
`CellKindErased` / `CellFormat` / `CellValue` / `ColumnWidth` (grid columns), `Binding<'T>`,
`Action<'Msg>`, `CallResultTarget`, `TextSource`, `Format` / `LocaleSource`, `BoxLayout`,
`Shape` / `CurveCommand` (drawing), `HoleDecl` / `HoleValueSpace` / `FragmentArg` / `Scalar`
(fragments), `LocalFlushTrigger`, and `TreeOp`. A case added to any of them is invisible to the F#
compiler at the wire boundary in every host but the reference, so only the corpus and the §11.2
attestations can catch it.

`LayoutKind` / `DisplayKind` / `VisKind` / `InputKind` are **not** separate families for this purpose:
they are the NodeKind primitive groups (WIRE_FORMAT §3.2), and their `$type`s *are* NodeKind names, so
`manifest.kinds` already enumerates them. `EffectClass` is a record, not a `$type` union. Both are
called out because a list of families that quietly over- or under-counts is the failure this section
exists to end.

1. **model the case in the IDL** — the single source for the F# structural layer. The vocabulary is
   declared as data in `fuaran-dotnet` itself ([`src/Fuaran.UI.Idl/Vocabulary.fs`](../fuaran-dotnet/src/Fuaran.UI.Idl/Vocabulary.fs)
   for the declarations, [`Support.fs`](../fuaran-dotnet/src/Fuaran.UI.Idl/Support.fs) for doc comments, verbatim
   splices, decode refinements and host projections); one command in that repo —
   `FUARAN_REGEN=1 dotnet run --project src/Fuaran.UI.Idl.Tests` — rewrites `src/Fuaran.UI.Idl/idl.json`,
   `support.json` and the generated `Fuaran.UI.Generated` module together, in process, through the packaged
   IDL engine. The generated module is the **type, canonical encoder, structural decoder and `mk` constructor**
   for the case, never hand-edited, and the five files are committed together — a partial commit is a
   vocabulary describing something the tree does not contain. (The earlier flow — a declaration in the
   engine's own test fixture plus a sync script — is retired; a session following it would edit the wrong repo.) There is no hand-written node
   encoder to update: the F# op codec ([`CanonicalJson.fs`](../fuaran-dotnet/src/Fuaran.UI.OpStream.Abstractions/CanonicalJson.fs))
   splices the generated encoder and adding a kind does not touch it. _(A `TreeOp` case is the
   exception — the op envelope codec itself is hand-maintained there.)_
2. update the **policy decoder** ([`JsonDecode.fs`](../fuaran-dotnet/src/Fuaran.UI.Ops/JsonDecode.fs)) —
   the diagnostics / §16 lenient-accept layer above the generated structural decoder,
3. update the **JSON Schema generator** ([`SchemaGen.fs`](../fuaran-dotnet/src/Fuaran.UI.Ops/SchemaGen.fs)) – add the new `$type` branch / `$def` so the schema keeps describing the wire shape exactly,
4. add a fixture to [`Fixtures.fs`](../fuaran-dotnet/src/Fuaran.UI.JsonDecode.Tests/Fixtures.fs) (or a reject case to `RejectFixtures.fs`) **and regenerate the `wire-format-fixtures/` corpus + `schema.json`** (`dotnet run --project src/Fuaran.UI.JsonDecode.Tests -- --emit-corpus <workspace-root>/wire-format-fixtures` – the same command writes the corpus payloads *and* the schema), and
5. **bump every non-reference codec host in the §11.0 roster** to match – the F# reference is covered by steps 1–4; each *other* codec host gets the same encoder/decoder (+ schema-shape) update: the TypeScript host's `@fuaran-ui/schema` shape + `@fuaran-ui/ui` smart-ctor (when applicable) + TS encoder/decoder, and the equivalent codec update in the Python (`fuaran-py`), Go (`fuaran-go`), and Rust (`fuaran-rs`) hosts. The render-projection surfaces (Swift/Kotlin) take a renderer arm, **not** a codec change – see §11.0, and
6. **update the in-repo authoring veneers + analyzer vocabulary** (applies to `NodeKind` cases – ops/bindings have no veneer surface): the C# fluent-factory facade ([`src/Fuaran.UI.CSharp/`](../fuaran-dotnet/src/Fuaran.UI.CSharp/) – a factory + options record for the new kind, plus its conformance expectations), the VB XML-literal mapping ([`src/Fuaran.UI.VisualBasic/Mapping/`](../fuaran-dotnet/src/Fuaran.UI.VisualBasic/Mapping/) – an element registration driving that factory), and the VB analyzer's embedded vocabulary ([`src/Fuaran.UI.Analyzers/VisualBasic/Vocabulary.cs`](../fuaran-dotnet/src/Fuaran.UI.Analyzers/VisualBasic/Vocabulary.cs) – the kind name, any new structural sub-elements, and their attribute rows).

**Native render surfaces (roster render projections).** A `NodeKind` addition also obliges a renderer
arm in every render-projection surface – the Swift/Kotlin native tiers
render from a sealed/exhaustive tree, so a kind lacking an arm is a *build* error there. This is the
client-side analogue of step 6's authoring veneers: no codec change (the Rust core owns the codec), a
render arm only. It is not a wire-conformance leg (§11.0) – it is listed here so a vocabulary change's
full obligation set stays derivable from the roster rather than remembered.

A missing case is an `UNKNOWN_DU_CASE` defect at runtime (the decoder consumes JSON, not the F# DU, so the compiler can't catch it). Encoder and decoder symmetry is load-bearing for hash-chain integrity; both move together. Two CI gates fail if this rule is skipped: the corpus coverage-gate test (`Fixtures.allNodes` / `allOps` count == corpus count) catches a fixture added without regenerating the corpus, and the **stale-schema guard** (`SchemaConformanceTests.fs` – re-derives `SchemaGen.wireFormatSchema` and asserts byte-equality with the committed `schema.json`) catches a contract change that didn't regenerate the schema. The schema-conformance suite additionally asserts every accept-fixture validates and every reject-fixture fails against `schema.json` using an off-the-shelf Draft 2020-12 validator – so the schema stays a faithful drop-in for external tooling.

Step 6 is pinned by three further gates in the same repo test run: the C# and VB conformance suites' **coverage-vs-corpus** tests (every node fixture's `kind.$type` must have a C# authoring factory / a VB XML element – they fire the moment step 4's fixture lands), and the VB analyzer **vocabulary-pin** test (`Vocabulary.Kinds == FuaranXml.KnownElements()`). Mind the pin's blind spot: a kind missing from **both** the VB translator and the analyzer keeps the pin green (the two lists agree on the gap) – it is the corpus anchor that surfaces the omission, which is one more reason step 4's fixture must land in the same commit as the kind. `Mount` and then `Switch` both shipped without step 6 and left the repo test gate red for every subsequent session until a follow-up closed each gap; the step is named here so that class of drift dies at authoring time instead.

### 11.1 Cross-implementation conformance gate (step 5 enforced mechanically)

Steps 1–4 above are enforced inside the F# repo's own test run (coverage-gate + stale-schema guard). Step 5 – *keep every non-reference codec host in the §11.0 roster byte-identical* – is enforced by pinning **each codec host to the committed corpus**, so a divergence between any two conformant hosts is caught rather than discipline-maintained. The committed corpus **is** the F# encoder's canonical output (`Corpus.emit` writes `CanonicalJson.encode*` into the `expectedFile` payloads and the `DecodeError` code/path into `manifest.json`); each codec host's leg asserts its own canonical output is byte-identical to that corpus, and `X == corpus` for every host `X` proves `X == Y` byte-for-byte across the roster.

**The legs are enumerated from the roster** (one per codec host; render projections have no leg – §11.0):

- **Leg A – `fuaran` (F#):** `dotnet run` the `Fuaran.UI.JsonDecode.Tests` suite – the current encoder/decoder re-produces the committed corpus byte-for-byte (round-trip), surfaces the canonical reject code/path, and is schema-valid + stale-schema-guarded. ⇒ `F# == corpus`.
- **Leg B – `fuaran-ts` (TypeScript):** a Node runner drives the TS encoder/decoder over the same corpus and asserts its canonical output is **byte-identical to the F# canonical form** and schema-valid against `schema.json` (off-the-shelf Draft 2020-12 validator). ⇒ `TS == corpus`. Legs C/D extend this to a generative sample space (FsCheck-emitted trees round-tripped F#→TS and TS→F#).
- **Leg E – `fuaran-py` (Python):** the `fuaran_py` codec round-trips the corpus byte-for-byte (node + op), surfaces the canonical reject code/path + float layout, re-encodes to schema-valid wire, and holds its offline-snapshot drift guard. ⇒ `Python == corpus`.
- **`fuaran-go` (Go) / `fuaran-rs` (Rust):** each host pins itself to the **same** corpus in its own repo's conformance suite (`fuaran-go/conformance/`, `fuaran-rs/tests/conformance.rs`), consuming the workspace corpus directly (no bundled snapshot). ⇒ `Go == corpus`, `Rust == corpus`.

**Enforcement topology (current).** Legs A–E run in the workspace CI gate `.github/workflows/wire-conformance.yml`, driving [`wire-format-fixtures/conformance/`](./conformance/); the host repos POST a `repository_dispatch` on push-to-main so a host-side change fires the workspace gate. The Go and Rust legs run in their own repos' `run.ps1` suites today; their **workspace** CI legs (so a corpus change fails centrally for all five codec hosts, not only F#/TS/Python) are pending. A one-byte divergence in any host's encoder turns its leg red with a per-fixture byte diff naming the fixture, host, and first differing byte. This is the mechanical enforcement of the forward-coupling rule **across the roster** – see [`wire-format-fixtures/conformance/README.md`](./conformance/README.md).

### 11.2 Vocabulary attestation (the discriminator-family enumerations)

Step 5's byte-identity legs certify that every host agrees on the fixtures the corpus *contains*. They
say nothing about a case a host has never met — a host that simply lacks a decode arm for a new
discriminator still passes every fixture that does not exercise it, and the corpus grows a fixture the
unadopted host quietly skips or fails as an ordinary decode error attributable to anything.
**Vocabulary attestation is the separate leg that names the gap.**

`manifest.json` therefore carries a generated enumeration per attested family, derived by `Corpus.emit`
from the encoded fixtures of the family's own carrier — the node fixtures for the two that ride inside a
node, the op fixtures for `ops` — and never hand-authored. Each codec host pins its own declared
vocabulary against it in **both** directions — *the manifest names a case this host lacks* and *this
host declares a case the corpus does not know*. Both failures name the offending case, so the report is
"host X lacks `DateRange`", not a diff.

| Manifest array | Family | Wire position(s) | Attested in |
|---|---|---|---|
| `kinds` | `NodeKind` | `$.kind.$type`, recursively | all five codec hosts (since the kind-set pin landed) |
| `formFieldKinds` | `FormFieldKind` | `Form.fields[].kind.$type`, `Filters.items[].kind.$type` | F#, TypeScript, Python; Go and Rust pending |
| `ops` | `TreeOp` | `$.$type` on an op payload (§14) | F#; every other host pending |

The `ops` row closes an ASYMMETRY rather than a missing check. The op vocabulary already had the
estate's strongest declaration — [`idl.json`](./idl.json)'s `ops` array carries each op's tag *and* its
wire field names *and* their optionality — but no host's harness reads `idl.json`; every one of them
loads `manifest.json`. So a host with no op decode arm at all could certify the op fixtures it happened
to carry and still declare nothing about the op set, because the list it would have failed against was
in the artefact it never opens. The enumeration is the reach; the IDL remains the stronger statement.

**Match a carrier by its parent discriminator, never by property name.** `DataGrid.columns[].kind.$type`
is a `CellKindErased` and shares the token `Text` with `FormFieldKind`; a sweep keyed on the property
name `kind` under any array silently attests the wrong family and reports green.

Every other family named above is **unattested**: a case added to one of them is caught only by the
fixture it ships with, in the hosts that decode that fixture. Most of their case sets *are* already
published — `schema.json` carries a `$defs` entry per family, with a `const` `$type` per case — so
those are extendable without a further manifest change. Two shapes are not directly readable that way
and would need the manifest route this phase took: `TextSource`, whose §16 bare-string shorthand makes
one `oneOf` branch a plain string rather than a discriminated object, and any family whose cases are
spread across sibling `$defs`. The families are enumerated so the scope is a stated one rather than an
assumed one. Adding a row to the table above is the way to close one.

---

## 12. Regenerating / consuming the corpus

The corpus is generated from the F# fixture values (the authoritative `Node`/`TreeOp` constructions in [`Fixtures.fs`](../fuaran-dotnet/src/Fuaran.UI.JsonDecode.Tests/Fixtures.fs) + [`RejectFixtures.fs`](../fuaran-dotnet/src/Fuaran.UI.JsonDecode.Tests/RejectFixtures.fs)):

```powershell
# from fuaran-dotnet/
dotnet run --project src/Fuaran.UI.JsonDecode.Tests -- --emit-corpus ..\wire-format-fixtures
```

Layout:

```
wire-format-fixtures/
├── manifest.json     # index: { version, schema, description, fixtures: [ { id, kind, decoder, inputFile, expectedFile?, expectedErrorCode?, expectedPath?, description } ] }
├── schema.json       # canonical Draft 2020-12 JSON Schema (see §13) — co-emitted by the same --emit-corpus run
├── nodes/   *.json   # canonical Node wire forms
├── ops/     *.json   # canonical TreeOp wire forms (incl. the Phase 364 nested-path set)
├── lenient/ *.json   # §16 shorthand inputs + their canonical twins
├── envelope/*.json   # §15 profile-envelope negotiation cases
├── elicitation/*.json# §18 elicitation envelopes, outcomes + answer documents
└── reject/  *.json   # malformed inputs
```

Fixture counts are **not restated in prose** — `manifest.json` is the authoritative enumeration, and
the counts drift where the manifest cannot. The current tallies, projected from it:
<!-- fuaran:count kind=total -->466<!-- /fuaran:count --> fixtures in all —
<!-- fuaran:count kind=node-round-trip -->200<!-- /fuaran:count --> `node-round-trip`,
<!-- fuaran:count kind=op-round-trip -->23<!-- /fuaran:count --> `op-round-trip`,
<!-- fuaran:count kind=reject -->125<!-- /fuaran:count --> `reject`,
<!-- fuaran:count kind=lenient-accept -->66<!-- /fuaran:count --> `lenient-accept`,
<!-- fuaran:count kind=envelope-round-trip -->4<!-- /fuaran:count --> `envelope-round-trip`,
<!-- fuaran:count kind=envelope-reject -->2<!-- /fuaran:count --> `envelope-reject`,
<!-- fuaran:count kind=elicitation-round-trip -->7<!-- /fuaran:count --> `elicitation-round-trip`,
<!-- fuaran:count kind=elicitation-reject -->15<!-- /fuaran:count --> `elicitation-reject`,
<!-- fuaran:count kind=elicitation-answer-accept -->3<!-- /fuaran:count --> `elicitation-answer-accept`,
and <!-- fuaran:count kind=elicitation-answer-reject -->7<!-- /fuaran:count -->
`elicitation-answer-reject`.

A conformant host's test harness loads `manifest.json` and, per entry:
- `kind: "node-round-trip"` / `"op-round-trip"` → decode `inputFile` with the `decoder`-named entry point, re-encode, assert byte-equal to `expectedFile`.
- `kind: "reject"` → decode `inputFile`; assert the error's code == `expectedErrorCode` and its path starts with `expectedPath`. **Matching stays a PREFIX, with one ruled exception: where `expectedPath` does not end in `.$type`, the emitted path MUST NOT either** (§6). The latitude is deliberate — a host may legitimately name a position *deeper* than the corpus's stated slot, and is then more precise rather than divergent: the corpus records the author-facing `$.kind.trend` where a decoder reports the wrong-typed `$.kind.trend.value` (the four `reject-binding-*` fixtures), and records `$` for the whole refused document where §21 licenses naming the position at which the limit was breached (`reject-limit-node-depth`, `reject-limit-op-depth`). Tightening to equality would red those six on arrival and buy nothing. What the exception forbids is different in kind — a suffix naming a position that does not exist in the document **at all**, which is precisely the defect that survived undetected until Phase 1073 because a prefix match cannot see it.

### 12.1 Third-party certification kit

Third-party implementations do not need to hand-build the harness above: the published **`@fuaran-ui/conformance`** npm package is a packaged certification kit – it bundles a versioned snapshot of this corpus (named in every report by manifest version + SHA-256 content digest), drives a candidate implementation through a small adapter seam (`decodeNode` / `encodeNode` / `decodeOp` / `encodeOp`, all optional), and emits a per-leg pass/fail report with honest partial-certification semantics for hosts that implement only part of the contract. The certification procedure – what "conformant host" means, mandatory vs optional legs, how to read the report, and the per-corpus-version caveat that follows from §11 – is defined in the TypeScript reference repo's `CONFORMANCE.md`. The bundled snapshot is byte-synced from this corpus and guarded by the kit's own test suite; when the corpus advances under §11, a new kit release ships the regenerated snapshot and hosts re-certify against it.

### 12.2 Generated tables in this document

Five surfaces of this specification are **projections**, not authored prose. Each sits between a
marker pair and is regenerated from a machine-readable artefact; a hand edit inside one is reverted
by the next regeneration and, before that, reported as drift by a gate.

| Marker | Section | Source |
|---|---|---|
| `fuaran:spec-kinds` | §3.2 — the `kind.$type` → category table | [`idl.json`](idl.json) |
| `fuaran:spec-enums` | §3.5 — the closed bare-string enum vocabularies | [`idl.json`](idl.json) |
| `fuaran:spec-omit-defaults` | §3.6 — the identity-default table | [`idl.json`](idl.json) |
| `fuaran:spec-wire-omitted` | §9 — the host-only node fields | [`idl.json`](idl.json) |
| `fuaran:count kind=…` | every in-prose fixture count | [`manifest.json`](manifest.json) |

```powershell
# from fuaran-dotnet/ — regenerate, then verify
dotnet run --project src/Fuaran.UI.JsonDecode.Tests -- --project-spec ..\wire-format-fixtures
dotnet run --project src/Fuaran.UI.JsonDecode.Tests -- --check-spec   ..\wire-format-fixtures
```

**Notes columns are hand-authored.** A projection may not add information its source does not carry,
so anything the IDL cannot know — that `Image.src` is routed through the §19 URL-scheme floor at
render time, that `HashStrictness` lives inside `Custom.contentHash` — is written in
[`spec-annotations.json`](spec-annotations.json), keyed by the vocabulary name it describes, and
emitted verbatim into a Notes column. **The generator refuses to run when a key names nothing**: an
annotation whose subject was renamed or retired is a stale claim in a normative document, and a
projection exists precisely so that such a thing cannot survive a regeneration. Adding a kind, enum
case, or omitted-when-default field therefore updates §3.2/§3.5/§3.6 **mechanically** — one fewer
hand-step in §11.

`--check-spec` also runs as an ordinary test in the F# host's conformance suite and as its own leg of
the cross-implementation conformance workflow, so a specification edit and a vocabulary edit are both
caught, from either side.

---

## 13. Canonical JSON Schema artefact (`schema.json`)

The corpus ships a machine-readable **Draft 2020-12 JSON Schema** at [`wire-format-fixtures/schema.json`](./schema.json) – the third co-equal expression of this contract, alongside this prose spec and the fixture corpus. It is the enabling input for provider-native constrained emission, a drop-in artefact for external validators and editor tooling, and a second executable check on the wire shape.

- **`$id`:** `https://fuaran.dev/wire-format/v1/schema.json`. The `/v1/` segment pins the wire-format major version (see the **Version** banner at the top of this doc).
- **Generated, not hand-authored.** It is emitted by [`Fuaran.UI.Ops.SchemaGen`](../fuaran-dotnet/src/Fuaran.UI.Ops/SchemaGen.fs) – a structural hand-walk of the same DU surface [`CanonicalJson.fs`](../fuaran-dotnet/src/Fuaran.UI.OpStream.Abstractions/CanonicalJson.fs) walks, so it *describes* the canonical JSON the encoder produces (and the decoder accepts) rather than introducing a parallel contract. It is regenerated by the same `--emit-corpus` command that writes the fixture payloads (§12).
- **Shape.** DU positions encode as `oneOf` of branch objects, each pinned by a `$type` `const` discriminator (an unrecognised `$type` matches no branch – mirroring `UNKNOWN_DU_CASE` / `WRONG_NODE_KIND`). Bare-string enums (§3.5) encode as `{ "type":"string", "enum":[…] }`. Closure slots (§4) are the `const "<closure>"`. Opaque `Binding.Static` values (§5) are `true` (any JSON); structured JSON payload positions (rule 12) are likewise `true` – any JSON except `null`, which the decoder rejects – the schema deliberately does not constrain content the encoder cannot decompose. Wire-omitted fields (§9, §10.1) are absent from the schema. The schema does **not** set `additionalProperties:false`, matching the decoder's tolerance of unknown keys (§2 rule 2). The top-level schema is `oneOf: [ {$ref Node}, {$ref TreeOp} ]`; `$defs/Node` and `$defs/TreeOp` are exposed directly for hosts that want to validate one shape.
- **Conformance.** `SchemaConformanceTests.fs` validates every accept-fixture (must validate) and every reject-fixture (must fail) against `schema.json` using an off-the-shelf Draft 2020-12 validator, and runs the stale-schema guard (§11). The schema describes the *existing* wire shape only – it introduced no change to the canonical JSON (additive-only; the fixture payloads are byte-unchanged by Phase 96).

### Canonical IDL vocabulary artefact (`idl.json`)

The corpus also ships [`wire-format-fixtures/idl.json`](./idl.json) – a canonical data rendering of the **IDL**, the declarative model of this wire vocabulary. `manifest.json` points at it under the `idl` key, exactly as it points at the schema under `schema`.

**The two artefacts answer different questions, and neither subsumes the other.** `schema.json` is the **validation surface**: given a payload, is it legal? `idl.json` is the **structural source**: what *is* the vocabulary? A JSON Schema is lossy about precisely the things a vocabulary consumer needs, because validation does not need them:

- **Optionality collapses.** Draft 2020-12 can say a property is `required`; it has no way to say "omitted when equal to this value". So every omit-at-default field (§3.6) is indistinguishable from a plain optional one in the schema, and the identity default **value** is absent entirely. `idl.json` carries a four-way optionality class per field – `required` / `optional` / `omitDefault` (with the default value) / `hostOnly` – which is what makes §3.6 and §9 mechanically derivable rather than prose-only.
- **Unions flatten** into `oneOf` branches; `idl.json` keeps the union, its named cases, its type parameters, and its transparent case (the bare-value encoding of `TextSource.Literal`, §3.5).
- **Host-surface declarations have nowhere to live** in a schema at all.

Consequences for a consumer:

- **Where they disagree about legality, `schema.json` governs** – it is the artefact validators actually run, and the fixture corpus is the arbiter above both.
- **Today the two are independent expressions of one vocabulary, not one derived from the other.** `schema.json` is emitted by a structural hand-walk of the same DU surface the encoder walks (above); `idl.json` is emitted from the IDL. Each carries its own regenerate-and-byte-compare drift guard, and the shared fixture corpus is what holds them to the same contract. Do not assume a change to one has reached the other.
- **`hostSurface` keys are not wire spec.** Function-typed slots (`fn`) and host-codec slots (`hosted`) carry the host-language declarations the F# and TypeScript tiers generate from. Nothing in them is observable on the wire – the accompanying `wire` key states the fixed wire form (`"<closure>"`, or arbitrary JSON) – and a host building a codec from this artefact must ignore them.

- **Shape.** A single JSON object: `version` (the *encoding* version, bumped when this artefact's shape changes, never when the vocabulary does), `description`, then `kinds`, `unions`, `enums`, `records`, `defaults` and `nodeFields` (the node envelope, §3.1). Object keys are Ordinal-sorted throughout, per §2 rule 1. **Ordering is a contract, so the artefact is diffable:** the top-level collections are sorted by identity (kinds by tag; unions, enums and records by name; defaults by kind then field), so reordering a vocabulary declaration produces no diff and an addition lands as one clean insert – while *within* an entry the declared order is preserved verbatim, because union-case fields and type parameters are positional and a reorder there is a real change.
- **Generated, not hand-authored** – and **not** by the `--emit-corpus` command that writes the fixtures and `schema.json` (§12). The encoder is the packaged IDL engine (`Fuaran.Core.Idl.Artifact`); the vocabulary it renders lives in `fuaran-dotnet` (`src/Fuaran.UI.Idl/`), and the same regeneration command that rewrites the generated module rewrites that repo's committed `idl.json`. **This corpus's copy is carried over by hand from that file, byte for byte, in the same change-set as the vocabulary edit** — the fixture emitter does not write it, so a session that regenerates and forgets the copy leaves this corpus describing the previous vocabulary while the projection check beside it (which reads *this* copy) stays green.

  ```
  cd fuaran-dotnet
  FUARAN_REGEN=1 dotnet run --project src/Fuaran.UI.Idl.Tests
  cp src/Fuaran.UI.Idl/idl.json ../wire-format-fixtures/idl.json
  ```

- **Conformance.** A stale-artefact guard in `fuaran-dotnet` asserts byte-equality between that repo's committed `idl.json` and a fresh emission, and names the regeneration command on failure – the same discipline as the stale-schema guard above, so a vocabulary edit that skips regeneration fails a test rather than quietly serving a stale spec. Adding the artefact changed no fixture payload and did not touch `schema.json`.
- **Scope.** The IDL models the **node** vocabulary. `TreeOp`s (§3.4) are outside it, as are decode-side policy surfaces a structural model cannot state: the §16 lenient-accept profile, the reject semantics of §6, and the §15/§17/§18 envelopes. For those, this prose spec and the corpus remain the only sources.

### Render-fidelity manifest artefact (`render-fidelity.json`)

The corpus also ships [`wire-format-fixtures/render-fidelity.json`](./render-fidelity.json) - the per-`NodeKind` declaration of **how far a target's render is held to this contract**. Where `schema.json` asks *is this payload legal?* and `idl.json` asks *what is the vocabulary?*, this artefact answers *for this kind, which render tiers exist, what does the parity-checked fallback pin, and what is declared client-only rich?*

**The three tiers (the contract this artefact summarises).** For every fidelity-sensitive kind the render splits into declared tiers, and only the middle one is compared:

1. **Source** - the deterministic, parity-clean data the wire carries: the LaTeX string, the code text, the raw markdown, the overlay's `open` binding. The wire never carries a rendered form.
2. **Fallback** - the deterministic render that the SSR-parity corpus and the cross-host byte-diff compare. This is what a no-JS reader, a crawler, an email client, or a non-browser host receives, and it is pinned byte-for-byte across every conformant host. `Modal` / `Toast` / `ScrollArea` render **inline, never portaled**, with a closed overlay held behind the native `[hidden]` attribute rather than omitted (§3.2, the overlay + overflow contract). `CodeBlock` pins a bare escaped `<pre><code class="language-{x}">`. `Math` pins native MathML for the closed LaTeX subset and the escaped source otherwise. `Markdown` pins one deterministic GFM render (§14).
3. **Rich** - the client-only render, **declared outside every parity comparison rather than silently divergent**: syntax highlighting, KaTeX, a chart or map library drawing into the placeholder. Because it is declared, a host that omits it is *degraded by contract*, not non-conformant.

The artefact also distinguishes a third posture from those two. A **`behavioural`** rich tier - overlay focus management, keyboard navigation, the handlers an inert server-rendered control gains at hydration - is attached after hydration and **must not alter the hydrated DOM**. That is precisely why the overlay contract admits a focus trap while refusing a portal, and a consumer that reports fidelity needs the distinction: `clientOnly` means the DOM you are looking at is not the parity-checked one; `behavioural` means it still is.

- **`$id`:** `https://fuaran.dev/wire-format/v1/render-fidelity.json`, pinning the wire-format major version exactly as `schema.json` does.
- **Generated, not hand-authored.** It is emitted from [`Fuaran.UI.RenderFidelity`](../fuaran-dotnet/src/Fuaran.UI/RenderFidelity.fs), the declaration the F# tier itself reads. The same `--emit-corpus` command that writes the fixtures and `schema.json` (§12) co-emits it; a declaration-only change that touches no fixture can publish it alone:

  ```
  cd fuaran-dotnet
  dotnet run --project src/Fuaran.UI.JsonDecode.Tests -- --emit-fidelity ..\wire-format-fixtures
  ```

- **Shape.** A single JSON object: `version`, `$id`, `description`, `tiers` (the three tier definitions above, so the artefact is self-describing), `obligationVocabulary` (the closed set of checkable claims — see "Render obligations" below), and `kinds` - one entry per canonical `kind.$type`, Ordinal-sorted so an addition lands as one clean insert. Each entry carries `kind`, `sensitive` (whether the kind has an explicit, phase-pinned fidelity contract, as against being trivially single-tier), `source`, `fallback`, `rich` (`{ "class": "none" | "behavioural" | "clientOnly", ... }`), `fixtures` (corpus-relative paths pinning the fallback, declared for the fidelity-sensitive kinds), `obligations` (the checkable claims this kind owes, each bound to the section that states it), and `contract` (where the contract is written down).
- **Conformance.** Two guards on the F# side. A **completeness rule** asserts one row per canonical wire kind, measured against this manifest's own generated `kinds` enumeration rather than a hand list - so a kind added under the §11 forward-coupling rule appears here and fails the rule until its posture is declared, and the class cannot silently grow. A **stale-artefact guard** asserts byte-equality between the committed file and a fresh emission, naming the regeneration command, exactly as the stale-schema guard does. Every fixture a row names is checked to exist. The artefact **describes the existing render contract only**: no wire byte and no renderer behaviour changed when it landed.
- **Scope.** Render fidelity, not interactivity. An inert server-rendered control becoming live at hydration is `behavioural`; what happens *after* a user interacts is outside this artefact entirely. Kinds the §15.3 tolerance path preserves without understanding have no row by construction, which is the honest answer rather than a missing one.

**Render obligations — the checkable remainder (normative).** The `fallback` prose above is complete and normative, and a machine cannot check a paragraph. A host can render a kind, pass every byte-parity fixture in the corpus, and still have silently dropped an obligation that paragraph states: `<audio>` gaining an autoplay pathway the case declares no slot for, `autoplay` emitted without its `muted` pair, an accessible name emitted only where an author supplied one, an expansion anchor pointing at a destination the egress floor refused. None of those is a missing discriminator arm, so no codec test and no compiler reaches them.

Each kind entry therefore also carries an `obligations` array — the subset of its fallback contract stated as **checkable claims**, drawn from a **closed vocabulary** the artefact enumerates at the top level as `obligationVocabulary`:

```json
"obligationVocabulary": [
  { "id": "autoplay-muted-pairing", "meaning": "autoplay is emitted only together with muted; neither attribute ever appears without the other" }
],
"kinds": [
  { "kind": "Media",
    "obligations": [
      { "id": "autoplay-muted-pairing",
        "statement": "`autoplay` is emitted ONLY together with `muted`, and `muted` rides `autoplay` — the pairing is what the declaration means, not a default",
        "section": "WIRE_FORMAT.md 3.6.6" } ] }
]
```

- **`id`** is the vocabulary token, and the vocabulary is **closed**. An open free-form vocabulary would let a host accept a claim it has no checker for; a closed one means a host can enumerate what exists independently of the rows it happens to read, and report an id it does not implement.
- **`statement`** is the normative sentence *for that kind* — the same claim reads differently on a transport (an accessible name is mandatory on the wire) and on a decorative image (it is the empty string).
- **`section`** binds the claim to the section that states it. An obligation with no section is an assertion about a host's habits rather than about this specification, and is not admissible.

**A conformant host's render suite asserts every obligation declared for the kinds it renders, and REPORTS every one it does not — because not checked is not passed.** The reporting shape:

| Outcome | When | What the host must do |
|---|---|---|
| `asserted` | the host renders the kind and its suite checks the claim in emitted output | nothing; the claim is met |
| `unchecked` | the host renders the kind and has no checker for the claim | print the kind, the claim id, the section, **and a reason**; fail the gate unless the exemption is *declared* in the suite |
| `not rendered` | the host does not render the kind at all | print it; nothing is owed |

The enumeration a host iterates is **this artefact's**, never a list beside its checkers. That is the whole mechanism: an obligation added to one kind's row arrives in every adopting host as a claim with no checker and turns that host's gate red, rather than as a paragraph a future reader may or may not re-read. A host whose closed vocabulary does not carry a claim id the artefact names is **behind the artefact** and must report that too — it cannot have checked what it cannot name.

Obligations are **additive within a major version** and land under the §11 forward-coupling rule: declaring one is a change to this artefact and to every adopting host's suite in the same change-set. A kind whose `obligations` array is empty states no checkable claim; that is not a statement that its fallback prose is optional.

**Deriving a fidelity badge (the consumer recipe).** A surface that shows per-node fidelity - a legend, a certification report, a degradation exhibit - derives it and hard-codes nothing:

1. Read the node's wire discriminator, `kind.$type`. (A host with its own kind vocabulary adapts at that boundary first: the F# tier's `Kind.name` says `Grid` where the wire says `DataGrid`.)
2. Look the token up in `kinds`. A miss means an unknown kind arriving over the tolerance path (§15.3), which is reported as unknown, never as single-tier.
3. Emit three segments in order - `source`, `fallback`, `rich` - taking the detail text from the matching fields. The `rich` segment is *absent* exactly when `rich.class` is `none`, which is a positive statement ("the fallback is the whole render"), not missing information.
4. To say which tier the current target is *delivering*, intersect with what that target runs: a scripts-disabled render delivers `fallback`; a hydrated browser render delivers `rich` where one is declared. The `fixtures` array names the corpus payloads that pin the fallback, which is what a per-node "and here is the fixture that proves it" affordance links to.

Each language tier ships the same derivation over the same artefact, so the three segments a badge shows are identical whichever host produced the page.

---

## 14. Markdown rendering (render-only; not a wire concern)

`DisplayKind.Markdown` carries its content as a raw `TextSource` on the wire – markdown is **never**
parsed into the wire format, so adding/removing a markdown feature is **not** a wire-format change and
does not touch the corpus in this directory. How that text is *rendered* to HTML is a separate,
render-only contract: **one deterministic GFM → HTML renderer** (`Fuaran.UI.Renderer.Markdown.toHtml`
in `Renderer.Core`), shared by the F# client + server renderers and re-implemented byte-identically
by the TS and Python hosts. It has its own conformance corpus at
[`wire-format-fixtures/markdown/corpus.json`](./markdown/corpus.json) and its
own cross-host gate, mirroring §11.1. The supported GFM subset, the IN/OUT/DEFERRED buckets, and the
Phase 292 behaviour change (npm `marked` + Markdig removed) are documented in
[`MARKDOWN.md`](../fuaran-dotnet/docs/MARKDOWN.md).

### 14.1 Destination policy for markdown link + image destinations (normative for rendering hosts)

§19's scheme floor answers *is this URL safe to have*. It does not answer *is this destination one
the composition declared*, and only the second question closes exfiltration:
`https://collector.example/?s=…` passes every rule in §19 — allowlisted scheme, well-formed host, no
script anywhere in it — and in an `![](…)` the browser contacts it **with no user act at all**,
because rendering *is* the request.

A **rendering host** that renders a markdown body from a **decoded** tree MUST therefore offer a
render entry point that takes a *destination policy* and consults it for every link and image
destination the body names. The policy itself is **host-constructed and never carried on the wire** —
a policy an emission can supply is a policy a hostile emission can widen, so this section describes
what a host must be able to *express*, not a document it must be able to *parse*.

**The two egress classes this section uses.** A **hyperlink** is an `href` the reader must act on: an
inline or reference link, a `<scheme:…>` or bare-URL autolink, an email autolink. **Media** is a
`src` the browser fetches unprompted: an inline or reference image. They are scoped separately
because only one of them is contacted by rendering alone.

**What a policy must be able to say.** Whether same-origin destinations are permitted (a relative
path, a fragment, an empty URL); whether hostless schemes are permitted (`mailto:`, `tel:` — an
egress channel with no host a rule could name, so it can only be permitted wholesale); whether every
origin is permitted; and otherwise a positive list of rules, each naming a **host** — never a scheme,
never a path — as either an exact host or a **suffix matched at a label boundary** (`docs.example`
matches `eu.docs.example`, and never `notdocs.example`), scoped to a set of classes.

**What a refusal renders as.** Not a silent neuter — "nothing happened" and "this was refused" are
different facts and only one of them is debuggable. The destination becomes the inert literal

```
about:blank#fuaran-egress-refused
```

and the element carries `data-fuaran-egress-refused="<class>:<what>"`, where `<class>` is
`hyperlink` or `media` and `<what>` is the normalised host, or the scheme for a hostless refusal
(`hyperlink:mailto`). **The marker carries the class and the host, never the path or the query**: the
query string of a refused exfiltration attempt is the payload itself, so a refusal record that quoted
it would become the disclosure it exists to prevent. The attribute is emitted **last** on the
element, after every attribute that was already there.

**The scheme floor's own answer is unchanged.** A URL §19 rejects still renders the bare
`about:blank` it rendered before this section existed, with **no** marker. The floor's refusal is a
different fact from a policy refusal, it is pinned by the `sanitization/` corpus in this directory,
and re-spelling it here would churn that corpus inside a change about egress — which is exactly where
a genuine divergence hides.

**Conformance.** A fixture in [`markdown/corpus.json`](./markdown/corpus.json) MAY carry a `policy`
naming the policy the render is performed under. A host maps the name to a policy **it constructs**:

| `policy` | The policy the host constructs |
|---|---|
| absent, or `"permissive"` | every origin permitted, same-origin permitted, hostless schemes permitted |
| `"denyNonLocal"` | no rules; same-origin permitted; hostless schemes refused; no origin permitted |
| `"declaredExample"` | `denyNonLocal`, plus exact host `cdn.example` scoped to **media**, plus host suffix `docs.example` scoped to **hyperlink** |

`permissive` is the pure `source → html` function this corpus has pinned since Phase 292 and its
fixtures are unchanged to the byte, so a host adopting this section changes no existing expectation.
`declaredExample` is what makes the gate falsifiable in both directions: a host that refused every
non-local destination unconditionally would fail its allowed fixtures, and one that ignored the
policy would fail the `denyNonLocal` ones.

**Forward coupling.** A change to the refusal shape, the class assignment of a destination, or the
named policies updates the renderer in **every** conformant host and the corpus in the same
change-set, per §11.

---

## 15. Wire versioning + forward/backward compatibility (Phase 319)

§11 keeps every host in **lockstep** – one coordinated change across encoder + decoder + schema + corpus + every host. That is the right discipline while the hosts ship together, but it cannot run a published standard with N independently-generated hosts: an *older* consumer will eventually meet a *newer* artifact, and §3.2's `WRONG_NODE_KIND` / §6's `UNKNOWN_DU_CASE` hard-reject it – a crash, not a graceful degrade. This section adds the missing contract: a versioned wire that lets a behind consumer **detect → preserve → degrade**, while the authoring/generation surface stays **closed and exhaustive** – no host can ever *emit* an unknown kind. Tolerance lives **only** on the decode boundary of a consumer that is behind.

The mechanism is host-neutral substrate in [`Fuaran.Core.Wire`](../../Fuaran-Core/src/Fuaran.Core.Wire/Wire.fs) (`Versioning` module, FSharp.Core-only + Fable-clean); each language host (F#, TS, Python) adopts the same envelope + tolerance rules, certified against the corpus.

### 15.1 Profile id + the versioned envelope

A **profile id** names a capability set: `<name>@<major>.<minor>` – e.g. `core@1.0`. `name` is the capability namespace; **`major` is the `/vN/` incompatibility boundary** (it pins the `$id` path of §13 – a removal/rename mints a new major); **`minor` is the additive capability counter** (a new kind/case/field bumps it). The current wire is **`core@1.0`**.

An artifact may be wrapped in a **versioned envelope** that carries the producer's authored profile alongside the payload tree/op:

```json
{ "$payload": <Node | TreeOp>, "$profile": "core@1.0" }
```

`$payload` / `$profile` are `$`-prefixed so they sort before any lower-case data key under the §2 rule-2 canonical order (and are reserved per §2.1). The bare (un-enveloped) form is unchanged and is read as the implicit base profile `core@1.0`, so **every existing v1 fixture is byte-unchanged** – the envelope is opt-in carriage, not a reshape of the artifact. A producer MAY instead declare the profile an artifact requires inline via an optional `"$requiredProfile":"<profile>"` key on the artifact object (the "artifact declares what it needs" shape); a behind consumer reads it to name the gap in a degraded placeholder.

> **Decision – `$requiredProfile` reservation (Phase 404).** Phase 319 first shipped this inline key un-prefixed as `requiredProfile`. It is a **spec-minted** key that sits directly on the artifact object alongside a host's lower-case data keys, so it belongs under the §2.1 reservation exactly as `$profile` / `$payload` do: `$`-prefixing marks it spec-reserved and guarantees it sorts *before* the data keys instead of interleaving among them (`requiredProfile` sorts wherever `r…` falls). The three versioning keys are therefore uniformly `$`-reserved. This is a wire-visible rename, taken now (pre-1.0, pre-flip, no external consumers) so it lands **before** the `envelope-*` fixtures freeze. **The wire migration – `Fuaran.Core.Wire.Versioning`'s `Unknown` carrier key, the TypeScript host (`@fuaran-ui/ops` `versioning.ts`), and the `envelope-*` corpus fixtures + manifest – lands with Phase 403's fixture regeneration** (the workstream that owns the shared `wire-format-fixtures/` corpus + cross-host envelope certification). Until that lands, the shipped hosts still emit the un-prefixed `requiredProfile`; this spec states the reserved target so 403 freezes the `$`-prefixed shape.

### 15.2 Capability negotiation

A consumer compares its own supported profile against the authored profile:

| Outcome | When | Consumer behaviour |
|---|---|---|
| **Current** | same `name`+`major`, authored `minor` ≤ consumer `minor` | decode fully |
| **Behind** | same `name`+`major`, authored `minor` > consumer `minor` | may meet unknown kinds – **tolerate** (§15.3): preserve + degrade, never crash |
| **Foreign** | different `name`, or different `major` | an incompatible `/vN/` boundary – **hard-refuse**, never silently mis-decode |

Minor-ahead is always tolerable (additive-only by the §15.4 policy); a major or namespace difference is never tolerable (it may have *removed* or *renamed* a kind this consumer relies on).

### 15.3 Transport-only `Unknown` + must-ignore-but-preserve

When a `Behind` consumer's decoder meets a discriminator it does not recognise, it does **not** raise `WRONG_NODE_KIND` / `UNKNOWN_DU_CASE`. It produces a **transport-only** `Unknown { kind, payload, requiredProfile }`:

- **Transport-only** means it is reachable on the **decode** path and **nowhere on encode** – there is no authoring constructor and no encoder entry point that takes one. The closed/exhaustive authoring surface (the AI-reliability moat) is intact: a producer still cannot emit an unknown kind; only a behind *reader* ever materialises one. This is enforced by construction in `Fuaran.Core.Wire.Versioning` (`decodeTolerant` is the sole producer of `Unknown`; `reencode` of a `Known` value can never yield one).
- **`payload`** is the **verbatim parsed object**. Re-encoding it with the canonical renderer (§2) reproduces the producer's bytes exactly – **must-ignore-but-preserve**: an old client that doesn't understand a kind round-trips its bytes intact, so it **cannot destroy data a newer producer authored**. This is load-bearing for op-stream / collaboration, and the hash chain (§4 consequence) makes the preservation verifiable – a preserved-but-unrendered subtree hashes identically through an old client.
- **`$requiredProfile`** (the reserved key of §15.1 – when the artifact declared one) lets the consumer render a labelled placeholder ("needs `core@1.4`") rather than a blank.

A behind consumer thus has three honest responses to an unknown kind: **detect** it (negotiate → `Behind`, decode → `Unknown`), **preserve** it (re-encode the verbatim payload), or **degrade** it (render a labelled placeholder). Crashing is no longer one of them. A genuinely malformed object – no discriminator at all – still fails the decode (the tolerance is for *unknown* kinds, not *invalid* ones).

### 15.4 Evolution policy – additive=minor, removal/rename=major

| Change class | Version step | Old-consumer effect |
|---|---|---|
| **Additive** – new `NodeKind` / `Spec` / `Binding` / `Action` case or a new optional field | **minor** (`core@1.N` → `core@1.(N+1)`) | `Behind` → must-ignore-but-preserve (§15.3) absorbs it; no migration needed |
| **Removal / rename** – a kind/case/field present before and absent after | **major** (`core@1.x` → `core@2.0`, new `/vN/` + `$id`) | `Foreign` → hard-refuse; a migration shim rewrites old→new |

The classification is **derivable, not hand-disciplined**: an IDL diff (the canonical-source inversion, Phase 316) over two capability snapshots classifies the change – no removed tags ⇒ additive/minor; any removed tag ⇒ breaking/major (a *rename* surfaces as a removal + an add, correctly breaking). `Fuaran.Core.Wire.Versioning.classify` / `bump` are the host-neutral primitives; the IDL generator is what emits the per-host migration shims for a major step. This makes "is this change breaking?" a computed property of the IDL delta, not a reviewer's judgement call – the same posture as the §11 forward-coupling gate, extended across version boundaries.

### 15.5 Cross-host coordination

This contract is part of the wire format, so it is a **cross-host change** like any §11 addition: each host implements the same envelope shape (§15.1), the same negotiation table (§15.2), and the same transport-only-`Unknown` + preserve rule (§15.3) – the envelope and tolerance are conformance-corpus-certified, not host-private. The substrate primitives live once in `Fuaran.Core.Wire.Versioning` (the F# reference); a host in another language re-implements them against this section + the corpus, exactly as it does the rest of the codec.

The contract is executable in the shared [`wire-format-fixtures/`](./) corpus as the **`envelope-round-trip` / `envelope-reject`** fixture families (regenerated by the §12 `--emit-corpus` run). A conformant host reads the `$profile` / `$payload` envelope, negotiates the authored profile against its own `core@1.0`, and either re-renders byte-identical (Current/Behind – unknown kinds preserved verbatim) or refuses a `Foreign` profile with the `FOREIGN_PROFILE` code; the emitter proves the law at generation time. Certification status:

- **F#** (`Fuaran.UI` + `Fuaran.Core.Wire.Versioning`) – certified against the corpus families, in addition to the value-level `VersioningTests` in the `Fuaran.Core` codec suite.
- **TypeScript** (`@fuaran-ui/ops`) – certified against the same families via the `@fuaran-ui/conformance` kit (the `envelope-round-trip` / `envelope-reject` legs).
- **Python** – adopts the same envelope + tolerance rules and certifies against these fixtures through its own conformance phase; the corpus families are the shared authority the moment it does.

---

## 16. Lenient AI-ingest profile (decode-only convenience)

The **encoder** is strict and canonical – it always emits the verbose forms above, and the byte-stable
round-trip property (§1) is defined over that canonical output. The **decoder** additionally accepts a
small set of author-friendly shorthands so a model spends fewer tokens emitting a tree. These are a
*decode-only* convenience: every shorthand decodes to exactly the value its verbose form would, and
**re-encodes to the verbose canonical bytes** – so the shorthand never becomes a second wire dialect,
and `encode(decode(x)) == encode(verbose(x))`.

**Normative (every conformant host, present and future – F#, TS, Python, Go, …):**

- A conformant decoder **MUST** accept each shorthand below and decode it to exactly the value its
  verbose form denotes. Rejecting a shorthand, or decoding it to a different value, is
  **non-conformant** – an AI author must be host-independent.
- A conformant decoder **MUST NOT** extend the profile with shorthands not listed here (a private
  leniency is a second dialect and a silent cross-host divergence).
**What earns a place in this profile (Phase 673).** A shorthand is admitted only when it is a
**genuine assist to the emitting model** — evidence that models actually produce that form, and that
its intent is unambiguous. §16's own origin is exactly that: 38 of 122 first-time parse failures in
the first 0.2.0 cohort. **Backward compatibility is NOT an admission ground.** Accepting a superseded
spelling so that older output still parses is a deprecation seam, and §1.1 rules those out for this
language. The distinction matters because the two are easy to confuse in review: both look like
"the decoder accepts more", but only one of them pays for itself at the point where models fail.

- The profile is **enforced by the corpus**: the `lenient-accept` fixture family
  (`wire-format-fixtures/lenient/`, manifest kind `lenient-accept`) asserts
  `encode(decode(shorthandInput)) == expectedFile` for every shorthand. A host's conformance run
  **MUST** include this family alongside the round-trip and reject families – a host that skips it
  can pass certification while diverging, which is precisely what this family exists to prevent.
  (Round-trip fixtures themselves stay canonical.)

Accepted shorthands:

1. **The `Literal` envelope (0.2.0 direction-flip).** Anywhere a `TextSource` is expected (a
   heading's `text`, a button's `label`, help text, a callout body, …), the **bare JSON string IS
   the canonical form** since 0.2.0 – the encoder emits `"Revenue"`, and labels/text being the most
   common leaves makes this the largest single token saving. The verbose
   `{"$type":"Literal","text":"Revenue"}` envelope is the *lenient-accept* side of this pair now:
   decode-accepted indefinitely (pre-0.2.0 trees keep parsing) and normalised to the bare string on
   re-encode. (`Bound` / `I18n` still require their `$type` object.)

2. **Omitted default fields** (already implied by rule 4). Because the encoder omits `None` / all-
   default fields, the decoder already restores them on absence; an author may likewise omit any field
   whose default is acceptable (`state` / `style` / `accessibility`, a `Box`'s `heading`, a bare-
   default style, …). Genuinely required fields (`id`, `kind`, a node's discriminating spec fields)
   still error with `MISSING_FIELD`. (No dedicated fixtures: the canonical encoder itself omits
   defaults, so every round-trip fixture already exercises restore-on-absence.)

**Op-value spelling (producer discipline).** In a `TreeOp.UpdateProp` value position targeting a
`TextSource` field, both the bare string and the `$type: "Literal"` object decode to the same typed
value at apply time – but the op encoder is *faithful* to the JSON it carries, so the two spellings
serialise (and therefore hash-chain) differently. Producers **SHOULD** emit the bare-string spelling
for literal-text op values (the 0.2.0 canonical form, what the reference diff emits, and the
token-cheapest); hosts **MUST** accept both. Two op logs differing only in this spelling are semantically equivalent but not
hash-identical – a comparer that needs spelling-independence compares post-apply trees, not chain
hashes.

The profile is additive and does not change the negotiated wire version (§15).

### 16.1 Emitter preference – accepted is not the same as preferred

§16 and the shape-coercion table in §3.6 say what a decoder **MUST accept**. They deliberately say
nothing about which of the accepted forms an author should *write*, and the choice is otherwise
rediscovered by every emitting surface. This subsection states it once. It binds **authoring
emissions only** – any surface producing a tree for the first time, whether generated or built
through a programmatic authoring API – and it is a **SHOULD**: nothing here narrows what a conformant
decoder accepts, and an emission that ignores it is still conformant, merely more verbose than it
needs to be.

**Why it is worth stating.** Several accepted forms are strictly more compact than the verbose form
they normalise to, and the verbose form is the one an author reaches for by default. The difference
is not only emission budget: a long run of low-information literal tokens – a `validity` mask that is
`true` all the way down, a `schema` restating types the cells already carry – is an error surface in
its own right. The longer the mechanical run, the more chances to drop an element, mis-align a column
against its neighbour, or disagree with the data sitting beside it. Preferring the compact form
removes the run rather than checking it.

| Prefer | Over | Rule |
|---|---|---|
| a column as a bare array – `"amount": [100, 200]` | `{"values":[100,200],"validity":[true,true]}` | an embedded `Transform` source column whose cells are **all valid** SHOULD be emitted bare. The wire has no JSON null, so the bare array already denotes all-present – the mask carries no information (§3.6) |
| an embedded `Transform` source with **no** `schema` | `"schema":[{"name":"amount","type":"int"},…]` | when every column's type is **inferable** – `string` / `int` / `float` / `bool` – `schema` SHOULD be omitted and left to inference. Emit it explicitly only where inference cannot decide: an empty or mixed column, or a `date` / `timestamp` type, which never infers (§3.6) |
| a `Static` source carrying the values | a `Binding.Transform` whose `pipeline` is `[]` | literal data the author already holds SHOULD be emitted as the slot's own `Static` source. `Transform` is the declarative-**compute** case; with an empty pipeline it buys a schema, a columnar re-shaping of data already in hand, and an empty step array, for no computation. Reach for it when the pipeline does work – `filter` / `groupBy` / `sort` / `derive`. (§5.1 still governs *survivability* where a slot's `Static` payload is not one the language enumerates; this row ranks compactness, it does not re-rank that boundary) |
| a `DataGrid` with `staticRows` | a `DataGrid` whose literal rows sit in `source` | a **static table of literal text** SHOULD be authored as the `staticRows` mode (§3.2). This row ranks **semantics**, not compactness — and its original rationale has been superseded: before Phase 665 a grid `source` carrying literal rows erased to `"<opaque>"`, so this was a survivability ranking. Both forms now round-trip value-faithfully (§5), so the preference rests on what the two modes *mean*: `staticRows` cells are `TextSource`, so `Bound` and `I18n` apply and localisation reaches table content, and the mode declares the table read-only and non-interactive (§3.2), which a renderer honours with semantic `<table>` markup. A `source` feed carries bare scalars and declares a *data-bound* grid. Choose by which of those you mean. The preference is stated for *literal text* tables; how a **data-bound** grid should best carry its rows is ranked by the rows above, not here |

The same preference for the omitted form applies to every omitted-when-default field (§3.6): an
emission carrying only the semantic fields is the preferred one, not merely an accepted one.

**Boundary – canonical encoding is UNCHANGED.** Every row above is about which accepted form an
author emits, never about what a host produces. `encode(decode(x))` still emits the canonical
envelope form in each case – a bare column re-encodes to `{values, validity}`, an inferred schema
re-encodes explicitly, a `Static` payload re-encodes per §5 – exactly as §16's normalisation law
requires. Hosts' byte-parity conformance legs (§11) are therefore untouched by this subsection, and
no round-trip or lenient-accept fixture changes on account of it.

---

## 17. Teleport state bundle (Phase 437)

A **teleport bundle** serialises a *running* application – the tree, its `Binding.State` values, an optional bounded op-history window, and the op-chain head hash – into one string small enough to ride a URL fragment or a QR code, and resume exactly where it was on any device. It is a **new, additive top-level artefact**: the Node/TreeOp wire forms of §§1–16 are embedded unchanged, and the existing tree-only fragment-permalink format is untouched. The F# reference implementation is `Fuaran.UI.OpStream.Abstractions.Teleport` (encode/decode), over the byte substrate in `Fuaran.UI.Compression` (`Utf8` / `Base64Url` / `Deflate`).

### 17.1 String format

```
FT1.<base64url(deflate(canonical-JSON envelope))>
```

- **`FT1.`** – the self-identifying format tag (Fuaran Teleport, format 1). A future compression/framing change mints `FT2.`; the envelope's own `bundle` field versions the JSON shape.
- **deflate** – a raw RFC 1951 stream (no zlib/gzip wrapper). The reference *encoder* emits a single fixed-Huffman block with deterministic greedy LZ77 (32 KB window), so the same bundle produces the same string on every host and pipeline; a conformant *decoder* accepts the full RFC 1951 range (stored / fixed / dynamic blocks), so a host producing bundles with a standard deflate library interoperates. Decoders MUST cap decompression output (the reference default is 1 MB) and fail a bomb as a typed error.
- **base64url** – RFC 4648 §5, unpadded. The encoded string is pure ASCII (chars = bytes).

### 17.2 Envelope (canonical-JSON inner form)

```json
{ "bundle":    "teleport@1",
  "chainHead": "<64-hex op-chain head>",
  "digest":    "<64-hex SHA-256>",
  "history":   [ <TreeOp>, … ],
  "state":     { "<key>": <value>, … },
  "tree":      <Node> }
```

Rendered under the §2 canonical rules (Ordinal-sorted keys, canonical numbers, canonical escapes). Fields:

| Field | Required | Content |
|---|---|---|
| `bundle` | yes | the envelope version, `teleport@1`. An unrecognised version is refused by name (never mis-decoded). |
| `digest` | yes | integrity digest – see §17.3. |
| `tree` | yes | the §3 canonical Node wire form of the live tree. |
| `state` | omit when empty | the `Binding.State` value map: state key → any canonical JSON value (rule 12 discipline; no `null`). Capture is best-effort per rule 11 – the recognised primitives (string / bool / int / float) and already-JSON-shaped values (the decoded-path `SetState` payload) ride the bundle; host-typed content the wire cannot decompose is dropped. |
| `history` | omit when empty | a **bounded window** of §3.4 canonical TreeOps – the most recent ops, newest-last. Carried for provenance/inspection at the destination; resume does not re-apply them (the `tree` already reflects them). |
| `chainHead` | omit when absent | the op-chain head hash at bundle time (`OpRecord(Sequence).Hash`, §4-consequence vocabulary) – binds the bundle to a position in the source op-stream, the same anchoring discipline as a checkpoint's `PreviousChainHead`. |

### 17.3 Integrity digest

```
digest = sha256Hex( "fuaran-teleport:v1|" + render(envelope minus the digest field) )
```

where `render` is the §2 canonical rendering of the envelope object *without* its `digest` member (all other fields, Ordinal-sorted). Because the preimage covers every field, **any tamper – a rewritten `chainHead` included – fails verification** as a typed `DigestMismatch`, before any tree decode runs. Both encode and decode MUST assemble the preimage through the same canonical renderer (the reference implementation re-parses its own sub-documents and renders the assembled envelope through one code path, so verification cannot drift from production). The digest is an integrity check against corruption and casual tamper, not an authenticity proof – signing is the attestation seam's job, as for checkpoints.

### 17.4 Decode–validate–resume

A conformant decoder runs, in order, and surfaces every failure as a typed, recoverable error (the §6 envelope discipline – never a throw):

1. **Size gate** – reject over-long input before any decompression work; cap inflate output (both `Oversize`).
2. **Unwrap** – prefix check, base64url, inflate, UTF-8 (`InvalidFormat`), JSON parse (`InvalidJson`).
3. **Envelope shape + version** (`InvalidEnvelope` / `UnsupportedVersion`).
4. **Digest verification** (`DigestMismatch`) – before decoding any payload.
5. **Standard wire decode** of `tree` and each `history` op through the §§3–7 decoder (`TreeDecode` / `HistoryDecode` carry the standard `DecodeError`).
6. **Pre-emit validation** of the decoded tree. Node-identity defects (duplicate / empty NodeId) **refuse** the bundle (`TreeInvalid`) – state re-seat is keyed on stable identity; other findings surface as non-fatal defects.
7. **State re-seat** – the host seats the decoded `state` map into its state store (the reference lowering is the standard structural `JVal → obj` one), and the tree's `Binding.State` readers – same stable keys, same stable NodeIds – resume mid-interaction (a wizard's active step, a buffered form draft).

**FGP 3 – closures cannot exist on the wire.** The bundle rides the standard codec: closure-bearing slots are `"<closure>"` sentinels that decode to inert placeholders (§4), and only the wire-survivable action cases dispatch after resume – through the host's standard `CanDispatch` default-deny gate, exactly as for any decoded tree. A teleported app is interactive to precisely the bounded, gate-checked extent any decoded tree is.

### 17.5 Size budgets (measured)

Budgets are in encoded characters (= bytes; the string is ASCII). Reference ceilings (`TeleportBudget`):

| Surface | Budget | Rationale |
|---|---|---|
| QR, hard ceiling | **2 953** | byte-mode capacity at QR version 40, EC level L |
| QR, comfortable | **1 273** | ≈ version 25-L; above this, dense codes scan poorly on mid-range cameras |
| URL fragment, practical | **8 000** | browsers accept far more, but shared-link surfaces (chat, mail, logs) degrade beyond a few KB |

Measured on the reference exemplar (an onboarding wizard: heading + 3-step stepper + 2-field form + button, 4 state keys, a 2-op history window, chain head):

| Bundle | Encoded size |
|---|---|
| tree only | 983 chars |
| tree + state | 1 071 chars |
| full (+ history + chain head) | 1 196 chars |

 – comfortably inside every budget; roughly, the canonical JSON compresses ≈ 3× and base64url costs the ⁴⁄₃ back. **When a bundle runs over budget** (the reference `encodeWithin` refuses with a typed `Oversize`): truncate the `history` window first – it is provenance, not resume material – then prune `state` keys the tree no longer reads; the `tree` itself is the floor. Producers targeting QR should treat 1 273 as the working budget and 2 953 as the hard stop.

### 17.6 Conformance

Round-trip is byte-exact at the string level: `encode(decode(s)) == s` for every valid bundle (closures re-encode to their sentinels, §4). The executable fixtures live with the F# reference implementation (`Fuaran.UI.OpStream.Tests/TeleportTests.fs`: byte-exact round-trip, determinism, tampered-chain-head and tampered-state rejects, oversize/bomb rejects, version/envelope rejects, the budget pin). Cross-host certification (a TS teleport leg in the shared corpus) follows when a second host adopts the bundle format; the Node/TreeOp payloads inside the envelope are already corpus-certified.

---

## 18. Elicitation envelope – question-as-UI with a typed answer contract (Phase 465)

An **elicitation** is a question posed *as a live Fuaran tree*: the asker emits a canonical `Node`
tree plus a declared **answer contract** – which nodes' committed state entries constitute the
answer, each typed by a value space – and the interaction resolves to exactly **one** typed outcome.
The answer is canonical typed JSON conforming to the contract, never prose for the asker to
re-parse.

Like §17, this is a **new, additive top-level artefact**: the `Node` wire form of §§1–16 is embedded
unchanged, and no `NodeKind` / `Action` / `Binding` case is added – the envelope *wraps* a tree, it
does not extend the tree vocabulary. All §2 canonical-encoding rules apply (Ordinal-sorted keys,
canonical floats, no whitespace); optional fields are omitted when absent, never `null`.

### 18.1 The envelope

```json
{ "$elicitation": "1",
  "contract":  { "fields": [ {
      "name":     "salary",
      "nodeId":   "ask-form",
      "required": true,
      "space":    { "$type": "intRange", "max": 1000000, "min": 0 },
      "stateKey": "salary" }, … ] },
  "default":   { "grade": "a", "salary": 45000 },
  "id":        "elc-full",
  "timeoutMs": 30000,
  "tree":      { …canonical §3.1 Node… } }
```

| Field | Required | Meaning |
|---|---|---|
| `$elicitation` | yes | Format-version tag, currently `"1"`. `$`-prefixed (reserved per §2.1) so it sorts first. Any other value is refused (`UNSUPPORTED_VERSION`) – the envelope is a protocol artefact whose evolution is explicit, not tolerance-based. |
| `contract` | yes | The answer contract: a non-empty `fields` array (below). |
| `default` | no | A proposed answer the presenting host may pre-fill / fall back to. Must itself conform to the contract (`DEFAULT_NONCONFORMANT`). |
| `id` | yes | The elicitation id (non-empty). Outcomes correlate back to it. |
| `timeoutMs` | no | Integer ≥ 1. **Data only** – no conformant codec reads a clock; the *presenting host's* clock decides when to dispatch a `TimedOut` outcome. |
| `tree` | yes | The question, as a standard §3.1 canonical `Node`. Decode errors from the embedded tree surface re-rooted under `$.tree` (e.g. `MISSING_FIELD` at `$.tree.kind`). |

**Answer fields.** Each `contract.fields[i]` object (all five keys required):

| Field | Meaning |
|---|---|
| `name` | The key this field's value takes in the answer object. Unique across the contract (`CONTRACT_DUPLICATE_FIELD`). |
| `nodeId` | The id of the **node** whose committed state carries the value – for a form question, the `Form` node itself (a `FormField` is a spec record, not a child node). Must name a node present in `tree` (`CONTRACT_UNKNOWN_NODE`). |
| `stateKey` | The state key the node's binding (e.g. a `Binding.Local` `initialFrom`/commit target) writes the value under. |
| `space` | The value space (below). |
| `required` | Whether a conforming answer must carry the field. |

**Value spaces** reuse the platform's established `$type`-tagged space vocabulary (the same wire
shape the capability codec uses – one space vocabulary across the platform):

```json
{ "$type": "intRange",   "max": 5,  "min": 1 }
{ "$type": "floatRange", "max": 1,  "min": 0 }
{ "$type": "stringLen",  "max": 10, "min": 0 }
{ "$type": "enum",       "values": ["s", "m", "l"] }
{ "$type": "anyString" }
```

`min`/`max` are inclusive and must satisfy `min ≤ max`; `enum.values` is a non-empty string array;
`anyString` is the only unbounded space. An unrecognised `$type` is `UNKNOWN_DU_CASE`.

### 18.2 The answer object

An answer is a JSON object mapping declared field `name`s to **scalar** values (string or number – 
booleans and structured values are not answer values; model a yes/no as a two-value `enum`).
Conformance rules, per field:

- `intRange` – a JSON **integer** in `[min, max]`. A string of digits is `ANSWER_TYPE_MISMATCH`, not
  a coercion. Integer classification is by **value**, never by spelling: a whole-valued number
  (`4.0` ≡ `4`; the canonical layout renders it `4`) within 32-bit signed range **is** an integer – 
  JSON has one number type, and hosts whose parsers cannot see the spelling must agree with hosts
  whose parsers can. `intRange` bounds and values are 32-bit signed; a whole-valued number beyond
  that range is not an integer (`ANSWER_TYPE_MISMATCH`).
- `floatRange` – a JSON **number** in `[min, max]`.
- `stringLen` / `enum` / `anyString` – a JSON **string** (length within bounds / a member of
  `values` / any string).

Every `required` field must be present (`ANSWER_MISSING_FIELD`); optional fields may be omitted;
keys not declared by the contract are refused (`ANSWER_UNDECLARED_FIELD`) – the answer surface is
closed by shape, exactly as the authoring surface is.

### 18.3 Outcomes

The outcome set is **closed** – exactly one of four `$type`-discriminated shapes, correlated by
`elicitationId` (non-empty, required on every outcome):

```json
{ "$type": "Answered",   "answer": { "grade": "a", "salary": 52000 }, "elicitationId": "elc-full" }
{ "$type": "Declined",   "elicitationId": "elc-full" }
{ "$type": "TimedOut",   "elicitationId": "elc-full" }
{ "$type": "Superseded", "by": "elc-next", "elicitationId": "elc-full" }
```

`Superseded.by` (the elicitation that replaced this one) is optional. An unrecognised `$type` is
`UNKNOWN_DU_CASE`; a key not declared for the outcome's shape is `UNDECLARED_FIELD` (a `Declined`
outcome cannot smuggle an answer). Decoding an outcome does **not** check contract conformance – 
the outcome does not carry the contract; conformance is the §18.4 validation step, run by whatever
pairs the outcome with its pending elicitation *before the answer reaches the asker*.

**Strictness.** Every object position in this artefact – envelope, contract, field, space, outcome,
answer document – rejects undeclared keys (`UNDECLARED_FIELD`). The elicitation envelope is a
protocol artefact, not a forward-compat carrier: there is no must-ignore tolerance here; evolution
is explicit via `$elicitation` (and, when carried inside a §15 envelope, the profile negotiation
applies to the embedded tree as usual).

### 18.4 Decode + validation pipeline

A conformant decoder runs, in order, failing fast with one structured §6-shaped error
(`{ code, path, message }`) so every host surfaces the **same first error**:

1. **JSON parse** (`INVALID_JSON` at `$`); root must be an object (`WRONG_TYPE`).
2. **Undeclared envelope keys** (`UNDECLARED_FIELD` at `$.«key»`, first offender in document order).
3. **Version tag** – `$elicitation` present, a string, equal to `"1"` (`MISSING_FIELD` /
   `WRONG_TYPE` / `UNSUPPORTED_VERSION`).
4. **`id`** – non-empty string.
5. **`tree`** – the standard §§3–7 node decode; errors re-rooted under `$.tree`.
6. **`contract`** – structure (`fields` non-empty: `CONTRACT_EMPTY`), per-field shape in array
   order (strict keys, non-empty strings, space decode), duplicate names
   (`CONTRACT_DUPLICATE_FIELD` at the *second* occurrence), and tree membership of each `nodeId`
   (`CONTRACT_UNKNOWN_NODE`).
7. **`timeoutMs`** – integer ≥ 1 when present.
8. **`default`** – decoded as an answer object, then validated against the contract; any violation
   is `DEFAULT_NONCONFORMANT` at the offending path under `$.default`.

**Answer validation** (the gate before an `Answered` outcome reaches the asker) is deterministic
and fail-fast: (1) undeclared answer keys, in the answer's Ordinal key order; then (2) each
contract field in **declaration order** – missing-required, then JSON-type-vs-space
(`ANSWER_TYPE_MISMATCH`), then in-space (`ANSWER_OUT_OF_SPACE`).

### 18.5 Error codes

Structural failures reuse the §6 codes (`INVALID_JSON` / `MISSING_FIELD` / `WRONG_TYPE` /
`UNKNOWN_DU_CASE`) on the same error envelope; the elicitation layer adds (kept OUT of the core
six-code set, like §15's `FOREIGN_PROFILE`):

| Code | Meaning |
|---|---|
| `UNSUPPORTED_VERSION` | `$elicitation` names a version this codec does not accept |
| `UNDECLARED_FIELD` | an object position carries a key its shape does not declare |
| `CONTRACT_EMPTY` | the contract declares no fields |
| `CONTRACT_DUPLICATE_FIELD` | two answer fields share a `name` |
| `CONTRACT_UNKNOWN_NODE` | a field's `nodeId` names no node in `tree` |
| `ANSWER_MISSING_FIELD` | a `required` field is absent from the answer |
| `ANSWER_UNDECLARED_FIELD` | the answer carries a key the contract does not declare |
| `ANSWER_TYPE_MISMATCH` | an answer value's JSON type does not fit its declared space |
| `ANSWER_OUT_OF_SPACE` | a well-typed answer value is outside its declared space |
| `DEFAULT_NONCONFORMANT` | the envelope's `default` violates its own contract |

### 18.6 Conformance

Four corpus families in the shared [`wire-format-fixtures/`](./) corpus
(regenerated by the §12 `--emit-corpus` run; the emitter proves every law at generation time):

- **`elicitation-round-trip`** – decode with the `decoder`-named entry point (`elicitation` ⇒ the
  envelope codec, `elicitation-outcome` ⇒ the outcome codec), re-encode, assert byte-equal to
  `expectedFile`.
- **`elicitation-reject`** – decode with the named entry point; assert the error's code ==
  `expectedErrorCode` at a path starting with `expectedPath`.
- **`elicitation-answer-accept` / `elicitation-answer-reject`** (`decoder: "elicitation-answer"`) – 
  the `inputFile` is a `{ "answer": …, "contract": … }` conformance document (it carries no tree,
  so the `CONTRACT_UNKNOWN_NODE` probe does not apply); run the host's answer validation and assert
  acceptance, or the expected refusal.

Like §15's envelope families (and unlike the node/op families), these fixtures are **outside
`schema.json`'s scope** – the embedded `tree` payloads are already schema-described; the envelope's
own shape is normative here. F# (`Fuaran.UI.OpStream.Abstractions`) and TypeScript
(`@fuaran-ui/ops`) certify against these families; any further host certifies the same way.

---

## 19. Renderer URL-scheme floor (normative renderer obligation)

URL-valued slots – `DisplayKind.Image.src`, `InteractiveKind.Link.href`, the `Action.Navigate`
destination, and every other slot documented as carrying a URL – are **opaque strings on the wire**.
The decoder does not validate them, and this section does not change that: a URL that fails the
floor below is still a *valid wire document*, and a decoder MUST NOT reject it.

What this section adds is the other half of the contract. A **rendering host** – any host that emits
markup, or drives a live document, from a decoded tree – MUST apply the following floor to a
URL-valued string before it reaches an `href`, `src`, or equivalent navigation/fetch sink. This was
previously a per-host choice, which meant a tree vetted on one host was not thereby safe on another;
it is now an obligation. Hosts that only decode, re-encode, or transform trees are unaffected.

**The floor.** Given the slot's string value:

1. **Normalise the string exactly as the [URL Standard](https://url.spec.whatwg.org/) basic URL
   parser does before it parses anything**, in this order, ASCII-exact:
   1. Remove leading and trailing **C0 control or space** — every code point in U+0000–U+0020
      inclusive, not merely the whitespace subset ([URL §4.1 basic URL parser, step
      1](https://url.spec.whatwg.org/#concept-basic-url-parser)).
   2. Remove **all** U+0009 TAB, U+000A LF and U+000D CR from anywhere in what remains ([URL §4.1,
      step 2](https://url.spec.whatwg.org/#concept-basic-url-parser)). Note this second step is those
      three code points only — U+000B and U+000C are removed by step 1 at the edges and **kept** in
      the interior, matching the parser.

   Both are validation errors in the standard that nonetheless proceed, so the string the floor
   inspects is the string the browser will parse. An empty result is **accepted** and passed through
   (a same-page reference; the documented HTML behaviour).

   **Do not substitute the implementation language's native trim.** Every one differs from this rule
   and they differ from each other: measured across five hosts, `str.strip` also removes
   U+001C–U+001F while `.NET`, JS, Go and Rust do not, and JS alone leaves U+0085 NEL where the other
   four remove it — divergence in the one rule whose whole purpose is that a tree vetted on one host
   is safe on another. All five also over-remove non-ASCII whitespace (U+00A0, U+2028, U+1680,
   U+3000) that the parser keeps; going ASCII-exact ends both classes at once.
2. Determine the scheme: the substring before the first `:` that occurs **before** any `/`, `?`, or
   `#`. If no such `:` exists, the reference is *schemeless* – go to rule 5. Otherwise remove every
   character at or below U+0020 from the candidate and ASCII-lowercase it, so that obfuscations such
   as `java<TAB>script:`, `  javascript:` and `JAVASCRIPT:` all classify as `javascript`.
3. **Accept** the scheme if and only if it is one of `http`, `https`, `mailto`, `tel`, `ftp`, `sftp`.
4. **Reject** every other scheme. This is default-deny, not a denylist: `javascript`, `vbscript`,
   `file` and `data` are rejected because they are known execution or exfiltration vectors, and an
   unrecognised scheme is rejected because the floor cannot reason about it. Widening the accept set
   is an additive, per-host-coordinated change; narrowing it is not a wire-format change at all.
5. A schemeless reference is a relative reference and is **accepted** – *except* a
   **protocol-relative** reference, which MUST be **rejected**. A reference is protocol-relative when
   its first two characters are each `/` or `\`; that is, `//host`, `/\host`, `\\host` and `\/host`.
6. On rejection the host MUST NOT emit the original value. It either omits the attribute entirely or
   substitutes the literal `about:blank`; `about:blank` is recommended where the element would
   otherwise be invalid or lose its semantics.

**Rule 1's output is the value that gets emitted**, not the original string. An accepted URL carrying
an interior tab is therefore emitted without it. That is correct — it is what the browser would have
parsed anyway — but the emitted bytes differ from the input, which is a visible behaviour change and
the reason a host adopting this rule is making a breaking change.

**Rule 1 and rule 2 cannot disagree, and rule 2 needs no amendment.** Removal never reorders the
surviving characters, and none of the removed code points is `:`, `/`, `?` or `#` — so which
delimiter comes first is invariant and rule 2 selects the same candidate substring before and after
normalisation. Rule 2 then already discards everything at or below U+0020 from that candidate, so the
classification is identical either way: `java<TAB>script:` is refused under both readings.

**Rule 2's ≤U+0020 strip is deliberately stricter than the browser and MUST NOT be narrowed to
rule 1's TAB/LF/CR set.** `java<VT>script:` is refused by the floor and treated by the parser as a
relative path — an over-rejection, which is the safe direction. The two rules answer different
questions: rule 1 reproduces what the parser will see, rule 2 refuses anything that *could* be read
as a dangerous scheme.

**Positional tests are defined over the normalised form.** Any rule in this section that inspects a
URL string by character position — rule 5 is the first, and is not intended to be the last — operates
on rule 1's output. Without this, each new positional rule would independently reinherit the gap
between the floor's idea of the string and the parser's, which is exactly how rule 5 came to be
evadable by a single interior tab.

**Two deliberate divergences remain, both in the safe direction.** Rule 2 is stricter than the parser
(above). And because rule 1 is ASCII-exact, non-ASCII whitespace is no longer removed: a leading
U+00A0 now survives to rule 5, which sees `<U+00A0>` rather than `/` and **accepts** — matching the
parser, which also keeps it and resolves an ordinary same-origin path. That is a loosening relative to
a native trim, and it is the correct answer.

**Why rule 5 is part of the floor and not an edge case.** A protocol-relative reference carries no
scheme, so rules 2–4 never see it and the schemeless branch would admit it. But a browser resolves
it against the *current document's* scheme and lands on the named host – which is off-origin.
The same-origin intent that makes a schemeless reference safe simply does not hold for it. On a link
that is off-origin navigation the tree never asked for; on an image source it is an off-origin
request that leaks the referring URL. The backslash forms are included because WHATWG URL parsing
treats `\` as `/` for special schemes, so all four spellings resolve identically – a floor that
rejected only `//` would be trivially evaded.

Rule 1's normalisation is what makes rule 5 hold against the two evasions that defeated its
pre-normalisation form. Without step 1.2, `/<TAB>/host/x` has first two characters `/` and `<TAB>`,
so rule 5 read an ordinary relative reference and accepted, while the parser removed the tab and
resolved off-origin — and the same for LF, CR, and every mix of the four slash spellings. Without
step 1.1, a leading C0 control that is not whitespace (`<U+0001>//host/x`, `<NUL>//host/x`) survived
every native trim, pushed the two slashes out of positions 0 and 1, and reached the parser, which
removed it and resolved off-origin. Neither is script execution — rules 2–4 still classify
`java<TAB>script:` as `javascript` and refuse it — but both are off-origin navigation, or an
off-origin subresource fetch that leaks the referrer, from a tree that asked for neither.

**Case folding in render-time sanitisers (normative where it applies).** A host whose sanitiser
scans a **case-folded copy** of a string and then applies the resulting offsets to the **original**
MUST use an **ASCII-only** fold. Locale-aware and full-Unicode folds are not length-preserving –
U+0130 folds to two code points – so the two strings desynchronise and the host operates on the
wrong span: it removes the wrong bytes, leaves a fragment of the construct it meant to remove, and,
in a byte-indexed host, can split a multi-byte character and emit invalid UTF-8. The vocabulary such
a scan matches (element names, scheme names) is ASCII, so an ASCII-only fold loses no matches. A
host that folds and rescans without reusing offsets is unaffected.

### 19.1 The `embed` class — a stricter floor for a slot that EXECUTES (Phase 1111)

`DisplayKind.Embed.src` does **not** ride the accept set above. Everything else §19 governs is
fetch-and-display or navigate-on-a-click; an embed is fetch-and-**execute**, and the floor for it is
correspondingly narrower. A rendering host MUST apply this rule instead of rules 2–5 for that slot:

1. Normalise exactly as **rule 1** does, unchanged. That rule is what makes any positional or prefix
   test see the string the browser's parser will see, and sharing it is deliberate.
2. Determine the scheme exactly as **rule 2** does — same extraction, same ≤U+0020 strip, same
   ASCII-lowercase.
3. **Accept if and only if the scheme is `https`.** Reject everything else.
4. On rejection the host MUST emit the element with **no source attribute at all**. It MUST NOT
   substitute `about:blank`, and MUST NOT emit the original value.

**Two of the exclusions are things §19 accepts, and both are deliberate.** `http` is refused because a
document delivered over a channel any intermediary can rewrite is an intermediary's script running in
a frame this page created — a risk that does not arise when the same channel delivers an image. And a
**schemeless** reference is refused, which is the sharper departure: a relative reference names a
same-origin document, and a same-origin frame is exactly the shape where a document granted both
`AllowSameOrigin` and `AllowScripts` can reach its own frame ELEMENT and remove the sandbox attribute
from it. A host that wants to compose its own content has `Mount`; this kind is for the uncooperative
third party.

**The class admits no schemeless reference, so it needs no rule-5 analogue** — and that is a property
worth stating rather than an omission. Rule 5 exists because the schemeless branch would otherwise
admit a protocol-relative reference, and its two historic evasions were both positional. A class that
accepts exactly one scheme performs no positional test and cannot inherit that surface.

**Deployment-policy scoping is separate and also distinct.** Where a host applies a destination
policy, an embed's destination is checked under its own class — named `embed`, never `media`. A
composition that declared an origin for image egress has said nothing about which DOCUMENTS it is
willing to run, and a class that conflated the two would let the first declaration answer the second
question.

As everywhere else in §19, this is a RENDER-time obligation and not a wire constraint: a document
naming an `http` or relative embed source is a **valid wire document**, a decoder MUST NOT reject it,
and a host that only decodes, re-encodes or transforms trees carries the value through unchanged.

---

## 20. Decode determinism (PROPOSED – NOT YET NORMATIVE)

> **Status: proposal, not contract.** Nothing in this section is binding on any host, no fixture
> pins it, and no host should be changed to conform to it before the questions below are settled and
> every host can move together. It is recorded here so the decision has a starting point rather than
> a blank page.

§1 states the fundamental conformance property as byte-stable round-trip, and the corpus enforces it
per fixture. That property is silent about a narrower question: given **the same input bytes**, do
two conformant hosts produce **the same tree**, or the same rejection? Today, for a small set of
inputs, they do not — and because every host is individually self-consistent, the corpus cannot see
it. The divergences are all at the **JSON syntax layer**, below the `$type` dispatch this document
otherwise specifies, which is why they escaped: §2 describes what a conformant *encoder* emits and
has never constrained what a *decoder* must refuse.

The measured behaviour, across the five codec hosts:

| Input | F# (ref) | TypeScript | Python | Go | Rust |
|---|---|---|---|---|---|
| Duplicate object key (`{"id":"a","id":"b"}`) | **first** wins | last wins | last wins | last wins | last wins |
| Content after the root value | accepted | accepted | **rejected** | **rejected** | accepted |
| Overflowing exponent (`1e999`) | → `Infinity` | → `Infinity` | → `Infinity` | → `Infinity` | → `Infinity` |
| Leading `+` on a number (`+1`) | accepted → `1` | accepted → `1` | **rejected** | **rejected** | accepted → `1` |
| Bare `NaN` / `Infinity` literal | rejected | rejected | **accepted** | rejected | rejected |
| §7 sentinel string at a typed float slot | accepted | accepted | accepted | accepted | accepted |

**Why the first row is the serious one.** The other rows differ on whether a document is *accepted*;
a disagreement there is loud, and the stricter host simply refuses to proceed. Duplicate keys differ
on **what the document means**, silently, with no error anywhere. A host that vets a tree and a host
that renders it can therefore be looking at two different trees derived from identical bytes — which
is a smuggling primitive, not merely an inconsistency. It is also the only row where the reference
host is the outlier: it is first-wins because its object parser accumulates entries in reverse and
then folds them into a map that lets later list entries win, so the reversed order leaves the
*first-parsed* key standing. That is emergent, not designed.

**The last row WAS a round-trip hole, and every host's CODEC now closes it.** §7 requires a decoder
to accept the quoted `"NaN"` / `"Infinity"` / `"-Infinity"` sentinels at a float slot, and every host
*emits* them. Two hosts did not accept them at every such slot, so a non-finite value encoded by one
host did not decode on those hosts at all — a host emitting bytes its own decoder refused. Unlike the
rows above this was already a §7 conformance defect rather than an open question, and it needed no
spec decision, which is why it could close on its own while rules 1–5 below stayed open.

The row above is the re-measurement, taken per **slot class** rather than at one slot, because the
two lagging hosts each accepted the sentinels at *some* float slots and not others — a fix designed
from one slot would have been a fix for one slot. The classes measured on all five hosts, with all
three sentinels: a typed float scalar, a typed float nested in a shape, an optional typed float, a
float inside a coordinate pair, a float behind a `Binding`'s `Static` envelope, and an element of a
float **sequence**. All five hosts now accept at every one of them, `decode → encode → decode`
closes, and the canonical bytes agree across all five.

Two properties of the fix are worth stating, because a later host will have to reproduce them:

- **A float slot widens; an integer slot does not.** §7 truncates at an integer slot and says nothing
  about sentinels there, so `"Infinity"` at an integer slot stays a `WRONG_TYPE` on every host. Both
  lagging hosts reached their integer slots through a separate gate, so the widening could not leak
  into them — worth checking rather than assuming, in a host where one function serves both. A
  non-sentinel string (`"banana"`) at a float slot stays a `WRONG_TYPE` everywhere too: the accept set
  widens by exactly three strings.
- **The decoded value is the FLOAT, not the sentinel string.** §7 says `JString "NaN"` → NaN, and the
  distinction is observable: the bare overflowing literal `1e999` already decodes to an infinity
  (row 3), so a host that answered a re-decode of its own canonical output with a string would hand a
  consumer a float the first time and a string the second. Byte-stability alone does not catch that.

**The corpus now pins it, and it takes three fixtures rather than one.** The natural pin is an
accept-case `node-round-trip` fixture carrying a sentinel — not a reject fixture: the defect was a
*conformant* document being refused, so what needs pinning is that it decodes. Three, because the
per-slot-class measurement above found the lagging hosts accepting at some float slots and not
others, so "this host accepts the sentinels" was never a well-formed claim. One per distinct decoder
path: `drawing-nonfinite-sentinels` (all three sentinels at typed float scalars, plus one at a
coordinate nested inside a shape), `spark-nonfinite-sentinel` (elements of a float **sequence**,
among finite neighbours), and `metric-nonfinite-sentinel` (behind a `Binding`'s `Static` envelope —
the one class every host already handled, pinned so that stays a fact rather than an assumption).
The integer boundary keeps its own pins: the corpus's integer controls must go on refusing.

Landing them needed the reference host's **IDL-generated structural layer** first, which is a second
decoder inside that host and one a codec fix does not reach: every node fixture must also decode and
re-encode byte-identically through it, and its float primitive modelled a finite double only, in
both directions. So a fixture pinning §7 would have failed the reference host's build on a defect in
a different layer from the one it was pinning — the same shape the corpus met when a UI vocabulary
addition reached the fixtures ahead of the IDL. The order that worked then worked again: IDL first,
fixture second. The generated float slot now emits the sentinel and reads it back, and the generated
JSON schema admits it at a float slot and still refuses it at an integer one. The hosts' generative
decoder-fuzz legs — where the hole was found in the first place — keep running beside the fixtures
rather than in place of them.

**Proposed rules, for the decision to accept, amend or reject:**

1. **Duplicate keys — reject** as an `INVALID_JSON` syntax error at the object's path. Rejection is
   the only option that cannot silently differ: both first-wins and last-wins are defensible, so a
   host that picks the other one is wrong in a way nothing detects. It also costs nothing legitimate,
   since no conformant encoder can emit a duplicate key. Last-wins is the fallback if rejection
   proves incompatible with a host's parser shape; first-wins is not recommended even though the
   reference host does it, because it is the minority behaviour and was not a decision.
2. **Trailing content — reject.** A wire artefact is a single JSON document (§1); requiring
   end-of-input after the root value makes that explicit and closes an obvious framing ambiguity.
3. **Leading `+` — reject**, per RFC 8259, which does not permit it.
4. **Bare `NaN` / `Infinity` literals — reject**, per RFC 8259. §7's quoted sentinels are the
   specified representation for non-finite values and are unaffected.
5. **Overflowing exponent — specify the existing behaviour** (`1e999` → the corresponding infinity)
   rather than change it. All five hosts already agree; it is unspecified, not divergent.
6. **§7 sentinels — bring the two hosts into line with §7** at *every* float-valued slot, including
   float sequences, independently of rules 1–5. **The five codecs are DONE** (see the
   round-trip-hole note above); the corpus fixture and the reference host's generated structural
   layer are not. Kept here rather than struck out, because it is not finished until it is pinned.

**What landing the REST requires.** Rules 1–4 are each a decoder-visible **breaking change** for at
least one host, so they need a version/profile decision under §15 as well as a coordinated §11 change
across encoder, decoder, corpus and every host. Fixtures pinning them are deliberately **not** in the
corpus yet: the corpus is a shared gate that every host runs, so a fixture landing ahead of the hosts
turns their builds red for a rule none of them has adopted. The fixtures land with the hosts, not
before them.

Rule 6 is the exception that shows the shape of that constraint rather than a breach of it. It widens
an ACCEPT set, so no document that decoded before is refused now, and it restates an obligation §7
already imposed rather than proposing a new one — which is why it could move ahead of the other five
without a version decision. What it could NOT move ahead of is a host's own build, which is exactly
the constraint this paragraph states, arriving from an unexpected direction: the blocker was not a
host that had refused the rule, but a layer inside a host that has no way to express it yet.

---

## 21. Resource limits (normative)

§6 promises that every wire-shape violation surfaces a **structured, recoverable** error, never a
throw. That promise held on *semantics* — a wrong-typed field, an unrecognised discriminator — and
was silent on *shape*. A decoder for this format is a recursive descent over a recursive document,
and nothing in §1–§20 bounded the recursion. A payload of a few hundred kilobytes consisting only of
`[[[[[…` — two bytes per level — drives a host off the end of its stack, and that is **not** a
`DecodeError`. On several host languages it is not even a catchable condition: the .NET
`StackOverflowException` cannot be caught and terminates the process outright, and Python's
`RecursionError` and JavaScript's `RangeError` escape a decoder that catches only its own error
type. Any host decoding untrusted input therefore had a one-request remote kill — and this document
mandated it, because rule 12 required structured payloads to round-trip "at any nesting depth".

This section closes that. The limits below are **part of the format**, not a per-host deployment
choice: a document within them is a valid wire document that every conformant host MUST be able to
decode, and a document beyond them is one that every conformant host MUST refuse, with the same
typed error.

### 21.1 The limits

| Limit | Value | Bounds |
|---|---|---|
| **max node depth** | **24** | NODE nesting – the longest root-to-leaf chain of `Node` objects, the root counting as 1. |
| **max JSON depth** | **256** | SYNTACTIC nesting – the depth of the underlying JSON document; every `{` and `[` counts, whether it carries a node, a spec, or a rule-12 payload. |
| **max string length** | **1 048 576** | Characters in a single decoded JSON string. |
| **max array length** | **100 000** | Elements in a single JSON array, and members in a single JSON object. |
| **max total nodes** | **100 000** | `Node` objects in one document, summed across the whole tree. |

**Why node depth and JSON depth are two numbers and not one.** They are not derivable from each
other in either direction. One tree level costs several JSON levels — a `Box` costs three (the node
object, its `children` array, the child object) and the worst-shaped kinds about five — so a single
figure cannot express both. More importantly they bound different things: a rule-12 structured
payload position nests freely *within* one node and consumes no node depth at all, so the node bound
does not constrain it and the syntactic bound is the only thing that does. 256 is chosen so that it
comfortably admits a maximally-deep tree of any kind shape with payload room left over — a host must
never report a node-depth breach as a syntax-depth breach, because that diagnosis sends the author to
repair the wrong thing.

**Why a total-node bound is needed once depth is bounded.** Depth, string length and array length
together still admit a document that is hostile by being **wide**: 24 levels of 100 000 siblings is
within every other limit. Its cost is linear in the input, but the constant is not — a decoded tree
is far larger in memory than the bytes that produced it.

**What these limits do not bound.** They bound *structure*, not total payload size, and a host still
owns the transport-level size limit (a request-body cap) separately. The two are complementary: a
size limit cannot express "not more than 24 levels deep", and a structural limit cannot express "not
more than 8 MB".

### 21.2 Host obligations

1. A conformant host **MUST accept** any document within every limit above. Refusing one is not
   conservatism, it is non-conformance: a tree vetted on one host would not be decodable on another.
2. A conformant host **MUST refuse** any document exceeding any limit above, with a `LIMIT_EXCEEDED`
   error in the §6 envelope. `Path` names the position at which the limit was breached; `Message`
   names the limit and the observed value, so an author repairing the document knows which bound to
   come back under. A limit breach **MUST NOT** be reported as `INVALID_JSON` — the input is
   well-formed and merely too large to walk, and calling it malformed is an actively wrong diagnosis.
3. The refusal **MUST NOT** be an exception, a panic, a process exit, or any escape from the host's
   declared error type. This is the obligation the section exists for, and the one a host is most
   likely to satisfy partially: catching a language-level recursion error is **not** equivalent to
   counting depth, because in at least one host language the condition is not catchable at all, and
   in others it is catchable only outside the decoder's own error contract.
4. The bound **MUST be enforced on the way down**, before the recursion that would breach it — never
   detected afterwards by measuring the structure that was built. A check that runs after the walk it
   is meant to bound has already paid the cost it exists to refuse, and on a host with a hard stack
   limit it never runs at all.
5. **Every walk over a decoded tree is subject to the node-depth bound, not only the decoder** —
   validation, transformation, cost accounting, and rendering alike. A document that decodes must not
   be able to kill a later stage. Where a host's walk has a signature that cannot express refusal (a
   total `tree -> markup` renderer, say), it MUST still bound the walk rather than recurse, and MUST
   make the truncation observable in its output rather than silently emitting a shortened tree.
6. A host **MAY** apply a **tighter** operational ceiling than the values above — a per-tenant node
   budget, for instance. A tighter ceiling is deployment policy, not a conformance claim: the host
   MUST document it, and MUST NOT describe a document it refuses under a tighter ceiling as
   malformed.

### 21.3 Amendment to rule 12

Rule 12's "faithfully at any nesting depth" is amended by this section to "faithfully at any nesting
depth within the §21 limits". Nothing else about rule 12 changes: within the bound the round-trip
guarantee is exactly as strong as it was, and the key-ordering, number and no-null rules are
untouched.

### 21.4 How the values were chosen

The node-depth figure is the only one derived from measurement rather than judgement, and it is the
tightest, so the derivation is recorded rather than asserted. Each walk in the reference (F#) host
was bisected for its true overflow depth, with the guards raised out of the way, on a thread with an
explicitly-sized 1 MB stack — the platform default — in both build configurations. Because a stack
overflow terminates the process, each probe ran as its own process; the figures are the deepest
level that survived.

| Walk | Optimised | Unoptimised | Unit |
|---|---|---|---|
| JSON parser | 2 095 | 805 | JSON nesting |
| structural node decoder | 186 | 31 | tree nesting |
| canonical encoder | 348 | – | tree nesting |
| pre-emit validator | 294 | 151 | tree nesting |
| server-side renderer | 67 | 30 | tree nesting |

Depth scales linearly with stack size (512 KB / 1 MB / 4 MB gave 31 / 67 / 285 for the renderer), so
these are genuine per-frame costs rather than an artefact of one stack size. The **binding
constraint is the server-side renderer** at roughly 15 KB of stack per node level optimised and 34 KB
unoptimised — its per-kind dispatch is one large function whose frame carries every branch's locals.
**24** is the largest round figure that keeps a real margin on that walk in *both* configurations. A
larger figure was rejected deliberately: 32 fits the optimised build comfortably but is past the
unoptimised renderer's and unoptimised decoder's budget, which would leave the guard working only in
the configuration hosts ship and not in the one they debug — and a guard with a hole is worse than a
smaller limit, because it reads as covered.

For scale, the deepest tree in this corpus is 3 levels, and a deliberately deep application tree
(dashboard > grid > card > stack > tabs > panel > split > disclosure > form > field) reaches about
16. Other hosts' per-frame costs will differ; the limit does not, because it is a protocol number.
A host that measures a *tighter* budget than 24 on some walk of its own should bound that walk
by §21.2 rule 5 rather than propose a smaller wire limit.

### 21.5 Conformance status

The reference (F#) host enforces all five limits. Specifically: its JSON parser enforces the
syntactic-depth, string-length and array-length bounds; its structural decoder enforces the
node-depth and total-node bounds; its **op** decoder enforces the same node-depth figure over
`TreeOp.Batch` nesting, counted on its own axis; and — per rule 5 — its pre-emit validator, its
server-side renderer and its interaction-cost accounting each enforce the node-depth bound on their
own walks, the renderer by the visible-marker route rule 5 allows for a total signature.

**A note for implementers, because it cost this host a second pass.** Bounding the node decoder is
not sufficient. `TreeOp.Batch` makes the *op* decoder self-recursive on a separate axis, and the
syntactic bound looks like adequate cover for it (two JSON levels per Batch level, so 256 admits only
about 127) — it is not. On the reference host, 2.6 KB of 100 nested Batches killed the process with
every other bound already in place. Enumerate every recursive entry point, including the ones whose
recursion is over ops rather than nodes.

**And the note earned its keep: `TreeItem` (Phase 1120) is a THIRD axis, arriving the same way.** A
`Tree`'s rows nest inside ONE node, so the node bound cannot see them at all however deep they go,
and at roughly two JSON levels per row the syntactic bound is not reached either — the same two
false comforts, at a new slot. A conformant host MUST bound item nesting **on its own axis**, counted
from the root row list, and MUST refuse a breach with `LIMIT_EXCEEDED` on the way down.

**The FIGURE is `max node depth`, reused rather than a sixth limit minted.** These frames cost what
the node decoder's frames cost, so a second number would be two figures for one per-frame budget and
every host would have to carry both. That is the same choice the op axis made, for the same reason.
The rule generalises past both: *any* self-referential record this format grows is bounded by that
figure on its own axis, and a new one is a conformance obligation on the day it lands rather than a
limit row added later.

**The four remaining hosts have since adopted them.** What follows is the record of what each was
found doing beforehand — kept rather than deleted, because the four failed in four different ways and
a host adopting §21 later will recognise its own shape here. The measurements are the ones the
adoption was designed against.

- **TypeScript** – `parseValue` / `parseObjectValue` / `parseArrayValue` were mutually recursive with
  no counter, and neither the parser nor the `decodeNode` entry point wrapped the walk in a
  `try`/`catch`. The engine's `RangeError` is catchable in principle but is not part of the declared
  `Result` contract, so it escaped the decoder as a throw. *Fixed: the parser counts depth and the
  parse error carries a flag distinguishing a limit breach from a syntax error, so the decoder can
  honour rule 2.*
- **Python** – `decode_node` caught `ValueError` around `json.loads`, and CPython raises
  `RecursionError` on deep nesting, which is not a `ValueError`. It escaped the same way. *Fixed:
  the parse is wrapped to catch `RecursionError` as `LIMIT_EXCEEDED`, and the shape bounds run over
  an explicit stack — a recursive checker would be the bug it is checking for.*
- **Go** – measured, and the finding is that Go does **not** crash: its goroutine stacks grow, and
  `encoding/json` applies its own syntactic nesting cap first, so a hostile document is refused
  rather than fatal. Two conformance defects remain. The cap sits at the JSON nesting the standard
  library enforces, not at §21.1's figures — a node tree decodes happily at 1 000 levels and is
  refused only around 4 000, and nested `Batch` around 5 000 — so Go **accepts documents rule 1
  requires every host to refuse**. And when it does refuse, it reports **`INVALID_JSON`**, which
  rule 2 explicitly forbids: the input is well-formed and merely too deep, so that diagnosis sends
  an author to repair the wrong thing. Go therefore needed the limits and the code, not a crash fix.
  *Fixed: the walk state is THREADED rather than package-level — its decoders can be called
  concurrently, so shared counters would be a data race — and the syntactic bound is checked on the
  raw text BEFORE parsing, so the standard library's own cap can no longer refuse a document as
  malformed before §21 refuses it as too large.*
- **Rust** – measured, and it is the worst case in this table: its hand-rolled `parse_value` /
  `parse_object` / `parse_array` are unbounded mutual recursion, and a Rust stack overflow **aborts
  the process** — not a catchable condition, and rule 3's exact prohibition.

  **It cannot decode a document rule 1 says it MUST accept.** Bisected on the default main-thread
  stack, the deepest surviving node-decode depth is **7 unoptimised / 102 optimised**, and nested
  `Batch` **22 / 296**; bare syntactic nesting reaches 917 / 3 176. The node figure is the one that
  matters: §21.1 sets max node depth at **24**, so the unoptimised Rust host dies on a
  *conformant* document, three times under the limit, in the configuration its developers build in.

  This is a per-frame-cost problem and **a depth counter alone does not fix it**. A guard at 24
  would never be reached unoptimised, because the process is gone at 8. Per §21.4 the limit is a
  protocol number and does not move for one host's frame size, so the work is to make the Rust
  decode walk cheaper per level — or to stop using the call stack for it — and *then* to add the
  guard. Recorded here rather than left to be rediscovered, because the obvious reading of "port
  the guard" underestimates this host specifically.

  *Fixed, and the frame came first.* Its kind dispatch was one match over the whole vocabulary, and
  in an unoptimised build a function's frame reserves space for every branch's locals, so each level
  of the recursion carried the entire vocabulary's worth of stack — about 128 KB. Split into small
  groups called in sequence, one level now costs a fraction of that: the same measurement clears 90
  levels on both axes, against a limit of 24. The guard was added after, because until the frame
  shrank it could not be reached.

**Method, so the figures above can be re-derived rather than trusted.** Each host was driven with
generated documents of increasing depth — nested `Box` nodes for the node axis, nested `Batch` for
the op axis, bare `[[[…` for the syntactic axis — and the deepest surviving depth found by
bisection, one process per probe because an overflow terminates the process. The same shape as
§21.4's F# derivation, and worth repeating on any host before it adopts a figure.

Bringing each into line is a per-host change against this section, not a spec question.

**All five hosts now enforce §21, and the corpus carries the family.** The status list above is
history: TypeScript, Python, Go and Rust adopted the limits alongside the reference host, each
bounding its parser, its structural decoder and its **op** decoder on separate axes.

**The fixtures are STORED, not generated — the expense this section anticipated turned out to be
misjudged.** The reasoning was that the smallest input breaching the *smallest* limit runs to
hundreds of kilobytes. That is true only of the two LINEAR limits: a max-string or max-array vector
really is about a megabyte. The bound that matters for the recursion class is **node depth**, and it
is breached far more cheaply — a 25-level node chain is about 3 KB, nested `Batch` under 1 KB, bare
syntactic nesting under 1 KB. So the depth family stores comfortably, needs no generator vocabulary
in the manifest, and runs on the reject machinery every host already implements.

The two linear limits stay **host-local tests** rather than corpus fixtures, deliberately: a
megabyte of `"aaaa…"` committed to a shared repository to assert one integer comparison is a poor
trade, and unlike the depth bounds it is not a recursion hazard. Each host asserts them in its own
suite.

Four fixtures, and note that one of them is an ACCEPT case:

| fixture | what it pins |
|---|---|
| `limit-node-depth-at-max` (node-round-trip) | a tree at EXACTLY 24 levels **decodes**. Rule 1, and the half hosts actually failed — two of the five aborted the process here |
| `reject-limit-node-depth` | 25 levels → `LIMIT_EXCEEDED` |
| `reject-limit-op-depth` | 25 nested `Batch` → `LIMIT_EXCEEDED`, the separate op axis |
| `reject-limit-json-depth` | 257 levels of bare nesting — one PAST the limit → `LIMIT_EXCEEDED`, not `INVALID_JSON` |
| `reject-limit-json-depth-at-max` | 256 levels — exactly AT the limit. Fails on shape, and must not be a limit breach |

**Every boundary is now pinned from both sides, on all three axes.** The syntactic pair above is the
last to land, and it is worth recording what it took, because the divergence it closed was invisible
until a fixture sat exactly on the line.

When the depth family first landed, the hosts disagreed by one level: four refused 257 while the
reference host accepted 257 and refused 258. §21.1 is not ambiguous — 256 levels are admissible and
257 are not — so this was an off-by-one in one implementation, not an under-specification. The cause
is worth naming because any host can reproduce it: its parser tested the depth **after** deciding the
composite was empty, and an empty `{}` / `[]` returns without ever incrementing the counter. The
innermost level of a `[[[…]]]` payload is always the empty one, so exactly one level went unmeasured.
Test the bound **before** the empty-composite arm; §21.1 counts every `{` and `[`, empty or not.

The at-the-limit fixture is the guard against the same class in the other direction. It expects a
SHAPE error, not a limit breach — so a host whose bound sits one level too tight answers
`LIMIT_EXCEEDED` there and fails. That is rule 1 expressed in the only form the reject machinery can
express it for a syntactic bound, and a family of refusals alone would not have caught either
version of the off-by-one.

---

## 22. Render-time safety floor (normative renderer obligation)

§19 states one renderer obligation in detail — the URL-scheme floor. This section states the rest of
them, and says what a *conformant renderer* owes at every seam where a string from the tree reaches a
document. §19 remains the normative text for URL-valued slots; this section does not restate it.

**This is a renderer obligation, not a decode one.** A tree carrying a hostile payload is a **valid
wire document** and a decoder MUST NOT reject it — the payload is data, and the format's whole claim
is that data cannot execute. What must hold is that a conformant renderer cannot be made to emit it
as anything but data. Hosts that only decode, re-encode, transform or route trees are unaffected.

### 22.1 The obligations

A rendering host — any host that emits markup, or drives a live document, from a decoded tree — MUST
ensure that for every string it takes from the tree:

1. **Text-bearing slots reach the document as text.** A payload in a text slot is content. It may
   appear in the output escaped; it must not appear as markup. There is no markup language in play at
   a text slot, so there is nothing to interpret.
2. **Markdown-bearing slots yield no live markup from the source.** A markdown body is rendered
   through the host's markdown renderer; no element, attribute or scheme originating in the source
   survives into the output as live markup. Whether the host escapes by construction, strips, or
   both, is the host's business — the obligation is on the output.
3. **No `on*` event-handler attribute is emitted from tree-supplied material**, in any spelling. Case,
   whitespace and separator variation are the attacker's, not the format's.
4. **Consumer-supplied attribute NAMES pass a positive character allowlist**, not a prefix rule alone.
   This one is stated as a mechanism rather than an outcome because the outcome is unreachable
   otherwise: HTML has no escape for an illegal character in an attribute name. A name carrying a
   space and an `=` is not a mangled attribute — it is several attributes, and one of them can be a
   live handler. Escaping cannot express the fix, so the response must be rejection.
5. **URL-valued slots** are governed by §19.

Attribute **values** are deliberately held to a weaker rule than names: a conformant renderer escapes
values, and that escaping is what makes a quote or an angle bracket inert. A value-level check is
defence in depth beneath it, not a replacement for it, and MUST NOT be relied on as the only gate.

### 22.2 Semantic invariants, not byte parity

Every other conformance family in this corpus compares bytes. This one cannot, and the reason is
worth stating rather than working around: the markup a host wraps around a payload differs
legitimately between a React renderer, a static-HTML emitter and a native render projection. Byte
comparison would pin those accidents and call it safety.

So the `sanitization/` family asserts **invariants over the rendered output**:

| Invariant | The host must |
|---|---|
| `inert` | not emit the payload as live markup. It may appear as text. Checked as forbidden substrings, case-insensitively, over the host's own output. |
| `reject` | refuse the payload at a predicate seam (an attribute key, a URL) — omit it, or substitute the documented fallback. |
| `accept` | admit the payload, and emit the stated normalised form where one is stated. |

A host declares any group **not-applicable** when the seam does not exist on it: a host with no markup
sink owes nothing on markdown or text escaping, and one that exposes no attribute hatch owes nothing
on attribute names. Not-applicable is a declared state with a reason, exactly as an abstention is —
what a host may not do is be silently untested.

### 22.3 Known limits are recorded, not implied

A group may carry a `nonGoals` list: payloads the floor deliberately does not catch, each with the
reason. They are recorded and never asserted.

This is not a hedge. A defence-in-depth substring sweep over markup that a deterministic renderer
produced is not a general-purpose HTML sanitiser, and pretending otherwise is how a floor comes to be
trusted for a job it was never doing. Stating the limits is what makes the asserted invariants a gate
rather than a wishlist — and it is what tells a reader which of the two they are looking at.

### 22.4 Forward-coupling

**A new string→output seam ships with a sanitisation fixture in the same change-set.** A new
`NodeKind` slot that carries text, markdown, a URL, or consumer-supplied attributes adds its case to
the `sanitization/` family alongside the codec fixtures §11 already requires. The codec families
prove the slot round-trips; they say nothing about what happens when its contents reach a document,
and a slot that round-trips perfectly while emitting a live handler is exactly the shape this
obligation exists to refuse.

---

## 23. Host-declared kind admission policy (optional, host-side narrowing)

An application that uses none of the vocabulary's escape hatches is *functionally* closed by
omission: it registers no custom renderers, installs no guest seam, and so a `Custom` or `Mount` node
in a decoded tree selects nothing. Closure by omission has two defects. It is invisible — nothing in
the deployment states it, so it cannot be checked, claimed, or audited. And it is not monotone: it
stops holding the day an unrelated registration lands somewhere else in the process, silently, with
no change to any tree.

This section specifies the mechanism by which a host closes the algebra **by declaration** instead: a
decoder may be given an **admitted-kind set**, and a document naming a kind outside it is refused
with `KIND_NOT_ADMITTED` rather than decoded into a node the host will not render. The refusal is a
logged, attributable event naming the kind and the declaration that refused it.

### 23.1 The default is unchanged, and this is a host narrowing rather than a wire one

§22 states that a tree carrying a hostile payload is a **valid wire document** and that a decoder
MUST NOT reject it. That is unchanged and this section does not qualify it. Specifically:

- **A decoder given no policy has exactly the obligations it had before.** Every valid document
  decodes; `KIND_NOT_ADMITTED` is unreachable.
- **Conformance is measured with no policy declared.** Every other family in this corpus is decoded
  at the default, and a host whose default decoder refuses any of them has narrowed the wire, which
  this section does not permit.
- **A document refused under a policy is still a valid wire document.** The refusal is a fact about a
  deployment, not about the format. A host that re-encodes, forwards or stores a document it will not
  itself decode under its policy must not treat it as malformed.

The narrowing is therefore *of one host's acceptance*, never of the vocabulary. §11's forward-coupling
rule and §15's version negotiation are untouched: a policy is not a profile, does not appear on the
wire, and is not negotiated with a peer.

### 23.2 The policy is written in wire discriminators

An admitted set is a set of `kind.$type` **strings**. This is a specification choice rather than an
implementation detail, and hosts must not substitute a closed enumeration of their own:

- The admission decision is made at the discriminator, **before** any kind-specific decoding — which
  is what makes the refusal cheap, and what makes it possible at all for a discriminator the host's
  own type system cannot name.
- The vocabulary is shared across hosts in five languages, only some of which have sum types. The
  string set is the one representation all of them already agree on, and it is the one the corpus and
  the JSON Schema are written in.
- A host may be pinned to an older release than the tree's author. A string set expresses "the kinds I
  declared" without requiring the declaring host to be able to *name* the kinds it excludes.

### 23.3 Allow-list semantics

A policy admits exactly the kinds it names. There is no deny-list form, and the asymmetry is
deliberate: a deny-list of the hatch kinds known today silently admits any hatch-shaped kind added
tomorrow, which is the same "closed until something changes elsewhere" failure that motivates the
whole section.

A host that prefers to think in exclusions resolves them **at the moment of declaration**, against a
vocabulary it names, producing an allow-list. So a kind added to the language later is not admitted by
a policy declared earlier. Hosts SHOULD offer this as a constructor; they MUST NOT offer a policy
whose admitted set is computed lazily against whatever vocabulary is current at decode time.

A policy carries a short, stable **identity** string. It appears in every refusal, so two deployments
running different profiles produce distinguishable evidence; a refusal that does not say which
declaration produced it is not auditable.

### 23.4 The refusal

A kind outside the admitted set is refused with:

| | |
|---|---|
| `Code` | `KIND_NOT_ADMITTED` |
| `Path` | the offending `kind.$type` — including for a kind nested below the root, whose whole document is refused. A policy applied only at the root admits a hatch one level down and is the obvious wrong implementation. |
| `Message` | names the refused kind and the policy identity. |
| `ExpectedShape` | the admitted vocabulary, so a repairing author sees what this deployment does take. |

A discriminator that is not in the vocabulary at all stays `WRONG_NODE_KIND` under a policy, exactly
as without one. The two are different facts: one says the spelling is wrong, the other says the
spelling is right and the deployment declines it, and collapsing them sends an author to invent a name
that is already correct.

**Ops are gated on the same terms.** A node kind reaches a `TreeOp` two ways — inside a node-bearing
operation, and as `EditNode`'s replacement kind — and a conformant policy-bearing op decoder refuses
both. A policy enforced only on the initial tree is a property of the first decode rather than a
closure.

### 23.5 The recommended closed profile

For an application that uses no escape hatches, the recommended profile admits the whole vocabulary
**except `Custom` and `Mount`** — the two kinds through which host-supplied behaviour enters a
rendered tree. `Custom` selects a host-registered renderer by a name taken off the wire; `Mount`
composes a guest tree produced host-side under its own scope. Neither carries behaviour on the wire —
decoding constructs no closures — which is precisely why omission alone does not close them: the tree
still *selects*, and the selection becomes live the moment something registers.

**What this profile does NOT close, stated because a partial closure read as a total one is worse
than none.** A kind gate reaches kinds. It does not reach the action vocabulary a tree can name, a
declared field rule's pattern (a slot on `Form` / `Filters`, both of which this profile admits), a
renderer's own output, or anything a host registers outside a tree altogether. Those are different
seams with different mechanisms, and a deployment claiming "no escape hatches" on the strength of this
profile alone has claimed more than it has closed.

**Forward coupling.** A new kind whose semantics is that a host supplies behaviour it names — a
registry it selects from, a guest it composes, a seam it reaches — joins this profile's exclusions in
the same change-set that adds the kind. A kind admitted into the recommended closed profile by default
is one that has been asserted not to be a hatch, and that assertion should be deliberate.

### 23.6 Conformance

The [`decode-policy/`](decode-policy/) family is the executable form. Each case pairs a document with
a declared policy and the outcome, and the same bytes appear under both an admitting and a refusing
policy — the pairing is the assertion, since neither half alone distinguishes a policy from a decoder
that simply dislikes the document. Its manifest is hand-authored and is not emitted by any host's
corpus generator.

A host that has not implemented this section declares the family **not-applicable with a reason**, on
the §22.2 footing. Implementing §23 is optional; being silently untested on it is not.

---

## 24. Declared-default resolution (normative renderer obligation)

§19 and §22 state what a renderer owes at the seam where a string reaches a document. This section
states what it owes at the seam **before** that one: what a `Binding` carrying a declared default
resolves to when nothing has written its slot.

### 24.1 The obligation

**A `Binding.State` carrying a `defaultValue` resolves to that value until the named state slot is
first written.** The same holds for `Binding.Filter` and `Binding.Selection`, whose declared defaults
§1.1 and §3.3 already describe.

**A renderer that holds no state MUST still resolve it.** A declared default is *authored data* — it
travels in the document, it is the same on every host, and it is available to a renderer that has no
store, no session and no client. It is not store state, and treating it as store state is the error
this section exists to name. A host that emits nothing for a defaulted binding is emitting an
**incomplete document**, not a cautious one.

Writing wins over defaulting, and the order is normative: a renderer resolves the slot from its
sources first and consults the declared default only when the slot is unwritten. Hydration therefore
**re-resolves** a value the server already rendered; it never *first-fills* one the server left
empty. A binding with neither a written slot nor a declared default is genuinely unresolved, and this
section says nothing about what a renderer shows for it.

### 24.2 Why this is stated on `State` and not left to its mirror

§1.1's third 0.2.0 item introduces `Binding.Filter.defaultValue` as "the value the resolver yields …
before the filter is first written", and calls it **a mirror of `State.defaultValue`**. That sentence
fixed the resolution behaviour of the mirror and left the original implicit, on the reasonable
assumption that a rule stated for one arm would be read across to the other.

It was not. Measured across five render tiers on 2026-08-26 with the corpus fixture
`nodes/a11y-wrapper-state-bound.json`, whose accessible name is a `Binding.State` with a declared
default of `"Site footer"`: four tiers emitted `aria-label="Site footer"` and one emitted no
`aria-label` at all — and **neither answer was non-conformant**, because the specification had not
taken a position. A declared default that means different things on different hosts is not a default;
it is a suggestion, and an author cannot build on it. So the rule is stated on the original.

The divergent host was not being careless. It resolved the two sibling defaults and declined this one
under a documented "unresolved until written" posture, which is a defensible reading of a slot named
for a *store*. What made it wrong was not the reading but that the format permitted both.

### 24.3 Conformance

The existing `nodes/a11y-wrapper-state-bound.json` fixture is the executable form: a `Binding.State`
carrying a declared default in a slot whose resolution is visible in rendered output. It needs no new
bytes — the fixture was already in the corpus, and the divergence it exposed was a *render*-parity
finding rather than a codec one, which is precisely why no codec family caught it.

A rendering host asserts the resolved value; a host that only decodes, re-encodes or routes trees is
unaffected by this section, on the §22 footing.

### 24.4 Slot seeding — a declared default fills the slot, not only its own reader

§24.1 states what a declared default resolves to **for the reader that carries it**. This subsection
states what it means for every OTHER reader of the same slot, which §24.1 left open and which two
readers of one key make unavoidable.

**A `Binding.State` carrying a `defaultValue` SEEDS its slot: the declared value is the value of
`$state.<key>` for every reader in the tree, not a fallback private to the binding that declares
it.** So a grid bound to `$state.members` and carrying the rows, beside a badge whose `Transform`
derives over the same key and carries nothing, read the same rows.

Five rules complete it, and each answers a question two readers raise that one does not.

1. **Who declares.** Any `Binding.State` with a present `defaultValue`, in any slot. There is no
   separate declaration form and no new namespace — `$state.<key>` is the one the language already
   has.
2. **Precedence: host value > written value > seed.** A seed is the value of a slot before anything
   else has said anything, never an override. This is the only reading consistent with the standing
   posture that a host owns named data (§24.5), and it is what makes §24.1's "writing wins over
   defaulting" continue to hold unchanged.
3. **Order-independence.** Seeding happens over the whole tree BEFORE any binding resolves — decode
   produces a tree and resolution happens at render, so there is no ordering between a declaration
   and a reference. A badge that appears before the grid declaring the rows is not a special case,
   and document order carries no meaning here.
4. **Two declarations of one key.** Two readers declaring the SAME value agree and are unremarkable.
   Two declaring DIFFERENT values are a defect (`FUARAN106`, Error — one slot cannot hold two
   values); a renderer must still be deterministic and takes the FIRST declaration in tree order, so
   every conformant host renders the same thing while the validator names the disagreement. An
   **empty** declaration (`"defaultValue": []` in a table-shaped slot) declares nothing: it is the
   value an unseeded slot already has, so it neither seeds nor conflicts.
5. **A host-reserved key is never seeded.** A seed is a tree-originated write, and §12's reserved
   `host.` namespace refuses those on every path. A declaration naming one resolves for its own
   reader exactly as §24.1 says and fills nothing.

**What this changes for an already-shipped document, stated plainly because it is a heavier class of
change than adding a case.** No wire byte moves and no document changes its decode. What moves is
what a document RENDERS, and only in one direction: a tree in which one reader declared a value and
another read the same key now shows the declared data where it previously showed the slot's empty
state. A tree with at most one reader per key renders exactly as before.

### 24.5 `DataSource.Ref` and `Binding.State` — one line that keeps them apart

The format has exactly one way to name host data and exactly one way to name tree-scoped data, and
seeding does not add a third:

> **`DataSource.Ref` names a table the HOST HAS. `Binding.State` names a slot the TREE CAN FILL.** A
> tree that carries its own rows uses the second; a tree that defers to its deployment uses the
> first.

`Ref` keeps its exact meaning — the host resolves the name, the wire carries the name and never the
rows — and gains no sibling case, no tree-first resolution order and no second reading.

### 24.6 Conformance for §24.4

`nodes/shared-source-seeded-pair.json` is the executable form: one declared table under
`$state.members`, read by a grid's `source` and by a badge's `Transform`. A conformant rendering host
resolves the badge's derivation over the grid's two rows. It is a *render*-parity obligation, like
§24.3's: the bytes round-trip identically with or without the rule, which is exactly why no codec
family catches a host that has not adopted it.

---

## 25. Contract cards + the unregistered-degradation obligation (Phase 1108)

`NodeKind.Custom` is the language's bounded escape: a host registers a component under a
`moduleId`/`componentId` pair, declares its prop contract, and from then on the component behaves
like a built-in — an emitter targets its declared prop schema, a validator checks the prop bag, and
a renderer dispatches to it. **All of that is deployment-local.** Cross the deployment boundary and
every part of it disappears at once: a conformant host receiving the same node has no contract, no
schema, and no renderer, so the best it can honestly do is name the component and stop.

What the issuing deployment had, and the receiving one did not, was never a *renderer*. It was the
**description** — the prop rows, the content hash, the declared payload languages (§25.1), and one
line saying what the component is. A **contract card** is that description as a specified,
transportable artefact. It makes a foreign `Custom` node **legible but unrendered** rather than
opaque, at a small fraction of the cost of a portable renderer, and without asking any host to
execute anything it did not choose to execute.

> **A card is not a renderer, not a permission, and not evidence that a component is safe to run.**
> Nothing in this section dispatches to anything. A card's only two consumers are a **prop
> validator** and a **placeholder**. The trust boundary stays exactly where §3.2's `Custom` contract
> and each host's own registry put it, and a card arriving from anywhere cannot move it.

### 25.1 The card document

```json
{ "$card":       "1",
  "componentId": "sparkline",
  "contentHash": { "algorithm": "SHA256", "hash": "<hex digest>" },
  "moduleId":    "analytics",
  "props": [
    { "name":     "series",
      "payload":  { "gate": "chartspec-gate:1.2", "language": "chartspec" },
      "required": true,
      "type":     "string" },
    { "name": "title", "required": false, "type": "string" } ],
  "summary": "A compact trend line with a period-over-period delta." }
```

Canonical §2 encoding throughout — Ordinal-sorted keys, canonical escaping, optionals omitted when
absent. Decoders stay order-tolerant, as everywhere else in this format.

| Member | | Meaning |
|---|---|---|
| `$card` | required | Format-version tag. `"1"` is the only version. |
| `moduleId` / `componentId` | required | The identity the card describes — the same pair a `Custom` node carries. |
| `contentHash` | required | `{ algorithm, hash }`: the digest the issuing deployment derived from the component's declared shape. **Required**, and see §25.4 for why. |
| `props` | required | The declared prop rows, **in declaration order** (a schema is ordered; the array is not sorted). May be empty. |
| `summary` | optional | One line saying what the component IS. |

A **prop row** carries `name`, `type`, `required`, and an optional `payload`.

- **`type`** is the prop's declared type as a stable tag: `string` / `int` / `float` / `bool` /
  `object` / `array` / `json`, or `enum(a|b|c)` for a closed choice. `enum()` is not a legal tag —
  an enum admitting nothing would be spelled as though it admitted one empty choice.
- **`payload`** is the payload-language declaration: `language` (required within the object)
  names the inner wire format the value is written in, and `gate` optionally names the gate that
  judges it, as the single `gate:version` stamp. **A `payload` carrying a gate and no language is
  refused** — the language is the declaration and the gate is an annotation on it, so a gate alone
  names a judge for nothing. `gate` absent is the *declared-but-ungated* state, which is a real and
  distinguishable claim rather than a spelling of "undeclared".

**`summary` does not enter `contentHash`.** The hash folds the declared *shape*; a reworded sentence
must not invalidate every strict-replay consumer of a component that emits exactly what it emitted
before.

**`contentHash` carries no strictness.** A `Custom` node's `ContentHash` (§3.2) has a third member
saying what a host should do on mismatch, because the *emitter of that tree* is declaring a policy
about its own replay. A card is a description of a component, not a policy about anyone's tree; a
card that carried a strictness would be a foreign deployment's policy arriving as data.

### 25.2 The card bundle

The document a deployment publishes:

```json
{ "$cards": "1",
  "cards": [ <card>, <card>, … ] }
```

`$cards` is the bundle format-version tag; `cards` is emitted **sorted by `(moduleId, componentId)`
Ordinal**, so two deployments holding the same cards publish the same bytes whatever order their
registries iterated in.

**A bundle carrying two cards for one identity is refused (`DUPLICATE_CARD`).** A host's card *store*
may resolve a duplicate by whatever order it folded cards in; a *document* has no order to appeal
to, so accepting one would make the description a reader gets depend on decoder implementation
detail.

### 25.3 Decode

Both documents are **default-deny by shape**: every object position refuses an undeclared key
(`UNDECLARED_FIELD`). A card is a protocol artefact, not a forward-compatibility carrier — its
evolution is the explicit `$card` / `$cards` version bump, and a decoder that shrugged at an unknown
key would silently accept a newer producer's document while ignoring exactly the part that was new.
Decode is fail-fast with one structured §6 `DecodeError`, in the deterministic member order this
section lists, so every conformant host surfaces the same first error.

Structural failures reuse the §6 codes (`INVALID_JSON` / `MISSING_FIELD` / `WRONG_TYPE`); three are
specific to this artefact.

| Code | When |
|---|---|
| `UNSUPPORTED_VERSION` | `$card` / `$cards` names a version the decoder does not implement |
| `UNDECLARED_FIELD` | a key this section does not declare, in any object position |
| `DUPLICATE_CARD` | a bundle carries two cards for one `(moduleId, componentId)` |
| `UNKNOWN_DU_CASE` | a prop `type` tag the decoding host's vocabulary does not carry |

That last one is the one worth stating plainly. A card written by a **newer** producer can name a
prop type that did not exist when the reading host was built. **Refusing it at the boundary is
normative**: resolving an unreadable tag to a permissive type would silently turn a check into a
pass, which is worse than not reading the card at all. A host that constructs a card in-process
rather than decoding one (a registry projecting its own contracts) may hold an unresolvable row; it
reports the row as unresolvable and offers no verdict on it.

### 25.4 The unregistered-degradation obligation (normative)

**Where a host renders a `Custom` node for which no renderer is registered, and a contract card for
that identity is available, the emitted placeholder MUST carry the component identity, the card's
summary where the card declares one, and a machine-readable verdict marker (below). It MUST NOT emit
a prop value, and MUST NOT guess at the component's appearance. Where no card is available the
placeholder is unchanged — the identity-only form §3.2 already required.**

That the uncarded path is untouched is not a courtesy. It is what makes this obligation safe to
declare on a kind every roster host already renders: a host that holds no cards emits exactly the
bytes it emitted before.

**The verdict is three-way, and the three cases are different licences to speak rather than three
degrees of confidence in one answer.** A `moduleId`/`componentId` pair is an *address*: two
deployments can ship different components at the same address, and the same component at two
versions certainly will. So a card that matches by name is not thereby a description of *this* node.

| Marker | When | What the host may show |
|---|---|---|
| `described` | the node declares a content hash and it equals the card's | everything |
| `unverified` | there is nothing to compare — the node declares no hash, or the two name different algorithms | everything, **and the marker says the claim is unverified** |
| `hash-mismatch` | the node declares a hash and it differs from the card's | identity and the marker only |

Two of those rows are decisions rather than consequences.

**`unverified` shows the description.** Most nodes declare no hash, so degrading to identity-only
here would throw away the common case for no gain — a card matching by name is still the best
description anyone has, and saying so is the honest form. **Two digests under different algorithms
are `unverified`, never `hash-mismatch`**: they are incomparable, not unequal, and reporting a
mismatch would withhold a good description on the strength of a comparison that was never made.

**`hash-mismatch` WITHHOLDS the summary and the prop rows.** The card describes a different shape at
the same address; printing its description would be exactly the guess this obligation forbids, and a
confident wrong description is worse than none. What is **not** withheld is the identity and the fact
of the mismatch — hiding those would leave a reader with less than the uncarded placeholder gave
them.

**Prop validation.** A host holding a card MAY validate the node's prop bag against the card's rows,
and where it does it MUST reach the same verdict a host holding the contract reaches — that
agreement is the entire claim a card makes. This is the half of the mechanism that is not cosmetic:
a foreign host can now say a `Custom` node is *malformed*, where before it could only fail to render
it. Under `hash-mismatch` no verdict is offered, for the same reason the description is withheld: the
schema is not this node's.

**In the render-fidelity manifest.** This obligation is carried as the §13 claim
**`unregistered-custom-labelled`** on the `Custom` row, so an adopting host's render suite
enumerates it from `render-fidelity.json` rather than from this paragraph, and reports it in the
three-outcome shape §13 specifies. §13's rules apply unchanged, the reporting shape included: a host
that has not adopted is not thereby exempt.

### 25.5 Transport (deliberately minimal)

**v1 specifies the artefact, not a protocol.** There is no card registry service, no fetching
protocol, no negotiation, and no discovery mechanism. A host supplies its cards however it likes —
bundled beside the application, read from disk at start-up, or served — and folds them into its own
lookup.

Where a host *does* serve its bundle over HTTP, the conventional location is
**`/.well-known/fuaran-cards.json`**. That is a convention and nothing more: no host is obliged to
serve it, none may assume another does, and nothing in this format fetches it. The convention exists
so that hosts which choose to serve a bundle all choose the same path, which is the whole of what a
convention buys. A transport worth specifying is a later, separately-motivated question — and it
should be asked only once demand exists, because the failure mode of specifying one early is a
protocol nobody implements sitting in a normative document.

### 25.6 Conformance

The corpus family is **`cards/`**, with the `contract-card-round-trip` and `contract-card-reject`
manifest kinds and the `contract-card` / `contract-card-bundle` decoder names. `manifest.json` is the
authoritative enumeration.

**It is its own family, and never `nodes/`.** A card is not a node: it never appears inside a tree,
it is not addressed by a `NodeId`, and the node family's round-trip law is stated over the canonical
*node* encoder, which has nothing to say about this document. Filing a card among the node fixtures
would quietly change what every host's node-corpus leg was asserting.

The round-trip payloads are **emitted by a conformant encoder from typed card values**, not
transcribed, so a hand-copying error cannot make the corpus disagree with the encoder it exists to
pin. The reject payloads are hand-written of necessity: their whole content is a document no encoder
would produce.

**Adoption is per host and recorded in §11.0**, on the same terms as the render-obligation adoption
table beside it. Reading a card is a *second* obligation beyond §13's: a host can drive its render
suite from the manifest, correctly report `unregistered-custom-labelled` as unchecked, and still hold
no card reader at all.

**Forward coupling.** A change to any member, ordering, encoding, refusal class or verdict rule in
this section updates the normative text, the `cards/` corpus family, and every codec host in the
§11.0 roster that has adopted, in the same change-set.

---


## See also

- [`MARKDOWN.md`](../fuaran-dotnet/docs/MARKDOWN.md) – the deterministic GFM markdown-render contract (render-only; §14).
- [`STABILITY.md`](../fuaran-dotnet/STABILITY.md) → "Wire format" – the stability declaration + breaking-change criteria.
- [`AI_AUTHORING_GUIDE.md`](../fuaran-dotnet/docs/AI_AUTHORING_GUIDE.md) "Self-checking before you emit" – the encoder-side pre-emit gate; the wire format is what it validates against.
- [`../src/Fuaran.UI/Types.fs`](../fuaran-dotnet/src/Fuaran.UI/Types.fs) – the §4b record contract this format serialises.
