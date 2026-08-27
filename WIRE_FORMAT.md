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
| `Box` | _Layout_ | `children`, `heading?`, `layout`, `role` | `layout` names how children arrange, `role` what the container means (element, ARIA landmark, chrome). See "The `Box` container" below. |
| `Disclosure` | _Layout_ | `children`, `defaultOpen`, `heading`, `onToggle?`, `open` |  |
| `Modal` | _Layout_ | `children`, `dismissable`, `heading?`, `onDismiss?`, `open` |  |
| `ScrollArea` | _Layout_ | `children`, `maxHeight?`, `maxWidth?`, `orientation` |  |
| `SplitPanel` | _Layout_ | `children`, `weight` |  |
| `Stepper` | _Layout_ | `activeStep`, `children`, `onSelect?` |  |
| `SummaryList` | _Layout_ | `children`, `heading?` |  |
| `Tabs` | _Layout_ | `activeIndex`, `activeTag?`, `children`, `onSelect?`, `onSelectTag?`, `orientation?=Horizontal`, `tabHeaders?`, `tabTags?` |  |
| `Badge` | _Display_ | `label`, `variant` |  |
| `Callout` | _Display_ | `body`, `dismissable?=false`, `heading?`, `icon?`, `tone?=Default` |  |
| `CodeBlock` | _Display_ | `code`, `copyable`, `highlightLines`, `language`, `lineNumbers` | The parity-checked render is a deterministic `<pre><code>`; syntax highlighting is a client-only post-hydration enhancement, outside the cross-host byte-diff. |
| `Drawing` | _Display_ | `description?`, `shapes`, `style`, `title?`, `viewBox` |  |
| `Fact` | _Display_ | `emphasis?=false`, `help?`, `icon?`, `label`, `tone?=Default`, `value` |  |
| `Heading` | _Display_ | `level`, `text`, `variant` |  |
| `Icon` | _Display_ | `icon`, `label?`, `size?=Medium`, `tone?=Default` |  |
| `Image` | _Display_ | `alt`, `src`, `variant` | `src` is a `Binding<string>` the renderer routes through the §19 URL-scheme floor: sanitisation is a render-time obligation, so a URL that fails the floor is still a valid wire document. `alt` is mandatory. |
| `LabelValueRow` | _Display_ | `emphasis?=false`, `format?=None`, `help?`, `label`, `value` |  |
| `Link` | _Display_ | `download`, `href`, `label`, `protection?`, `rel?`, `target?` | `protection` names an anti-scraper render STRATEGY, never a content constraint — the wire carries the real `mailto:` href and a decoder MUST NOT alter it. See "Link protection" below. |
| `List` | _Display_ | `items`, `ordered` |  |
| `Markdown` | _Display_ | `text` |  |
| `Math` | _Display_ | `display`, `source` | The parity-checked render is a deterministic escaped-source fallback; KaTeX is a client-only post-hydration enhancement, outside the byte-diff. |
| `Metric` | _Display_ | `emphasis?=Normal`, `format?=None`, `icon?`, `label`, `subtext?`, `tone?=Default`, `trend?`, `trendFormat?`, `trendPolarity?=HigherIsBetter`, `value`, `weight?=Standard` |  |
| `Progress` | _Display_ | `caveat?`, `fraction`, `indeterminate?=false`, `label?`, `tone?=Default` |  |
| `Skeleton` | _Display_ | `rows` |  |
| `Sparkline` | _Display_ | `source` |  |
| `Toast` | _Display_ | `dismissable?=true`, `message`, `open`, `tone?=Default` |  |
| `Button` | _Input_ | `disabled?`, `icon?`, `label`, `onClick`, `tooltip*`, `variant` |  |
| `FileUpload` | _Input_ | `accept`, `disabled?`, `label`, `multiple`, `onSelect?` |  |
| `Filters` | _Input_ | `items` |  |
| `Form` | _Input_ | `disabled?`, `fields`, `onSubmit`, `submitLabel` |  |
| `Select` | _Input_ | `disabled?`, `label`, `multiple?`, `onChange?`, `onChangeMulti?`, `placeholder?`, `source`, `value`, `values?` |  |
| `Chart` | _Visualisation_ | `dataLabels?`, `kind`, `legendPosition?`, `onPointClick?`, `source`, `stacked`, `subtitle?`, `title?`, `valueFormat?`, `xField`, `xScale?`, `xTitle?`, `yFields`, `yTitle?` |  |
| `DataGrid` | _Visualisation_ | `columns`, `defaultSort?`, `editStateKey?`, `editable?=false`, `onRowClick?`, `pageSize?`, `pageStateKey?`, `reorderable?=false`, `rowKey?`, `rowKeyField?`, `sortStateKey?`, `source`, `staticRows?` | The wire discriminator is `DataGrid`; the F# display tag is `Grid`. The former `Grid` collision with the CSS-grid container is resolved — that container is a `Box`. |
| `Map` | _Visualisation_ | `centreLatitude`, `centreLongitude`, `onMarkerClick?`, `source`, `zoom` |  |
| `Custom` | _Meta_ | `componentId`, `contentHash?`, `exposedNodeIds?`, `moduleId`, `props` | The host-registered escape hatch. `props` is opaque to the wire; the host renderer is a trust boundary. |
| `ErrorBoundary` | _Meta_ | `child`, `fallback` |  |
| `FragmentDecl` | _Meta_ | `body`, `effect?`, `holes?`, `name` | NOT an isolation boundary — its `body` is walked, so id uniqueness there is pre-expansion. |
| `FragmentRef` | _Meta_ | `args?`, `name` | An isolation boundary (§8.1): the referenced body is not part of the referring tree. Interior ids are namespaced by the referring node at render time. |
| `Mount` | _Meta_ | `capabilities`, `channel`, `inputs?`, `onBubble?`, `scopeId` | An isolation boundary (§8.1): the guest interior is a separate id scope, produced host-side by the guest loader and never inlined into the host document. |
| `Switch` | _Meta_ | `cases`, `default`, `on?`, `stateKey?` | The declarative branch — `cases` are matched against `on`, `default` is taken when none matches. A `Switch` is resolved on the decoded tree, not by host code. |
<!-- /fuaran:spec-kinds -->

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

