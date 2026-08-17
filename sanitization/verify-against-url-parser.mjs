#!/usr/bin/env node
// Check every `url-floor` case's declared `reason` against a WHATWG-conformant URL
// parser, rather than trusting the note beside it.
//
// This is the corpus checking ITSELF, not a host checking the corpus. The
// `off-origin` / `same-origin` claims are what make the family meaningful — a
// fixture asserting "the floor must reject this" is worthless if the payload does
// not actually reach another origin — and they are exactly the claims that are
// easy to get subtly wrong by reading a specification rather than resolving the
// string. Node's `URL` implements the URL Standard, so it is the same oracle the
// notes cite.
//
//   node sanitization/verify-against-url-parser.mjs [path/to/manifest.json]
//
// Exits non-zero on any mismatch. Requires only Node (no build step, no deps), so
// a host in any language can run it as a corpus-integrity check.
import { readFileSync } from 'node:fs';

const BASE = 'https://good.example/page';
const BASE_ORIGIN = 'https://good.example';
const manifestPath = process.argv[2] ?? new URL('./manifest.json', import.meta.url);
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

let checked = 0;
let bad = 0;
for (const group of manifest.groups) {
  for (const c of group.cases) {
    // Only cases that make a URL claim are checkable against a URL parser. A
    // case carries `reason` exactly when it asserts where the payload resolves;
    // the markdown, text and attribute groups assert something else entirely
    // (that a payload does not survive as live markup), and resolving their
    // payloads as URLs would be meaningless rather than merely unhelpful. Keying
    // on the field rather than the group id means a future group that DOES make a
    // URL claim is checked without editing this script.
    if (c.reason === undefined) continue;
    checked++;
    let origin, scheme;
    try {
      const u = new URL(c.input, BASE);
      origin = u.origin;
      scheme = u.protocol;
    } catch {
      origin = 'THROW';
      scheme = 'THROW';
    }

    // What the parser actually does with this payload. The empty and
    // whitespace-only cases resolve to the base document itself, which is
    // same-origin — their declared reason, so they need no special case.
    let actual;
    if (scheme === 'javascript:' || scheme === 'vbscript:') actual = 'scheme-refused';
    else if (origin === BASE_ORIGIN) actual = 'same-origin';
    else actual = 'off-origin';

    // A case flagged `overRejects` is one where the floor deliberately refuses
    // something the parser resolves harmlessly — rule 2's below-U+0020 scheme
    // strip is stricter than rule 1's TAB/LF/CR removal, and over-rejection is the
    // safe direction. Asserting the parser DOES resolve it same-origin keeps the
    // flag honest: it cannot be used to wave through a fixture that is simply wrong.
    const ok = c.overRejects ? actual === 'same-origin' : actual === c.reason;
    if (!ok) {
      bad++;
      console.log(
        `MISMATCH ${c.id}\n  input    ${JSON.stringify(c.input)}\n  declared ${c.reason}${c.overRejects ? ' (overRejects)' : ''}\n  parser   ${actual} (origin=${origin}, scheme=${scheme})`
      );
    }
  }
}
console.log(`${checked} cases checked against the WHATWG URL parser, ${bad} mismatched`);
process.exit(bad === 0 ? 0 : 1);
