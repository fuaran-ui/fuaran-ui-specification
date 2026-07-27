# Fuaran wire format (canonical JSON)

**Status:** stable (see [`STABILITY.md`](../fuaran-dotnet/STABILITY.md) → "Wire format"). **Version:** wire format v1 – profile `core@1.0`, language rev **0.2.0** (see §15 for the version/profile + forward-compatibility contract, and §1.1 for the 0.2.0 revision summary).

This document is the **permanent, language-neutral specification** of the Fuaran UI tree's JSON wire format. It is the authority; the F# encoder ([`Fuaran.UI.OpStream.Abstractions.CanonicalJson`](../fuaran-dotnet/src/Fuaran.UI.OpStream.Abstractions/CanonicalJson.fs)) and decoder ([`Fuaran.UI.Ops.JsonDecode`](../fuaran-dotnet/src/Fuaran.UI.Ops/JsonDecode.fs)) are one *conformant host* – the reference – of this contract. The other conformant codec hosts (TypeScript, Python, Go, Rust) and any third-party host implement the same contract from this doc + the conformance corpus – **without reading F# source**. The **§11.0 roster** is the authoritative list of hosts and their roles (codec host vs native render projection).

The executable conformance suite is the fixture corpus [in this repository](./), indexed by [`manifest.json`](./manifest.json) – the authoritative enumeration of every fixture family and count. A decoder/encoder pair built from this document alone must pass every fixture assertion the manifest enumerates.

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

11. **`obj`-typed values** (the remaining erased seams: untyped `Binding.Static` statics, a `PropValue.Native` op value) are best-effort: if the runtime type matches a recognised JSON primitive (string, bool, `int`, `int64`, `float`, `float32`, `DateTimeOffset`, `DateTime`), encode that. `DateTimeOffset`/`DateTime` encode as Unix **seconds** (`int64`). Anything else renders the sentinel `"<opaque>"`. **No reflection over arbitrary CLR objects.** The slot-typed `Static` payloads the language enumerates (options / values / series / markers) bypass this rule with typed encodings – see §5 for the table and the residual-opaque boundary.

