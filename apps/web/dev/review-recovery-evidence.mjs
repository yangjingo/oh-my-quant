import { join } from 'node:path';
import { HOST_PROTOCOL_VERSION, HOST_SERVICE_CONTRACT_VERSION } from '../../../src/types/workbench-host.ts';

// Screenshot actual production components with an isolated, deterministic Host adapter.
export async function captureRecovery({ browser, output }) {
  const results = [];
  for (const state of ['interrupted', 'cancelled', 'failed', 'settled', 'needs_input']) {
    for (const [label, width, height] of [['wide', 1440, 900], ['narrow', 390, 844]]) {
      const context = await browser.newContext({ viewport: { width, height } });
      const page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      try {
        await page.addInitScript(({ initialState, protocolVersion, serviceContractVersion }) => {
          const original = window.fetch.bind(window);
          const identity = { workspaceId: 'fixture-workspace', sessionId: 'fixture-session', runId: 'fixture-run' };
          const market = { refreshedAt: '', quotes: [], source: { provider: null, updatedAt: null, available: 0, total: 0 } };
          const output = { conclusion: { statement: null, confidence: null, boundary: null, settled: false }, evidence: [], artifacts: [] };
          const snapshot = { identity, revision: 2, state: initialState, turns: [
            { id: 'fixture-run-user', role: 'user', text: '这是隔离验证的示例问题。', state: 'settled', at: '2026-10-29T00:00:00Z' },
            { id: 'fixture-run-assistant', role: 'assistant', text: '之前的部分回答已保存。', state: initialState, at: '2026-10-29T00:00:00Z' },
          ], recovery: { runId: identity.runId, unconfirmedTools: initialState === 'interrupted' ? 0 : 1, acknowledgementRequired: true }, market, output };
          window.fixtureCalls = { submits: 0, acknowledgements: 0 };
          window.fetch = async (input, init = {}) => {
            const url = new URL(typeof input === 'string' ? input : input.url || input.href, location.href);
            if (!url.pathname.startsWith('/api/workbench/')) return original(input, init);
            if (url.pathname.endsWith('/bootstrap')) return Response.json({ version: 1, protocolVersion, serviceContractVersion, token: 'a'.repeat(64) });
            if (url.pathname.endsWith('/events')) return new Response(new ReadableStream({ start(controller) {
              controller.enqueue(new TextEncoder().encode('data: {"type":"ready","workspaceId":"fixture-workspace"}\n\n'));
            } }), { headers: { 'content-type': 'text/event-stream' } });
            const { method } = JSON.parse(init.body); let result;
            if (method === 'identity') result = identity;
            else if (method === 'workspaces') result = [{ ...identity, name: '中断恢复示例', code: '', state: initialState, runCount: 1 }];
            else if (method === 'preferences') result = { model: '受控示例', source: 'none', portfolio: '' };
            else if (method === 'session') result = snapshot;
            else if (method === 'market' || method === 'refreshMarket') result = market;
            else if (method === 'acknowledgeInterruption') { window.fixtureCalls.acknowledgements++; snapshot.revision++; snapshot.recovery.acknowledgementRequired = false; result = null; }
            else if (method === 'submit') { window.fixtureCalls.submits++; throw new Error('Unexpected submission in visual fixture'); }
            else throw new Error('Unexpected fixture method: ' + method);
            return Response.json({ ok: true, result });
          };
        }, { initialState: state, protocolVersion: HOST_PROTOCOL_VERSION, serviceContractVersion: HOST_SERVICE_CONTRACT_VERSION });
        await page.route('http://127.0.0.1:4177/', async route => {
          const response = await route.fetch();
          const body = (await response.text()).replace('</head>', '<meta name="whyj-workbench-host" content="1"></head>');
          await route.fulfill({ response, body });
        });
        await page.goto('http://127.0.0.1:4177/', { waitUntil: 'networkidle' });
        if (state === 'interrupted') await page.getByText('执行记录不完整，无法确认工具是否运行', { exact: false }).waitFor();
        else if (state === 'cancelled') await page.getByText('研究已请求停止，工具结果待核对', { exact: true }).waitFor();
        else await page.getByText('工具结果待核对', { exact: true }).waitFor();
        const input = page.locator('textarea#input'); await input.fill('保留的未发送草稿');
        if (!await page.locator('#send').isDisabled()) throw new Error(state + ': submission was not blocked');
        const button = page.getByRole('button', { name: '我已核对，继续提问' }); await button.focus();
        if (!await button.evaluate(element => element === document.activeElement)) throw new Error(state + ': confirmation lacks focus');
        await page.screenshot({ path: join(output, `recovery-${state}-${label}-before.png`), scale: 'css' });
        await button.press('Enter');
        await button.waitFor({ state: 'hidden' });
        if (state === 'interrupted') await page.getByText('可以继续提问，或新建研究。', { exact: false }).waitFor();
        if (await page.locator('#send').isDisabled()) throw new Error(state + ': submission stayed blocked after acknowledgement');
        if (await input.inputValue() !== '保留的未发送草稿') throw new Error(state + ': draft changed');
        const calls = await page.evaluate(() => window.fixtureCalls);
        if (calls.submits !== 0 || calls.acknowledgements !== 1) throw new Error(state + ': unexpected request count');
        if (await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) > innerWidth)) throw new Error(state + ': horizontal overflow');
        if (errors.length) throw new Error(state + ': page errors: ' + errors.join('; '));
        await page.screenshot({ path: join(output, `recovery-${state}-${label}-after.png`), scale: 'css' });
        results.push({ state, viewport: [width, height], draftPreserved: true, submitCount: calls.submits, acknowledgementCount: calls.acknowledgements, errors });
      } finally { await context.close(); }
    }
  }
  return { adapter: 'synthetic Host', results };
}
