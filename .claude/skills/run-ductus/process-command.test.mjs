import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pnpmCommand } from './process-command.mjs';

test('Linux uses pnpm with separate argv, never shell', () => {
  assert.deepEqual(pnpmCommand('build', { platform: 'linux' }), { command: 'pnpm', args: ['build'] });
  assert.deepEqual(pnpmCommand('serve', { platform: 'linux', port: 3111 }), {
    command: 'pnpm', args: ['exec', 'next', 'start', '-p', '3111'],
  });
});

test('Windows uses a fixed cmd.exe shim without Node shell:true', () => {
  assert.deepEqual(pnpmCommand('build', { platform: 'win32' }), {
    command: 'cmd.exe', args: ['/d', '/s', '/c', 'pnpm build'],
  });
  assert.deepEqual(pnpmCommand('serve', { platform: 'win32', port: 3111 }), {
    command: 'cmd.exe', args: ['/d', '/s', '/c', 'pnpm exec next start -p 3111'],
  });
});

test('rejects injection, reserved E2E ports and invalid port numbers', () => {
  for (const port of [0, 1, 3000, 3001, 3002, 3003, 3004, 65536, NaN, Infinity, -7, 3111.5, '3111 & echo escaped', '3111']) {
    assert.throws(() => pnpmCommand('serve', { platform: 'win32', port }), /invalid or reserved port/);
  }
});

test('only build and serve are exposed, no arbitrary command strings', () => {
  for (const operation of ['', 'repl', 'exec', 'build && rm -rf /']) {
    assert.throws(() => pnpmCommand(operation, { platform: 'win32' }), /unsupported pnpm operation/);
  }
});
