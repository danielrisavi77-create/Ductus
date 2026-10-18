/**
 * Fixed pnpm operations for the local run-ductus skill.
 * Windows pnpm.cmd is invoked through a literal cmd.exe command rather
 * than Node shell:true. Only a validated numeric port can enter that string.
 */
export function pnpmCommand(operation, { platform = process.platform, port = 3111 } = {}) {
  if (operation !== 'build' && operation !== 'serve') throw new TypeError('unsupported pnpm operation');
  if (operation === 'serve' && (typeof port !== 'number' || !Number.isInteger(port) ||
      port < 1024 || port > 65535 || (port >= 3000 && port <= 3004))) {
    throw new RangeError('invalid or reserved port');
  }
  const args = operation === 'build' ? ['build'] : ['exec', 'next', 'start', '-p', String(port)];
  return platform === 'win32'
    ? { command: 'cmd.exe', args: ['/d', '/s', '/c', `pnpm ${args.join(' ')}`] }
    : { command: 'pnpm', args };
}
