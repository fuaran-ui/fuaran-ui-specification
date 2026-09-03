# `sparkline-lowering/` — the `Sparkline` render-lowering contract

A `Sparkline` carries a bare bound series and nothing else. Every host that draws one therefore has
to turn that series into geometry, and this family fixes **exactly what geometry**, so the picture is
the same everywhere rather than the same by coincidence.

It is the `chart-lowering/` family's shape applied to the one geometry-bearing kind that never had
it: `<name>.input.json` carries the neutral input, `<name>.expected.json` carries the canonical wire
JSON of the `Drawing` node the lowering must produce. Like `chart-lowering/`, this family is a
**render** contract rather than a codec one, so it is deliberately not indexed by the root
[`manifest.json`](../manifest.json) — a codec runner dispatches on that manifest's `kind`, and a
lowering is not a round-trip.

**This changes no wire vocabulary.** `Sparkline` keeps its `$type`, its schema branch and its
`manifest.kinds` entry; the `nodes/spark-1.json` and `nodes/spark-nonfinite-sentinel.json` fixtures
are untouched. What moves is `render-fidelity.json`, where `Sparkline` is now `"class": "none"` —
the parity-checked fallback is the whole render, as it has been for `Drawing`.

## The input

```json
{ "series": [1, 2, 3, 2, 4] }
```

`series` is the **resolved** value of `SparklineSpec.source` — a host runs its own binding resolution
first, so no fixture here carries a binding. A non-finite element is the same string sentinel the
wire format spells it as everywhere else (`"NaN"` / `"Infinity"` / `"-Infinity"`), which is what
`nodes/spark-nonfinite-sentinel.json` already carries, so a runner reads this family with the decoder
it already has.

## The expected output

The canonical wire JSON of a `Drawing` node whose `id` is `sparkline-<name>`.

**A case with nothing to draw emits the JSON literal `null`.** An empty (or absent) series has no
polyline, and the fallback a host renders instead — its own hook element carrying an em-dash — is a
*host* element rather than a `Shape`, so the lowering cannot express it and must not pretend to by
emitting an empty canvas. `null` is that fact, and it invents no vocabulary: a runner that reads
`null` asserts its host drew no drawing and fell back.

## The geometry

Over a series of `n` values with `min` and `max`:

| | |
|---|---|
| canvas | `viewBox="0 0 100 30"` |
| `range` | `max - min`, or **`1.0` when `max - min < 1e-9`** — a constant series sits on its own line rather than dividing by zero |
| `x` | `i / (n - 1) * 100`, and **`50` when `n = 1`** — a lone point is centred |
| `y` | `30 - (v - min) / range * 28 - 1` — one unit of inset at each edge, so a peak is not clipped by the stroke |
| rounding | round-half-up to 2 decimal places, on both coordinates |
| chrome | one `Polyline`, `stroke="currentColor"`, `stroke-width="1.5"`, no fill (the open-shape default) |
| title / desc | **none** — a sparkline has no spec to generate a summary from, so it carries no accessible name of its own |

Non-finite values are **not** special-cased: they propagate through that arithmetic, reach the wire
as the string sentinels above, and render as `0` through the drawing builder's number form. The
`nonfinite-sentinel` vector pins the result — this input class is where a hand-copied decode path
drifts first, and a pinned contract is what makes such a divergence a failing test rather than an
argument.

## The vectors

| Vector | What it fixes |
|---|---|
| `normal` | the ordinary case — the series `nodes/spark-1.json` carries |
| `two-points` | `n = 2`, the smallest series the `i / (n - 1)` term is defined for |
| `single-point` | `n = 1` — the centring rule, not a division by zero |
| `flat` | `max - min = 0` — the flat guard |
| `flat-boundary` | a range just inside `1e-9`, so the guard decides the picture rather than the arithmetic happening to agree |
| `empty` | nothing to draw — the `null` case above |
| `nonfinite-sentinel` | the sentinel elements, propagated rather than filtered |

## Forward coupling

A change to the geometry, the chrome or the rounding updates the reference lowering, these vectors
**and** every host certified against them, in one change-set. A vector regenerated on its own is a
contract nobody has met yet; a lowering changed on its own is a contract quietly broken.
