// Exercise Desktop discovery errors against an isolated real Host.
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..'), root = resolve(desktop, '../..');
const output = resolve(root, 'output/playwright/desktop-conflict'); await mkdir(output, { recursive: true });
const { _electron: electron } = createRequire(join(desktop, 'package.json'))('playwright');
const home = await mkdtemp(join(tmpdir(), 'whyj-conflict47-'));
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(systemroot|windir|comspec|temp|tmp|localappdata|appdata|path|pathext|username|userdomain|processor_architecture|number_of_processors)$/i.test(key)));
Object.assign(env, { WHYJ_DESKTOP_HOME: home, OHQUANT_DIR: join(home, 'shared-state'), WHYJ_WEB_PORT: '0', USERPROFILE: home, HOME: home, NO_PROXY: '127.0.0.1,localhost' });
const receipt = { result: 'failed', revision: process.env.GITHUB_SHA ?? null, data: 'isolated Host; intentionally altered temporary registration', checks: [] };
let fixture, blocker, application, page, original, registry, impostor;
const launch = () => electron.launch({ args: [desktop], env, timeout: 60000 });
const waitLine = (child, marker, timeoutMs) => new Promise((done, reject) => {
  let output = '', errors = ''; const timer = setTimeout(() => reject(Error('Fixture timeout: ' + errors)), timeoutMs);
  child.stderr.on('data', chunk => { errors += chunk; }); child.once('error', reject);
  child.stdout.on('data', chunk => { output += chunk; const line = output.split('\n').find(item => item.startsWith(marker)); if (line) { clearTimeout(timer); done(line); } });
});
try {
  fixture = spawn('bun', ['run', 'tests/app/dev/review-host-fixture.ts'], { cwd: root,
    env: { ...env, WHYJ_REVIEW_HOST_ROOT: env.OHQUANT_DIR }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const host = JSON.parse(await waitLine(fixture, '{"origin"', 30000));
  if (!(await fetch(host.origin + '/api/workbench/bootstrap')).ok) throw Error('Fixture Host did not become ready');
  registry = join(env.OHQUANT_DIR, '.host', 'registry.json'); original = await readFile(registry);
  const value = JSON.parse(original); value.protocolVersion = 999;
  const incompatible = Buffer.from(JSON.stringify(value)); await writeFile(registry, incompatible);
  application = await launch(); page = await application.firstWindow();
  await page.locator('#retry:not(:disabled)').waitFor({ timeout: 30000 });
  if (!(await page.locator('#message').innerText()).includes('版本不兼容')) throw Error('Incompatible Host was not explained');
  if (!(await fetch(host.origin + '/api/workbench/bootstrap')).ok || !(await readFile(registry)).equals(incompatible)) throw Error('Existing Host or registration was changed');
  await page.screenshot({ path: join(output, 'version-conflict.png') });
  receipt.checks.push('incompatible version is visible and existing owner is preserved');
  await writeFile(registry, original); original = undefined;
  await page.locator('#retry').click(); await page.getByRole('combobox', { name: '研究问题', exact: true }).waitFor();
  const firstExit = new Promise(done => application.process().once('exit', done));
  await application.evaluate(({ app }) => app.quit()); await firstExit; application = undefined;
  impostor = createServer((_request, response) => { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ instanceId: 'another-instance' })); });
  await new Promise((done, reject) => { impostor.once('error', reject); impostor.listen(0, '127.0.0.1', done); });
  const other = `http://127.0.0.1:${impostor.address().port}`;
  original = await readFile(registry); const changed = { ...JSON.parse(original), url: other };
  const collision = Buffer.from(JSON.stringify(changed)); await writeFile(registry, collision);
  application = await launch(); page = await application.firstWindow();
  await page.locator('#retry:not(:disabled)').waitFor({ timeout: 30000 });
  if (!(await page.locator('#message').innerText()).includes('身份与当前端口不一致')) throw Error('Endpoint identity conflict was not explained');
  if (!(await fetch(host.origin + '/api/workbench/bootstrap')).ok || !(await readFile(registry)).equals(collision)) throw Error('Endpoint conflict changed the existing owner');
  await page.screenshot({ path: join(output, 'port-conflict.png') });
  receipt.checks.push('port identity conflict is visible and existing owner is preserved');
  await writeFile(registry, original); original = undefined; await new Promise(done => impostor.close(done)); impostor = undefined;
  await page.locator('#retry').click(); await page.getByRole('combobox', { name: '研究问题', exact: true }).waitFor();
  const secondExit = new Promise(done => application.process().once('exit', done));
  await application.evaluate(({ app }) => app.quit()); await secondExit; application = undefined;
  original = await readFile(registry); const damaged = Buffer.from('fixture-private-marker-not-valid-json'); await writeFile(registry, damaged);
  application = await launch(); page = await application.firstWindow();
  await page.locator('#retry:not(:disabled)').waitFor({ timeout: 30000 });
  const damagedMessage = await page.locator('#message').innerText();
  if (!damagedMessage.includes('登记损坏') || damagedMessage.includes('fixture-private-marker')) throw Error('Damaged registration was not safely explained');
  if (!(await readFile(registry)).equals(damaged) || !(await fetch(host.origin + '/api/workbench/bootstrap')).ok) throw Error('Damaged registration or live owner was changed');
  await page.screenshot({ path: join(output, 'damaged-registration.png') });
  receipt.checks.push('damaged registration is preserved without exposing contents');
  await writeFile(registry, original); original = undefined;
  await page.locator('#retry').click(); await page.getByRole('combobox', { name: '研究问题', exact: true }).waitFor();
  const thirdExit = new Promise(done => application.process().once('exit', done));
  await application.evaluate(({ app }) => app.quit()); await thirdExit; application = undefined;
  blocker = spawn('bun', ['run', 'tests/app/dev/desktop-startup-lock.ts'], { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  await waitLine(blocker, 'locked', 10000);
  application = await launch(); page = await application.firstWindow();
  await page.locator('#retry:not(:disabled)').waitFor({ timeout: 30000 });
  if (!(await page.locator('#message').innerText()).includes('其他入口仍在启动')) throw Error('Startup timeout was not explained');
  if (!(await fetch(host.origin + '/api/workbench/bootstrap')).ok) throw Error('Waiting for startup lock stopped the existing Host');
  await page.screenshot({ path: join(output, 'startup-timeout.png') });
  const released = new Promise(done => blocker.once('exit', done)); blocker.stdin.end('\n'); await released; blocker = undefined;
  await page.locator('#retry').click(); await page.getByRole('combobox', { name: '研究问题', exact: true }).waitFor();
  receipt.checks.push('startup timeout preserves owner and allows retry after lock release');
  receipt.result = 'passed';
} catch (error) {
  receipt.failure = String(error); if (page) { receipt.url = page.url(); receipt.body = await page.locator('body').innerText().catch(() => ''); }
  throw error;
} finally {
  if (original && registry) await writeFile(registry, original);
  if (impostor) await new Promise(done => impostor.close(done));
  if (blocker && blocker.exitCode === null) blocker.stdin.end('\n');
  if (application) { try { await application.evaluate(({ app }) => app.quit()); } catch {} await application.close().catch(() => {}); }
  if (fixture && fixture.exitCode === null) fixture.kill('SIGTERM');
  await writeFile(join(output, 'receipt.json'), JSON.stringify(receipt, null, 2));
}
