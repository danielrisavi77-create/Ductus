#!/usr/bin/env node
// Offline fixture executable. No network, no delegation to a real gh process.
import { appendFileSync, readFileSync } from 'node:fs';
const args = process.argv.slice(2);
appendFileSync(process.env.QA_TRACE, JSON.stringify(args) + '\n');
if (args.length !== 2 || args[0] !== 'api') process.exit(98);
const path = args[1];
const url = new URL('https://fixture.invalid/' + path);
const page = Number(url.searchParams.get('page'));
if (!Number.isInteger(page) || page < 1 || url.searchParams.get('per_page') !== '100') process.exit(97);
const fixture = JSON.parse(readFileSync(process.env.QA_FIXTURE, 'utf8'));
const isRuns = url.pathname === '/repos/{owner}/{repo}/actions/workflows/ci.yml/runs';
const match = url.pathname.match(/^\/repos\/\{owner\}\/\{repo\}\/actions\/runs\/(\d+)\/jobs$/);
if (!isRuns && !match) process.exit(96);
if (isRuns && (url.searchParams.get('event') !== 'pull_request' || url.searchParams.get('status') !== 'success' || !url.searchParams.get('created')?.startsWith('>='))) process.exit(95);
if (match && url.searchParams.get('filter') !== 'latest') process.exit(94);
if (fixture.failure === (isRuns ? 'runs' : 'jobs')) {
  process.stderr.write('synthetic gh failure\n'); process.exit(17);
}
if (fixture.malformed === (isRuns ? 'runs' : 'jobs')) { process.stdout.write('{'); process.exit(0); }
const rows = isRuns ? fixture.runs : (fixture.jobs[match[1]] ?? []);
console.log(JSON.stringify({ [isRuns ? 'workflow_runs' : 'jobs']: rows.slice((page - 1) * 100, page * 100) }));
