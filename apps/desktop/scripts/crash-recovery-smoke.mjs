import { createRequire } from 'node:module';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..'), root = resolve(desktop, '../..'), out = resolve(root, 'output/playwright/desktop-crash');
await mkdir(out, { recursive: true });
const { _electron: electron } = createRequire(join(desktop, 'package.json'))('playwright');
const home = await mkdtemp(join(tmpdir(), 'whyj-crash47-'));
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(systemroot|windir|comspec|temp|tmp|localappdata|appdata|path|pathext|username|userdomain|processor_architecture|number_of_processors)$/i.test(key)));
Object.assign(env, { WHYJ_DESKTOP_HOME: home, OHQUANT_DIR: join(home, 'shared-state'), WHYJ_WEB_PORT: '0', USERPROFILE: home, HOME: home, NO_PROXY: '127.0.0.1,localhost' });
let app, fixture, page; const result = { result: 'failed', revision: process.env.GITHUB_SHA ?? null, data: 'isolated Host and controlled synthetic provider', checks: [] };
async function start(keep) {
  const child = spawn('bun', ['run', 'tests/app/dev/review-host-fixture.ts'], { cwd: root,
    env: { ...env, WHYJ_REVIEW_HOST_ROOT: env.OHQUANT_DIR, ...(keep ? { WHYJ_REVIEW_KEEP_SETTINGS: '1' } : {}) }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const value = await new Promise((done, reject) => {
    let text = '', errors = ''; const timer = setTimeout(() => reject(Error('Fixture timeout: ' + errors)), 30000);
    child.stderr.on('data', data => { errors += data; }); child.once('error', reject); child.once('exit', code => reject(Error('Fixture exited: ' + code + ' ' + errors)));
    child.stdout.on('data', data => { text += data; const line = text.split('\n').find(line => line.startsWith('{"origin"')); if (line) { clearTimeout(timer); done(JSON.parse(line)); } });
  });
  return { child, ...value };
}
try {
  fixture = await start(false); app = await electron.launch({ args: [desktop], env, timeout: 60000 }); page = await app.firstWindow();
  await page.getByRole('combobox', { name: '研究问题', exact: true }).waitFor();
  const input = page.getByRole('combobox', { name: '研究问题', exact: true }); await input.fill('Crash recovery fixture'); await input.press('Enter');
  for (let i = 0; i < 200; i++) { const s = await (await fetch(fixture.control + '/state')).json(); if (s.stage === 'waiting' && s.canAdvance) break; await new Promise(done => setTimeout(done, 50)); }
  await input.fill('中断前未发送草稿');
  const old = fixture.child, exit = new Promise(done => old.once('exit', done)); old.kill('SIGTERM'); await exit; fixture = undefined;
  await page.getByRole('alert').filter({ hasText: '连接已中断' }).waitFor({ timeout: 15000 });
  if (await input.inputValue() !== '中断前未发送草稿') throw Error('Crash lost the draft');
  result.checks.push('Host crash is visible and preserves draft');
  fixture = await start(true);
  await page.locator('#retry:not(:disabled)').waitFor({ timeout: 45000 }); await page.locator('#retry').click();
  await page.getByText('上次研究意外中断').waitFor({ timeout: 30000 });
  if (await page.getByRole('combobox', { name: '研究问题', exact: true }).inputValue() !== '中断前未发送草稿') throw Error('Reconnection lost the draft');
  if ((await (await fetch(fixture.control + '/state')).json()).requests !== 0) throw Error('Reconnect replayed the model request');
  await page.screenshot({ path: join(out, 'electron-crash-recovered.png') });
  result.checks.push('new Host reconnects to interrupted run without replay'); result.result = 'passed';
} catch (error) { result.failure = String(error); if (page) { result.url = page.url(); result.body = await page.locator('body').innerText().catch(() => ''); } throw error; }
finally {
  if (app) { try { await app.evaluate(({ app }) => app.quit()); } catch {} await app.close().catch(() => {}); }
  if (fixture?.child.exitCode === null) fixture.child.kill('SIGTERM');
  await writeFile(join(out, 'receipt.json'), JSON.stringify(result, null, 2));
}
