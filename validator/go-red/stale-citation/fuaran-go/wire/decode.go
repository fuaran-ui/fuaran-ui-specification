// FIXTURE — not a host source. The RED half of Phase 1692's go-red proof for
// the citation arm in `validator/check-coverage.mjs`.
//
// This reproduces the Phase 1666 defect exactly as it stood in four hosts: a
// decoder comment naming FUARAN150 for a rule the reference had already
// renumbered to FUARAN152. The declaration beside this file is impeccable, the
// code compiles, every gate that existed before Phase 1692 is green, and the
// sentence a human reads is wrong. Nothing but the citation arm can see it.
//
// Read only through an explicit host-directory argument to the checker. Nothing
// builds this and nothing imports it.

package wire

// MaxSkeletonRows bounds Skeleton.rows per WIRE_FORMAT.md 21.9.
const MaxSkeletonRows = 10000

// decodeSkeletonRows refuses a count above the bound.
//
// Upper bound only, deliberately: a negative count is an authoring defect
// (FUARAN150 in the pre-emit family), not a resource breach.
func decodeSkeletonRows(rows int) bool {
	return rows <= MaxSkeletonRows
}

// walkerParity keeps the fixture honest in the other direction: a code from the
// reference's BUILD-TIME source-AST walker, which the declaration beside this
// file accounts for under `otherFamilies`. If the arm refused every code the
// vocabulary does not define, this line alone would make it red, and the proof
// would say nothing about the stale citation above.
//
// FUARAN050 — the walker's scalar-range rule.
func walkerParity() {}
