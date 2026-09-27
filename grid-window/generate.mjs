#!/usr/bin/env node
// The `grid-window/` behaviour vectors (WIRE_FORMAT.md, "Row window and declared
// total", Phase 1892) — which rows a DataGrid's row window presents.
//
//   node grid-window/generate.mjs           rewrite grid-window-vectors.json
//   node grid-window/generate.mjs --check   exit 1 if the committed file differs
//
// The expected answers are computed HERE, straight from the specification's
// rules — the usable-descriptor test, the sort, the page slice, the clamp and
// the who-slices table — and independently of every host. Each host then runs
// the same inputs through ITS OWN descriptor reader, sort, page slice and window
// function, and must agree. So a vector is the specification's answer, not the
// reference host's, and a host that matched the reference by sharing its bug
// would still go red here.
//
// Two values are written as JSON floats on purpose (`20.0`, `5.0`): a store may
// hold an integral number in either spelling, and the specification reads both
// as an integer. JavaScript has no float spelling of an integer, so those two
// are spliced into the text after serialisation rather than lost in it.

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, 'grid-window-vectors.json')

// A raw JSON number spelling, spliced in after serialisation.
const RAW = (text) => ({ __raw: text })
const valueOf = (v) => (v && typeof v === 'object' && '__raw' in v ? Number(v.__raw) : v)

const integer = (v) => {
  v = valueOf(v)
  return typeof v === 'number' && Number.isInteger(v) ? v : null
}

// The usable-descriptor test: an object whose offset is an integer >= 0 and
// whose count is an integer >= 1. Anything else is NO window.
function usable(desc) {
  if (desc === null || typeof desc !== 'object' || Array.isArray(desc)) return null
  const o = 'offset' in desc ? integer(desc.offset) : null
  const c = 'count' in desc ? integer(desc.count) : null
  if (o === null || c === null || o < 0 || c < 1) return null
  return { offset: o, count: c }
}

function expected(input) {
  let rows = [...input.rows]
  if (input.sort) {
    const field = input.columns[input.sort.column]
    const sign = input.sort.direction === 'desc' ? -1 : 1
    rows.sort((a, b) => sign * (a[field] - b[field]))
  }
  if (input.slicing === 'client' && input.page) {
    const { size, page } = input.page
    const last = Math.max(1, Math.ceil(rows.length / size))
    const p = Math.min(Math.max(1, page), last)
    rows = rows.slice((p - 1) * size, p * size)
  }
  const w = 'window' in input ? usable(input.window) : null
  if (input.slicing === 'hostWindows') {
    let total = 'rowTotal' in input ? integer(input.rowTotal) : null
    if (total !== null && total < 0) total = null
    return { offset: w ? w.offset : 0, rowIds: rows.map((r) => r.id), total, windowed: true }
  }
  const n = rows.length
  if (!w) return { offset: 0, rowIds: rows.map((r) => r.id), total: n, windowed: false }
  const offset = Math.min(w.offset, Math.max(0, n - w.count))
  return { offset, rowIds: rows.slice(offset, offset + w.count).map((r) => r.id), total: n, windowed: true }
}

const pad = (i, w) => String(i).padStart(w, '0')
const base = Array.from({ length: 50 }, (_, i) => ({
  id: `r${pad(i, 2)}`,
  region: i % 2 === 0 ? 'north' : 'south',
  score: (i * 37) % 101,
}))
const north = base.filter((r) => r.region === 'north')
const columns = ['id', 'region', 'score']

const V = (id, description, input) => {
  const full = { slicing: 'client', columns, ...input }
  return { id, description, input: full, expected: expected(full) }
}

