// CI-only browser acceptance. It never reads local settings or calls a paid model.
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const root = process.cwd(), output = resolve(root, 'output/web-react');
const runtime = process.env.WHYJ_BROWSER_RUNTIME;
if (!runtime) throw new Error('Set WHYJ_BROWSER_RUNTIME to the isolated Playwright package directory.');
const { chromium } = createRequire(join(resolve(runtime), 'package.json'))('playwright');
await mkdir(output, { recursive: true });
const children = [];
const start = (directory, outDir, port) => {
  const child = spawn(process.execPath, [join(directory, 'node_modules/vite/bin/vite.js'), 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort', '--outDir', outDir], { cwd: directory, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = ''; child.stdout.on('data', chunk => { logs += chunk; }); child.stderr.on('data', chunk => { logs += chunk; });
  const closed = new Promise(done => child.once('close', done));
  let spawnError; child.on('error', error => { spawnError = error; logs += error.message; }); children.push({ child, closed });
  return async () => {
    for (let i = 0; i < 150; i++) {
      if (spawnError || child.exitCode !== null) throw new Error('Preview exited: ' + logs);
      try { if ((await fetch(`http://127.0.0.1:${port}/`)).ok) return; } catch { /* Wait for actual readiness. */ }
      await new Promise(done => setTimeout(done, 100));
    }
    throw new Error('Preview did not become ready: ' + logs);
  };
};
let browser, context;
const receipt = { headSha: process.env.REVIEW_HEAD_SHA, baseSha: process.env.REVIEW_BASE_SHA,
  checkoutSha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  environment: { platform: process.platform, node: process.version }, data: 'synthetic demo, disconnected production, and isolated Host with controlled synthetic provider', captures: [] };
try {
  const web = resolve(root, 'apps/web');
  const ready = [start(web, 'dist-demo', 4176)(), start(web, 'dist', 4177)()];
  const baseline = process.env.WHYJ_REVIEW_BASE_ROOT;
  if (baseline) ready.push(start(resolve(baseline, 'apps/web'), 'dist-demo', 4178)());
  await Promise.all(ready);
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'], recordVideo: { dir: join(output, 'video'), size: { width: 1440, height: 960 } } });
  const page = await context.newPage();
  if (baseline) {
    for (const [width, height, name] of [[1440, 960, '00-before-wide'], [390, 844, '00-before-narrow']]) {
      await page.setViewportSize({ width, height }); await page.goto('http://127.0.0.1:4178/');
      await page.getByText(/WhyJ Quant/).first().waitFor(); await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: join(output, name + '.png'), scale: 'css' });
    }
  }
  // The existing trusted repository capture script is a function expression used by playwright-cli.
  const capture = (0, eval)(await readFile(join(web, 'dev/capture.cjs'), 'utf8'));
  receipt.frontend = await capture(page);
  const hostCapture = join(web, 'dev/review-host-evidence.mjs');
  let hasHostCapture = false;
  try { await readFile(hostCapture); hasHostCapture = true; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (hasHostCapture) receipt.host = await (await import(pathToFileURL(hostCapture).href)).captureHost({ browser, output, root });
  receipt.actions = await (await import('./review-actions-evidence.mjs')).captureActions({ browser, output, root });
  receipt.result = 'passed';
} catch (error) { receipt.result = 'failed'; receipt.failure = String(error); throw error; }
finally {
  await context?.close(); await browser?.close();
  for (const { child } of children) { if (child.exitCode === null) child.kill('SIGTERM'); }
  await Promise.all(children.map(({ closed }) => closed));
  for (const name of (await readdir(output)).filter(name => name.endsWith('.png'))) {
    const bytes = await readFile(join(output, name)); receipt.captures.push({ name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  await writeFile(join(output, 'receipt.json'), JSON.stringify(receipt, null, 2));
}
