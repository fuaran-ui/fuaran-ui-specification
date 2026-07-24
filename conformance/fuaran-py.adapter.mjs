// ============================================================================
//  The Python reference implementation's certification adapter.
//
//  The Python-host counterpart to fuaran-ts's examples/fuaran-ts-ops.adapter.mjs
//  — the worked example proving the Phase 168 kit's language-agnostic claim: a
//  host in any language certifies through a thin JS bridge without the kit
//  taking a dependency on it. This adapter shells the Python codec via the
//  stdio bridge (fuaran_py.conformance.bridge, JSON in / JSON out), so the kit
//  runner drives the real Python decoder + encoder exactly as it drives the TS
//  ops package.
//
//  Values cross the kit's adapter seam as opaque `unknown`: the runner only
//  passes a decoded value back into the host's own encoder. This bridge carries
//  the input wire text across as that opaque token, and encodeNode/encodeOp
//  decode+re-encode it in Python — so both the Python decoder AND encoder are
//  genuinely exercised through the seam.
//
//  Run against the built kit CLI (from fuaran-ts/packages/conformance/, after
//  `pnpm build`):
//
//    node dist/cli.js ../../../wire-format-fixtures/conformance/fuaran-py.adapter.mjs
//
//  Requires: the Python host importable (`pip install -e ../../fuaran-py`, or a
//  PYTHONPATH pointing at fuaran-py/src). Override the interpreter with
//  FUARAN_PY_PYTHON (e.g. a venv python), and the module root with FUARAN_PY_ROOT.
// ============================================================================

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// conformance/ → wire-format-fixtures/ → workspace root → fuaran-py/src
const pySrc = process.env.FUARAN_PY_ROOT ?? join(here, '..', '..', 'fuaran-py', 'src');
const python = process.env.FUARAN_PY_PYTHON ?? 'python';

if (!existsSync(pySrc)) {
  throw new Error(
    `fuaran-py source root not found at ${pySrc}. Set FUARAN_PY_ROOT to the fuaran-py/src ` +
      `directory, or check out fuaran-py side-by-side in the canonical workspace layout.`,
  );
}

/** One synchronous round-trip through the Python stdio bridge. */
function call(op, input) {
  const stdout = execFileSync(python, ['-m', 'fuaran_py.conformance.bridge'], {
    input: JSON.stringify({ op, input }),
    env: { ...process.env, PYTHONPATH: pySrc + (process.env.PYTHONPATH ? `${process.platform === 'win32' ? ';' : ':'}${process.env.PYTHONPATH}` : '') },
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

/** decodeNode/decodeOp: return the input as the opaque token on success. */
function decode(op, json) {
  const res = call(op, json);
  return res.ok ? { ok: true, value: json } : { ok: false, error: res.error };
}

/** encodeNode/encodeOp: the opaque token is the input wire text — Python decodes+re-encodes it. */
function encode(op, value) {
  const res = call(op, value);
  if (!res.ok) throw new Error(`fuaran-py ${op} failed on a value it had decoded: ${JSON.stringify(res.error)}`);
  return res.value;
}

export const adapter = {
  decodeNode: (json) => decode('decodeNode', json),
  encodeNode: (value) => encode('encodeNode', value),
  decodeOp: (json) => decode('decodeOp', json),
  encodeOp: (value) => encode('encodeOp', value),
};

export const implementation = { name: 'fuaran-py', version: '0.0.1' };
