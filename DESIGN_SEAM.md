# Fuaran UI design-provider seam (`design-seam@1`)

The **design-provider seam**: the records a design tool and the Fuaran UI language exchange when a
module is designed in the tool and lowered to a Fuaran UI tree. The tool sits behind the seam. It
never sees a tree, and the lowering never sees the tool: the two meet only in the four records this
document specifies.

This document is **normative**. A provider, or a reader of what a provider returns, is written from
this document and the [`design/`](./design/) fixture family; it does not need to read any
implementation's source. The family is enumerated by this corpus's root
[`manifest.json`](./manifest.json) under the kinds `design-seam-round-trip` and
`design-seam-reject`, and the manifest is the only place its counts live. The conventions this
document follows are [`SPEC_CONVENTIONS.md`](./SPEC_CONVENTIONS.md)'s.

---

## 1. Scope

### 1.1 What this specifies

Four records and the exchange between them:

- a **design-system reference** — which bundle of the language's own parts a provider holds;
- a **design brief** — what a module is for and what it must show, written for the provider;
- a **design request** — a brief handed to a provider, and where the request stands;
- a **design result** — the screens the provider returns, and what they were made from.

A provider offers three operations over them: it receives a design-system bundle and answers with
a reference; it receives a brief and answers with a request; it is asked for the result of a request
and answers with a result, or with nothing while the design is not ready. How a provider performs
them (an interactive tool, a service, a directory of hand-authored files) is outside this document.

### 1.2 What this does not specify

The design-system bundle itself (its cards and manifest), how a result is lowered to a Fuaran UI
tree, and how the fidelity of that lowering is judged. A record that pins a lowered tree beside the
design it came from belongs to whoever composes the application, and is built over the hashes these
records carry.

## 2. Encoding

Every record document is encoded under the canonical encoding of [`WIRE_FORMAT.md`](./WIRE_FORMAT.md)
§2, which this section restates for the members these records use rather than delegating:

1. **UTF-8, no byte-order mark, no insignificant whitespace.** A document is one line with no
   trailing newline.
2. **Object members are sorted by key, ordinally** — by UTF-16 code unit, at every depth. `$type`
   sorts first because `$` precedes every letter.