const vectors = [
  V('window-start', 'The first window: offset 0 presents the first count rows of the range.', { rows: base, window: { offset: 0, count: 10 } }),
  V('window-middle', 'A window in the middle of the range presents exactly count rows from its offset.', { rows: base, window: { offset: 20, count: 10 } }),
  V('window-end', 'The last full window: offset n - count reaches the final row.', { rows: base, window: { offset: 40, count: 10 } }),
  V('window-overlapping-end', 'A window that overlaps the end clamps back to the last full window rather than presenting a short one.', { rows: base, window: { offset: 45, count: 10 } }),
  V('window-past-total', 'A window past the total (a filter shrank the set under a scrolled viewport) presents the last full window, never an empty grid.', { rows: base, window: { offset: 120, count: 10 } }),
  V('window-wider-than-range', 'A window wider than the range clamps to offset 0 and presents every row.', { rows: base, window: { offset: 5, count: 80 } }),
  V('window-empty-range', 'An empty range presents nothing, at offset 0, with a total of 0.', { rows: [], window: { offset: 10, count: 5 } }),
  V('window-under-sort-and-filter', "The window indexes the SORTED, FILTERED rows the reader sees: the range is a filter's output (the even ids), sorted by score descending, and offset 5 is the sixth row in that order, not the source's sixth row.", { rows: north, sort: { column: 2, direction: 'desc' }, window: { offset: 5, count: 5 } }),
  V('window-under-sort-past-total', 'A sorted, filtered range with the window left past its end: the last full window of the sorted order.', { rows: north, sort: { column: 2, direction: 'asc' }, window: { offset: 30, count: 4 } }),
  V('window-integral-floats', 'Integral floats are integers: {"offset":20.0,"count":5.0} is the window (20, 5).', { rows: base, window: { offset: RAW('20.0'), count: RAW('5.0') } }),
  V('window-within-page', 'The window ranges over the page: page 2 of 20 holds r20..r39, and offset 5 within it is r25.', { rows: base, page: { size: 20, page: 2 }, window: { offset: 5, count: 10 } }),
  V('no-window-descriptor-absent', 'No descriptor in State: no window, and the grid presents every row it would have without the field.', { rows: base.slice(0, 12) }),
  V('no-window-negative-offset', 'A negative offset is not a usable descriptor: no window.', { rows: base.slice(0, 12), window: { offset: -1, count: 5 } }),
  V('no-window-zero-count', 'A count below 1 names no window: no window.', { rows: base.slice(0, 12), window: { offset: 0, count: 0 } }),
  V('no-window-fractional-offset', 'A fractional offset is not an integer: no window.', { rows: base.slice(0, 12), window: { offset: 2.5, count: 5 } }),
  V('no-window-string-member', 'A member of the wrong type (a string offset) is not a usable descriptor: no window.', { rows: base.slice(0, 12), window: { offset: '3', count: 5 } }),
  V('no-window-missing-count', 'A descriptor missing a member is not usable: no window.', { rows: base.slice(0, 12), window: { offset: 3 } }),
  V('no-window-not-an-object', 'A descriptor that is not an object (an array) is not usable: no window.', { rows: base.slice(0, 12), window: [0, 10] }),
  V('host-pages-window-within-page', "A host-paged grid holds the page the host returned and windows within it; the window's total is that page's row count, and the declared rowTotal (the whole set) is NOT the window's total.", { slicing: 'hostPages', rows: base.slice(0, 10), window: { offset: 8, count: 5 }, rowTotal: 500 }),
  V('host-windows', "A host-windowed grid slices nothing: the rows are the window the host returned, its position is the descriptor's offset, and its total is the declared rowTotal.", {
    slicing: 'hostWindows',
    rows: Array.from({ length: 10 }, (_, k) => ({ id: `r${pad(100 + k, 3)}`, region: 'north', score: 100 + k })),
    window: { offset: 100, count: 10 },
    rowTotal: 5000,
  }),
  V('host-windows-no-total', 'A host-windowed grid with no declared total: the total is unknown (null), never guessed from the window.', { slicing: 'hostWindows', rows: base.slice(0, 10), window: { offset: 0, count: 10 } }),
  V('host-windows-before-first-descriptor', "A host-windowed grid before the renderer has written a descriptor: the rows are the host's, at offset 0.", { slicing: 'hostWindows', rows: base.slice(0, 10), rowTotal: 50 }),
  V('host-windows-negative-total', 'A declared total that is not an integer >= 0 is no declared total: unknown.', { slicing: 'hostWindows', rows: base.slice(0, 10), window: { offset: 0, count: 10 }, rowTotal: -3 }),
  V('host-windows-fractional-total', 'A fractional declared total is not an integer: unknown.', { slicing: 'hostWindows', rows: base.slice(0, 10), window: { offset: 0, count: 10 }, rowTotal: 12.5 }),
]

const description = [
  'The DataGrid row window (WIRE_FORMAT.md, "Row window and declared total", Phase 1892): which rows a window presents.',
  'SELF-ENUMERATED, on the laws/ precedent: this family is not indexed by the corpus root manifest.json, which indexes the codec families. Generated by generate.mjs beside it, which computes every expected answer from the specification rules rather than from any host.',
  'These are BEHAVIOUR vectors, not byte-parity fixtures: a host asserts the four expected values, not the framing of this file.',
  'To run one: take input.rows as the rows the grid resolved (any filter has already run in the binding). Where input.sort is present, sort them stably, through the host\'s own grid sort, by the column input.columns[sort.column] names in sort.direction.',
  'Where input.slicing is "client" and input.page is present, take that page through the host\'s own page slice (1-based, clamped).',
  'Read input.window as the RAW value held at the grid\'s windowStateKey (the member absent means nothing is held there) and validate it through the host\'s own descriptor reader. Read input.rowTotal as the RAW value the grid\'s rowTotal binding resolved to (absent means there is no binding).',
  'Then run the host\'s window function with host-windowing = (input.slicing == "hostWindows"), passing the declared total only in that case. input.slicing is "client" (the grid holds its whole set), "hostPages" (a Query whose dependsOn names the pageStateKey returned the page in input.rows) or "hostWindows" (a Query whose dependsOn names the windowStateKey returned the window in input.rows).',
  'Assert expected.windowed (a window is in effect), expected.offset (the index of the first presented row in the range), expected.rowIds (the presented rows\' "id" values, in order) and expected.total (the range\'s size, or null where it is unknown). Scores are distinct, so no vector depends on a tie order.',
].join(' ')

const doc = { family: 'gridWindow', version: 1, description, vectors }
const text =
  JSON.stringify(doc, (_, v) => (v && typeof v === 'object' && '__raw' in v ? `@@RAW:${v.__raw}@@` : v), 2).replace(
    /"@@RAW:([^@]+)@@"/g,
    '$1',
  ) + '\n'

if (process.argv.includes('--check')) {
  const committed = readFileSync(out, 'utf8')
  if (committed !== text) {
    console.error('grid-window-vectors.json is stale: run `node grid-window/generate.mjs`')
    process.exit(1)
  }
  console.log(`grid-window: ${vectors.length} vectors, committed file current`)
} else {
  writeFileSync(out, text)
  console.log(`grid-window: wrote ${vectors.length} vectors`)
}
