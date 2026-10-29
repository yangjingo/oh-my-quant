// Tests Electron tray events and menu callbacks; it does not simulate an OS mouse click.
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { access, cp, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..'), root = resolve(desktop, '../..');
const output = resolve(root, 'output/playwright/desktop-tray'); await mkdir(output, { recursive: true });
const { _electron: electron } = createRequire(join(desktop, 'package.json'))('playwright');
const home = await mkdtemp(join(tmpdir(), 'whyj-tray47-')), testApp = join(home, 'app');
await cp(join(desktop, 'dist'), join(testApp, 'dist'), { recursive: true });
const manifest = JSON.parse(await readFile(join(desktop, 'package.json'), 'utf8')); manifest.main = 'test-entry.cjs';
await writeFile(join(testApp, 'package.json'), JSON.stringify(manifest));
await writeFile(join(testApp, 'test-entry.cjs'), 'require(' + JSON.stringify(resolve(root, 'tests/app/dev/desktop-tray-hook.cjs')) + '); require("./dist/main.cjs");\n');
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(systemroot|windir|comspec|temp|tmp|localappdata|appdata|path|pathext|username|userdomain|processor_architecture|number_of_processors)$/i.test(key)));
Object.assign(env, { WHYJ_DESKTOP_HOME: join(home, 'profile'), OHQUANT_DIR: join(home, 'state'), WHYJ_WEB_PORT: '0', USERPROFILE: home, HOME: home, NO_PROXY: '127.0.0.1,localhost' });
const result = { result: 'failed', revision: process.env.GITHUB_SHA ?? null, data: 'isolated Host and controlled synthetic provider', boundary: 'Electron tray events and menu callbacks invoked programmatically; native OS mouse interaction not tested', checks: [] };
let fixture, restoredFixture, application, page;
try {
  fixture = spawn('bun', ['run', 'tests/app/dev/review-host-fixture.ts'], { cwd: root, env: { ...env, WHYJ_REVIEW_HOST_ROOT: env.OHQUANT_DIR }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const host = await new Promise((done, reject) => {
    let text = '', errors = ''; const timer = setTimeout(() => reject(Error('Fixture startup timeout: ' + errors)), 30000);
    fixture.stderr.on('data', data => { errors += data; }); fixture.once('error', reject);
    fixture.stdout.on('data', data => { text += data; const line = text.split('\n').find(value => value.startsWith('{"origin"')); if (line) { clearTimeout(timer); done(JSON.parse(line)); } });
  });
  application = await electron.launch({ args: [testApp], env, timeout: 60000 }); page = await application.firstWindow();
  const input = page.getByRole('combobox', { name: '研究问题', exact: true }); await input.waitFor();
  const labels = await application.evaluate(() => globalThis.__whyjTrayTest?.menu.items.map(item => item.label));
  for (const label of ['打开研究工作台', '退出 WhyJ Quant', '停止研究服务并退出…']) if (!labels?.includes(label)) throw Error('Missing tray menu item: ' + label);
  await input.fill('Tray lifecycle fixture'); await input.press('Enter');
  let ready = false;
  for (let i = 0; i < 200; i++) { const state = await (await fetch(host.control + '/state')).json(); if (state.stage === 'waiting' && state.canAdvance) { ready = true; break; } await new Promise(done => setTimeout(done, 50)); }
  if (!ready) throw Error('Controlled run did not start');
  const bootstrap = await (await fetch(host.origin + '/api/workbench/bootstrap')).json();
  const rpc = async (method, args = []) => { const response = await fetch(host.origin + '/api/workbench/rpc', { method: 'POST', headers: { 'content-type': 'application/json', 'x-workbench-token': bootstrap.token }, body: JSON.stringify({ method, args }) }); const value = await response.json(); if (!response.ok || !value.ok) throw Error('Host request failed'); return value.result; };
  const identity = await rpc('identity'), before = await rpc('session', [identity.sessionId]);
  if (before.state !== 'running' || !before.identity.runId) throw Error('Expected an active run');
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  if (await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())) throw Error('Window did not hide');
  await application.evaluate(() => globalThis.__whyjTrayTest.menu.items.find(item => item.label === '打开研究工作台').click());
  await page.waitForFunction(() => document.visibilityState === 'visible');
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await application.evaluate(() => globalThis.__whyjTrayTest.tray.emit('double-click', {}, { x: 0, y: 0 }));
  await page.waitForFunction(() => document.visibilityState === 'visible');
  if ((await rpc('session', [identity.sessionId])).identity.runId !== before.identity.runId) throw Error('Tray restore changed the run');
  await page.screenshot({ path: join(output, 'tray-restored.png') });
  result.checks.push('menu open and double-click event restore the same active run');
  const normalExit = new Promise(done => application.process().once('exit', done));
  await application.evaluate(() => globalThis.__whyjTrayTest.menu.items.find(item => item.label === '退出 WhyJ Quant').click()).catch(() => {});
  await normalExit; application = undefined;
  const afterQuit = await rpc('session', [identity.sessionId]);
  if (afterQuit.identity.runId !== before.identity.runId || afterQuit.state !== 'running') throw Error('Normal tray quit stopped a reused Host');
  application = await electron.launch({ args: [testApp], env, timeout: 60000 }); page = await application.firstWindow();
  await page.getByRole('combobox', { name: '研究问题', exact: true }).waitFor();
  if ((await rpc('session', [identity.sessionId])).identity.runId !== before.identity.runId) throw Error('Relaunch changed the run');
  result.checks.push('normal tray quit detaches and preserves a reused active Host');
  const confirmation = await application.evaluate(async ({ dialog }) => {
    const original = dialog.showMessageBox; let options;
    dialog.showMessageBox = async value => { options = value; return { response: 0, checkboxChecked: false }; };
    try { await globalThis.__whyjTrayTest.menu.items.find(item => item.label === '停止研究服务并退出…').click(); return options; }
    finally { dialog.showMessageBox = original; }
  });
  if (!confirmation?.message?.includes('所有入口') || confirmation.cancelId !== 0 || confirmation.buttons?.length !== 2) throw Error('Stop confirmation is unclear or unsafe');
  const afterCancel = await rpc('session', [identity.sessionId]);
  if (afterCancel.identity.runId !== before.identity.runId || afterCancel.state !== 'running') throw Error('Cancelling confirmation stopped the run');
  result.checks.push('cancelling the stop confirmation leaves shared work running');
  const exited = new Promise(done => application.process().once('exit', done));
  await application.evaluate(async ({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    await globalThis.__whyjTrayTest.menu.items.find(item => item.label === '停止研究服务并退出…').click();
  }).catch(() => {});
  await exited; application = undefined;
  let stopped = false;
  for (let i = 0; i < 100; i++) { try { await fetch(host.origin + '/api/workbench/bootstrap'); } catch { stopped = true; break; } await new Promise(done => setTimeout(done, 100)); }
  if (!stopped) throw Error('Confirmed explicit stop did not stop the Host');
  const provider = await (await fetch(host.control + '/state')).json();
  if (provider.stage !== 'idle') throw Error('Controlled model request survived explicit stop');
  result.checks.push('confirmed stop closes the shared Host and cancels the active fixture request');
  let unpublished = false;
  for (let i = 0; i < 100; i++) { try { await access(join(env.OHQUANT_DIR, '.host', 'registry.json')); } catch { unpublished = true; break; } await new Promise(done => setTimeout(done, 100)); }
  if (!unpublished) throw Error('Stopped Host did not release its registration');
  restoredFixture = spawn('bun', ['run', 'tests/app/dev/review-host-fixture.ts'], { cwd: root,
    env: { ...env, WHYJ_REVIEW_HOST_ROOT: env.OHQUANT_DIR, WHYJ_REVIEW_KEEP_SETTINGS: '1' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const restored = await new Promise((done, reject) => {
    let text = '', errors = ''; const timer = setTimeout(() => reject(Error('Restore fixture timeout: ' + errors)), 30000);
    restoredFixture.stderr.on('data', data => { errors += data; }); restoredFixture.once('error', reject);
    restoredFixture.stdout.on('data', data => { text += data; const line = text.split('\n').find(value => value.startsWith('{"origin"')); if (line) { clearTimeout(timer); done(JSON.parse(line)); } });
  });
  const restoredBootstrap = await (await fetch(restored.origin + '/api/workbench/bootstrap')).json();
  const response = await fetch(restored.origin + '/api/workbench/rpc', { method: 'POST', headers: { 'content-type': 'application/json', 'x-workbench-token': restoredBootstrap.token }, body: JSON.stringify({ method: 'session', args: [identity.sessionId] }) });
  const loaded = await response.json();
  if (!response.ok || !loaded.ok || loaded.result.identity.runId !== before.identity.runId || loaded.result.state !== 'cancelled') throw Error('Stopped run was not durably recorded');
  if ((await (await fetch(restored.control + '/state')).json()).requests !== 0) throw Error('Reopening replayed the stopped run');
  result.checks.push('reopening reads the cancelled run without replay'); result.result = 'passed';
} catch (error) {
  result.failure = String(error); if (page) result.body = await page.locator('body').innerText().catch(() => '');
  throw error;
} finally {
  if (application) { try { await application.evaluate(({ app }) => app.quit()); } catch {} await application.close().catch(() => {}); }
  if (restoredFixture && restoredFixture.exitCode === null) restoredFixture.kill('SIGTERM');
  if (fixture && fixture.exitCode === null) fixture.kill('SIGTERM');
  await writeFile(join(output, 'receipt.json'), JSON.stringify(result, null, 2));
}