3. **Strings** escape `"` and `\`, and every control character `U+0000`–`U+001F` as `\u00xx` with
   lowercase hexadecimal; nothing else is escaped, and `\n`, `\r`, `\t` short forms are not used.
4. **Integers** are written in decimal with no sign for non-negative values, no leading zeros and no
   fraction or exponent. These records carry no real numbers.
5. **An absent optional member is omitted.** It is never written as `null`, and `null` is not a value
   any member of these records takes.
6. **A list member is always present**, written `[]` when empty. Arrays keep their order: the order
   of a list is part of the record.
7. **A record document carries `"$type"`** naming its record (`DesignSystemRef`, `DesignBrief`,
   `DesignRequest`, `DesignResult`). A record nested inside another is typed by its position and
   carries no `$type`.

## 3. Hashes

Every hash is written `sha256:` followed by the 64 **lowercase** hexadecimal digits of a SHA-256
digest. Three are carried, and each names what it is computed over:

| Member | Computed over |
|---|---|
| `bundleHash` | The design-system bundle's own content hash, as the bundle states it. These records carry it and never recompute it. |
| `briefHash` | The UTF-8 bytes of the brief's canonical document (§2), `$type` included. |
| `contentHash` | One line per file of the result, across every screen, in ordinal order of `path`: the file's `path`, one space, its `hash`, and a line feed (`U+000A`). The digest is over the concatenation of those lines; an empty result's lines are the empty string. |

A file's own `hash` is over that file's bytes. No hash is inside the bytes it covers.

## 4. The records

Members are listed with their JSON type. **Required** members must be present; **optional** members
may be absent. A string marked *non-empty* is refused when empty.

### 4.1 `DesignSystemRef`

| Member | Type | | Meaning |
|---|---|---|---|
| `providerId` | string, non-empty | required | The provider's own identifier, an opaque token it chooses. |
| `projectId` | string, non-empty | optional | The provider-side project holding the bundle, for a provider that has projects. |
| `bundleHash` | hash | required | The bundle's content hash (§3). |
| `idlVersion` | integer | required | The vocabulary version the bundle's cards were rendered from. |

### 4.2 `DesignBrief`

| Member | Type | | Meaning |
|---|---|---|---|
| `module` | string, non-empty | required | The module's name. |
| `purpose` | string, non-empty | optional | What the module is for. |
| `dataShapes` | array of data shapes | required | The data the module shows. |
| `tasks` | array of non-empty strings | required | The tasks a user performs in the module. |
| `interactions` | array of interactions | required | The interactions the module offers (§4.5). |
| `viewports` | array of viewports | required | The viewports the design is made for. |
| `density` | density | optional | The density the design is made at (§4.5). |
| `fragments` | array of non-empty strings | required | The stdlib fragments the design may use, by name. |
| `designSystem` | `DesignSystemRef` members | required | The design system the design is composed from. |

A **data shape** is an object with `name` (non-empty string), `type` (non-empty string, the type's
name) and `cardinality` (§4.5), all required. A **viewport** is an object with `name` (non-empty
string) and `width` (integer, CSS pixels, greater than zero), both required.

### 4.3 `DesignRequest`

| Member | Type | | Meaning |
|---|---|---|---|
| `briefHash` | hash | required | The brief's hash (§3). |
| `designSystem` | `DesignSystemRef` members | required | The design system the brief names. |
| `state` | request state | required | Where the request stands (§4.5). |
| `handle` | string, non-empty | optional | The provider's handle for the request, when it issues one. |

### 4.4 `DesignResult`

| Member | Type | | Meaning |
|---|---|---|---|
| `screens` | array of screens | required | The design's screens. |
| `annotations` | array of annotations | optional | Per-screen component inventories, when the provider supplies them. |
| `designSystem` | `DesignSystemRef` members | required | The design system the design was made against. |
| `contentHash` | hash | required | The result's content hash (§3). |

A **screen** is an object with `name` (non-empty string) and `files`, an array of files, both
required. A **file** is an object with `path` (non-empty string, relative to the result), `mediaType`
(non-empty string, a media type such as `text/html`, `text/css` or `image/png`) and `hash` (hash),
all required. An **annotation** is an object with `screen` (non-empty string, a screen's name) and
`components` (array of non-empty strings, each the name of a Components or Fragments card in the
bundle the result was made against), both required.

### 4.5 Closed vocabularies

Each is written as the bare string shown; any other string is refused.

| Vocabulary | Values |
|---|---|
| interaction | `Filter`, `Select`, `Drill`, `Compare`, `Export`, `Navigate` |
| cardinality | `One`, `Optional`, `Many` |
| density | `Compact`, `Standard`, `Spacious` |
| request state | `Manual`, `Pending`, `Ready` |

The interaction vocabulary is closed because every interaction must lower to a construct the
language already has: `Filter` to a filter binding written by a filters control, `Select` to a
selection binding, `Drill` to a navigation carrying the selected key, `Compare` to a selection over
several items read by a second view, `Export` to the invocation of a host capability, and `Navigate`
to a navigation. A design that asks for an interaction outside the set could not be lowered.

`Manual` means the design is made interactively in the tool and retrieved by its declared export;
`Pending` that the provider holds the request and the design is not ready; `Ready` that it is.
Density maps onto the language's weight axis.

## 5. Reading

A reader is **strict on the records and lenient on annotations**, and the asymmetry is deliberate.
A reference, a brief, a request and a result are agreements between two parties, so a disagreement
about them is refused: a missing required member, a member of the wrong JSON type, a value outside a
closed vocabulary, a malformed hash and **an unknown member** are each refused. An annotation is
evidence a provider reports about its own output, so an unknown member of an annotation is
**ignored** — refusing it would discard the rest of the evidence — and a reader that re-encodes the
result writes the annotation without it. A missing required member of an annotation is still
refused.

Where an object repeats a key, the first occurrence is read.

A reader that refuses a document reports a **code** and the **path** of the offending value. A path
is `$` followed by `.member` for an object member and `[n]` for an array element (zero-based). The
codes:

| Code | Refused when |
|---|---|
| `DESIGN_MALFORMED` | The text is not JSON. Path `$`. |
| `DESIGN_WRONG_TYPE` | A value is not the JSON type its member requires, or a document's `$type` names another record (path `$.$type`). |
| `DESIGN_MISSING_MEMBER` | A required member is absent; the path names the absent member. |
| `DESIGN_UNKNOWN_MEMBER` | A record outside an annotation carries a member it does not declare; the path names that member. |
| `DESIGN_UNKNOWN_INTERACTION` | An interaction is outside §4.5's vocabulary. |
| `DESIGN_UNKNOWN_TOKEN` | A cardinality, density or request state is outside its vocabulary. |
| `DESIGN_BAD_HASH` | A hash is not spelled as §3 requires. |
| `DESIGN_OUT_OF_RANGE` | A non-empty string is empty, or a viewport width is not greater than zero. |
| `DESIGN_SYSTEM_MISMATCH` | An exchange's result names a different `bundleHash` than its request (§6). Path `$.result.designSystem.bundleHash`. |

A document's `$type` is checked before its other members, so a document of another record is
refused as `DESIGN_WRONG_TYPE` rather than as a list of unknown members. A document with several
defects is refused for one of them; which one is not specified, and every reject vector carries one
defect.

## 6. The exchange rule

A result answers the request it was fetched for only when both name the same `bundleHash`: a design
made against another bundle was composed from parts the request did not agree to. The corpus states
the rule over an **exchange document**, an object with `"$type": "DesignExchange"` and two required
members, `request` (a `DesignRequest` document) and `result` (a `DesignResult` document), each
carrying its own `$type`. A reader decodes both, then refuses `DESIGN_SYSTEM_MISMATCH` when the rule
fails. An exchange document is the corpus's statement of the rule, not a fifth record a provider
sends.

## 7. Conformance corpus

The `design/` family is listed in the root `manifest.json`. Each row names a `decoder`, the entry
point a reader invokes: `design-system-ref`, `design-brief`, `design-request` and `design-result`
for the four record documents, and `design-exchange` for an exchange document.

- **`design-seam-round-trip`** — decode `inputFile` with the named entry point, re-encode, and
  produce bytes equal to `expectedFile`. For every vector but one, `expectedFile` is `inputFile`.
  The exception is the annotation-leniency vector, whose input carries an unknown annotation member
  and whose `expectedFile` is the same result without it (§5).
- **`design-seam-reject`** — decode `inputFile` with the named entry point and refuse it with exactly
  `expectedErrorCode` at exactly `expectedPath`. A refusal for another reason, or at another path, is
  not a pass.

For each record the family carries a vector with every member present, a vector with every optional
member absent, and a minimal vector (every optional member absent and every list empty). For a
`DesignSystemRef`, whose only list-free optional member is `projectId`, the minimal and the
every-optional-absent vectors are one document.

**A provider is certified** by producing documents a reader decodes and re-encodes byte-identically
under this document, and by reading this family: every round-trip vector to its expected bytes and
every reject vector to its named refusal. A second provider is certified by the same vectors as the
first, not by resembling it.

## Appendix A (non-normative): the reference emitter

The family's vectors are written by the reference host's corpus emitter, which proves each one
against its own codec before writing it; `corpus-producers.json` names the emitter and the command
that runs it.
