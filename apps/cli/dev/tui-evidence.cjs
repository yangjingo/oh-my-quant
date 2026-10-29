const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');
const { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

const root = resolve(__dirname, '../../..'), desktop = join(root, 'apps/desktop'), output = join(root, 'output/playwright/desktop-tui');
const requireDesktop = createRequire(join(desktop, 'package.json'));
const pty = requireDesktop('node-pty'), { chromium } = requireDesktop('playwright');
const bun = spawnSync('bun', ['-e', 'console.log(process.execPath)'], { encoding: 'utf8' }).stdout.trim();
const assets = join(desktop, 'node_modules/@xterm'); mkdirSync(output, { recursive: true });
const receipt = { result: 'failed', revision: process.env.GITHUB_SHA || null, data: 'real TUI with an isolated synthetic recovery snapshot, no Host or model', cases: [] };
let browser;
(async () => {
  browser = await chromium.launch({ headless: true });
  for (const [label, width, height] of [['wide', 1280, 800], ['narrow', 680, 480]]) {
    const tmp = mkdtempSync(join(tmpdir(), 'whyj-tui-review-')), ack = join(tmp, 'ack.json'), submit = join(tmp, 'submit.txt');
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(systemroot|windir|comspec|temp|tmp|localappdata|appdata|path|pathext|userprofile|homedrive|homepath|username|userdomain|processor_architecture|number_of_processors)$/i.test(key)));
    Object.assign(env, { OHQUANT_DIR: join(tmp, 'state'), PI_CODING_AGENT_DIR: join(tmp, 'pi'), OHQUANT_SKILLS_DIR: join(tmp, 'skills'),
      WHYJ_TUI_ACK: ack, WHYJ_TUI_SUBMIT: submit, TERM: 'xterm-256color' });
    const context = await browser.newContext({ viewport: { width, height } }), page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    let terminal, exited = false, exitPromise;
    try {
      await page.setContent('<!doctype html><meta charset="UTF-8"><style>html,body,#terminal{width:100%;height:100%;margin:0;background:#0c0c0c;overflow:hidden}#terminal{padding:8px;box-sizing:border-box}</style><div id="terminal"></div>');
      await page.addStyleTag({ path: join(assets, 'xterm/css/xterm.css') });
      await page.addScriptTag({ path: join(assets, 'xterm/lib/xterm.js') });
      await page.addScriptTag({ path: join(assets, 'addon-fit/lib/addon-fit.js') });
      const size = await page.evaluate(async () => {
        const term = new window.Terminal({ fontFamily: 'Consolas, "Microsoft YaHei", monospace', fontSize: 14, lineHeight: 1.18,
          cursorBlink: false, theme: { background: '#0c0c0c', foreground: '#fff3c4', cursor: '#c99a2e' } });
        const fit = new window.FitAddon.FitAddon(); term.loadAddon(fit); term.open(document.querySelector('#terminal')); await document.fonts.ready; fit.fit();
        window.term = term; window.dump = () => Array.from({ length: term.rows }, (_, i) => term.buffer.active.getLine(i)?.translateToString(true) || '').join('\n');
        return { cols: term.cols, rows: term.rows };
      });
      terminal = pty.spawn(bun, ['run', join(root, 'apps/tui/dev/recovery-evidence.ts')], { name: 'xterm-256color', ...size, cwd: root, env });
      exitPromise = new Promise(done => terminal.onExit(value => { exited = true; done(value); }));
      let writes = Promise.resolve(), terminalError;
      terminal.onData(data => { writes = writes.then(() => page.evaluate(data => new Promise(done => window.term.write(data, done)), data)).catch(error => { terminalError = error; }); });
      const waitText = async text => { await page.waitForFunction(text => window.dump().includes(text), text, { timeout: 30000 }); await writes; if (terminalError) throw terminalError; };
      await waitText('工具结果待核对'); terminal.write('KEEP DRAFT'); terminal.write('\r'); await waitText('核对未确定的结果'); await waitText('fixture_tool');
      await page.screenshot({ path: join(output, `tui-recovery-${label}-before.png`) });
      terminal.write('\x1b'); await waitText('KEEP DRAFT'); if (existsSync(ack)) throw Error('Escape acknowledged unexpectedly');
      terminal.write('\r'); await waitText('核对未确定的结果'); terminal.write('\r');
      for (let n = 0; n < 200 && !existsSync(ack); n++) await delay(25);
      if (!existsSync(ack)) throw Error('Acknowledgement was not recorded');
      await waitText('KEEP DRAFT');
      const value = JSON.parse(readFileSync(ack, 'utf8'));
      if (JSON.stringify(value) !== JSON.stringify({ workspaceId: 'fixture-workspace', sessionId: 'fixture-session', runId: 'fixture-run', expectedRevision: 4 })) throw Error('Wrong acknowledgement identity');
      if (existsSync(submit)) throw Error('Acknowledgement submitted the draft');
      if (errors.length) throw Error(errors.join('; '));
      await page.screenshot({ path: join(output, `tui-recovery-${label}-after.png`) });
      terminal.write('\r');
      for (let n = 0; n < 200 && !existsSync(submit); n++) await delay(25);
      if (!existsSync(submit) || readFileSync(submit, 'utf8') !== 'KEEP DRAFT') throw Error('Explicit submit lost the draft');
      terminal.write('EXIT_FIXTURE\r');
      const result = await Promise.race([exitPromise, delay(10000).then(() => { throw Error('TUI fixture did not exit'); })]);
      if (result.exitCode !== 0) throw Error('TUI fixture exited unsuccessfully');
      receipt.cases.push({ viewport: [width, height], terminal: size, escapePreservedDraft: true, acknowledgedOriginalRevision: true, submittedBeforeExplicitSend: false, explicitSendPreservedDraft: true, errors });
    } finally { if (terminal && !exited) terminal.kill(); await context.close(); }
  }
  receipt.result = 'passed';
})().catch(error => { receipt.error = String(error); console.error(error); process.exitCode = 1; }).finally(async () => {
  await browser?.close(); writeFileSync(join(output, 'receipt.json'), JSON.stringify(receipt, null, 2));
  process.exit(process.exitCode || 0);
});
