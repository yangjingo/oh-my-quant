// Real browser, Electron and terminal against one isolated Host and local model.
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const output = join(root, 'output/playwright/entry-contracts');
await mkdir(output, { recursive: true });
const require = createRequire(join(root, 'apps/desktop/package.json'));
const { _electron: electron, chromium } = require('playwright'), pty = require('node-pty');
const home = await mkdtemp(join(tmpdir(), 'whyj-cross-entry-'));
const workspace = join(home, 'workspace'); await mkdir(workspace);
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(systemroot|windir|comspec|temp|tmp|localappdata|appdata|path|pathext|username|userdomain|processor_architecture|number_of_processors)$/i.test(key)));
Object.assign(env, { HOME: home, USERPROFILE: home, OHQUANT_DIR: workspace, WHYJ_DESKTOP_HOME: home, WHYJ_REVIEW_HOST_ROOT: workspace,
  WHYJ_REVIEW_WEB_ROOT: join(root, 'apps/web/dist'), WHYJ_WEB_PORT: '0', NO_PROXY: '127.0.0.1,localhost', TERM: 'xterm-256color' });
const bun = spawnSync('bun', ['-e', 'console.log(process.execPath)'], { encoding: 'utf8' }).stdout.trim();
if (!bun) throw Error('Bun is required for the controlled fixture and terminal');
const result = { result: 'failed', revision: process.env.GITHUB_SHA || null, scope: 'actual browser, Electron, terminal and Host; isolated synthetic provider', checks: [], errors: [] };
let fixture, app, browser, term, page, terminalOutput = '', terminalExit, terminalExited = false, fixtureStopped = false;
const sleep = ms => new Promise(done => setTimeout(done, ms));
async function wait(read, match, label) {
  for (let i = 0; i < 300; i++) { const value = await read(); if (match(value)) return value; await sleep(100); }
  throw Error('Timed out waiting for ' + label);
}
try {
  fixture = spawn(bun, ['run', 'tests/app/dev/review-host-fixture.ts'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  fixture.once('exit', () => { fixtureStopped = true; });
  let logs = '';
  const address = await new Promise((done, reject) => {
    let text = ''; const timer = setTimeout(() => reject(Error('Host startup timeout: ' + logs)), 30000);
    fixture.stderr.on('data', chunk => { logs += chunk; }); fixture.once('error', reject); fixture.once('exit', code => reject(Error('Host exited: ' + code + ' ' + logs)));
    fixture.stdout.on('data', chunk => { text += chunk; const line = text.split('\n').find(value => value.startsWith('{"origin"')); if (line) { clearTimeout(timer); done(JSON.parse(line)); } });
  });
  const boot = await (await fetch(address.origin + '/api/workbench/bootstrap')).json();
  const rpc = async (method, args = []) => {
    const response = await fetch(address.origin + '/api/workbench/rpc', { method: 'POST', headers: { 'content-type': 'application/json', 'x-workbench-token': boot.token }, body: JSON.stringify({ method, args }) });
    const value = await response.json(); if (!response.ok || !value.ok) throw Error(method + ' failed: ' + JSON.stringify(value.error)); return value.result;
  };
  const provider = async () => (await fetch(address.control + '/state')).json();
  const advance = async () => { await wait(provider, state => state.canAdvance, 'provider release'); const response = await fetch(address.control + '/advance', { method: 'POST' }); if (!response.ok || !(await response.json()).advanced) throw Error('Provider release rejected'); };
  const session = async id => rpc('session', [id]);
  browser = await chromium.launch({ headless: true }); const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const web = await context.newPage(); web.on('pageerror', error => result.errors.push(error.message)); await web.goto(address.origin);
  const input = web.getByRole('combobox', { name: '研究问题', exact: true }); await input.fill('Cross entry controlled question'); await input.press('Enter');
  await wait(provider, state => state.stage === 'waiting' && state.canAdvance, 'browser run');
  const identity = await rpc('identity'), running = await session(identity.sessionId);
  if (running.state !== 'running' || !running.identity.runId) throw Error('Browser did not start a shared run');
  await web.screenshot({ path: join(output, 'browser-running.png') });
  app = await electron.launch({ args: [join(root, 'apps/desktop')], env, timeout: 60000 }); page = await app.firstWindow();
  page.on('pageerror', error => result.errors.push(error.message));
  await page.getByText('Cross entry controlled question').first().waitFor({ timeout: 45000 });
  const desktopIdentity = await page.evaluate(async () => {
    const boot = await (await fetch('/api/workbench/bootstrap')).json();
    const response = await fetch('/api/workbench/rpc', { method: 'POST', headers: { 'content-type': 'application/json', 'x-workbench-token': boot.token }, body: JSON.stringify({ method: 'identity', args: [] }) });
    return { instanceId: boot.instanceId, identity: (await response.json()).result };
  });
  if (desktopIdentity.instanceId !== boot.instanceId || desktopIdentity.identity.runId !== running.identity.runId) throw Error('Desktop attached to a different run or Host');
  await page.screenshot({ path: join(output, 'desktop-attached.png') });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  if (await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())) throw Error('Desktop did not hide to tray');
  if ((await session(identity.sessionId)).state !== 'running') throw Error('Closing Desktop stopped research');
  term = pty.spawn(bun, ['run', join(root, 'src/index.ts')], { name: 'xterm-256color', cols: 140, rows: 40, cwd: root, env });
  term.onData(value => { terminalOutput += value; }); terminalExit = new Promise(done => term.onExit(value => { terminalExited = true; done(value); }));
  await wait(async () => terminalOutput, value => value.includes('Cross entry controlled question'), 'terminal attached to shared run');
  term.write('\x07');
  const stopped = await wait(() => session(identity.sessionId), value => value.state === 'cancelled' && value.identity.runId === running.identity.runId, 'terminal cancellation');
  if ((await provider()).requests !== 1) throw Error('Attaching or cancelling duplicated the model request');
  await sleep(250); if ((await session(identity.sessionId)).state !== 'cancelled') throw Error('Late state replaced cancellation');
  await web.getByText('已停止', { exact: true }).first().waitFor(); await web.screenshot({ path: join(output, 'browser-cancelled.png') });
  result.checks.push('browser starts one run; Electron attaches and hides; terminal cancels that exact run');
  result.runId = stopped.identity.runId;
  const button = web.getByRole('button', { name: '继续未完成的研究', exact: true }); await button.waitFor(); await button.click();
  const continuing = await wait(() => session(identity.sessionId), value => value.state === 'running' && value.identity.runId !== stopped.identity.runId, 'explicit continuation');
  if (!continuing.turns.some(turn => turn.operation === 'continue' && turn.previousRunId === stopped.identity.runId)) throw Error('Continuation lost its previous run identity');
  for (let i = 0; i < 5; i++) await advance();
  const completed = await wait(() => session(identity.sessionId), value => value.state === 'settled' && value.identity.runId === continuing.identity.runId, 'continued result');
  await web.getByRole('button', { name: '研究成果', exact: true }).click(); await web.getByRole('tab', { name: '报告版本' }).click();
  await web.getByRole('button', { name: '保存当前研究' }).click(); await web.getByText('报告版本已保存。').waitFor();
  const saved = await session(identity.sessionId); if (!saved.output.artifacts.length) throw Error('Saved report missing');
  await web.getByRole('button', { name: '查看记录' }).first().click(); await web.getByText('已打开固定版本。').waitFor();
  await web.getByRole('button', { name: '关闭窗口', exact: true }).click();
  await input.fill('Explicit follow-up after saved result'); await input.press('Enter');
  const follow = await wait(() => session(identity.sessionId), value => value.state === 'running' && value.identity.runId !== completed.identity.runId, 'follow-up');
  if (!follow.turns.some(turn => turn.operation === 'followup' && turn.previousRunId === completed.identity.runId)) throw Error('Follow-up lost its previous run identity');
  const cancelResponse = web.waitForResponse(value => value.url().endsWith('/api/workbench/rpc') && value.request().postDataJSON()?.method === 'cancel');
  await web.getByRole('button', { name: '停止生成', exact: true }).click(); if (!(await cancelResponse).ok()) throw Error('Follow-up cancellation failed');
  result.checks.push('explicit continuation, saved report reopen and follow-up retain run identities');
  term.write('/exit\r'); await Promise.race([terminalExit, sleep(10000).then(() => { throw Error('Terminal did not detach'); })]); term = undefined;
  const desktopExit = new Promise(done => app.process().once('exit', done)); await app.evaluate(({ app }) => app.quit());
  await Promise.race([desktopExit, sleep(15000).then(() => { throw Error('Desktop did not quit'); })]); app = undefined;
  const afterQuit = await rpc('identity');
  if (afterQuit.workspaceId !== identity.workspaceId || afterQuit.sessionId !== identity.sessionId) throw Error('Quitting views replaced the shared Host');
  result.checks.push('explicit terminal and Desktop quit detach without stopping the reused Host');
  if (result.errors.length) throw Error(result.errors.join('\n'));
  result.result = 'passed';
} catch (error) { result.failure = String(error); result.terminalTail = terminalOutput.slice(-1200); try { result.body = await page?.locator('body').innerText(); } catch {} console.error(error); }
finally {
  if (term) { term.write('/exit\r'); await Promise.race([terminalExit, sleep(5000)]); if (!terminalExited) try { term.kill(); } catch {} }
  await browser?.close(); if (app) { try { await app.evaluate(({ app }) => app.quit()); } catch {} await app.close().catch(() => {}); }
  if (fixture && !fixtureStopped) { const stopped = new Promise(done => fixture.once('exit', done)); fixture.kill('SIGTERM'); await Promise.race([stopped, sleep(10000)]); }
  if (fixture && !fixtureStopped) { result.result = 'failed'; result.failure = 'Controlled Host did not exit'; }
  await writeFile(join(output, 'receipt.json'), JSON.stringify(result, null, 2));
  // Preserve failed fixtures for diagnosis; remove only this verified temporary root on success.
  if (result.result === 'passed' && fixtureStopped) {
    if (!resolve(home).startsWith(resolve(tmpdir()) + sep)) throw Error('Unexpected fixture root');
    await rm(home, { recursive: true, force: true });
  }
  // node-pty can keep an idle helper handle after its owned terminal exits.
  process.exit(result.result === 'passed' ? 0 : 1);
}
