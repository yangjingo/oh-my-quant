import { createRequire } from 'node:module';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..'), root = resolve(desktop, '../..'), output = resolve(root, 'output/playwright/desktop-shared');
const appRoot = process.env.WHYJ_TEST_DESKTOP_APP || desktop;
await mkdir(output, { recursive: true });
const require = createRequire(join(desktop, 'package.json')), { _electron: electron, chromium } = require('playwright');
const home = await mkdtemp(join(tmpdir(), 'whyj-desktop47-'));
const webRoot = process.env.WHYJ_REVIEW_WEB_ROOT || resolve(root, 'apps/web/dist');
async function hashAssets(dir, prefix = '') {
  const hash = createHash('sha256');
  async function visit(folder, relative) {
    for (const entry of (await readdir(folder, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const name = relative + entry.name, path = join(folder, entry.name);
      if (entry.isDirectory()) await visit(path, name + '/');
      else if (entry.isFile()) { hash.update(name + '\0'); hash.update(await readFile(path)); }
      else throw Error('Unexpected web asset type: ' + name);
    }
  }
  await visit(dir, prefix); return hash.digest('hex');
}
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(systemroot|windir|comspec|temp|tmp|localappdata|appdata|path|pathext|username|userdomain|processor_architecture|number_of_processors)$/i.test(key)));
Object.assign(env, { WHYJ_DESKTOP_HOME: home, WHYJ_WEB_PORT: '0', USERPROFILE: home, HOME: home, NO_PROXY: '127.0.0.1,localhost' });
env.OHQUANT_DIR = join(home, 'shared-state');
const receipt = { result: 'failed', home, revision: process.env.GITHUB_SHA ?? null, entry: process.env.WHYJ_TEST_DESKTOP_APP ? 'explicit test fixture' : 'development source', data: 'isolated Host and controlled synthetic provider', checks: [], errors: [], captures: [] };
let app, page, fixture, browser, blocker;
try {
  receipt.webAssetsSha256 = await hashAssets(webRoot);
  if (process.env.WHYJ_TEST_DESKTOP_APP && appRoot.endsWith('.asar')) receipt.appArchiveSha256 = createHash('sha256').update(await readFile(appRoot)).digest('hex');
  const fixtureEnv = { ...env, WHYJ_REVIEW_HOST_ROOT: env.OHQUANT_DIR, WHYJ_REVIEW_WEB_ROOT: webRoot,
    WHYJ_REVIEW_CLEANUP_DELAY_MS: '1500' };
  fixture = spawn('bun', ['run', 'tests/app/dev/review-host-fixture.ts'], { cwd: root, env: fixtureEnv, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const address = await new Promise((done, reject) => {
    let text = '', errors = ''; const timeout = setTimeout(() => reject(Error('Fixture startup timed out: ' + errors)), 30000);
    fixture.stderr.on('data', data => { errors += data; }); fixture.once('error', reject);
    fixture.stdout.on('data', data => { text += data; const line = text.split('\n').find(line => line.startsWith('{"origin"')); if (line) { clearTimeout(timeout); done(JSON.parse(line)); } });
  });
  blocker = spawn('bun', ['run', 'tests/app/dev/desktop-startup-lock.ts'], { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  await new Promise((done, reject) => {
    let output = '', errors = ''; const timer = setTimeout(() => reject(Error('Startup lock fixture timed out: ' + errors)), 10000);
    blocker.stderr.on('data', data => { errors += data; }); blocker.once('error', reject);
    blocker.stdout.on('data', data => { output += data; if (output.includes('locked\n')) { clearTimeout(timer); done(); } });
  });
  app = await electron.launch({ args: [appRoot], env, timeout: 60000 });
  page = await app.firstWindow(); await page.locator('#retry:disabled').waitFor();
  await new Promise(done => setTimeout(done, 300));
  const blockedProcess = app.process(), blockedExit = new Promise(done => blockedProcess.once('exit', done));
  await app.evaluate(({ app }) => app.quit()); await new Promise(done => setTimeout(done, 300));
  if (blockedProcess.exitCode !== null) throw Error('Desktop exited while discovery was still in flight');
  const released = new Promise(done => blocker.once('exit', done)); blocker.stdin.end('\n'); await released; blocker = undefined;
  await blockedExit; app = undefined; page = undefined;
  if (!(await fetch(address.origin + '/api/workbench/bootstrap')).ok) throw Error('Startup cancellation stopped a reused Host');
  receipt.checks.push('quit waits for in-flight discovery and preserves a reused Host');
  app = await electron.launch({ args: [appRoot], env, timeout: 60000 });
  page = await app.firstWindow();
  page.on('pageerror', error => receipt.errors.push(error.message));
  const capture = async (target, name) => { await target.screenshot({ path: join(output, name) }); receipt.captures.push({ name, viewport: await target.evaluate(() => ({ width: innerWidth, height: innerHeight, deviceScaleFactor: devicePixelRatio })) }); };
  await page.waitForFunction(() => location.protocol === 'app:' && document.querySelector('#input'), null, { timeout: 45000 });
  receipt.checks.push('existing Bun fixture Host serves the shared workbench in Electron');
  const identity = await page.evaluate(async () => { const b = await (await fetch('/api/workbench/bootstrap')).json(); return { version: b.version, instanceId: b.instanceId, tokenPresent: typeof b.token === 'string', controlTokenPresent: 'controlToken' in b }; });
  if (identity.instanceId !== (await (await fetch(address.origin + '/api/workbench/bootstrap')).json()).instanceId) throw Error('Electron did not reuse fixture Host');
  if (!identity.instanceId || !identity.tokenPresent || identity.controlTokenPresent) throw Error('Invalid Host bootstrap');
  const prefs = await app.evaluate(({ BrowserWindow }) => { const p = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences(); return { sandbox: p.sandbox, contextIsolation: p.contextIsolation, nodeIntegration: p.nodeIntegration }; });
  if (!prefs.sandbox || !prefs.contextIsolation || prefs.nodeIntegration) throw Error('Electron isolation failed');
  const denied = await page.evaluate(async () => { try { await window.desktopRecovery.status(); return false; } catch { return true; } });
  if (!denied) throw Error('Recovery IPC accepted a Host renderer');
  if (await page.evaluate(async () => (await fetch('/api/host/shutdown', { method: 'POST' })).status) !== 404) throw Error('Control endpoint was exposed to the renderer');
  receipt.checks.push('isolated renderer and authenticated Host');
  await capture(page, 'electron-01-workbench.png');
  const input = page.getByRole('combobox', { name: '研究问题', exact: true }); await input.fill('中文草稿验证');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  if (await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())) throw Error('Close did not hide the window');
  const second = spawn(require('electron'), [appRoot], { env, stdio: 'ignore', windowsHide: true });
  const secondExit = new Promise(done => second.once('exit', done));
  await page.waitForFunction(() => document.visibilityState === 'visible', null, { timeout: 15000 });
  await secondExit;
  if (await input.inputValue() !== '中文草稿验证') throw Error('Reopen lost the draft');
  const again = await page.evaluate(async () => (await (await fetch('/api/workbench/bootstrap')).json()).instanceId);
  if (again !== identity.instanceId) throw Error('Reopen changed the Host');
  receipt.checks.push('close hides and second launch reopens same Host with draft');
  await capture(page, 'electron-02-reopened.png');
  const bootstrap = await (await fetch(address.origin + '/api/workbench/bootstrap')).json();
  const rpc = async (method, args = [], signal) => {
    const response = await fetch(address.origin + '/api/workbench/rpc', { method: 'POST', headers: { 'content-type': 'application/json', 'x-workbench-token': bootstrap.token }, body: JSON.stringify({ method, args }), signal });
    const value = await response.json(); if (!response.ok || !value.ok) throw Error('Fixture RPC failed: ' + method); return value.result;
  };
  const awaitStage = async stage => { for (let i = 0; i < 200; i++) { const s = await (await fetch(address.control + '/state')).json(); if (s.stage === stage && s.canAdvance) return; await new Promise(done => setTimeout(done, 50)); } throw Error('Missing controlled stage ' + stage); };
  const advance = async () => { if (!(await fetch(address.control + '/advance', { method: 'POST' })).ok) throw Error('Fixture advance failed'); };
  await input.fill('Compare supplied scenarios'); await input.press('Enter'); await awaitStage('waiting');
  const identityBefore = await rpc('identity'), running = await rpc('session', [identityBefore.sessionId]);
  if (running.state !== 'running' || !running.identity.runId) throw Error('Run did not start');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await advance(); await awaitStage('thinking');
  const observed = await rpc('session', [identityBefore.sessionId]);
  if (observed.identity.runId !== running.identity.runId || observed.state !== 'running') throw Error('Detached run identity changed');
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } }), web = await context.newPage();
  await web.goto(address.origin); await web.getByText('Compare supplied scenarios').first().waitFor();
  await web.locator('.agent-status-label').last().filter({ hasText: '思考中' }).waitFor();
  const webRun = await web.evaluate(async () => {
    const bootstrap = await (await fetch('/api/workbench/bootstrap')).json();
    const response = await fetch('/api/workbench/rpc', { method: 'POST', headers: { 'content-type': 'application/json', 'x-workbench-token': bootstrap.token }, body: JSON.stringify({ method: 'identity', args: [] }) });
    return (await response.json()).result.runId;
  });
  if (webRun !== running.identity.runId) throw Error('Browser and Electron did not observe the same run');
  await capture(web, 'electron-03-browser.png');
  await context.close(); await browser.close(); browser = undefined;
  receipt.checks.push('browser observes the same running session while Desktop is hidden');
  const third = spawn(require('electron'), [appRoot], { env, stdio: 'ignore', windowsHide: true });
  const thirdExit = new Promise(done => third.once('exit', done));
  await page.waitForFunction(() => document.visibilityState === 'visible', null, { timeout: 15000 }); await thirdExit;
  await page.locator('.agent-status-label').last().filter({ hasText: '思考中' }).waitFor();
  await capture(page, 'electron-03-running-reopened.png');
  await advance(); await awaitStage('preparing'); await advance(); await awaitStage('executing'); await advance(); await awaitStage('answering'); await advance();
  await page.getByRole('button', { name: '发送问题', exact: true }).waitFor();
  const completed = await rpc('session', [identityBefore.sessionId]);
  if (completed.identity.runId !== running.identity.runId || completed.state !== 'settled') throw Error('Completed run identity changed');
  receipt.checks.push('run progresses while window is hidden and reopens with same identity');
  await page.getByRole('button', { name: '研究成果', exact: true }).click(); await page.getByRole('tab', { name: '报告版本' }).click();
  await page.getByRole('button', { name: '保存当前研究' }).click(); await page.getByText('报告版本已保存。').waitFor();
  await capture(page, 'electron-04-saved.png');
  await page.getByRole('button', { name: '关闭窗口', exact: true }).click();
  await input.fill('Check the assumptions'); await input.press('Enter'); await awaitStage('waiting');
  const followup = await rpc('session', [identityBefore.sessionId]);
  if (followup.identity.runId === running.identity.runId || !followup.turns.some(turn => turn.operation === 'followup' && turn.previousRunId === running.identity.runId)) throw Error('Follow-up did not reference the prior run');
  await page.getByRole('button', { name: '停止生成', exact: true }).click();
  await page.locator('.agent-status-label').last().filter({ hasText: '已停止' }).waitFor();
  // A stopped snapshot can be published before the cancelled run releases its owner.
  // Session reads wait for that exact non-running run to drain before returning.
  const stopped = await rpc('session', [identityBefore.sessionId], AbortSignal.timeout(30000));
  if (stopped.state !== 'cancelled' || stopped.identity.runId !== followup.identity.runId) throw Error('Cancelled follow-up did not finish');
  receipt.checks.push('save, follow-up and explicit cancellation use the shared service');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(390, 720));
  await page.waitForFunction(() => innerWidth <= 390 && document.documentElement.scrollWidth <= innerWidth);
  await page.getByRole('combobox', { name: '研究问题', exact: true }).fill('窄屏中文草稿');
  await capture(page, 'electron-05-narrow.png');
  receipt.checks.push('390px layout and Chinese draft input');
  await input.fill('Continue with another assumption'); await input.press('Enter'); await awaitStage('waiting');
  const beforeExit = await rpc('session', [identityBefore.sessionId]);
  const exited = new Promise(done => app.process().once('exit', done));
  await app.evaluate(({ app }) => app.quit()); await exited; app = undefined;
  const afterExit = await rpc('session', [identityBefore.sessionId]);
  if (afterExit.identity.runId !== beforeExit.identity.runId || afterExit.state !== 'running') throw Error('Quitting a reused Desktop stopped the shared run');
  receipt.checks.push('desktop quit detaches from an active reused Host');
  if (receipt.errors.length) throw Error(receipt.errors.join('\n'));
  receipt.result = 'passed';
} catch (error) {
  receipt.failure = String(error); receipt.url = page?.url();
  try { receipt.body = await page?.locator('body').innerText(); await page?.screenshot({ path: join(output, 'electron-failure.png') }); } catch {}
  throw error;
} finally {
  if (blocker && blocker.exitCode === null) blocker.stdin.end('\n');
  await browser?.close();
  if (app) { try { await app.evaluate(({ app }) => app.quit()); } catch {} await app.close().catch(() => {}); }
  if (fixture && fixture.exitCode === null) fixture.kill('SIGTERM');
  await writeFile(join(output, 'receipt.json'), JSON.stringify(receipt, null, 2));
}
