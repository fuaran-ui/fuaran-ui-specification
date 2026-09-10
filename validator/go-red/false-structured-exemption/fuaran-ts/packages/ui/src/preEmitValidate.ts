// FIXTURE — not a host implementation, and not compiled by anything.
//
// The FALSE half of Phase 1659's go-red proof. A host source in the reference
// TypeScript idiom whose findings DO carry prose, sitting beside a declaration that
// claims `messageForm: "structured"`. The pre-1659 checker accepts this pairing on
// the strength of the declaration alone; the current one refuses it on the strength
// of this file.
//
// Two refutable shapes are present on purpose, because they are independent: the
// `message` member is prose whatever its value (so a host that assembles the string
// elsewhere is still caught), and the string literal with an interior space is prose
// whatever the member is called.

/** A pre-emit defect. FUARAN083's `Switch` case is `UNGROUNDED_SWITCH_STATE_KEY`. */
export type PreEmitDefect =
  | { readonly code: 'EMPTY_NODE_ID'; readonly message: string }
  | { readonly code: 'UNGROUNDED_SWITCH_STATE_KEY'; readonly nodeId: string; readonly why: string };

export function validate(n: { id: string; stateKey: string }): PreEmitDefect[] {
  const defects: PreEmitDefect[] = [];

  // Shape one — a prose member on the constructed record. FUARAN083 in this comment
  // must not be read as evidence of anything, and neither must the `backticks` here.
  if (n.stateKey === '') {
    defects.push({
      code: 'UNGROUNDED_SWITCH_STATE_KEY',
      nodeId: n.id,
      why: 'stateKey is empty, so the Switch is stuck on its default — name one',
    });
  }

  // Shape two — a prose string literal, under a member the probe does not name.
  if (n.id === '') {
    defects.push({ code: 'EMPTY_NODE_ID', message: 'an id is the empty string; the wire form requires one' });
  }

  return defects;
}
