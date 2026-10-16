// Execution advice only: a trusted, single-orchestrator snapshot, NOT a distributed lock.
export const WORK_REPO = 'danielrisavi77-create/Ductus';
const SHA = /^[a-f0-9]{40}$/;
const TASK = /^DAN-[1-9]\d*$/;
const AGENT = /^(claude|chatgpt|codex|grok):[a-z0-9][a-z0-9_-]{0,40}:(backend|frontend|platforma)$/i;
const text = (re, value) => typeof value === 'string' && re.test(value);
const ID = /^[a-z0-9][a-z0-9_.:-]{0,100}$/i;
const principal = a => a.toLowerCase().replace(/^(chatgpt|codex):/, 'openai:').split(':').slice(0, 2).join(':');
const unique = values => new Set(values).size === values.length;
const keys = (v, names) => v && typeof v === 'object' && !Array.isArray(v)
  && Object.keys(v).length === names.length && names.every(k => Object.hasOwn(v, k));
const array = (v, max = 100) => Array.isArray(v) && v.length <= max;
const integer = (v, min = 0) => Number.isSafeInteger(v) && v >= min;
const branch = v => typeof v === 'string' && /^[a-z0-9][a-z0-9_./-]{0,180}$/i.test(v)
  && !['main', 'master', 'head'].includes(v.toLowerCase())
  && !v.includes('..') && !v.includes('//') && !v.endsWith('/') && !v.endsWith('.') && !v.endsWith('.lock');

export function scopePath(value) {
  if (typeof value !== 'string' || !value || value.length > 512) throw new Error('path');
  const p = value.replace(/\\/g, '/').replace(/^(\.\/)+/, '').toLowerCase();
  if (!p || /[:*?]/.test(p) || [...p].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) || p.startsWith('/')
      || p.split('/').some((v, i, all) => v === '..' || v === '.' || v === '.git'
        || (v === '' && i !== all.length - 1))) throw new Error('path');
  return p;
}
const within = (path, scope) => path === scope || (scope.endsWith('/') && path.startsWith(scope));
export function scopesOverlap(a, b) {
  a = scopePath(a); b = scopePath(b);
  return within(a, b) || within(b, a)
    || ['db/migrations/', 'db/tests/'].some(d => a.startsWith(d) && b.startsWith(d));
}

function validContract(c) {
  if (!keys(c, ['schema', 'repository', 'issuedAt', 'expiresAt', 'assignments'])
      || c.schema !== 1 || c.repository !== WORK_REPO || !array(c.assignments, 32) || !c.assignments.length
      || ![c.issuedAt, c.expiresAt].every(t => typeof t === 'string' && /^\d{4}-\d\d-\d\dT/.test(t) && Number.isFinite(Date.parse(t)))) return false;
  for (const a of c.assignments) {
    if (!keys(a, ['task', 'agent', 'branch', 'baseSha', 'paths', 'pr', 'failures', 'regressions', 'blockers'])
        || !text(TASK, a.task) || !text(AGENT, a.agent) || !branch(a.branch) || !text(SHA, a.baseSha)
        || !array(a.paths) || !a.paths.length || !(a.pr === null || integer(a.pr, 1))
        || !array(a.failures) || !integer(a.regressions) || !array(a.blockers)
        || !a.blockers.every(b => ['infrastructure', 'decision', 'ownership', 'dependency'].includes(b))) return false;
    a.paths.forEach(scopePath);
    if (!unique(a.paths.map(scopePath))) return false;
    for (const f of a.failures) {
      if (!keys(f, ['id', 'root', 'round', 'head']) || !text(ID, f.id) || !text(ID, f.root)
          || !integer(f.round, 1) || !text(SHA, f.head)) return false;
    }
    if (!unique(a.failures.map(f => f.id))) return false;
  }
  return unique(c.assignments.map(a => a.task)) && unique(c.assignments.map(a => a.branch.toLowerCase()))
    && unique(c.assignments.map(a => principal(a.agent)))
    && unique(c.assignments.filter(a => a.pr !== null).map(a => a.pr));
}

