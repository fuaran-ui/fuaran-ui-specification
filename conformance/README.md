# Cross-implementation wire-format conformance runner

The mechanical enforcement of the **forward-coupling rule** ([`WIRE_FORMAT.md` §11](../../fuaran/docs/WIRE_FORMAT.md)) **across the three conformant hosts** of the canonical Fuaran UI wire format:

- the **F#** `Fuaran.UI` tier (`CanonicalJson` encoder + `JsonDecode` decoder),
- the **TypeScript** `@fuaran-ui/ops` tier (`encodeNode`/`encodeOp` + `decodeNode`/`decodeOp`), and
- the **Python** `fuaran_py` tier (`fuaran_py.schema` / `fuaran_py.ops` — `decode_node`/`encode_node` + `decode_op`/`encode_op`).

The central claim — _language-neutral contract, F# + TS + Python as sibling implementations_ — depends on all three hosts agreeing **byte-for-byte** on the wire format. This gate makes a divergence **un-mergeable** rather than discipline-maintained. It is wired into CI as [`.github/workflows/wire-conformance.yml`](../../.github/workflows/wire-conformance.yml).

## The three-leg gate

The committed [`wire-format-fixtures/`](..) corpus **is** the F# encoder's canonical output — `Corpus.emit` writes `CanonicalJson.encode*` straight into the `expectedFile` payloads and the F# `DecodeError` code/path straight into `manifest.json`. So the corpus is a serialized F# conformance report, and the gate has three legs that each pin a host to it:

| Leg | Runner | Proves |
|---|---|---|
| **A — F#** | `dotnet run --project fuaran/src/Fuaran.UI.JsonDecode.Tests -c Release` (Expecto: `RoundTrip` + `Reject` + `SchemaConformance`) | The **current** F# encoder/decoder re-produces the committed corpus byte-for-byte, and every payload is schema-valid (+ the stale-schema guard). ⇒ `F# == corpus`. |
| **B — cross-host (TS)** | `node cross-host-conformance.mjs` (this directory) | The TS `@fuaran-ui/ops` codec, run over the same corpus, produces canonical output **byte-identical to the F# canonical form** and **schema-valid** against `schema.json` (off-the-shelf Draft 2020-12 validator, `ajv`). ⇒ `TS == corpus`. |
| **E — Python** | `python -m pytest` in `fuaran-py/` (`test_roundtrip` + `test_reject` + `test_canonical_numbers` + `test_schema_conformance` + `test_bridge` + `test_corpus_sync` + `test_generative_parity`) | The `fuaran_py` codec re-encodes the corpus **byte-identical to the F# canonical form**, surfaces the canonical reject code/path, matches the canonical float layout (§5), re-encodes to **schema-valid** wire (Draft 2020-12, `jsonschema`), and certifies through the kit's stdio bridge. ⇒ `Python == corpus`. |

`A` ⟹ `F# == corpus`, `B` ⟹ `TS == corpus`, and `E` ⟹ `Python == corpus`, therefore **`F# == TS == Python`, byte-for-byte**.

A one-byte divergence in **any** host's encoder fails the gate:

- **TS encoder edit** → Leg B's byte-diff (or schema check) fails here, naming the fixture + host + the first differing byte.
- **Python encoder edit** → Leg E's `test_roundtrip` (or `test_schema_conformance`) fails, naming the fixture + the first differing byte.
- **F# encoder edit** → Leg A's `RoundTrip` re-encode no longer matches the committed corpus (caught by `dotnet run`); or, if the corpus was regenerated alongside, the corpus changes and Legs B/E's host↔corpus diff fails.

### Leg E — Python native harness + kit bridge

Python certifies two ways over the one corpus (both reading the same `manifest.json` + the same `fuaran_py` codec, so they cannot disagree):

- **Native `pytest` harness** — the inner-loop DX, resolving the corpus at `../wire-format-fixtures` (or the committed offline snapshot `fuaran-py/conformance/corpus/`, kept in sync by `fuaran-py/conformance/sync_corpus.py` + the `test_corpus_sync` drift guard).
- **Phase 168 kit bridge** — [`fuaran-py.adapter.mjs`](fuaran-py.adapter.mjs) (this directory) shells the Python codec through a stdio bridge (`fuaran_py.conformance.bridge`, JSON in / JSON out), so the language-agnostic `@fuaran-ui/conformance` kit issues Python the *same* certification report it issues any third-party host — the worked proof of the kit's language-agnostic claim. Run against the built kit CLI:

  ```powershell
  # from fuaran-ts/packages/conformance, after `pnpm build`:
  node dist/cli.js ..\..\..\wire-format-fixtures\conformance\fuaran-py.adapter.mjs
  # override the interpreter / module root when not installed:  $env:FUARAN_PY_PYTHON, $env:FUARAN_PY_ROOT
  ```

## Running locally

