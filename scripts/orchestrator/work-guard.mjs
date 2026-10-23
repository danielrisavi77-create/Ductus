// Single-orchestrator snapshot validation; never starts a model or publishes a verdict.
import { execFile } from 'node:child_process';
import { open } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { checkWork, WORK_REPO } from './work-guard-core.mjs';

const run = promisify(execFile);
const exec = async (cmd, args) => (await run(cmd, args, { timeout: 15000, maxBuffer: 4 * 1024 * 1024,
  windowsHide: true, env: { ...process.env, GH_HOST: 'github.com', GH_REPO: WORK_REPO } })).stdout;
const blocked = reason => ({ ok: false, state: 'BLOCKED', task: null, head: null, base: null,
  reasons: [reason], next: 'handoff-to-orchestrator' });
const mark = (result, reason) => ({ ...result, ok: false, state: 'BLOCKED',
  reasons: [...new Set([...result.reasons, reason])], next: 'handoff-to-orchestrator' });

async function readContract(file) {
  const handle = await open(file, 'r');
  try {
    if (!(await handle.stat()).isFile()) throw new Error('file');
    const buffer = Buffer.alloc(32769);
    let used = 0;
    while (used < buffer.length) {
      const { bytesRead } = await handle.read(buffer, used, buffer.length - used, null);
      if (!bytesRead) break;
      used += bytesRead;
    }
    if (used > 32768) throw new Error('size');
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, used)));
  } finally { await handle.close(); }
}

export async function collectWorkPrs(list) {
  const prs = await list(`repos/${WORK_REPO}/pulls?state=open&per_page=100`);
  if (!Array.isArray(prs) || prs.length > 1000) throw new Error('PR list');
  const out = [];
  for (const pr of prs) {
    if (!Number.isSafeInteger(pr?.number) || pr.number < 1 || pr.state !== 'open'
        || typeof pr.head?.ref !== 'string' || !pr.head.ref
        || typeof pr.head?.repo?.full_name !== 'string' || !pr.head.repo.full_name) throw new Error('PR');
    const files = await list(`repos/${WORK_REPO}/pulls/${pr.number}/files?per_page=100`);
    if (!Array.isArray(files) || !files.length || files.length >= 3000) throw new Error('files');
    const paths = [];
    for (const f of files) {
      if (!['added', 'removed', 'modified', 'renamed', 'copied', 'changed', 'unchanged'].includes(f?.status)
          || typeof f.filename !== 'string' || !f.filename
          || (f.status === 'renamed' && (typeof f.previous_filename !== 'string' || !f.previous_filename))) throw new Error('file');
      paths.push(f.filename);
      if (f.status === 'renamed') paths.push(f.previous_filename);
    }
    out.push({ number: pr.number, headRefName: pr.head.ref, headRepository: pr.head.repo.full_name, paths });
  }
  return out;
}

async function loadPrs(command) {
  const { ghList } = await import('./gh.mjs');
  return collectWorkPrs(path => ghList(path, command));
}

export async function runWorkGuard(options, deps = {}) {
  const deadline = Date.now() + 60000;
  const command = async (cmd, args) => {
    if (Date.now() >= deadline) throw new Error('budget');
    return (deps.exec ?? exec)(cmd, args);
  };
  const git = async (...args) => (await command('git', args)).trim();
  const main = async () => (await command('gh', ['api', '--hostname', 'github.com',
    `repos/${WORK_REPO}/git/ref/heads/main`, '--jq', '.object.sha'])).trim();
  const paths = async (...args) => (await command('git', args)).split('\0').filter(Boolean);
  try {
    const contract = await readContract(options.contractFile);
    const branch = await git('symbolic-ref', '--short', 'HEAD');
    if (options.expectedBranch !== undefined && branch !== options.expectedBranch) return blocked('PUSH_TARGET');
    const head = await git('rev-parse', '--verify', 'HEAD^{commit}');
    const baseSha = await main();
    if (!/^[0-9a-f]{40}$/.test(baseSha)) return blocked('INVALID_BASE');
    // No implicit fetch, checkout, reset or local mutation. Missing base objects stop work.
    await git('merge-base', '--is-ancestor', baseSha, head);
    const changed = [
      ...await paths('diff', '--name-only', '--no-renames', '-z', baseSha, head, '--'),
      ...await paths('diff', '--name-only', '--no-renames', '-z', '--cached', head, '--'),
      ...await paths('diff', '--name-only', '--no-renames', '-z', 'HEAD', '--'),
      ...await paths('ls-files', '--others', '--exclude-standard', '-z'),
    ];
    const prs = await (deps.loadPrs ?? loadPrs)(command);
    const finalHead = await git('rev-parse', '--verify', 'HEAD^{commit}');
    const finalBranch = await git('symbolic-ref', '--short', 'HEAD');
    const finalBase = await main();
    let result = checkWork(contract, { now: (deps.now ?? Date.now)(), task: options.task,
      agent: options.agent, branch, head, baseSha, paths: [...new Set(changed)], prs });
    if (head !== finalHead || branch !== finalBranch) result = mark(result, 'HEAD_MOVED');
    if (baseSha !== finalBase) result = mark(result, 'BASE_MOVED');
    return result;
  } catch { return blocked('READ_FAILED'); }
}

export async function guardPush(target, env = process.env, deps = {}) {
  const names = ['DUCTUS_WORK_CONTRACT', 'DUCTUS_WORK_TASK', 'DUCTUS_WORK_AGENT'];
  if (!names.some(n => Object.hasOwn(env, n))) return null;
  if (!names.every(n => typeof env[n] === 'string' && env[n].trim())) return blocked('CONFIGURATION');
  if (![target.currentBranch, 'HEAD'].includes(target.src) || target.dst !== target.currentBranch
      || typeof target.remote !== 'string' || !/^[a-z0-9][a-z0-9_.-]*$/i.test(target.remote)) return blocked('PUSH_TARGET');
  try {
    if ((await (deps.exec ?? exec)('git', ['symbolic-ref', '--short', 'HEAD'])).trim() !== target.currentBranch) return blocked('PUSH_TARGET');
    const url = (await (deps.exec ?? exec)('git', ['remote', 'get-url', '--push', '--all', target.remote])).trim();
    const allowed = ['https://github.com/', 'git@github.com:', 'ssh://git@github.com/']
      .flatMap(prefix => [prefix + WORK_REPO, prefix + WORK_REPO + '.git']);
    if (!allowed.includes(url)) return blocked('PUSH_TARGET');
    const result = await runWorkGuard({ contractFile: env.DUCTUS_WORK_CONTRACT, expectedBranch: target.dst,
      task: env.DUCTUS_WORK_TASK, agent: env.DUCTUS_WORK_AGENT }, deps);
    return result.ok ? { ...result, pushUrl: url } : result;
  } catch { return blocked('READ_FAILED'); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [contractFile, task, agent, ...extra] = process.argv.slice(2);
  const result = contractFile && task && agent && !extra.length
    ? await runWorkGuard({ contractFile, task, agent }) : blocked('USAGE');
  console.log(JSON.stringify(result));
  process.exitCode = result.ok ? 0 : 1;
}
