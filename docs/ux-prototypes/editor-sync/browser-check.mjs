import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Uses the repo's existing Playwright dependency. An isolated verifier may
// supply an installed Playwright module/executable without changing the repo.
const engines = await import(process.env.DUCTUS_PLAYWRIGHT_MODULE || '@playwright/test');
const engine = process.argv[2] || 'chromium';
assert.ok(['chromium', 'firefox', 'webkit'].includes(engine), 'Unsupported browser');
const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');
const output = await mkdtemp(join(tmpdir(), 'ductus-scratch-'));
const browser = await engines[engine].launch({
  headless: true,
  ...(process.env.DUCTUS_BROWSER_EXECUTABLE ? { executablePath: process.env.DUCTUS_BROWSER_EXECUTABLE } : {}),
});
const checks = [], errors = [], requests = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('request', r => requests.push(r.url()));
  // In-memory document: tests rendering/CSP/interactions, not file:// navigation.
  await page.setContent(html);
  const status = () => page.locator('#status').innerText();
  const select = name => page.selectOption('#scenario', name);
  const check = (name, pass) => { assert.ok(pass, name); checks.push(name); };
  check('initial EDITING rendered under CSP', await status() === 'Uređivanje');
  await page.screenshot({ path: join(output, 'desktop.png'), fullPage: true });
  await page.click('#local'); check('local saving starts', await status() === 'Spremam lokalno');
  await page.click('#local'); check('local is not server', await status() === 'Spremljeno na uređaju');
  await page.click('#send'); check('sending is pending', await status() === 'Sinkroniziram');
  for (const kind of ['unsigned', 'invalid', 'stale']) {
    await page.selectOption('#receipt', kind); await page.click('#reject');
    check(`reject ${kind}`, await status() === 'Sinkroniziram');
  }
  await page.click('#ack'); check('matching receipt confirmed', await status() === 'Spremljeno na poslužitelju');
  await page.fill('#text', 'Nova izmišljena izmjena.'); check('edit clears confirmed UI', await status() === 'Uređivanje');
  await select('syncing'); await page.fill('#text', 'Promjena za vrijeme slanja.'); await page.click('#ack');
  check('late ACK cannot confirm new text', await status() === 'Uređivanje');
  await select('offline'); await page.click('#network');
  check('reconnect alone not confirmed', await status() === 'Spremljeno na uređaju');
  await page.click('#send'); await page.click('#ack');
  check('offline marker survives receipt', await page.locator('#offline-origin').isVisible() && await status() === 'Spremljeno na poslužitelju');
  for (const [name, label] of [['conflict', 'Sukob'], ['recovery', 'Potreban oporavak']]) {
    await select(name);
    check(`${name} locks writing`, await status() === label && await page.locator('#text').isDisabled());
    await page.click('#network'); check(`${name} not resolved by network`, await status() === label);
    await page.click('#resolve');
    check(`${name} explicit local choice`, await status() === 'Spremam lokalno' && await page.locator('#text').isEnabled());
  }
  await select('blocked');
  check('blocked tab', await page.locator('#text').isDisabled() && await status() === 'Dokument je otvoren u drugoj kartici.');
  await select('loading'); check('loading', await page.locator('#text').isDisabled() && await page.locator('#loading').isVisible());
  await select('empty'); check('empty', await page.locator('#text').inputValue() === '');
  await page.fill('#text', '<script>window.injected=1</script>');
  check('text is not executable HTML', await page.evaluate('window.injected === undefined'));
  await page.setContent(html);
  check('reinitializing document forgets input', !(await page.locator('#text').inputValue()).includes('window.injected'));
  await select('syncing'); await page.emulateMedia({ reducedMotion: 'reduce' });
  check('reduced motion stops pulse', await page.locator('.dot').evaluate(el => getComputedStyle(el).animationName) === 'none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.locator('summary').click(); await page.locator('#motion').fill('1200');
  await page.locator('#motion').dispatchEvent('input');
  check('motion tuning', await page.locator('#motion-value').innerText() === '--pulse: 1200ms;');
  for (const width of [390, 760, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1050 });
    check(`no horizontal overflow at ${width}`, await page.evaluate('document.documentElement.scrollWidth <= innerWidth'));
  }
  await page.setViewportSize({ width: 390, height: 844 }); await select('offline');
  await page.screenshot({ path: join(output, 'mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1050 }); await select('syncing');
  await page.screenshot({ path: join(output, 'sending.png'), fullPage: true });
  check('no external requests', requests.length === 0);
  check('no browser errors', errors.length === 0);
  const result = { browser: engine, version: browser.version(), mode: 'in-memory HTML (setContent)', passed: checks.length, checks, errors, requests };
  await writeFile(join(output, 'results.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ ...result, output }, null, 2));
} finally {
  await browser.close();
}
