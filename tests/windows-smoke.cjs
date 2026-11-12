const {spawn} = require('node:child_process');
const assert = require('node:assert/strict');
const {chromium} = require('playwright-core');
(async () => {
  // Do not let Qt or DLL paths from the build machine mask missing installer files.
  const env = {...process.env, PATH: `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}`,
    QTWEBENGINE_REMOTE_DEBUGGING: '127.0.0.1:9222'};
  for (const key of ['QT_PLUGIN_PATH','QT_QPA_PLATFORM_PLUGIN_PATH','QML2_IMPORT_PATH','QTWEBENGINEPROCESS_PATH']) delete env[key];
  const app = spawn(process.argv[2], [], {env, stdio: 'inherit'});
  let browser;
  try {
    for (let i=0; i<60; i++) {
      if (app.exitCode !== null) throw new Error(`App exited with ${app.exitCode}`);
      try { browser = await chromium.connectOverCDP('http://127.0.0.1:9222'); break; } catch {}
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    assert(browser, 'WebEngine did not start');
    const page = browser.contexts()[0].pages()[0];
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => typeof activeSettings !== 'undefined' && activeSettings);
    await page.locator('#open-settings').click();
    await page.waitForFunction(() => document.querySelector('#view-settings').open);
    await page.evaluate(async () => {
      await desktop('clearErrorLog');
      setNotice('settings', 'Installer smoke test', 'cancelled');
      await errorLogQueue;
    });
    assert.match(await page.locator('#error-log').inputValue(), /Installer smoke test/);
    assert(await page.locator('.toast').count());
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#view-settings').evaluate(el => el.open), false);
    await page.locator('#open-settings').click();
    await page.locator('#clear-errors').click();
    await page.waitForFunction(() => document.querySelector('#error-log').value === '');
    await page.screenshot({path:'build-win/windows-installed.png'});
    assert.deepEqual(errors, []);
    console.log('PASS: installed app, WebEngine, native bridge, settings drawer, toast, persistent journal and clear');
  } finally {
    if (browser) await browser.close();
    app.kill();
    await new Promise(resolve => app.exitCode !== null ? resolve() : app.once('exit', resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
