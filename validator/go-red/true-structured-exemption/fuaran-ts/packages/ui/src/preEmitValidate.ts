// FIXTURE — not a host implementation, and not compiled by anything.
//
// The TRUE half of Phase 1659's go-red proof: an honest structured host. Every
// finding below is a discriminant plus typed fields, so the exemption beside it is
// exact and the checker must say so.
//
// It is also the false-positive guard, and that is the harder half. Each of the
// following appears here deliberately, and none of it is prose at a finding:
//
//   * FUARAN083 and FUARAN047 named in comments, with `backticked` type names and
//     an apostrophe in the author's own sentence;
//   * a `//` and a `/*` inside a string literal that is NOT at a finding site;
//   * a slot name (`'label'`) and a SCREAMING_SNAKE discriminant, both string
//     literals at a finding site and neither of them a sentence;
//   * a prose string literal in a function that constructs no finding at all.
//
// A scan that reports any of these has accused an honest host, which costs this
// contract as much as believing a false claim does.

/** A pre-emit defect. FUARAN047's case is `TAB_HEADER_COUNT_MISMATCH`. */
export type PreEmitDefect =
  | { readonly code: 'EMPTY_NODE_ID' }
  | { readonly code: 'EMPTY_ACCESSIBILITY_DECLARATION'; readonly nodeId: string; readonly slot: 'label' }
  | { readonly code: 'UNGROUNDED_SWITCH_STATE_KEY'; readonly nodeId: string }
  | {
      readonly code: 'TAB_HEADER_COUNT_MISMATCH';
      readonly nodeId: string;
      readonly headerCount: number;
      readonly childrenCount: number;
    };

/** Not a finding — the consumer's rendering, which is where prose belongs. */
export function docsUrl(): string {
  return 'https://example.invalid/wire-format#12 /* not a comment */ // nor is this';
}

export function describe(d: PreEmitDefect): string {
  // Prose, and legitimately so: this is the CONSUMER's rendering of a structured
  // finding, in a function that constructs nothing. The exemption's claim is about
  // the finding, not about the host.
  return d.code === 'EMPTY_NODE_ID' ? 'an id is the empty string' : 'see the wire format';
}

export function validate(n: {
  id: string;
  stateKey: string;
  ariaLabel: string;
  headers: number;
  children: number;
}): PreEmitDefect[] {
  const defects: PreEmitDefect[] = [];

  if (n.id === '') defects.push({ code: 'EMPTY_NODE_ID' });

  // FUARAN083 (the `Switch` selector rule): an empty key is ungrounded. The author's
  // sentence here carries `backticks` and an apostrophe on purpose.
  if (n.stateKey === '') defects.push({ code: 'UNGROUNDED_SWITCH_STATE_KEY', nodeId: n.id });

  if (n.ariaLabel === '')
    defects.push({ code: 'EMPTY_ACCESSIBILITY_DECLARATION', nodeId: n.id, slot: 'label' });

  if (n.headers !== n.children)
    defects.push({
      code: 'TAB_HEADER_COUNT_MISMATCH',
      nodeId: n.id,
      headerCount: n.headers,
      childrenCount: n.children,
    });

  return defects;
}