- **`Image`** (Display) – `{"$type":"Image","alt":<TextSource>,"src":<Binding>,"variant":"Default"|"Avatar"|"Rounded"}`. `src` is a `Binding<string>`; the renderer routes it through the §19 URL-scheme floor – sanitisation is a render-time obligation, not a wire constraint, so a URL that fails the floor is still a valid wire document. `alt` is mandatory. See `nodes/image-1.json`.
- **`List`** (Display) – `{"$type":"List","items":[<TextSource>,…],"ordered":<bool>}`. See `nodes/list-1.json`.
- **`Divider`** – **retired (Phase 459)** into a childless `Box` with `role:"Separator"` (see "The `Box` container" above). A bare `"$type":"Divider"` is rejected (`UNKNOWN_DU_CASE`); there is no `divider-1.json` fixture.
- **`Toast`** (Display) – `{"$type":"Toast","dismissable"?:<bool>,"message":<TextSource>,"open":<Binding>,"tone"?:<ToneVariant>}`. 0.2.0: `dismissable` is omitted-when-**TRUE** (a toast is dismissable unless said otherwise – the one inverted default in §3.6's table). See `nodes/toast-1.json`.
- **`Modal`** (Layout) – `{"$type":"Modal","children":[<Node>,…],"dismissable":<bool>,"heading"?:<TextSource>,"onDismiss"?:<Action>,"open":<Binding>}`. `onDismiss` is a **wire-survivable `Action`** (like `FormSpec.onSubmit` – encoded as the action value, not a `<closure>` sentinel), OPTIONAL since Phase 426: omitted, a dismissable modal falls to the write-back default (dismiss writes `false` to a writable `open` slot). `heading` omitted when `None`. See `nodes/modal-1.json`.
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

**Overlay + overflow render-fidelity contract (Phase 289).** `Modal` / `Toast` / `ScrollArea` are render-fidelity-sensitive, so the renderers pin an explicit SSR↔CSR contract: overlays render **inline (no React portal)**, positioned + z-indexed purely by CSS, and a closed overlay stays in the DOM behind the native `[hidden]` attribute (never an absent node). The server and client therefore emit **byte-identical class + ARIA structure** (`role="dialog"`+`aria-modal` for Modal; `role="status"`+`aria-live="polite"` for Toast; `role="region"`+`tabindex="0"` for ScrollArea), so React hydration finds the DOM it expects with no mismatch. Focus management is an additive client-only enhancement that does not alter the hydrated DOM. The contract is executable in the SSR-parity corpus (Phase 142). Full narrative: `docs/SSR.md`.

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

`$type`-dispatched objects also appear at every nested DU: `TextSource` (`Literal`/`Bound`/`I18n`), `Binding<'T>` (`Static`/`Query`/`Filter`/`Selection`/`State`/`Computed`/`I18n`/`Local`/`Format`/`Transform`/`Invoke`), `Action<'Msg>` (`Dispatch`/`Call`/`Notify`/`Navigate`/`SetState`/`AiTool`/`Chain`/`CommitLocal`/`WriteToClipboard`/`ReadFileBody`/`Invoke`), `CellFormat`, `CellValue`, `ColumnWidth`, `Format`, `LocaleSource`, `FormFieldKind`, `CellKindErased`, `LocalFlushTrigger`. Each renders `{"$type":"<CaseName>", …fields}`, with two 0.2.0 exceptions: `TextSource.Literal`'s canonical form is the **bare JSON string** (the `{"$type":"Literal","text":…}` envelope stays decode-accepted and normalises down, §16), and `Action.Dispatch` renders the bare `{"$type":"Dispatch"}` (no `msg` sentinel, §4). Field names and presence are pinned by the corpus.

`Binding.Transform` (Phase 282) is the declarative-compute case – a serialisable dataframe transform evaluated client-side **as data**: `{"$type":"Transform","pipeline":<array>,"source":<object>}`. `source` is a columnar data source (an embedded `{schema, columns}` table – column-oriented, a `values` array + a `validity` mask per column – or a `{schema, ref}` host-resolved named source); `pipeline` is an ordered array of `$type`-discriminated transform steps (`filter` / `project` / `derive` / `groupBy` / `join` / `window` / `pivot` / `unpivot` / `sort` / `distinct` / `limit` / `union`, each over a scalar `ColExpr` algebra). Both sub-trees are `Fuaran.Core` values serialised in **this same canonical discipline** (§2), so they splice in byte-stably; their detailed per-step shape is owned and conformance-certified by `Fuaran.Core`'s own codec, and the schema (§13) describes them structurally (array / object) rather than re-deriving the full algebra – the same "don't constrain content the host doesn't decompose" posture as an opaque `Static.value` (§5). The case is constrained to the **row-feed** binding at a data-bearing node (`DataGrid` / `Chart` / `Metric`): the host evaluates the pipeline and the result rows resolve as the node's source, in the same row shape §5 defines for a literal feed. See `nodes/grid-transform.json` for the canonical shape.

**`Binding.Transform` params (Phase 424).** The Transform binding gains an OPTIONAL `params` field: `"params":[{"from":<Binding>,"name":<string>},…]`, each entry binding a `ColExpr.param` name the pipeline references (a `{"$type":"param","name":…}` scalar expression, `fuaran-core#77`) to a scalar `Binding` source (`Filter` / `State` / `Static` / `Selection`). **Omitted when empty**, so a param-free Transform is byte-identical to the Phase 282 wire. The host resolves each param to a `Cell`, prunes any `filter` step whose params are unbound (an unset choice filter ⇒ no constraint – the one lenient UI rule), and evaluates the pipeline in that env – so a `filter` step comparing a `col` to a `param` scopes the rows by a live filter/state value, the declarative-data twin of `Query.dependsOn`. The filter→consumer edge is *derived* from the pipeline's params, never separately declared. See `nodes/grid-transform-param.json` (a filter param from a chip) vs the byte-unchanged `nodes/grid-transform.json`.

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
- `Emphasis`: `"Quiet"` / `"Normal"` / `"Loud"`
- `FileReadEncoding` (inside `Action.ReadFileBody.encoding`): `"Text"` / `"Base64"` / `"DataUrl"`
- `FontVoice`: `"Default"` / `"Display"` / `"Structural"`
- `HashStrictness` (inside `Custom.contentHash.strictness`): `"StrictReplay"` / `"AdvisoryWarning"` / `"Enforced"`
- `HeadingVariant`: `"Standard"` / `"Eyebrow"` / `"Caption"` / `"Lead"`
- `HostEffect`: `"Pure"` / `"ReadsHost"` / `"WritesHost"`
- `IconSize`: `"Small"` / `"Medium"` / `"Large"`
- `ImageVariant`: `"Default"` / `"Avatar"` / `"Rounded"`
- `LinkProtection`: `"email"`
- `LiveRegionKind`: `"polite"` / `"assertive"` / `"off"`
- `MathDisplay`: `"Inline"` / `"Block"`
- `Motion` (a closed vocabulary that never reaches the wire — `Node.motion` is host-only, §9): `"None"` / `"PulseDuringLoad"` / `"FadeInOnMount"` / `"SlideInFromBelow"` / `"ShakeOnError"` / `"RotateOnRefresh"` / `"SlideInFromRight"` / `"ExpandCollapse"`
- `Orientation`: `"Vertical"` / `"Horizontal"`
- `RelativeTimeUnit` (inside `Format.RelativeTime.unit`): `"Second"` / `"Minute"` / `"Hour"` / `"Day"` / `"Week"` / `"Month"` / `"Year"`
- `ScrollOrientation`: `"Vertical"` / `"Horizontal"` / `"Both"`
- `SortDirection`: `"asc"` / `"desc"`
- `StyleRole`: `"None"` / `"Eyebrow"` / `"Data"` / `"Lede"` / `"Caption"`
- `StyleWeight`: `"Compact"` / `"Standard"` / `"Spacious"`
- `TextAnchor`: `"Start"` / `"Middle"` / `"End"`
- `TextFormat`: `"email"` / `"url"` / `"tel"`
- `ToneVariant`: `"Default"` / `"Subdued"` / `"Brand"` / `"Success"` / `"Warning"` / `"Critical"` / `"Info"`
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
| `default` | `ToneVariant` | `Default` | `CellKindErased.TonedPill` | The tone for a value the `map` does not mention. |
| `dismissable` | `bool` | `false` | `CalloutSpec` |  |
| `dismissable` | `bool` | `true` | `ToastSpec` | The one omit-when-TRUE: a toast is dismissable unless said otherwise. |
| `editable` | `bool` | `false` | `DataGridSpec` |  |
| `emphasis` | `Emphasis` | `Normal` | `MetricSpec`, `SemanticStyle` |  |
| `emphasis` | `bool` | `false` | `FactSpec`, `LabelValueRowSpec` | The behavioural bool, not the `Emphasis` style DU — a different field that shares a name. |
| `format` | `CellFormat` | `None` | `ColumnErased`, `LabelValueRowSpec`, `MetricSpec` |  |
| `indeterminate` | `bool` | `false` | `ProgressSpec` |  |
| `orientation` | `Orientation` | `Horizontal` | `TabsSpec` | `TabsSpec` only. `FormFieldKind.SegmentedChoice.orientation` is REQUIRED and is not in this table: its decoder restores `Horizontal` when the field is absent (a §16 lenient-ingest accept), but the encoder always emits it, so the omitted form is not canonical there. |
| `reorderable` | `bool` | `false` | `DataGridSpec` |  |
| `role` | `StyleRole` | `None` | `SemanticStyle` |  |
| `size` | `IconSize` | `Medium` | `IconSpec` |  |
| `tone` | `ToneVariant` | `Default` | `CalloutSpec`, `FactSpec`, `IconSpec`, `MetricSpec`, `ProgressSpec`, `SemanticStyle`, `ToastSpec` |  |
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
| embedded `Transform` **source slot** carrying a `State`/`Static`/`Bound` binding **envelope** | `{"$type":"State","defaultValue":[…],"key":…}` | the wrapped data itself – the envelope unwraps to its `defaultValue` (else `value`) BEFORE the columnar decode (initial-snapshot semantics; a LIVE state-sourced Transform is deliberately future charter work, not this). A wrapper carrying NEITHER payload member is not unwrappable and refuses downstream (`reject/reject-transform-source-empty-wrapper`). **An EMPTY array payload (`"defaultValue": []`) is the EMPTY TABLE, not a malformed one** — an initially-empty live collection ("count the requests in an empty log") is a complete intent with zero rows and no columns to infer, and it is also how a live source spells "I read this key and carry no data of my own" while the bare wrapper stays refused. Since §24.4 that spelling is what lets a Transform derive over a slot a SIBLING reader seeds; it declares nothing itself. Read this way by the reference host since 0.23.1, unspecified until fuaran#1075 and therefore refused by a second conformant host for a year — the divergence a rule stated on one implementation and not in the format always eventually produces. Pinned by `nodes/shared-source-seeded-pair`. Observed cross-family in the Tier-D pilot (claude, gemini, kimi). Pinned by `lenient/lenient-transform-source-state-rows`. fuaran#815; 2026-08-13; empty-payload rule fuaran#1075, 2026-08-27 |
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
| `FormFieldKind.Choice` / `SegmentedChoice` `.options` (forms and filter chips), `SelectSpec.source` | `SelectOption list` | array of `{"label":<TextSource>,"value":<string>}` | `[]` |
| the same specs' `.value` | `string option` | the plain string | `null` |
| `SelectSpec.values` (multi-select, Phase 291) | `string list` | array of strings | `[]` |
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
| `FormFieldKind.DateRange` | partial | omit the handler – the renderer's write-back default writes the change to the control's writable Binding.State / Binding.Filter value slot |

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

`Path` uses a `$`-rooted dotted form; `$type` appears literally in the path when the discriminator is at fault (e.g. `$.kind.$type`). The eight codes:

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

The <!-- fuaran:count kind=reject -->73<!-- /fuaran:count --> reject fixtures in the corpus exercise every code **except `LIMIT_EXCEEDED`**, whose fixtures are deliberately deferred until the hosts adopt §21 together (§21.5), **and `KIND_NOT_ADMITTED`**, which cannot appear in this family at all: a reject fixture asserts what the bytes are worth, and that code is raised by a declaration the bytes do not carry. Its cases live in [`decode-policy/`](decode-policy/) (§23), where each one names the policy alongside the document. Each manifest entry pins the `expectedErrorCode` and an `expectedPath` prefix. Node-side rejects additionally populate `ExpectedShape`; op-side rejects assert Code + Path only.

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
   declared as data in `fuaran-core` ([`tests/Fuaran.Core.Tests/UiIdl.fs`](https://github.com/Fuaran-Core/fuaran-core/blob/main/tests/Fuaran.Core.Tests/UiIdl.fs));
   regenerating (`dotnet run --project tests/Fuaran.Core.Tests -- --regen-snapshots`) and syncing
   (`fuaran-dotnet` [`scripts/sync-generated-layer.ps1`](../fuaran-dotnet/scripts/sync-generated-layer.ps1))
   emits the generated `Fuaran.UI.Generated` module — the **type, canonical encoder, structural
   decoder and `mk` constructor** for the case, never hand-edited. There is no hand-written node
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

`manifest.json` therefore carries a generated enumeration per attested family, derived from the encoded
node fixtures by `Corpus.emit` (never hand-authored), and each codec host pins its own declared
vocabulary against it in **both** directions — *the manifest names a case this host lacks* and *this
host declares a case the corpus does not know*. Both failures name the offending case, so the report is
"host X lacks `DateRange`", not a diff.

| Manifest array | Family | Wire position(s) | Attested in |
|---|---|---|---|
| `kinds` | `NodeKind` | `$.kind.$type`, recursively | all five codec hosts (since the kind-set pin landed) |
| `formFieldKinds` | `FormFieldKind` | `Form.fields[].kind.$type`, `Filters.items[].kind.$type` | F#, TypeScript, Python; Go and Rust pending |

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
<!-- fuaran:count kind=total -->339<!-- /fuaran:count --> fixtures in all —
<!-- fuaran:count kind=node-round-trip -->145<!-- /fuaran:count --> `node-round-trip`,
<!-- fuaran:count kind=op-round-trip -->22<!-- /fuaran:count --> `op-round-trip`,
<!-- fuaran:count kind=reject -->73<!-- /fuaran:count --> `reject`,
<!-- fuaran:count kind=lenient-accept -->61<!-- /fuaran:count --> `lenient-accept`,
<!-- fuaran:count kind=envelope-round-trip -->4<!-- /fuaran:count --> `envelope-round-trip`,
<!-- fuaran:count kind=envelope-reject -->2<!-- /fuaran:count --> `envelope-reject`,
<!-- fuaran:count kind=elicitation-round-trip -->7<!-- /fuaran:count --> `elicitation-round-trip`,
<!-- fuaran:count kind=elicitation-reject -->15<!-- /fuaran:count --> `elicitation-reject`,
<!-- fuaran:count kind=elicitation-answer-accept -->3<!-- /fuaran:count --> `elicitation-answer-accept`,
and <!-- fuaran:count kind=elicitation-answer-reject -->7<!-- /fuaran:count -->
`elicitation-answer-reject`.

A conformant host's test harness loads `manifest.json` and, per entry:
- `kind: "node-round-trip"` / `"op-round-trip"` → decode `inputFile` with the `decoder`-named entry point, re-encode, assert byte-equal to `expectedFile`.
- `kind: "reject"` → decode `inputFile`; assert the error's code == `expectedErrorCode` and its path starts with `expectedPath`.

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
- **Generated, not hand-authored** – and **not** by the `--emit-corpus` command that writes the fixtures and `schema.json` (§12). The encoder ([`Fuaran.Core.Idl.Artifact`](../../Fuaran-Core/src/Fuaran.Core.Idl/Idl.fs)) and the vocabulary it renders both live in the `Fuaran-Core` sibling, so the artefact is emitted from there:

  ```
  cd Fuaran-Core
  dotnet run --project tests/Fuaran.Core.Tests -- --emit-idl ../Fuaran-UI/wire-format-fixtures
  ```

- **Conformance.** A stale-artefact guard on the `Fuaran-Core` side asserts byte-equality between the committed `idl.json` and a fresh emission, and names the regeneration command on failure – the same discipline as the stale-schema guard above, so a vocabulary edit that skips regeneration fails a test rather than quietly serving a stale spec. Adding the artefact changed no fixture payload and did not touch `schema.json`.
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

- **Shape.** A single JSON object: `version`, `$id`, `description`, `tiers` (the three tier definitions above, so the artefact is self-describing), and `kinds` - one entry per canonical `kind.$type`, Ordinal-sorted so an addition lands as one clean insert. Each entry carries `kind`, `sensitive` (whether the kind has an explicit, phase-pinned fidelity contract, as against being trivially single-tier), `source`, `fallback`, `rich` (`{ "class": "none" | "behavioural" | "clientOnly", ... }`), `fixtures` (corpus-relative paths pinning the fallback, declared for the fidelity-sensitive kinds), and `contract` (where the contract is written down).
- **Conformance.** Two guards on the F# side. A **completeness rule** asserts one row per canonical wire kind, measured against this manifest's own generated `kinds` enumeration rather than a hand list - so a kind added under the §11 forward-coupling rule appears here and fails the rule until its posture is declared, and the class cannot silently grow. A **stale-artefact guard** asserts byte-equality between the committed file and a fresh emission, naming the regeneration command, exactly as the stale-schema guard does. Every fixture a row names is checked to exist. The artefact **describes the existing render contract only**: no wire byte and no renderer behaviour changed when it landed.
- **Scope.** Render fidelity, not interactivity. An inert server-rendered control becoming live at hydration is `behavioural`; what happens *after* a user interacts is outside this artefact entirely. Kinds the §15.3 tolerance path preserves without understanding have no row by construction, which is the honest answer rather than a missing one.

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


## See also

- [`MARKDOWN.md`](../fuaran-dotnet/docs/MARKDOWN.md) – the deterministic GFM markdown-render contract (render-only; §14).
- [`STABILITY.md`](../fuaran-dotnet/STABILITY.md) → "Wire format" – the stability declaration + breaking-change criteria.
- [`AI_AUTHORING_GUIDE.md`](../fuaran-dotnet/docs/AI_AUTHORING_GUIDE.md) "Self-checking before you emit" – the encoder-side pre-emit gate; the wire format is what it validates against.
- [`../src/Fuaran.UI/Types.fs`](../fuaran-dotnet/src/Fuaran.UI/Types.fs) – the §4b record contract this format serialises.
