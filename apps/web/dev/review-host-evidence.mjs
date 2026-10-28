import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';

export async function captureHost({ browser, output, root }) {
  const child = spawn('bun', ['run', 'tests/app/dev/review-host-fixture.ts'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = ''; child.stderr.on('data', data => { logs += data; });
  const closed = new Promise(done => child.once('close', done));
  let context;
  const results = [];
  try {
    const fixture = await new Promise((done, reject) => {
      let text = ''; const timer = setTimeout(() => reject(new Error('Fixture startup timeout: ' + logs)), 30000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.stdout.on('data', data => { text += data; const line = text.split('\n').find(line => line.startsWith('{"origin"'));
        if (line) { clearTimeout(timer); done(JSON.parse(line)); } });
    });
    context = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: join(output, 'host-video'), size: { width: 1280, height: 720 } } });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const capture = async name => {
      if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error(name + ': page overflow');
      await page.screenshot({ path: join(output, name + '.png'), scale: 'css' }); results.push(name);
    };
    const next = async () => { if (!(await fetch(fixture.control + '/advance', { method: 'POST' })).ok) throw new Error('Fixture control failed'); };
    const state = async label => page.locator('.agent-status-label').last().filter({ hasText: new RegExp('^' + label + '$') }).waitFor();
    await page.goto(fixture.origin); const input = page.getByRole('combobox', { name: '研究问题', exact: true }); await input.waitFor();
    await page.getByRole('heading', { name: '开始一份研究' }).waitFor(); await capture('host-01-empty');
    await input.fill('Compare supplied scenarios'); await input.press('Enter'); await state('等待模型响应'); await capture('host-02-waiting');
    await page.reload(); await page.getByRole('button', { name: '停止生成', exact: true }).waitFor();
    if ((await (await fetch(fixture.control + '/state')).json()).requests !== 1) throw new Error('Reload replayed the request');
    if (!(await page.locator('#sessionTitle').innerText()).includes('Compare supplied scenarios')) throw new Error('Auto-name missing');
    await capture('host-03-reloaded-waiting');
    await page.getByRole('button', { name: 'review-fixture', exact: true }).click();
    const model = page.getByRole('textbox', { name: '模型 ID', exact: true }); await model.fill('busy-model'); await page.getByRole('button', { name: '保存偏好', exact: true }).click();
    await page.locator('.error-feedback').waitFor(); await capture('host-04-busy-model-rejected'); await page.getByRole('button', { name: '关闭窗口', exact: true }).click();
    await next(); await state('思考中'); await capture('host-05-thinking');
    await next(); await state('准备调用工具'); await capture('host-06-preparing');
    await next(); await state('正在调用工具'); await capture('host-07-executing');
    await next(); await state('正在生成回答'); await capture('host-08-answering');
    await next(); await page.getByRole('button', { name: '发送问题', exact: true }).waitFor();
    const ended = await page.locator('.agent-status').last().innerText();
    await page.waitForTimeout(1100); if (await page.locator('.agent-status').last().innerText() !== ended) throw new Error('Terminal timer advanced');
    await capture('host-09-result');
    await input.fill('Follow up on those supplied scenarios'); await input.press('Enter'); await state('等待模型响应');
    await input.fill('Retained draft'); await input.press('Enter'); await capture('host-10-follow-up-draft');
    await page.getByRole('button', { name: '停止生成', exact: true }).click(); await state('已停止');
    if (await input.inputValue() !== 'Retained draft') throw new Error('Stop lost draft'); await capture('host-11-stopped');
    await page.getByRole('button', { name: 'review-fixture', exact: true }).click(); await model.fill('review-fixture-next'); await page.getByRole('button', { name: '保存偏好', exact: true }).click();
    await page.locator('.operation-feedback:not(.error-feedback)').waitFor(); await capture('host-12-model-saved'); await page.getByRole('button', { name: '关闭窗口', exact: true }).click();
    const beforeReference = (await (await fetch(fixture.control + '/state')).json()).requests;
    await input.fill('Summarize @file:evidence.md'); await input.press('Enter');
    await page.getByRole('alert').filter({ hasText: '引用' }).waitFor();
    if (await input.inputValue() !== 'Summarize @file:evidence.md') throw new Error('Rejected reference lost draft');
    if ((await (await fetch(fixture.control + '/state')).json()).requests !== beforeReference) throw new Error('Unavailable reference called provider');
    await capture('host-reference-unavailable');
    await input.fill('FAIL supplied fixture'); await input.press('Enter'); await state('等待模型响应'); await next(); await state('思考中'); await next(); await state('准备调用工具'); await next(); await state('正在调用工具'); await next(); await state('正在生成回答');
    await page.locator('.tool-record[data-state="failed"]').waitFor(); await capture('host-13-tool-failed'); await next(); await page.getByRole('button', { name: '发送问题', exact: true }).waitFor();
    await input.fill('Stop before dispatch'); await input.press('Enter'); await state('等待模型响应'); await next(); await state('思考中'); await next(); await state('准备调用工具');
    await page.getByRole('button', { name: '停止生成', exact: true }).click(); await state('已停止');
    await page.locator('.tool-history').last().locator('summary').first().click(); await page.locator('.tool-record[data-state="not-run"]').waitFor(); await capture('host-14-not-executed');
    await page.setViewportSize({ width: 390, height: 844 }); await capture('host-15-narrow');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await input.fill('Reduced motion fixture'); await input.press('Enter'); await state('等待模型响应');
    if (await page.locator('.agent-status-mark').last().evaluate(element => getComputedStyle(element).animationName) !== 'none') throw new Error('Reduced motion animates');
    await capture('host-16-reduced-motion'); await page.getByRole('button', { name: '停止生成', exact: true }).click(); await state('已停止');
    if (errors.length) throw new Error(errors.join('\n'));
    return { result: 'passed', captures: results, data: 'controlled fake provider / actual core and calculator', errors };
  } finally {
    await context?.close(); if (child.exitCode === null) child.kill('SIGTERM'); await closed;
    await writeFile(join(output, 'host-fixture-log.txt'), logs);
  }
}
