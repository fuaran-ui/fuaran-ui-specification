#!/usr/bin/env node
// The `grid-window-writer/` behaviour vectors (WIRE_FORMAT.md, "Row window and
// declared total" — the paragraph "The window a viewport writes", Phase 1922) —
// which descriptor an interactive DataGrid viewport writes to its
// `windowStateKey` as it scrolls, resizes and re-renders.
//
//   node grid-window-writer/generate.mjs           rewrite grid-window-writer-vectors.json
//   node grid-window-writer/generate.mjs --check   exit 1 if the committed file differs
//
// The `grid-window/` family beside this one pins the READ half — which rows a
// window presents. This one pins the WRITE half, and only its pure part: the
// measurement a viewport resolved on one step goes in, and the write the step
// owes (or no write) comes out. Measuring the DOM is each host's own business;
// the arithmetic and the dedupe are the part two hosts can disagree about while
// both look right on screen, so they are what a shared script certifies.
//
// The expected answers are computed HERE, straight from the specification's
// rules — the two fallback figures, the floor / ceil arithmetic, the usable-
// descriptor test on the held window and the two-sided dedupe — and
// independently of every host. Each host then runs the same scripts through
// ITS OWN writer and descriptor reader, and must agree.
//
// Two held values are written as JSON floats on purpose (`1.0`, `10.0`): a store
// may hold an integral number in either spelling, and the specification reads
// both as an integer. They are spliced into the text after serialisation, as the
// `grid-window/` generator does.

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, 'grid-window-writer-vectors.json')

// A raw JSON number spelling, spliced in after serialisation.
const RAW = (text) => ({ __raw: text })
const valueOf = (v) => (v && typeof v === 'object' && '__raw' in v ? Number(v.__raw) : v)

const integer = (v) => {
  v = valueOf(v)
  return typeof v === 'number' && Number.isInteger(v) ? v : null
}

// The usable-descriptor test (the same rule the `grid-window/` family pins): an
// object whose offset is an integer >= 0 and whose count is an integer >= 1.
// Anything else is NO window.
function usable(desc) {
  if (desc === null || desc === undefined || typeof desc !== 'object' || Array.isArray(desc) || '__raw' in desc)
    return null
  const o = 'offset' in desc ? integer(desc.offset) : null
  const c = 'count' in desc ? integer(desc.count) : null
  if (o === null || c === null || o < 0 || c < 1) return null
  return { offset: o, count: c }
}

// The row height assumed where none is measurable, and the viewport height
// assumed where none is measurable (which is also the viewport's height bound).
const DEFAULT_ROW_HEIGHT = 32
const DEFAULT_VIEWPORT_HEIGHT = 480

// The window a viewport shows: the first row whose top edge is at or above the
// scroll offset below the header, and how many rows the viewport's height holds,
// rounded up so a partly visible last row is in the window.
function measure(m) {
  const row = m.rowHeight !== undefined && m.rowHeight > 0 ? m.rowHeight : DEFAULT_ROW_HEIGHT
  const viewport = m.viewportHeight !== undefined && m.viewportHeight > 0 ? m.viewportHeight : DEFAULT_VIEWPORT_HEIGHT
  return {
    offset: Math.max(0, Math.floor((m.scrollTop - m.headerHeight) / row)),
    count: Math.max(1, Math.ceil(viewport / row)),
  }
}

const same = (a, b) => a !== null && b !== null && a.offset === b.offset && a.count === b.count

// Run one script exactly as the family's description prescribes.
function expected(input) {
  let held = 'held' in input ? usable(input.held) : null
  let lastWritten = null
  const writes = []
  for (const step of input.steps) {
    if ('held' in step) held = usable(step.held)
    if (input.windowStateKey === undefined) {
      writes.push(null)
      continue
    }
    const next = measure(step.measure)
    if (same(lastWritten, next) || same(held, next)) {
      writes.push(null)
      continue
    }
    lastWritten = next
    held = next // the write is reflected into State, as SetState does
    writes.push(next)
  }
  return { writes }
}

const V = (id, description, input) => {
  const full = { windowStateKey: 'grid-window', ...input }
  if (full.windowStateKey === null) delete full.windowStateKey
  return { id, description, input: full, expected: expected(full) }
}

// A measurement over 32px rows under a 40px header — the common case.
const at = (scrollTop, viewportHeight) => ({ measure: { scrollTop, headerHeight: 40, rowHeight: 32, viewportHeight } })

const scroll = [
  at(0, 320),
  at(10, 320),
  at(40, 320),
  at(72, 320),
  at(72, 320),
  at(400, 320),
  at(1000, 320),
  at(1000, 160),
]