12. **Structured JSON payload positions** – `Custom` props, `Action.Notify` / `SetState` / `AiTool` payloads, `I18n` args, and a wire-form `UpdateProp` value – carry a structured JSON value (`JVal` on the F# host) and round-trip **faithfully at any nesting depth**: objects re-encode with Ordinal-sorted keys, numbers under rule 5, no `"<opaque>"` collapse. A JSON `null` anywhere inside such a position is **rejected at decode** (`WRONG_TYPE`, message naming the rule) – the wire model has no null (rule 4): omit the field instead.

### 2.1 Reserved `$`-prefixed keys

**Object keys beginning with `$` are reserved for this specification and its certified extensions; a host MUST NOT mint one.** The spec uses `$`-keys for the two structural roles a canonical wire needs: the DU discriminator `$type` (§3) and the versioning-envelope keys `$profile` / `$payload` / `$requiredProfile` (§15). Two properties follow from the reservation:

- **Canonical sort position.** Because rule 2 sorts keys by Ordinal and `$` (`U+0024`) precedes every letter and digit, a `$`-key always sorts **before** any lower-case data key on the same object – so a reserved key is deterministically first, never interleaved with a host's data fields.
- **Forward tolerance.** An **unknown** `$`-key on an otherwise-known kind is treated exactly as any unknown key under rule 2 – **ignored on decode**, not an error – so a newer spec revision may reserve a further `$`-key without breaking an older decoder. (This is distinct from an unknown *kind*, which §15.3's transport-only `Unknown` preserves; a `$`-key is object-local metadata, not a kind.)

Host-specific opaque data does **not** ride a `$`-key: it rides the sanctioned wire-omitted / extension slots (`Node.ExtraAttributes`, §9; the theme manifest's `$extensions` pocket) – those are lower-case, host-filled, and outside the reserved namespace by construction.

---

## 3. `"$type"` discriminator dispatch

Every DU position on the wire is a JSON object carrying a `"$type"` string + that case's payload fields. A decoder reads `$type`, dispatches to the per-case parser, and surfaces `UNKNOWN_DU_CASE` (see §6) for unrecognised discriminators, with an `ExpectedShape` hint enumerating the valid cases.

### 3.1 Node envelope

A `Node` has exactly two **required** keys – `id` and `kind`. `state`, `style`, and `accessibility` are **optional** and omitted when empty / all-default / `None`. A fully-default node is just `{ "id": …, "kind": … }`.

```json
{ "id": "<non-empty string>",
  "kind": <NodeKind>,
  "state": <StateBehaviour>,         // optional — omitted when empty
  "style": <SemanticStyle>,          // optional — omitted when all-default
  "accessibility": <Accessibility>   // optional — omitted when None
}
```

- `state` (`StateBehaviour`) is an object with optional keys `onLoading` (Node), `onEmpty` (Node), `onError` (always the `"<closure>"` sentinel when present – the `ErrorPayload -> Node` callback is unobservable). **Omitted entirely from the node when all three are `None`** (the common case); a decoder restores the empty `StateBehaviour` on absence.
- `style` (`SemanticStyle`) is `{ "emphasis": <Emphasis>, "tone": <ToneVariant>, "weight": <StyleWeight> }`, each a bare enum string (§3.5), plus the Phase 147 `role`/`voice`. **Omitted entirely when all fields are the default** (`emphasis` = `"Normal"`, `tone` = `"Default"`, `weight` = `"Standard"`, `role`/`voice` default); a decoder restores the default on absence. Each of `emphasis`/`tone`/`weight` is **individually** omitted-when-default on both boundaries (§3.6, Phase 460), matching `role`/`voice`: an absent field restores its identity default on decode, and the encoder omits a field at its identity default even when the object is emitted for the other fields.
- `accessibility` carries optional keys `label` (`Binding<string>`), `labelledBy` (NodeId string), `describedBy` (NodeId string), `role` (ARIA role string), `liveRegion` (`"polite"`/`"assertive"`/`"off"`), `hidden` (`Binding<bool>`). Omitted entirely when `None`.

### 3.2 `NodeKind` discriminators (`kind.$type`)

The `kind` object's `$type` is the node's primitive discriminator **directly** – the wire is **flat**, with no behavioural-category envelope and no `spec` wrapper. A node carrying a label/value row is `{"$type":"LabelValueRow","emphasis":…,"label":…,"value":…}` – the spec's fields hoisted directly under `$type`, exactly as `Custom`/`ErrorBoundary` and every nested DU carry their fields. The four behavioural categories – Layout / Display / Input / Visualisation – are a **host-side classification recovered on decode** (each primitive belongs to exactly one category), not a level of wire nesting.

The `kind.$type` is one of – and **only** one of – the following primitives or structural cases. Anything else is `WRONG_NODE_KIND` (a dedicated code distinct from `UNKNOWN_DU_CASE`, because the AI-emission eval surface pattern-matches specifically on "AI emitted something other than a valid node kind"):

| Recovered category | `kind.$type` ∈ | Payload (hoisted under `$type`) |
|---|---|---|
| _Layout_ | `Box`,`SplitPanel`,`Tabs`,`Stepper`,`SummaryList`,`Disclosure`,`Modal`,`ScrollArea` | the spec's fields (incl. a `children` array) |
| _Display_ | `Heading`,`Markdown`,`Metric`,`Badge`,`Sparkline`,`Callout`,`Progress`,`Skeleton`,`LabelValueRow`,`Fact`,`Link`,`Image`,`List`,`Toast`,`CodeBlock`,`Math`,`Drawing` | the spec's fields |
| _Input_ | `Form`,`Button`,`FileUpload`,`Select` | the spec's fields |
| _Input_ | `Filters` | `{ "items": [ … ] }` |
| _Visualisation_ | `DataGrid`,`Chart`,`Table`,`Map` | the spec's fields |
| _(structural)_ | `Custom` | `{ "moduleId", "componentId", "props", "contentHash"?, "exposedNodeIds"? }` |
| _(structural)_ | `ErrorBoundary` | `{ "child": <Node>, "fallback": <Node> }` |
| _(structural)_ | `FragmentDecl` | `{ "name": <string>, "body": <Node>, "holes"?: [ <HoleDecl> ], "effect"?: <EffectClass> }` |
| _(structural)_ | `FragmentRef` | `{ "name": <string>, "args"?: { <holeName>: <FragmentArg> } }` |

Every `kind.$type` is globally unique. The former `Grid` collision (a Layout grid and a Visualisation data-grid both once named `Grid`) is fully resolved: the CSS-grid container is now a **`Box`** with `layout: {"$type":"Grid",…}` (Phase 390 – see below), and the data-bound grid is **`DataGrid`** (payload `GridSpec`). This global uniqueness is what lets the wire be flat – a single discriminator unambiguously selects both the primitive and its category.

A primitive's spec fields are emitted **directly under `$type`**, with no `spec` wrapper (e.g. `Markdown` → `{"$type":"Markdown","text":…}`; `Box` → `{"$type":"Box","children":[…],"layout":…,"role":…}`). `Filters` carries an `"items"` array. The corpus is the exhaustive reference for each spec's field set – read `nodes/<id>.json` for the canonical shape of each.

#### The `Box` container (Phase 390 / 459)

The four container near-synonyms (`Stack` / `GridLayout` / `Dashboard` / `Card`) are unified into a single **`Box`** kind, whose **`layout`** names how children arrange and whose **`role`** names what the container means (driving the HTML element, ARIA landmark, and `fuaran-*` chrome). `BoxSpec` carries `children` (required), `layout` (required), `role` (required), and an optional `heading` (emitted only when `Some` – the `Card` heading):

```json
{"$type":"Box","children":[…],"heading":<TextSource?>,"layout":{…},"role":"Group"|"Card"|"Dashboard"|"Separator"}
```

`layout` is a discriminated object:

- `{"$type":"Flex","direction":"Vertical"|"Horizontal","gap":<int?>,"wrap":<bool>}` – `gap` omitted when `None`. (`direction` + `wrap` required.)
- `{"$type":"Grid","cols":<int>,"gap":<int?>,"templateColumns":<string?>}` – `gap` / `templateColumns` omitted when `None`. (`cols` required; a `Some templateColumns` supersedes `cols`.)
- `{"$type":"Auto"}` – responsive auto-tile (the retired `Dashboard`'s renderer-owned behaviour; no author column count).

The four canonical corners (byte-exact): `stack` → `{layout:{$type:Flex,direction,wrap},role:"Group"}`; `gridLayout` → `{layout:{$type:Grid,cols},role:"Group"}`; `dashboard` → `{layout:{$type:Auto},role:"Dashboard"}`; `card` → `{layout:{$type:Flex,Vertical,false},heading,role:"Card"}`. See `nodes/stack-1.json`, `nodes/glayout-1.json`, `nodes/dash-empty.json`, `nodes/card-1.json`.

**Retired container tags are rejected, as are `Spacer` / `Divider`.** The four superseded container `$type` tags (`Stack` / `GridLayout` / `Dashboard` / `Card`) and the superseded `Table` tag are **hard-retired (Phase 673)**: a bare `"$type":"Stack"` is a decode error, not an upgrade. They briefly decode-upgraded to `Box` / `DataGrid` for permalink and op-stream compatibility; that seam was removed once measurement showed nothing depended on it (no persisted artefact carried the tags, and across 6,561 eval runs no model emitted one without being taught it). This restores §1.1's stated 0.2.0 posture — *retired vocabulary is a hard decode error, not a deprecation* — which the upgrade seam had quietly contradicted. The two leaf display primitives `Spacer` and `Divider` were **hard-retired (Phase 459) with no legacy seam**: `Spacer` → the container `gap`; `Divider` → a childless `Box` with `role:"Separator"` (`<hr>`/`role="separator"`; `DividerSpec.Orientation` → the box's `layout` axis, `DividerSpec.Label` → the box's `heading`). A bare `"$type":"Spacer"` / `"Divider"` is rejected (`UNKNOWN_DU_CASE`), and the corpus carries no Spacer/Divider fixtures.

#### Vocabulary-completion primitives (Phases 287–293)

The Wave-43 "last-10%" primitives, canonical shapes pinned by the named fixtures:

- **`Image`** (Display) – `{"$type":"Image","alt":<TextSource>,"src":<Binding>,"variant":"Default"|"Avatar"|"Rounded"}`. `src` is a `Binding<string>`; the renderer routes it through `Sanitize.sanitizeUrlOrBlank` (SANITIZATION.md) – sanitisation is a render-time concern, not a wire constraint. `alt` is mandatory. See `nodes/image-1.json`.
- **`List`** (Display) – `{"$type":"List","items":[<TextSource>,…],"ordered":<bool>}`. See `nodes/list-1.json`.
- **`Divider`** – **retired (Phase 459)** into a childless `Box` with `role:"Separator"` (see "The `Box` container" above). A bare `"$type":"Divider"` is rejected (`UNKNOWN_DU_CASE`); there is no `divider-1.json` fixture.
- **`Toast`** (Display) – `{"$type":"Toast","dismissable"?:<bool>,"message":<TextSource>,"open":<Binding>,"tone"?:<ToneVariant>}`. 0.2.0: `dismissable` is omitted-when-**TRUE** (a toast is dismissable unless said otherwise – the one inverted default in §3.6's table). See `nodes/toast-1.json`.
- **`Modal`** (Layout) – `{"$type":"Modal","children":[<Node>,…],"dismissable":<bool>,"heading"?:<TextSource>,"onDismiss"?:<Action>,"open":<Binding>}`. `onDismiss` is a **wire-survivable `Action`** (like `FormSpec.onSubmit` – encoded as the action value, not a `<closure>` sentinel), OPTIONAL since Phase 426: omitted, a dismissable modal falls to the write-back default (dismiss writes `false` to a writable `open` slot). `heading` omitted when `None`. See `nodes/modal-1.json`.
- **`ScrollArea`** (Layout) – `{"$type":"ScrollArea","children":[<Node>,…],"orientation":"Vertical"|"Horizontal"|"Both","maxHeight"?:<int>,"maxWidth"?:<int>}`. The pixel bounds omit when `None`. See `nodes/scroll-1.json`.
- **`CodeBlock`** (Display, Phase 290) – `{"$type":"CodeBlock","code":<string>,"copyable":<bool>,"highlightLines":[<int>,…],"language":<string>,"lineNumbers":<bool>}`. All five always present (`highlightLines` is an int array, possibly empty). The parity-checked render is a **deterministic `<pre><code>`** (HTML-escaped, no markdown library) identical across all hosts + SSR; **syntax highlighting is a client-only post-hydration enhancement** that targets the `language-{x}` class – explicitly OUTSIDE the cross-host / SSR↔CSR byte-diff. See `nodes/code-1.json`.
- **`Math`** (Display, Phase 293) – `{"$type":"Math","display":"Inline"|"Block","source":<string>}`. `source` is the LaTeX string. The parity-checked render is a **deterministic escaped-source fallback** in a known container; **KaTeX is a client-only post-hydration enhancement** (targets `.fuaran-math-source`), OUTSIDE the byte-diff – the no-JS / SSR reader sees the source, the JS reader sees rendered math. Inline `$…$` math in prose is a separate client-only pass over rendered markdown (soft-coordinated with the deterministic GFM markdown renderer), same pattern. **Mermaid is NOT a node** – a host registers it via the existing `Custom` escape (heavy JS-only library, non-deterministic SVG); promote to a first-class `Diagram` node only if demand warrants. See `nodes/math-1.json`.

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
- **`DrawStyle`** – `{"fill"?:<Binding>,"opacity"?:<Binding>,"stroke"?:<Binding>,"strokeWidth"?:<Binding>}`,
  every field OPTIONAL and omitted when `None` (an all-default style is `{}`). `fill`/`stroke` are
  `Binding<string>` (colour tokens/literals); `strokeWidth`/`opacity` are `Binding<float>`. Present on
  every shape (as `style`) and on the drawing root (as `style`).
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

**Overlay + overflow render-fidelity contract (Phase 289).** `Modal` / `Toast` / `ScrollArea` are render-fidelity-sensitive, so the renderers pin an explicit SSR↔CSR contract: overlays render **inline (no React portal)**, positioned + z-indexed purely by CSS, and a closed overlay stays in the DOM behind the native `[hidden]` attribute (never an absent node). The server and client therefore emit **byte-identical class + ARIA structure** (`role="dialog"`+`aria-modal` for Modal; `role="status"`+`aria-live="polite"` for Toast; `role="region"`+`tabindex="0"` for ScrollArea), so React hydration finds the DOM it expects with no mismatch. Focus management is an additive client-only enhancement that does not alter the hydrated DOM. The contract is executable in the SSR-parity corpus (Phase 142). Full narrative: `docs/SSR.md`.

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

`$type`-dispatched objects also appear at every nested DU: `TextSource` (`Literal`/`Bound`/`I18n`), `Binding<'T>` (`Static`/`Query`/`Filter`/`Selection`/`State`/`Computed`/`I18n`/`Local`/`Format`/`Transform`/`Invoke`), `Action<'Msg>` (`Dispatch`/`Call`/`Notify`/`Navigate`/`SetState`/`AiTool`/`Chain`/`CommitLocal`/`WriteToClipboard`/`ReadFileBody`/`Invoke`), `CellFormat`, `CellValue`, `ColumnWidth`, `Format`, `LocaleSource`, `FormFieldKind`, `CellKindErased`, `LocalFlushTrigger`. Each renders `{"$type":"<CaseName>", …fields}`, with two 0.2.0 exceptions: `TextSource.Literal`'s canonical form is the **bare JSON string** (the `{"$type":"Literal","text":…}` envelope stays decode-accepted and normalises down, §16), and `Action.Dispatch` renders the bare `{"$type":"Dispatch"}` (no `msg` sentinel, §4). Field names and presence are pinned by the corpus.

`Binding.Transform` (Phase 282) is the declarative-compute case – a serialisable dataframe transform evaluated client-side **as data**: `{"$type":"Transform","pipeline":<array>,"source":<object>}`. `source` is a columnar data source (an embedded `{schema, columns}` table – column-oriented, a `values` array + a `validity` mask per column – or a `{schema, ref}` host-resolved named source); `pipeline` is an ordered array of `$type`-discriminated transform steps (`filter` / `project` / `derive` / `groupBy` / `join` / `window` / `pivot` / `unpivot` / `sort` / `distinct` / `limit` / `union`, each over a scalar `ColExpr` algebra). Both sub-trees are `Fuaran.Core` values serialised in **this same canonical discipline** (§2), so they splice in byte-stably; their detailed per-step shape is owned and conformance-certified by `Fuaran.Core`'s own codec, and the schema (§13) describes them structurally (array / object) rather than re-deriving the full algebra – the same "don't constrain content the host doesn't decompose" posture as an opaque `Static.value` (§5). The case is constrained to `Binding<obj seq>` use at a data-bearing node (`DataGrid` / `Chart` / `Table` / `Metric`): the host evaluates the pipeline and the result rows resolve as the node's source. See `nodes/grid-transform.json` for the canonical shape.

**`Binding.Transform` params (Phase 424).** The Transform binding gains an OPTIONAL `params` field: `"params":[{"from":<Binding>,"name":<string>},…]`, each entry binding a `ColExpr.param` name the pipeline references (a `{"$type":"param","name":…}` scalar expression, `fuaran-core#77`) to a scalar `Binding` source (`Filter` / `State` / `Static` / `Selection`). **Omitted when empty**, so a param-free Transform is byte-identical to the Phase 282 wire. The host resolves each param to a `Cell`, prunes any `filter` step whose params are unbound (an unset choice filter ⇒ no constraint – the one lenient UI rule), and evaluates the pipeline in that env – so a `filter` step comparing a `col` to a `param` scopes the rows by a live filter/state value, the declarative-data twin of `Query.dependsOn`. The filter→consumer edge is *derived* from the pipeline's params, never separately declared. See `nodes/grid-transform-param.json` (a filter param from a chip) vs the byte-unchanged `nodes/grid-transform.json`.

**`Binding.Query` dependency edge (Phase 421).** The Query binding gains an OPTIONAL `dependsOn` field: `"dependsOn":["status","date-range"]`, a string array naming the **filters** that scope this host-computed consumer. **Omitted when empty**; the degenerate canonical `Query` is `{"$type":"Query","name":…}` (0.2.0 – the `accessor` sentinel is off the wire, §4). The tree owns the dependency *edge* (so the AI can author it, the validator sees it, the op-stream replays it – restoring symmetry with `Binding.Selection`); the host accessor closure still owns *how* it filters – **no predicate language enters the tree** (that is `Transform.params`, Phase 424, for declarative data). On a filter-store change, a renderer re-resolves every `Query` whose `dependsOn` names the changed filter. Note the paired **decoded-accessor fix**: a decoded `Query` accessor is now an identity projection (F# `unbox`, TS `(raw) => raw`), so a host-populated `queryResults.<name>` value flows through decoded trees (previously it was discarded). See `nodes/query-dependson.json`.

**`Action.Call` result target (Phase 428).** The `Call` action's `onResult` closure is OPTIONAL on the wire (present → the `"<closure>"` sentinel, byte-identical to before; the closure wins at run time), and the case gains an optional declarative **result target**: `"into":{"$type":"State","key":…}` (the response lands in the reactive `$state.<key>` slot – `Binding.State` readers re-render) or `{"$type":"Query","name":…}` (the response lands in the `queryResults` slot `<name>` – `Binding.Query` readers re-render, data-preserving per the Phase 421 identity accessor). Both omitted is a fire-and-forget command call (FUARAN073 warns). A failed / undecodable call never reaches the target – the host's `Call` implementation surfaces it (the default browser host warns) and the slot stays unwritten, so readers keep their `onLoading` surface. The endpoint set + the default-deny dispatch gate are unchanged – `into` adds no new capability, only a destination. Canonical shape: `{"$type":"Call","endpoint":…,"into"?:…,"onResult"?:"<closure>"}`. See `nodes/call-into.json` (closure / into-State / into-Query side by side).

`Binding.Invoke` / `Action.Invoke` (Phase 283) are the invocable-capability cases – the binding dispatches a host-registered compute capability for a value, the action for an effect: `{"$type":"Invoke","args":[{"addr":<string>,"value":<string>}…],"capabilityId":<string>}`. `capabilityId` references a capability the host registry enumerates (the compute analogue of node-introspection); `args` are scalar `(addr, value)` pairs the host validates against the capability's signature before dispatch (default-deny by shape). **The body is never on the wire** – only the typed declaration + this invocation. A `Binding.Invoke`'s value is async (a `Deferred`) and renders through the existing `StateBehaviour` surface (`onLoading` until ready, `onError` on failure) – no new node concept, no `Deferred` wire DU. A non-deterministic invocation's realized value is journaled through the determinism-capture seam for exact replay.

`FormFieldKind.Date` (Phase 288) is the date/time field case: `{"$type":"Date","onChange"?:"<closure>","value":<Binding>,"variant":"Date"|"Time"|"DateTime","min"?:<string>,"max"?:<string>,"step"?:<number>}` (`onChange` optional per Phase 426). `value` is a `Binding<string>` carrying an ISO-8601 string (`YYYY-MM-DD` / `HH:MM` / `YYYY-MM-DDTHH:MM` per `variant`); `min` / `max` are ISO strings and `step` is in seconds – all three optional, omitted when `None` (rule 4), mirroring `RangedNumber`. See `nodes/form-date.json`.

**`Binding.Filter.defaultValue` (0.2.0).** The Filter binding gains an OPTIONAL `defaultValue`: `{"$type":"Filter","defaultValue"?:<typed static>,"name":<string>}`. It is the value the resolver yields – and the renderer seeds the filter store with – **before the filter is first written** (the pre-selected-filter gap: "default to the last 30 days"). The payload is typed via the slot's own static encoding (the same seam as `State.defaultValue`, Phase 429); omitted, behaviour is exactly pre-0.2.0 (`NotResolved` until written). A chip's auto binding (see the filters-unification note above) is `Filter(name)` with **no** default – a chip whose control carries an explicit `value` binding with a `defaultValue` keeps that `value` on the wire (the omission rule keys on the exact auto shape).

**`FormFieldKind.Range` (0.2.0)** is the dual-thumb numeric range control (absorbing the retired `FilterKind.RangeFilter`): `{"$type":"Range","onChange"?:"<closure>","value":<Binding<float*float>>,"min"?:<number>,"max"?:<number>,"step"?:<number>}`. A `Static` pair rides as the **bare** `{"max":<number>,"min":<number>}` object – no `Static` envelope (the Phase 423 range shape, kept as the canonical bytes); a decoder also accepts the `[min,max]` two-element array leniently (the §3.6 bare-array coercion) and the enveloped form. In a filter context the `value` may be omitted per the auto-binding rule. `min`/`max`/`step` bounds are omitted when absent (rule 4).

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

**Migration window.** A decoder currently ACCEPTS AND IGNORES a legacy `position` / `newPosition` on
these two ops, so a stored v1 emission still applies (as an append) while hosts adopt independently.
That tolerance is a migration mechanism, not a second dialect: nothing in this spec, the corpus, or
the prompt pack offers the field, and a conformant encoder must never write it. The window closes
when every host is positionless, after which the field is a decode error.

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

These DUs encode as a **bare JSON string** (not a `$type` object), matching the renderer's emission:

- `Orientation`: `"Vertical"` / `"Horizontal"`
- `BadgeVariant`: `"Neutral"` / `"Brand"` / `"Success"` / `"Warning"` / `"Critical"` / `"Info"`
- `ButtonVariant`: `"Primary"` / `"Secondary"` / `"Tertiary"` / `"Destructive"`
- `HeadingVariant`: `"Standard"` / `"Eyebrow"` / `"Caption"` / `"Lead"`
- `ToneVariant`: `"Default"` / `"Subdued"` / `"Brand"` / `"Success"` / `"Warning"` / `"Critical"` / `"Info"`
- `StyleWeight`: `"Compact"` / `"Standard"` / `"Spacious"`
- `Emphasis`: `"Quiet"` / `"Normal"` / `"Loud"`
- `ChartKind`: `"Line"` / `"Bar"` / `"Area"` / `"Pie"` / `"Scatter"` / `"Heatmap"`
- `AriaRole`: the raw ARIA string (`"button"`, `"link"`, `"dialog"`, …; `AriaRole.Custom raw` emits `raw`)
- `LiveRegionKind`: `"polite"` / `"assertive"` / `"off"`
- `HashStrictness` (inside `Custom.contentHash.strictness`): `"StrictReplay"` / `"AdvisoryWarning"`
- `DateStyle` (inside `Format.Date.dateStyle`): `"Short"` / `"Medium"` / `"Long"` / `"Full"`
- `RelativeTimeUnit` (inside `Format.RelativeTime.unit`): `"Second"` / `"Minute"` / `"Hour"` / `"Day"` / `"Week"` / `"Month"` / `"Year"`
- `FileReadEncoding` (inside `Action.ReadFileBody.encoding`): `"Text"` / `"Base64"` / `"DataUrl"`

An unrecognised bare-enum string is `UNKNOWN_DU_CASE` at that path (e.g. `tone: "Magenta"`).

### 3.6 Stylistic fields – omitted-when-default + lenient-ingest (Phase 460)

The stylistic slots on the spec decoders – `format` (`CellFormat`), `tone` (`ToneVariant`),
`weight` (`StyleWeight`), `emphasis` (`Emphasis`), and `width` (`ColumnWidth`) – are
**omitted-when-default on the decode boundary**: an absent field restores its identity default,
exactly as `role`/`voice` do inside `SemanticStyle` (Phase 147). This is the required-vs-omittable
seam of the Phase 426/430 declarative-floor doctrine, applied to *style* instead of behaviour: an
emission carrying only the semantic fields (`label`, `value`, `kind`) is a complete, valid tree.

**Identity-default table** (absent ⇒ this value; a present explicit-default value keeps decoding,
read-compat):

| Field | Type | Identity default | Sites |
|---|---|---|---|
| `format` | `CellFormat` | `None` | `MetricSpec`, `ColumnErased`, `LabelValueRowSpec` |
| `tone` | `ToneVariant` | `Default` | `MetricSpec`, `SemanticStyle`, `ToastSpec`, `CalloutSpec`, `ProgressSpec`, `FactSpec` |
| `weight` | `StyleWeight` | `Standard` | `MetricSpec`, `SemanticStyle` |
| `emphasis` | `Emphasis` | `Normal` | `MetricSpec`, `SemanticStyle`, `FactSpec` |
| `width` | `ColumnWidth` | `Auto` | `ColumnErased` |
| `editable` | `bool` | `false` | `GridSpec` (DataGrid) – 0.2.0 |
| `indeterminate` | `bool` | `false` | `ProgressSpec` – 0.2.0 |
| `dismissable` | `bool` | `false` | `CalloutSpec` – 0.2.0 |
| `dismissable` | `bool` | **`true`** | `ToastSpec` – 0.2.0; the one omit-when-TRUE (a toast is dismissable unless said otherwise) |
| `orientation` | `Orientation` | `Horizontal` | `TabsSpec`, `FormFieldKind.SegmentedChoice` – 0.2.0 (encoder-symmetric) |

`CellFormat`'s own per-case payloads (`Currency.code`, `Date.format`, `SignificantDigits.digits`)
stay **required** – only the parent *field* is omittable, never a DU payload. `LabelValueRowSpec.emphasis`
is a **bool** (behavioural, not the style DU) and stays required – out of this seam's scope.

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

(`title` is scoped: `Chart.title` and `Drawing.title` are *real canonical fields* and take no alias.)

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

Refused, per the law: the value→label **map** form (`"options": {"A":"Alpha"}`) – JSON object key
order IS meaningful for a displayed option list (contrast `params`, a keyed set, where the map is
admitted); a bare **object without `$type`** in a Binding slot – more plausibly a mistyped binding
than a `Static` value; and `null` in a Binding slot (ambiguous with absent). Pinned cross-host by
`lenient/lenient-shape-*` fixtures.

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
omitted in eval emission data). **0.2.0 made this encoder-symmetric** – the encoder now omits
`orientation` at `Horizontal` on `SegmentedChoice` AND `Tabs` (the identity-default table above),
so the omitted form is the canonical bytes. The legacy `Stack` `orientation` stays required (no
default is neutral there: vertical and horizontal stacks are both common). Pinned by
`lenient/lenient-shape-segmented-orientation-omitted` + the regenerated `nodes/tabs-1.json`.

---

### The declarative floor (Phase 430)

The design principle the 423–428 family enforces, stated once so the next spec author designs against it: **closures are overrides, never the floor.** Every interactive control's event surface has a declarative default (an omitted handler writes the change back to the control's own writable value binding – State/Filter/Selection store write-back); every data-display accessor has a declarative field-name form (`field` / `rowKeyField`); every result continuation has a declarative destination (`Call … into`). A slot that only works via a closure is dead on the decoded path – it parses, validates, renders, and does nothing. The machine-checked registry of every closure-bearing slot's posture (`WriteBack` / `FieldName` / `ResultTarget` / `HostOnly-by-design`) is `Fuaran.UI.SlotCapability` – a new closure-bearing spec field MUST add its row (the completeness test fails otherwise), and the dead-on-decode lint (`Fuaran.UI.DeadOnDecode.lint`, FUARAN080/081) flags sentinel slots on decoded trees with the declarative remedy. Relatedly, the **`queryResults` population contract**: `$queries.*` population is a host concern – the host feeds `BindingSources.QueryResults`, or a declarative `Call … into Query <name>` (Phase 428) writes it live; decoded trees own the *names and edges* (`Query.name`, `dependsOn`, `into`), never the fetch itself.

## 4. Closure-bearing slots → `"<closure>"`

Every function-typed payload the encoder cannot observe renders as the sentinel string `"<closure>"`. The decoder reconstructs each as a **placeholder** that re-encodes to the same `"<closure>"` sentinel, keeping the round-trip byte-stable. The slots are:

- `Action.Dispatch _` → encodes as the bare `{"$type":"Dispatch"}` – 0.2.0: the `msg` sentinel field is OFF the wire (no decoder ever read it; pure token weight). On decode `Action.Dispatch (box "<closure>")`.
- `Action.Call(endpoint, _, _)` → endpoint string preserved; a `Some` `onResult` is `"<closure>"` (omitted when `None` – Phase 428; the declarative `into` target IS wire-carried data, not a closure).
- `Action.ReadFileBody(file, encoding, _)` → `file.Id` carried as the `fileRef` string + `encoding` as a bare enum; the blob (`file.Handle`) never serialises and `onRead` is `"<closure>"`. The decoded `FileRef` carries `Handle = None`.
- `FormFieldKind.*` `onChange` / `onToggle`; `SelectSpec.OnChange` / `OnChangeMulti`, `TabsSpec.OnSelect` / `OnSelectTag`, `Disclosure.OnToggle` → emitted **only when present** (Phase 426 – an omitted handler arms the write-back default); a present sentinel decodes to `Some` no-op placeholder. `FileUploadSpec.OnSelect` and `StepperSpec.OnSelect` stay always-emitted closures decoding to a no-op action.
- `CellKindErased.*` handlers (`onEdit` / `onToggle` / `onClick` / `get` / `labelFn` / `hrefFn` / `toneFn` / `fractionFn` / `fn`).
- `GridSpec.OnRowClick`, `ChartSpec.OnPointClick`, `TableSpec.OnRowClick`, `MapSpec.OnMarkerClick` → emitted **only when present** (rule 4); the value is `"<closure>"`.
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
| `FormFieldKind.Choice` / `SegmentedChoice` `.options` (forms and filter chips), `SelectSpec.source` | `SelectOption list` | array of `{"label":<TextSource>,"value":<string>}` | `[]` |
| the same specs' `.value` | `string option` | the plain string | `null` |
| `SelectSpec.values` (multi-select, Phase 291) | `string list` | array of strings | `[]` |
| `SparklineSpec.source` | `float seq` | array of numbers (rule 5 layout) | `[]` |
| `MapSpec.source` | `MapMarker seq` | array of `{"label":<TextSource>,"latitude":<number>,"longitude":<number>}` | `[]` |
| `FormFieldKind.Range.value` | `float * float` | bare `{"max":<number>,"min":<number>}` – no `Static` envelope (Phase 423 shape, kept at 0.2.0) | – (both bounds always present) |

The typed encoding applies at the binding's `State.defaultValue` position too, and recursively through `Local.initialFrom` – the whole `Binding` in a typed slot is typed, not just the `Static` case.

**The residual-opaque boundary (by design).** A `Static` payload the language does NOT enumerate – a host domain record, the `obj seq` grid/table/chart row sources, a `PropValue.Native` op value – still renders `"<opaque>"` under rule 11's best-effort primitives. This is deliberate: the wire never invents structure for content only the host can decompose; the decoder passes the sentinel through and **MUST NOT** attempt to reconstruct the original CLR type – the host's per-app schema re-hydrates downstream (`moduleMsgDecoder`). Nothing else falls through the catch-all silently: a new slot-typed payload shape MUST land its typed encoder + decoder + corpus fixtures in one §11 change-set, or be added to the residual list here.

**Read-compat (indefinite).** Two legacy wire forms – what the pre-429 encoder produced for the now-typed slots – stay decode-accepted at every typed slot:

- `"<opaque>"` → a **tagged placeholder**: options → `[ { Value = "<opaque>"; Label = Literal "<opaque>" } ]`; `string option` → `Some "<opaque>"`; `string list` → `[ "<opaque>" ]`; float / marker seqs → empty. A placeholder's re-encode is its **typed** form (e.g. the one-element placeholder options array) – pinned cross-host by the `lenient/lenient-opaque-static-*` corpus fixtures.
- `null` → the typed empty form (`[]` / `None`). This was the pre-429 F# boxes-to-`null` asymmetry (`box ([] : 'a list)` and `box None` are null references, which the old encoder wrote as JSON `null`); pinned by `lenient/lenient-null-static-options`.

For a genuinely residual-opaque slot (`obj seq` sources), the old rule still holds: the substituted placeholder must itself re-encode to `"<opaque>"` (a non-null reference of a non-recognised type – the F# host uses an empty generator sequence). The invariant there remains `encode(decode(encode(x))) == encode(x)`, not value preservation – residual-opaque content is intentionally lost.

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
| `LayoutKind.Modal` | survivable | – |
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

_(The `FilterKind` table is retired at 0.2.0 – filter chips are `FormFieldKind` controls; see the rows above.)_

**`VisKind`**

| Case | Wire | Recoverable alternative |
|---|---|---|
| `VisKind.DataGrid` | partial | use Column.Field + CellFormat instead of a closure Value; RowKeyField instead of RowKey; the click write-back default for OnRowClick |
| `VisKind.Chart` | partial | – |
| `VisKind.Table` | partial | – |
| `VisKind.Map` | partial | – |

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
| `CellKindErased.Pill` | **host-only** | – |
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
| `Binding.Static` | partial | a language-enumerated slot payload round-trips; a non-enumerated value (host records, obj-seq grid/chart sources) erases to "<opaque>" – prefer a typed slot, Binding.State / Binding.Filter, or Binding.Transform |
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

## 6. `DecodeError` envelope + the six codes

Every wire-shape violation surfaces a **structured, recoverable** error (never a throw). The envelope:

```json
{ "Code": "<one of the six codes>",
  "Path": "<JSONPath-ish location, e.g. $.kind.text>",
  "Message": "<human/AI-readable description>",
  "ExpectedShape": "<optional hint string>" }
```

`Path` uses a `$`-rooted dotted form; `$type` appears literally in the path when the discriminator is at fault (e.g. `$.kind.$type`). The six codes:

| Code | Raised when |
|---|---|
| `INVALID_JSON` | The input is not syntactically valid JSON (garbage, truncation, empty string). `Path` is `$`. |
| `MISSING_FIELD` | A required key is absent on a Node / Spec / Op object. `Path` names the missing key. |
| `WRONG_TYPE` | A value is present but the wrong JSON kind (e.g. `id` is a number, `children` is an object). |
| `UNKNOWN_DU_CASE` | A `$type` discriminator (or bare-enum string) is not a recognised case. `ExpectedShape` enumerates valid cases. |
| `WRONG_NODE_KIND` | The **top-level** `kind.$type` is not a recognised node kind – i.e. not one of the flat Layout/Display/Input/Visualisation primitives (§3.2) nor Custom/ErrorBoundary/FragmentDecl/FragmentRef. Raised at `$.kind.$type`. (Distinct from `UNKNOWN_DU_CASE` for the eval gate-1 surface.) |
| `EMPTY_NODE_ID` | An `"id"` field is present but the empty string. (Same defect the post-apply validator catches; surfaced at decode time to save the round-trip.) |

The 30 reject fixtures in the corpus exercise every code; each manifest entry pins the `expectedErrorCode` and an `expectedPath` prefix. Node-side rejects additionally populate `ExpectedShape`; op-side rejects assert Code + Path only.

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

---

## 9. Wire-omitted fields (by design)

Three fields on the `Node` record are **never** emitted, and a decoder always sets them to their default:

| Field | Default on decode | Why omitted |
|---|---|---|
| `Node.Motion` (`Motion option`) | `None` | Motion is consumer-authored, not AI-authored. |
| `Node.ExtraAttributes` (`Map<string,string> option`) | `None` | The "AI-opaque consumer-side hatch" for `data-*` / `aria-*` test-hook attributes; the §4d JSON wire shape omits it on emit (see [`Types.fs`](../fuaran-dotnet/src/Fuaran.UI/Types.fs) ~lines 211–251). |
| `Node.Accessibility` (`Accessibility option`) | `None` when the `accessibility` key is absent | Optional per rule 4; present only when authored. |

A conformant host that emits these fields would diverge from the canonical wire shape and fail the corpus.

---

## 10. Known v1 limitations

A conformant host MUST reproduce these *exactly* so the corpus stays byte-stable across hosts. Any change that closes one of them is a single coordinated change across encoder + decoder + corpus + every host (§11).

### 10.1 Type fields not carried on the wire

One field exists on the typed surface but is **not part of the wire format**: the encoder does not emit it, and a conformant decoder restores the type's default. A host MUST NOT expect it on the wire:

- `ButtonSpec.Tooltip` – optional `TextSource`; decodes to `None`.

**Closed by Phase 126** (previously listed here as dropped – now carried, so these round-trip losslessly): `ChartSpec.Stacked` (`bool`, carried as `stacked`), `TabsSpec.ActiveIndex` (`Binding<int>`, carried as `activeIndex`). `TabsSpec.OnSelect` is a closure – it is now carried as the `"<closure>"` sentinel (§4) and decodes to a no-op action (its behaviour cannot round-trip, but the slot is no longer silently dropped). A decoder still tolerates the absence of `stacked` / `activeIndex` (legacy wire predating the change), defaulting to `false` / `Binding.Static 0`.

### 10.2 Other v1 limitations

- **Closures are placeholders** (§4); typed re-attachment is `moduleMsgDecoder`'s job.
- **Residual-opaque `Binding.Static` values lose typed content** (§5 – host-typed payloads only; the enumerated slot-typed payloads round-trip value-faithfully since Phase 429); the host's per-app schema re-hydrates.
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

A machine-readable mirror of this roster (plus a generated kind enumeration) is the intended
executable anchor in [`wire-format-fixtures/manifest.json`](./manifest.json),
so the roster can be mechanically enforced rather than doc-maintained; **until that lands this table is
authoritative.**

Adding a new `NodeKind` / `Spec` / `TreeOp` / `Binding<'T>` / `Action<'Msg>` case MUST, **in the same commit**:

1. update the encoder ([`CanonicalJson.fs`](../fuaran-dotnet/src/Fuaran.UI.OpStream.Abstractions/CanonicalJson.fs)),
2. update the decoder ([`JsonDecode.fs`](../fuaran-dotnet/src/Fuaran.UI.Ops/JsonDecode.fs)),
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
├── nodes/   *.json   # 70 canonical Node wire forms
├── ops/     *.json   # 21 canonical TreeOp wire forms (incl. the Phase 364 nested-path set)
└── reject/  *.json   # 30 malformed inputs
```

A conformant host's test harness loads `manifest.json` and, per entry:
- `kind: "node-round-trip"` / `"op-round-trip"` → decode `inputFile` with the `decoder`-named entry point, re-encode, assert byte-equal to `expectedFile`.
- `kind: "reject"` → decode `inputFile`; assert the error's code == `expectedErrorCode` and its path starts with `expectedPath`.

### 12.1 Third-party certification kit

Third-party implementations do not need to hand-build the harness above: the published **`@fuaran-ui/conformance`** npm package is a packaged certification kit – it bundles a versioned snapshot of this corpus (named in every report by manifest version + SHA-256 content digest), drives a candidate implementation through a small adapter seam (`decodeNode` / `encodeNode` / `decodeOp` / `encodeOp`, all optional), and emits a per-leg pass/fail report with honest partial-certification semantics for hosts that implement only part of the contract. The certification procedure – what "conformant host" means, mandatory vs optional legs, how to read the report, and the per-corpus-version caveat that follows from §11 – is defined in the TypeScript reference repo's `CONFORMANCE.md`. The bundled snapshot is byte-synced from this corpus and guarded by the kit's own test suite; when the corpus advances under §11, a new kit release ships the regenerated snapshot and hosts re-certify against it.

---

## 13. Canonical JSON Schema artefact (`schema.json`)

The corpus ships a machine-readable **Draft 2020-12 JSON Schema** at [`wire-format-fixtures/schema.json`](./schema.json) – the third co-equal expression of this contract, alongside this prose spec and the fixture corpus. It is the enabling input for provider-native constrained emission, a drop-in artefact for external validators and editor tooling, and a second executable check on the wire shape.

- **`$id`:** `https://fuaran.dev/wire-format/v1/schema.json`. The `/v1/` segment pins the wire-format major version (see the **Version** banner at the top of this doc).
- **Generated, not hand-authored.** It is emitted by [`Fuaran.UI.Ops.SchemaGen`](../fuaran-dotnet/src/Fuaran.UI.Ops/SchemaGen.fs) – a structural hand-walk of the same DU surface [`CanonicalJson.fs`](../fuaran-dotnet/src/Fuaran.UI.OpStream.Abstractions/CanonicalJson.fs) walks, so it *describes* the canonical JSON the encoder produces (and the decoder accepts) rather than introducing a parallel contract. It is regenerated by the same `--emit-corpus` command that writes the fixture payloads (§12).
- **Shape.** DU positions encode as `oneOf` of branch objects, each pinned by a `$type` `const` discriminator (an unrecognised `$type` matches no branch – mirroring `UNKNOWN_DU_CASE` / `WRONG_NODE_KIND`). Bare-string enums (§3.5) encode as `{ "type":"string", "enum":[…] }`. Closure slots (§4) are the `const "<closure>"`. Opaque `Binding.Static` values (§5) are `true` (any JSON); structured JSON payload positions (rule 12) are likewise `true` – any JSON except `null`, which the decoder rejects – the schema deliberately does not constrain content the encoder cannot decompose. Wire-omitted fields (§9, §10.1) are absent from the schema. The schema does **not** set `additionalProperties:false`, matching the decoder's tolerance of unknown keys (§2 rule 2). The top-level schema is `oneOf: [ {$ref Node}, {$ref TreeOp} ]`; `$defs/Node` and `$defs/TreeOp` are exposed directly for hosts that want to validate one shape.
- **Conformance.** `SchemaConformanceTests.fs` validates every accept-fixture (must validate) and every reject-fixture (must fail) against `schema.json` using an off-the-shelf Draft 2020-12 validator, and runs the stale-schema guard (§11). The schema describes the *existing* wire shape only – it introduced no change to the canonical JSON (additive-only; the fixture payloads are byte-unchanged by Phase 96).

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

## See also

- [`MARKDOWN.md`](../fuaran-dotnet/docs/MARKDOWN.md) – the deterministic GFM markdown-render contract (render-only; §14).
- [`STABILITY.md`](../fuaran-dotnet/STABILITY.md) → "Wire format" – the stability declaration + breaking-change criteria.
- [`AI_AUTHORING_GUIDE.md`](../fuaran-dotnet/docs/AI_AUTHORING_GUIDE.md) "Self-checking before you emit" – the encoder-side pre-emit gate; the wire format is what it validates against.
- [`../src/Fuaran.UI/Types.fs`](../fuaran-dotnet/src/Fuaran.UI/Types.fs) – the §4b record contract this format serialises.
