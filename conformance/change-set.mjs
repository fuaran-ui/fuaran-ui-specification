// ============================================================================
//  The change-set's leg stage (WIRE_FORMAT.md 11.3, Phase 2301).
//
//  `node cross-host-conformance.mjs --roster [options]` — every host in
//  roster.json, certified against ONE corpus: the one FUARAN_WIRE_FIXTURES names
//  (a set-but-missing path is refused, never replaced by a fallback), else the
//  directory above this one. It is the workstation form of the 11.1 gate, and the
//  fourth and fifth steps of the change-set command the reference host's build
//  runs (`dotnet run --project Build.fsproj -- ChangeSet`).
//
//  Before any leg runs, the corpus is checked against the hosts:
//    since      every fixture row carries `since` (11.3's AHEAD grade reads it);
//    families   every codec host's 27 manifest declares corpusFamilies, naming
//               every family the corpus tree enumerates and no other (27.7);
//    snapshots  every bundled corpus copy is the corpus under test (11 step 5).
//  Then each host's leg runs in its own checkout with FUARAN_WIRE_FIXTURES set.
//
//  The verdict is GREEN only when every check passed and every leg ran and
//  passed. A leg the run could not reach (its checkout is absent) is UNRESOLVED
//  and red; a run narrowed with --legs is PARTIAL, never green; a leg bound to
//  another platform is reported by name as n/a here. Exit: 0 green, 1 red,
//  3 partial, 2 refused before running (a bad option or an unreadable corpus).
//
//  Options:
//    --workspace <dir>  where the host checkouts sit (default: the corpus's parent)
//    --legs <a,b>       run only these hosts' legs (development only: PARTIAL)
//    --dry-run          print the plan and run nothing
//    --log-dir <dir>    where each leg's output goes (default: a temp directory)
//    --perturb <id>     the altered-fixture probe: copy the corpus, change one byte
//                       of fixture <id>'s expected payload (one non-canonical space), run the legs against the
//                       copy, and require EVERY leg to go red naming <id>
// ============================================================================

