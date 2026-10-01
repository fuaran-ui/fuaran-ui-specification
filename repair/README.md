# `repair/` — deliberate repair of malformed canonical JSON

WIRE_FORMAT.md §28 specifies `repair`: a separate, pure function a caller invokes on a document the
strict decoder refused, which puts right a missing, surplus or wrong-type closing bracket and names every repair
it performs by a stable catalogue id. This family is the catalogue's conformance declaration.

## What a case declares

Each entry in `manifest.json` `cases` names:

| Member | Meaning |
|---|---|
| `inputFile` | the input text, read as UTF-8 bytes with no newline translation |
| `strict` | the strict decoder's answer to the input: `"accept"`, or `{code, path}` |
| `outcome` | `repaired` or `not-repairable` |
| `applied` | (`repaired`) the catalogue ids applied, in order; `[]` for a document that already parses |
| `expectedFile` | (`repaired`) the repaired text, **byte for byte** |
| `repairedDecodes` | (`repaired`) the strict decoder's answer to the repaired text |
| `reason` | (`not-repairable`) the §28.4 refusal token |

A host that implements repair (`hostStatements`: `implements`) certifies every case: the strict
answer, and `repair`'s exact output. A host whose statement is `no-repair` asserts only what its
decoder already asserts elsewhere; §28.5 has no partial implementation. An implementing host also
declares, under `hostCatalogueVersions`, the catalogue version it implements, which is the
`catalogueVersion` this family certifies (version 2 since Phase 1961, which added
`wrong-type-close`; every version-1 case is unchanged).

One more real emission is a case here: `repair-wrong-type-close-eval-emission`, the model output that
motivated `wrong-type-close` (a `}` closing the root children array at the end of the document). It
comes from an evaluation run rather than the stored set, so its input lives in this directory.

The nine real emissions of the `stored-emissions/` family that the catalogue repairs are cases here
too, read from that family's directory; their repaired bytes live here. One of them
(`stored-recovery-over-close-unique-62782c6f2c99a7da`), and the authored
`repair-over-close-after-root`, are the §20.2 row 2 input class: a surplus closer after the root
value, refused by strict decode and returned repaired with `over-close-unique` named.

## Hand-authored

Like `decode-policy/` and `stored-emissions/`, this family is declared in its own manifest, not in the
generated root `manifest.json`. The expected outputs were produced by the reference host's `repair`
and certified byte-identical by the TypeScript host; a change to any of them is a change to the
catalogue, which §28.2 says moves the catalogue version.
