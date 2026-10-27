# `chart-lowering/themed/` — a host-installed palette

The cases here pin the chart lowering under a **host-installed series palette** rather than the
shipped default. Each `<name>.input.json` is the family's neutral input contract plus one
harness-only style selector, `palette`: the series colours, in assignment order. The palette is a
lowering parameter like `axisUnitMode`, not a `ChartSpec` wire field. The matching
`<name>.expected.json` is the canonical `Drawing` the lowering produces under that palette, with
every other style value at its default.

A themed golden differs from its unthemed twin in the parent family (the input minus `palette`)
in the series colours alone. The reference host asserts that byte for byte.

**Who certifies this subfamily.** A host that lets an application install a chart style from its
theme. The parent family's harnesses enumerate their directory non-recursively, so a host with no
install seam is not asked to certify these cases. A palette is validated before it is installed
(the lightness band and chroma floor per slot on both chart surfaces, and the colour-vision and
normal-vision floors over adjacent slots), so every palette here clears those gates.