import { spawnSync } from 'node:child_process';
import {
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const CORPUS_ENV = 'FUARAN_WIRE_FIXTURES';

/** The one corpus locator of this directory's runners. */
export const resolveCorpusRoot = (env = process.env) => {
  const named = (env[CORPUS_ENV] ?? '').trim();
  if (named !== '') {
    if (!existsSync(join(named, 'manifest.json')))
      throw new Error(`${CORPUS_ENV} names ${named}, which holds no manifest.json — refusing to fall back`);
    return resolve(named);
  }
  return resolve(here, '..');
};

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

/**
 * The corpus families the tree enumerates (27.7): every distinct root-manifest fixture `kind`,
 * plus every top-level directory carrying its own manifest.json — one family per entry of a
 * non-empty `families` array of objects (as `<dir>/<id>`), else the directory itself.
 */
export const corpusFamilies = (corpusRoot) => {
  const families = new Set(readJson(join(corpusRoot, 'manifest.json')).fixtures.map((f) => f.kind));
  for (const entry of readdirSync(corpusRoot)) {
    const dirPath = join(corpusRoot, entry);
    if (entry.startsWith('.') || entry === 'node_modules' || !statSync(dirPath).isDirectory()) continue;
    const sub = join(dirPath, 'manifest.json');
    if (!existsSync(sub)) continue;
    const declared = readJson(sub).families;
    const objects = Array.isArray(declared) ? declared.filter((f) => f && typeof f === 'object') : [];
    if (objects.length > 0) for (const f of objects) families.add(`${entry}/${f.id}`);
    else families.add(entry);
  }
  return [...families].sort();
};

/** The 11.0 codec hosts, read from the authoritative table (scoped to its section). */
const specCodecHosts = (corpusRoot) => {
  const text = readFileSync(join(corpusRoot, 'WIRE_FORMAT.md'), 'utf8');
  const from = text.indexOf('### 11.0 ');
  const to = text.indexOf('### 11.1 ', from);
  return text
    .slice(from, to)
    .split('\n')
    .filter((l) => l.includes('**codec host**'))
    .map((l) => /^\|\s*`([^`]+)`/.exec(l)?.[1])
    .filter(Boolean)
    .sort();
};

const SEMVER = /^\d+\.\d+\.\d+$/;

const parseArgs = (argv) => {
  const opts = { legs: null, dryRun: false, workspace: null, logDir: null, perturb: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === '--roster') continue;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--legs') opts.legs = value().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--workspace') opts.workspace = value();
    else if (a === '--log-dir') opts.logDir = value();
    else if (a === '--perturb') opts.perturb = value();
    else throw new Error(`unknown option ${a}`);
  }
  return opts;
};

/** Run one shell command in `cwd`, its output appended to `log`; returns the exit code. */
const runLogged = (command, cwd, env, log) => {
  writeFileSync(log, `\n$ ${command}\n`, { flag: 'a' });
  const fd = openSync(log, 'a');
  try {
    const r = spawnSync(command, { cwd, env, shell: true, stdio: ['ignore', fd, fd] });
    return r.status ?? 1;
  } finally {
    closeSync(fd);
  }
};

const tail = (path, n = 40) => readFileSync(path, 'utf8').split('\n').slice(-n).join('\n');

/** Copy the corpus and change one byte of `id`'s expected payload; returns [copy, file]. */
const perturbedCopy = (corpusRoot, id) => {
  const row = readJson(join(corpusRoot, 'manifest.json')).fixtures.find((f) => f.id === id);
  if (!row) throw new Error(`--perturb: no fixture '${id}' in the corpus`);
  const copy = mkdtempSync(join(tmpdir(), 'fuaran-perturb-'));
  cpSync(corpusRoot, copy, {
    recursive: true,
    filter: (src) => !/[\\/](\.git|node_modules)([\\/]|$)/.test(src.slice(corpusRoot.length)),
  });
  const file = row.expectedFile ?? row.inputFile;
  const path = join(copy, file);
  const text = readFileSync(path, 'utf8');
  // One space after the first member colon. A canonical payload usually serves as both input
  // and expected bytes, so a VALUE edit would round-trip consistently; a non-canonical byte
  // survives every decoder and is gone from every re-encode, so each byte-comparing leg sees it.
  const altered = text.replace('":', '": ');
  if (altered === text) throw new Error(`--perturb: '${file}' has no member to alter`);
  writeFileSync(path, altered);
  return [copy, file];
};

export const runRoster = async (argv) => {
  let opts;
  let corpusRoot;
  try {
    opts = parseArgs(argv);
    corpusRoot = resolveCorpusRoot();
  } catch (err) {
    console.error(`change-set: ${err.message}`);
    return 2;
  }
  const roster = readJson(join(here, 'roster.json')).hosts;
  const workspace = resolve(opts.workspace ?? join(corpusRoot, '..'));
  const known = new Set(roster.map((h) => h.id));
  const unknown = (opts.legs ?? []).filter((l) => !known.has(l));
  if (unknown.length > 0) {
    console.error(`change-set: --legs names hosts the roster does not: ${unknown.join(', ')}`);
    return 2;
  }
  const hostDir = (h) => resolve((h.rootEnv && process.env[h.rootEnv]) || join(workspace, h.dir));
  const selected = (h) => opts.legs === null || opts.legs.includes(h.id);

  console.log(`change-set legs — corpus ${corpusRoot}`);
  console.log(`  workspace ${workspace}${opts.perturb ? `   PROBE: perturb '${opts.perturb}'` : ''}`);
  if (opts.dryRun) {
    console.log('  plan (dry run — nothing runs):');
    console.log('    check since      every fixture row of manifest.json carries a semver `since`');
    console.log('    check roster     roster.json codec hosts == WIRE_FORMAT.md 11.0 codec hosts');
    console.log('    check families   corpusFamilies of every codec host == the corpus family set');
    for (const h of roster) {
      const mark = selected(h) ? '' : '   (not selected: the run would be PARTIAL)';
      console.log(`    host ${h.id} [${h.role}] in ${hostDir(h)}${h.platform ? ` (${h.platform} only)` : ''}${mark}`);
      if (h.snapshot) console.log(`      snapshot: ${h.snapshot}`);
      for (const c of h.leg) console.log(`      leg: ${c}`);
    }
    return 0;
  }

  const logDir = resolve(opts.logDir ?? mkdtempSync(join(tmpdir(), 'fuaran-change-set-')));
  mkdirSync(logDir, { recursive: true });
  const checks = [];
  const check = (name, problems) => {
    checks.push({ name, ok: problems.length === 0, problems });
  };

  let probeFile = null;
  if (opts.perturb) {
    try {
      [corpusRoot, probeFile] = perturbedCopy(corpusRoot, opts.perturb);
    } catch (err) {
      console.error(`change-set: ${err.message}`);
      return 2;
    }
    console.log(`  probe corpus ${corpusRoot} (${probeFile} altered)`);
  } else {
    const fixtures = readJson(join(corpusRoot, 'manifest.json')).fixtures;
    check(
      'since',
      fixtures.filter((f) => !SEMVER.test(f.since ?? '')).map((f) => `${f.kind}/${f.id} carries no semver \`since\``),
    );
    const spec = specCodecHosts(corpusRoot);
    const rostered = roster.filter((h) => h.role === 'codec').map((h) => h.id).sort();
    check(
      'roster',
      JSON.stringify(spec) === JSON.stringify(rostered)
        ? []
        : [`WIRE_FORMAT.md 11.0 codec hosts [${spec}] but roster.json codec hosts [${rostered}]`],
    );
    const families = corpusFamilies(corpusRoot);
    const familyProblems = [];
    for (const h of roster.filter((r) => r.role === 'codec')) {
      if (!h.capabilityManifest) {
        familyProblems.push(`${h.id}: the roster names no capability manifest for a codec host`);
        continue;
      }
      const path = join(hostDir(h), h.capabilityManifest);
      if (!existsSync(path)) {
        familyProblems.push(`${h.id}: no capability manifest at ${path}`);
        continue;
      }
      const declared = readJson(path).corpusFamilies;
      if (declared === null || typeof declared !== 'object') {
        familyProblems.push(`${h.id}: ${h.capabilityManifest} declares no corpusFamilies`);
        continue;
      }
      const missing = families.filter((f) => !(f in declared));
      const extra = Object.keys(declared).filter((f) => !families.includes(f));
      if (missing.length) familyProblems.push(`${h.id}: omits ${missing.join(', ')}`);
      if (extra.length) familyProblems.push(`${h.id}: names families the corpus does not enumerate: ${extra.join(', ')}`);
    }
    check('families', familyProblems);
  }

  const env = { ...process.env, [CORPUS_ENV]: corpusRoot };
  const legs = [];
  for (const h of roster) {
    const dir = hostDir(h);
    const log = join(logDir, `${h.id}.log`);
    if (!selected(h)) {
      legs.push({ id: h.id, verdict: 'NOT SELECTED' });
      continue;
    }
    if (h.platform && h.platform !== process.platform) {
      legs.push({ id: h.id, verdict: `n/a on ${process.platform}`, note: `${h.platform}-only leg` });
      continue;
    }
    if (!existsSync(dir)) {
      legs.push({ id: h.id, verdict: 'UNRESOLVED', note: `no checkout at ${dir}` });
      continue;
    }
    writeFileSync(log, `# ${h.id} — ${dir}\n# ${CORPUS_ENV}=${corpusRoot}\n`);
    let failed = null;
    if (h.snapshot && !opts.perturb) {
      const code = runLogged(h.snapshot, dir, env, log);
      if (code !== 0) failed = `snapshot check exit ${code}`;
    }
    if (failed === null) {
      for (const command of h.leg) {
        console.log(`  … ${h.id}: ${command}`);
        const code = runLogged(command, dir, env, log);
        if (code !== 0) {
          failed = `\`${command}\` exit ${code}`;
          break;
        }
      }
    }
    legs.push({ id: h.id, verdict: failed === null ? 'green' : 'RED', note: failed ?? '', log });
  }

  // ── Report ────────────────────────────────────────────────────────────────
  console.log('\n  checks');
  for (const c of checks) {
    console.log(`    ${c.ok ? 'ok  ' : 'FAIL'} ${c.name}`);
    for (const p of c.problems.slice(0, 20)) console.log(`         ${p}`);
    if (c.problems.length > 20) console.log(`         … and ${c.problems.length - 20} more`);
  }
  console.log('  legs');
  for (const l of legs) console.log(`    ${l.verdict.padEnd(14)} ${l.id}${l.note ? `  — ${l.note}` : ''}`);
  console.log(`  logs ${logDir}`);
  // A pinned host's AHEAD grade (11.3) is a statement about a released tier; every leg here
  // builds its host from source, so there is no tier to be ahead of and the count is zero by rule.
  console.log('  AHEAD 0 (every leg here builds its host at HEAD)');

  if (opts.perturb) {
    rmSync(corpusRoot, { recursive: true, force: true });
    const ran = legs.filter((l) => l.log);
    const held = ran.filter((l) => l.verdict === 'RED' && readFileSync(l.log, 'utf8').includes(opts.perturb));
    for (const l of ran)
      console.log(`    probe ${held.includes(l) ? 'HELD  ' : 'MISSED'} ${l.id}${held.includes(l) ? '' : ` (${l.verdict})`}`);
    const missed = ran.length - held.length;
    const notRun = legs.filter((l) => l.verdict === 'NOT SELECTED' || l.verdict === 'UNRESOLVED').map((l) => `${l.id} (${l.verdict})`);
    if (notRun.length) console.log(`    not probed: ${notRun.join(', ')}`);
    console.log(
      missed === 0 && notRun.length === 0
        ? `\n  PROBE HELD — every leg went red naming '${opts.perturb}'`
        : `\n  PROBE ${missed === 0 ? 'PARTIAL' : 'FAILED'} — ${missed} leg(s) did not go red naming '${opts.perturb}'`,
    );
    return missed === 0 ? (notRun.length === 0 ? 0 : 3) : 1;
  }

  for (const l of legs.filter((x) => x.verdict === 'RED')) {
    console.log(`\n  ── ${l.id} (last lines of ${l.log})`);
    console.log(tail(l.log).replace(/^/gm, '     '));
  }
  const red = checks.some((c) => !c.ok) || legs.some((l) => l.verdict === 'RED' || l.verdict === 'UNRESOLVED');
  const partial = legs.some((l) => l.verdict === 'NOT SELECTED');
  const verdict = red ? 'RED' : partial ? 'PARTIAL (narrowed with --legs; never a green)' : 'GREEN';
  console.log(`\n  change-set legs: ${verdict}`);
  return red ? 1 : partial ? 3 : 0;
};
