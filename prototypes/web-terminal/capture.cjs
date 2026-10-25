// Run with playwright-cli run-code --filename prototypes/web-terminal/capture.cjs.
// An isolated browser page at http://127.0.0.1:8770/ is required.
async (page) => {
  const errors = [];
  let captures = 0;
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  const check = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const capture = async name => {
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `output/web-ui/${name}.png`, scale: 'css' });
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name}: page overflow`);
    captures++;
  };
  const menuWidth = async () => {
    const [menu, composer] = await Promise.all([
      page.locator('#cmdMenu').boundingBox(), page.locator('#composer').boundingBox(),
    ]);
    check(menu && Math.abs(menu.x - composer.x) <= 2 && Math.abs(menu.width - composer.width) <= 2, 'Menu must match Composer');
  };
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto('http://127.0.0.1:8770/');
  await page.evaluate(() => localStorage.removeItem('quant-preview.preferences'));
  await page.reload();
  await page.getByRole('combobox', { name: '研究问题' }).waitFor();
  const input = page.getByRole('combobox', { name: '研究问题' });
  check(!await page.locator('#projects').isVisible(), 'Session rail starts collapsed');
  await capture('01-overview');
  await page.locator('#projectSwitch').click();
  await capture('02-sessions');
  await input.fill('保留这份草稿');
  await page.locator('[data-project="empty"]').click();
  check(!await page.locator('#overview').innerText().then(text => text.includes('300308.SZ')), 'Empty session leaked quotes');
  await capture('03-empty');
  await page.locator('[data-project="sample"]').click();
  check(await input.inputValue() === '保留这份草稿', 'Session draft was lost');
  await page.getByRole('button', { name: '收起会话侧栏', exact: true }).click();
  await input.fill('/');
  await page.locator('#cmdMenu').waitFor({ state: 'visible' });
  await menuWidth();
  await capture('04-commands');
  await input.press('ArrowDown');
  await input.press('Tab');
  check((await input.inputValue()).startsWith('/'), 'Keyboard completion missing');
  await input.fill('@reports/');
  await page.locator('#cmdMenu').waitFor({ state: 'visible' });
  await menuWidth();
  await capture('05-references');
  await input.press('Enter');
  check((await input.inputValue()).includes('.md'), 'Directory reference completion missing');
  await input.fill('/doctor');
  await input.press('Escape');
  await input.press('Enter');
  check((await input.inputValue()).includes('/doctor'), 'Host command discarded draft');
  await input.fill('');
  await page.locator('#toast').waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: '界面设置', exact: true }).click();
  await capture('06-settings');
  await page.keyboard.press('Escape');
  await page.locator('#modal').waitFor({ state: 'hidden' });
  check(await page.getByRole('button', { name: '界面设置', exact: true }).evaluate(el => el === document.activeElement), 'Dialog focus return missing');
  await page.getByRole('button', { name: '选择模型', exact: true }).click();
  await page.locator('#modelProvider').selectOption('local');
  await page.locator('#modelName').fill('demo-model');
  await capture('07-model');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '设置数据源', exact: true }).click();
  await page.locator('#marketSource').selectOption('akshare');
  await page.keyboard.press('Escape');
  await page.reload();
  check((await page.locator('footer').innerText()).includes('demo-model'), 'Model preference did not persist');
  check((await page.locator('footer').innerText()).includes('未连接'), 'Disconnected state missing');
  check(!await page.locator('#overview').innerText().then(text => text.includes('300308.SZ')), 'Disconnected source leaked synthetic quotes');
  await capture('08-disconnected');
  await page.getByRole('button', { name: '设置数据源', exact: true }).click();
  await page.locator('#marketSource').selectOption('demo');
  await page.keyboard.press('Escape');
  await input.fill('演示运行与停止');
  await input.press('Enter');
  await page.getByRole('button', { name: '停止生成', exact: true }).waitFor();
  await capture('09-running');
  await page.getByRole('button', { name: '停止生成', exact: true }).click();
  await page.getByRole('button', { name: '发送问题', exact: true }).waitFor();
  await capture('10-stopped');
  await page.reload();
  await page.getByRole('button', { name: '证据 4 / 6 ↗', exact: true }).click();
  await capture('11-evidence');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '研究报告 ↗', exact: true }).click();
  await capture('12-report');
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 844 });
  await capture('13-mobile');
  await input.fill('@reports/');
  await menuWidth();
  await capture('14-mobile-references');
  await input.press('Escape');
  await input.fill('');
  await page.getByRole('button', { name: '选择模型', exact: true }).click();
  await capture('15-mobile-settings');
  await page.keyboard.press('Escape');
  await page.locator('#projectSwitch').click();
  await capture('16-mobile-sessions');
  await page.getByRole('button', { name: '收起会话侧栏', exact: true }).click();
  await page.getByRole('button', { name: '切换投资组合', exact: true }).click();
  await page.locator('#portfolioSelect').selectOption('indices');
  await capture('17-mobile-portfolio');
  await page.keyboard.press('Escape');
  await page.reload();
  check(await page.locator('#statusText').innerText() === '宽基指数组合', 'Portfolio preference did not persist');
  await page.setViewportSize({ width: 1440, height: 960 });
  check((await page.locator('.portfolio-group').innerText()).includes('宽基指数组合'), 'Overview portfolio title did not switch');
  check(!await page.locator('.portfolio-group').innerText().then(text => text.includes('300308.SZ')), 'Old portfolio quotes remain');
  check((await page.locator('#thread').innerText()).includes('中际旭创'), 'Portfolio switch replaced the research conversation');
  await capture('18-portfolio-overview');
  check(await page.locator('#send').innerText() === '↵', 'Idle send affordance must show Enter');
  await input.fill('组合选择不应被运行状态覆盖');
  await page.getByRole('button', { name: '发送问题', exact: true }).click();
  await page.getByRole('button', { name: '停止生成', exact: true }).waitFor();
  check(await page.locator('#statusText').innerText() === '宽基指数组合', 'Running state overwrote portfolio');
  await page.getByRole('button', { name: '界面设置', exact: true }).click();
  await page.getByRole('tab', { name: '运行状态', exact: true }).click();
  await page.locator('#stopRuntime').click();
  check(await page.locator('#stopRuntime').isDisabled(), 'Runtime stop did not disable');
  await page.keyboard.press('Escape');
  check(await page.locator('#statusText').innerText() === '宽基指数组合', 'Stopped state overwrote portfolio');
  await page.getByRole('button', { name: '设置数据源', exact: true }).click();
  await page.locator('#marketSource').selectOption('akshare');
  await page.getByRole('tab', { name: '投资组合', exact: true }).click();
  await page.locator('#portfolioSelect').selectOption('optical');
  await page.keyboard.press('Escape');
  check(await page.locator('#overview [data-component="QuoteRow"]').count() === 0, 'Portfolio switch fabricated disconnected quotes');
  await page.getByRole('button', { name: '设置数据源', exact: true }).click();
  await page.locator('#marketSource').selectOption('demo');
  await page.keyboard.press('Escape');
  check(errors.length === 0, `Browser errors: ${errors.join('; ')}`);
  return {
    passed: true,
    captures,
    browser: await page.evaluate(() => navigator.userAgent),
    checks: 'menu alignment, keyboard completion, draft retention, Host boundary, preference persistence, send/stop, focus return, no horizontal page overflow or browser errors',
  };
}