const vectors = [
  V('mount-writes-the-first-window', 'The first measurement (the mount) writes the window the viewport shows: rows 0..9 of 32px rows in a 320px viewport.', {
    steps: [at(0, 320)],
  }),
  V(
    'scripted-scroll',
    'A scroll, a re-render at rest and a resize: one write per changed window, in step order, and no write for a step whose window is unchanged (still row 0 at the top; the header scrolled away with row 0 still first; a re-render at rest).',
    { steps: scroll },
  ),
  V('no-window-key-never-writes', 'A grid that declares no windowStateKey never writes, whatever the viewport measures.', {
    windowStateKey: null,
    steps: [...scroll, { measure: { scrollTop: 5000, headerHeight: 0 } }],
  }),
  V('held-window-is-not-written-again', 'A window State already holds is not written again: the seeded (1, 10) is what the viewport measures at both steps.', {
    held: { offset: 1, count: 10 },
    steps: [at(72, 320), at(90, 320)],
  }),
  V('held-integral-floats', 'A held window spelled with integral floats ({"offset":1.0,"count":10.0}) IS the window (1, 10): nothing is written.', {
    held: { offset: RAW('1.0'), count: RAW('10.0') },
    steps: [at(72, 320)],
  }),
  V('held-malformed-is-no-window', 'A held value that is not a usable descriptor (a negative offset) holds no window, so the mount writes.', {
    held: { offset: -1, count: 10 },
    steps: [at(0, 320)],
  }),
  V('unmeasurable-falls-back-to-defaults', 'Nothing measurable (no row rendered, no layout): the writer assumes 32px rows and a 480px viewport, so scroll offset 64 is row 2 and the count is 15.', {
    steps: [{ measure: { scrollTop: 64, headerHeight: 0 } }],
  }),
  V('zero-figures-are-unmeasurable', 'A row or viewport height of 0 is "not measurable", exactly as an absent one is: the same two defaults apply.', {
    steps: [{ measure: { scrollTop: 100, headerHeight: 0, rowHeight: 0, viewportHeight: 0 } }],
  }),
  V('partly-visible-last-row-counts', 'The count rounds UP: a 330px viewport over 32px rows shows ten whole rows and part of an eleventh, so the count is 11.', {
    steps: [{ measure: { scrollTop: 0, headerHeight: 40, rowHeight: 32, viewportHeight: 330 } }],
  }),
  V('fractional-figures', 'Fractional pixel figures: (500 - 41.25) / 33.5 floors to row 13, and 400 / 33.5 rounds up to a count of 12.', {
    steps: [{ measure: { scrollTop: 500, headerHeight: 41.25, rowHeight: 33.5, viewportHeight: 400 } }],
  }),
  V('scroll-within-the-header-is-offset-zero', 'A scroll offset still inside the header is row 0, never a negative offset; a viewport shorter than one row still holds a count of 1.', {
    steps: [{ measure: { scrollTop: 20, headerHeight: 40, rowHeight: 32, viewportHeight: 10 } }],
  }),
  V(
    'external-write-of-the-measured-window',
    'Another writer (a pager, a restored session) puts the measured window into State before the viewport does: the viewport does not write it again, and its last-written window is unchanged, so a later scroll back to the top writes again.',
    {
      steps: [at(0, 320), { held: { offset: 1, count: 10 }, ...at(72, 320) }, at(400, 320), at(0, 320)],
    },
  ),
  V(
    'external-write-under-an-unchanged-viewport',
    'Another writer moves State away from the window the viewport last wrote, and the viewport has not moved: nothing is written, because the measured window equals the one last written. The viewport writes again only when its own measurement changes.',
    {
      steps: [at(72, 320), { held: { offset: 5, count: 10 }, ...at(72, 320) }, at(400, 320)],
    },
  ),
]

const description = [
  'The DataGrid window WRITER (WIRE_FORMAT.md, "Row window and declared total", the paragraph "The window a viewport writes", Phase 1922): which descriptor an interactive grid viewport writes to its windowStateKey on each scroll, resize and render. The grid-window/ family beside it pins the read half.',
  'SELF-ENUMERATED, on the laws/ precedent: this family is not indexed by the corpus root manifest.json, which indexes the codec families. Generated by generate.mjs beside it, which computes every expected answer from the specification rules rather than from any host.',
  'These are BEHAVIOUR vectors, not byte-parity fixtures: a host asserts expected.writes, not the framing of this file. A host whose grid viewport writes the descriptor runs every vector through its OWN pure writer; a static host, which writes nothing, does not run the family.',
  'To run one: input.windowStateKey is the key the grid declares (absent means it declares none). Read input.held as the RAW value State holds at that key before the first step (absent means nothing is held) through the host\'s own descriptor reader. Start with no last-written window.',
  'Then for each entry of input.steps, in order: where the step carries a held member, first read it the same way as the window State now holds (another writer moved it). Run the writer over step.measure — scrollTop, the viewport\'s scroll offset; headerHeight, the table head\'s height (0 where there is none); rowHeight and viewportHeight, where an absent member or a figure of 0 or less means "not measurable", all in CSS pixels. A viewport that measured a row earlier may carry that height forward instead of the default; these vectors pin the writer, which receives the figure the viewport resolved.',
  'The step writes nothing where the grid declares no key, or where the measured window equals the window last written or the window State holds; otherwise it writes the measured window, which becomes both the last-written window and the window State holds (the write is reflected into State, as SetState does).',
  'Assert expected.writes: one entry per step, the written descriptor {"offset", "count"} or null where the step writes nothing.',
].join(' ')

const doc = { family: 'gridWindowWriter', version: 1, description, vectors }
const text =
  JSON.stringify(doc, (_, v) => (v && typeof v === 'object' && '__raw' in v ? `@@RAW:${v.__raw}@@` : v), 2).replace(
    /"@@RAW:([^@]+)@@"/g,
    '$1',
  ) + '\n'

if (process.argv.includes('--check')) {
  const committed = readFileSync(out, 'utf8')
  if (committed !== text) {
    console.error('grid-window-writer-vectors.json is stale: run `node grid-window-writer/generate.mjs`')
    process.exit(1)
  }
  console.log(`grid-window-writer: ${vectors.length} vectors, committed file current`)
} else {
  writeFileSync(out, text)
  console.log(`grid-window-writer: wrote ${vectors.length} vectors`)
}