```powershell
# 1. Build the TS host so packages/ops/dist exists (uses corepack pnpm; no pnpm.cmd on PATH)
corepack pnpm --dir ..\..\fuaran-ts install
corepack pnpm --dir ..\..\fuaran-ts build

# 2. Install this runner's own deps (ajv) and run the cross-host leg
npm install
npm run conformance

# 3. (the F# leg, for completeness)
dotnet run --project ..\..\fuaran\src\Fuaran.UI.JsonDecode.Tests\Fuaran.UI.JsonDecode.Tests.fsproj -c Release
```

A green run prints `✓ cross-implementation conformance: 85 fixtures …` and exits `0`. Any divergence prints a per-fixture report (fixture id, kind, host, byte offset + a `F#`/`TS` context window with a `^` caret) and exits `1`.

## Negative test (proving the gate bites)

The acceptance criterion is that CI goes red on a one-byte encoder divergence. To reproduce locally without committing a broken host, mutate the built dist, run, and restore:

```powershell
cd ..\..\fuaran-ts\packages\ops\dist
Copy-Item index.js index.js.bak
(Get-Content index.js -Raw).Replace('<closure>','<closurX>') | Set-Content index.js
cd ..\..\..\..\wire-format-fixtures\conformance ; node cross-host-conformance.mjs   # → exit 1, 11 fixtures flagged
Move-Item -Force ..\..\fuaran-ts\packages\ops\dist\index.js.bak ..\..\fuaran-ts\packages\ops\dist\index.js
```

## Generative cross-host parity (Phase 101)

The two-leg gate above pins each host to the **fixed** corpus. [`property-cross-host.mjs`](property-cross-host.mjs) extends parity to the **generated** tree-space the curated fixtures can't reach: the F# FsCheck generators and the TS `fast-check` arbitraries ([`fuaran/src/Fuaran.UI.JsonDecode.Tests/Generators.fs`](../../fuaran/src/Fuaran.UI.JsonDecode.Tests/Generators.fs) / [`fuaran-ts/packages/ops/test/arbitraries.ts`](../../fuaran-ts/packages/ops/test/arbitraries.ts)) cover every DU arm, and the generators emit only the **cross-host-safe** value subspace (plain-decimal int53 floats etc. — `.NET "R"` and JS `toString()` agree there byte-for-byte; see `WIRE_FORMAT.md` §5).

Two extra legs, run after Legs A/B (samples land in the git-ignored `fuzz-samples/`):

| Leg | Runner | Proves |
|---|---|---|
| **C — F# → TS** | `dotnet run … -- --emit-fuzz-samples conformance/fuzz-samples 300` then `node property-cross-host.mjs` | The TS codec decodes + re-encodes each F#-generated canonical sample to bytes **identical** to the F# input (and writes the TS-canonical output to `fuzz-samples/typescript/`). |
| **D — TS → F#** | `dotnet run … -- --check-fuzz-samples conformance/fuzz-samples` | The F# codec decodes + re-encodes each **TS-encoder-produced** sample to bytes identical to the TS input — the converse direction. |

`C` ⟹ TS canonical == F# canonical and `D` ⟹ F# canonical == TS canonical over the generated space, both directions. Within-host idempotence (`encode(decode(encode x)) == encode x`) is asserted separately by the FsCheck / fast-check suites (≥1000 cases each), and by the Python `hypothesis` suite (`fuaran-py/tests/test_generative_parity.py`, ≥1000 cases over the same cross-host-safe subspace). The F# ↔ Python fuzz-sample exchange (the Legs C/D analogue for Python) needs the F#-side `--emit-fuzz-samples` / `--check-fuzz-samples` tooling to read a `fuzz-samples/python/` set — a cross-repo follow-up; the Python within-host generative floor ships now. Run locally:

```powershell
$s = "$PWD\fuzz-samples"
dotnet run --project ..\..\fuaran\src\Fuaran.UI.JsonDecode.Tests\Fuaran.UI.JsonDecode.Tests.fsproj -c Release -- --emit-fuzz-samples $s 300
node property-cross-host.mjs                                                                                   # Leg C (F# → TS)
dotnet run --project ..\..\fuaran\src\Fuaran.UI.JsonDecode.Tests\Fuaran.UI.JsonDecode.Tests.fsproj -c Release -- --check-fuzz-samples $s   # Leg D (TS → F#)
```

## Layout note (separate-repo CI)

`fuaran/`, `fuaran-ts/`, `fuaran-py/`, and the workspace repo (which owns `wire-format-fixtures/` + this runner + the workflow) are **separate git repos** cloned side-by-side. Leg B resolves the TS host at `../../fuaran-ts/packages/ops/dist/index.js`, Leg E resolves the corpus at `../wire-format-fixtures` from `fuaran-py/`, and both resolve the corpus at `..`, so they require the canonical workspace layout on disk. The CI workflow assembles that layout by checking out all repos into the right relative paths — see the workflow's header comment for the cross-repo checkout token requirement.
