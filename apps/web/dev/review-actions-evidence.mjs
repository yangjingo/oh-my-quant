// Actual local Host and core, isolated storage, controlled synthetic provider.
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { advanceFixture } from './review-host-control.mjs';

export async function captureActions({ browser, output, root }) {
  const child = spawn('bun', ['run', 'tests/app/dev/review-host-fixture.ts'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  const closed = new Promise(done => child.once('close', done));
  let logs = '', context; const captures = [], errors = [], timings = { inputMs: [], reconnectMs: [], scrollMs: [] };
  child.stderr.on('data', data => { logs += data; });
  try {
    const fixture = await new Promise((done, reject) => {
      let text = ''; const timer = setTimeout(() => reject(new Error('Fixture timeout: ' + logs)), 30000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.stdout.on('data', data => { text += data; const line = text.split('\n').find(line => line.startsWith('{"origin"')); if (line) { clearTimeout(timer); done(JSON.parse(line)); } });
    });
    context = await browser.newContext({ viewport: { width: 1280, height: 800 }, recordVideo: { dir: join(output, 'actions-video'), size: { width: 1280, height: 800 } } });
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    const shot = async name => { if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw Error('Horizontal overflow: ' + name); await page.screenshot({ path: join(output, name + '.png'), scale: 'css' }); captures.push(name); };
    const next = async () => { await advanceFixture(fixture.control); };
    const state = async label => page.locator('.agent-status-label').last().filter({ hasText: new RegExp('^' + label + '$') }).waitFor();
    await page.goto(fixture.origin); await page.getByRole('heading', { name: '开始一份研究' }).waitFor();
    const input = page.getByRole('combobox', { name: '研究问题', exact: true });
    for (let i = 0; i < 3; i++) {
      const start = performance.now(); await page.reload(); await page.getByRole('heading', { name: '开始一份研究' }).waitFor();
      timings.reconnectMs.push(Math.round((performance.now() - start) * 10) / 10);
    }
    for (let i = 0; i < 10; i++) {
      const value = 'Controlled input ' + i, start = performance.now(); await input.fill(value);
      await page.waitForFunction(value => document.querySelector('#input')?.value === value, value);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      timings.inputMs.push(Math.round((performance.now() - start) * 10) / 10);
    }
    await input.fill('Compare supplied scenarios'); await input.press('Enter'); await state('等待模型响应');
    let ready = false;
    for (let i = 0; i < 150; i++) { const status = await (await fetch(fixture.control + '/state')).json(); if (status.canAdvance) { ready = true; break; } await page.waitForTimeout(100); }
    if (!ready) throw Error('Controlled provider did not become ready');
    await next(); await state('思考中'); await next(); await state('准备调用工具'); await next(); await state('正在调用工具'); await next(); await state('正在生成回答'); await next();
    await page.getByRole('button', { name: '发送问题', exact: true }).waitFor();
    await page.getByRole('button', { name: '研究成果', exact: true }).click(); await page.getByRole('tab', { name: '报告版本' }).click();
    await page.getByRole('button', { name: '保存当前研究' }).click(); await page.getByText('报告版本已保存。').waitFor({ timeout: 30000 }); await shot('actions-01-report-wide');
    await page.getByRole('button', { name: '查看记录' }).first().click(); await page.getByText('已打开固定版本。').waitFor();
    await page.locator('.saved-report').getByText(/数据仍需核对/).waitFor(); await shot('actions-02-record-wide');
    await page.getByRole('button', { name: '发起复核' }).first().click();
    const question = page.getByRole('textbox', { name: '复核问题' });
    await question.fill('Review @file:unavailable.md'); await page.getByRole('button', { name: '开始复核' }).click();
    const error = page.getByRole('alert').filter({ hasText: '引用' }); await error.waitFor();
    await page.waitForFunction(() => { const alert = document.querySelector('.research-content [role=alert]'), panel = document.querySelector('.research-content'); if (!alert || !panel) return false; const a = alert.getBoundingClientRect(), p = panel.getBoundingClientRect(); return a.top >= p.top && a.bottom <= p.bottom; });
    if (await question.inputValue() !== 'Review @file:unavailable.md') throw Error('Rejected review lost input');
    await shot('actions-02b-review-error-wide'); await question.fill('Review the supplied assumptions');
    await page.setViewportSize({ width: 390, height: 844 }); await shot('actions-03-review-narrow');
    for (let i = 0; i < 5; i++) {
      const timing = await page.locator('.research-content').evaluate(async (element, index) => {
        const max = element.scrollHeight - element.clientHeight; if (max <= 0) throw Error('Expected scrollable research panel');
        element.scrollTop = index % 2 ? 0 : max; const start = performance.now();
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return Math.round((performance.now() - start) * 10) / 10;
      }, i);
      timings.scrollMs.push(timing);
    }
    await page.getByRole('button', { name: '开始复核' }).click(); await state('等待模型响应'); await shot('actions-04-review-started-narrow');
    await page.getByRole('button', { name: '停止生成', exact: true }).click(); await state('已停止');
    await page.locator('#sessionTitle').click(); await page.getByRole('button', { name: '删除当前会话' }).click(); await shot('actions-05-delete-confirm-narrow');
    await page.getByRole('button', { name: '确认删除会话' }).click(); await page.locator('dialog[open]').waitFor({ state: 'detached' });
    if ((await page.locator('#sessionTitle').innerText()).includes('复核：')) throw Error('Deleted review remained selected');
    await shot('actions-06-after-delete-narrow');
    if (errors.length) throw Error(errors.join('\n'));
    return { result: 'passed', captures, errors, data: 'isolated actual Host and core with controlled synthetic provider; not Electron',
      timings, timingScope: 'local Playwright input/reload round trip and panel scroll to two animation frames; small samples, not framework comparison' };
  } finally {
    await context?.close(); if (child.exitCode === null) child.kill('SIGTERM'); await closed;
    await writeFile(join(output, 'actions-fixture-log.txt'), logs);
  }
}