export function checkWork(contract, evidence = {}) {
  const reasons = new Set();
  const finish = () => ({ ok: reasons.size === 0, state: reasons.size ? 'BLOCKED' : 'ALLOWED',
    task: text(TASK, evidence?.task) ? evidence.task : null, head: text(SHA, evidence?.head) ? evidence.head : null,
    base: text(SHA, evidence?.baseSha) ? evidence.baseSha : null, reasons: [...reasons],
    next: reasons.size ? 'handoff-to-orchestrator' : 'assigned-step' });
  try {
    if (!validContract(contract)) throw new Error('contract');
  } catch { reasons.add('INVALID_CONTRACT'); return finish(); }
  const { now, task, agent, branch: currentBranch, baseSha, head, paths, prs } = evidence ?? {};
  if (!Number.isFinite(now) || !text(TASK, task) || !text(AGENT, agent) || !branch(currentBranch)
      || !text(SHA, head) || !text(SHA, baseSha) || !array(paths, 10000) || !array(prs, 1000)) {
    reasons.add('INVALID_EVIDENCE'); return finish();
  }
  const issued = Date.parse(contract.issuedAt), expires = Date.parse(contract.expiresAt);
  if (issued > now || expires <= now || expires <= issued || expires - issued > 15 * 60 * 1000) reasons.add('STALE_CONTRACT');
  if (contract.assignments.length > 3) reasons.add('WIP_LIMIT');
  const assignment = contract.assignments.find(a => a.task === task);
  if (!assignment) { reasons.add('UNASSIGNED'); return finish(); }
  if (principal(assignment.agent) !== principal(agent) || assignment.agent.split(':')[2].toLowerCase() !== agent.split(':')[2].toLowerCase()) reasons.add('WRONG_AGENT');
  if (assignment.branch !== currentBranch) reasons.add('WRONG_BRANCH');
  if (assignment.baseSha !== baseSha) reasons.add('STALE_BASE');
  if (assignment.blockers.length) reasons.add('EXPLICIT_BLOCKER');
  if (assignment.regressions >= 2) reasons.add('REGRESSION_LIMIT');
  const roots = new Map();
  for (const f of assignment.failures) {
    if (!roots.has(f.root)) roots.set(f.root, new Set());
    roots.get(f.root).add(f.round);
    if (roots.get(f.root).size >= 2) reasons.add('REPEATED_FAILURE');
    if (f.round >= 2) reasons.add('ROUND_LIMIT'); // A further correction would start round three.
  }
  try {
    const scopes = assignment.paths.map(scopePath);
    if (paths.some(p => !scopes.some(s => within(scopePath(p), s)))) reasons.add('OUT_OF_SCOPE');
    for (const a of contract.assignments) {
      if (a !== assignment && a.paths.some(p => scopes.some(s => scopesOverlap(p, s)))) reasons.add('CLAIM_OVERLAP');
    }
    if (!unique(prs.map(p => p.number))) throw new Error('duplicate PR');
    let ownFound = assignment.pr === null;
    for (const pr of prs) {
      if (!integer(pr.number, 1) || typeof pr.headRefName !== 'string' || !pr.headRefName) throw new Error('PR');
      if (!array(pr.paths, 3000)) { reasons.add('INCOMPLETE_PR_FILES'); continue; }
      pr.paths.forEach(scopePath);
      if (pr.number === assignment.pr) {
        ownFound = pr.headRefName === currentBranch && pr.headRepository === WORK_REPO;
        if (!ownFound) reasons.add('WRONG_PR');
        continue;
      }
      if (pr.paths.some(p => scopes.some(s => scopesOverlap(p, s)))) reasons.add('PR_OVERLAP');
    }
    if (!ownFound) reasons.add('WRONG_PR');
  } catch { reasons.add('INVALID_EVIDENCE'); }
  return finish();
}
