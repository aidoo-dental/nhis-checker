const {spawn} = require('node:child_process');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  const env = {...process.env, PATH: `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}`,
    QTWEBENGINE_REMOTE_DEBUGGING: '127.0.0.1:9222'};
  for (const key of ['QT_PLUGIN_PATH','QT_QPA_PLATFORM_PLUGIN_PATH','QML2_IMPORT_PATH','QTWEBENGINEPROCESS_PATH']) delete env[key];
  const webview2 = process.argv[3] === 'ON';
  let browserData;
  if (webview2) {
    browserData = await fs.mkdtemp(path.join(os.tmpdir(), 'nhis-webview2-smoke-'));
    env.WEBVIEW2_USER_DATA_FOLDER = browserData;
    env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9222';
    env.QT_FORCE_STDERR_LOGGING = '1';
    delete env.QTWEBENGINE_REMOTE_DEBUGGING;
  }
  const app = spawn(process.argv[2], [], {env, stdio: 'inherit'});
  let spawnError, ws;
  app.on('error', error => { spawnError = error; });
  const closed = new Promise(resolve => app.once('close', resolve));
  try {
    let target, lastError;
    for (let i=0; i<60; i++) {
      if (spawnError) throw spawnError;
      if (app.exitCode !== null) throw new Error(`App exited with ${app.exitCode}`);
      try {
        const targets = await (await fetch('http://127.0.0.1:9222/json/list')).json();
        target = targets.find(t => t.type === 'page' && (!webview2 || t.url === 'https://nhis-checker.invalid/index.html'));
        if (target) break;
      } catch (e) { lastError = e.message; }
      await delay(500);
    }
    assert(target, `No application page: ${lastError}`);
    // Qt exposes page targets; connect directly without full Chrome browser commands.
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve,reject) => {ws.onopen=resolve;ws.onerror=reject;});
    let id = 0;
    const pending = new Map(), errors = [];
    ws.onmessage = event => {
      const msg = JSON.parse(event.data);
      if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.text);
      if (pending.has(msg.id)) {
        const {resolve,reject,timer} = pending.get(msg.id);pending.delete(msg.id);clearTimeout(timer);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      }
    };
    const send = (method,params={}) => new Promise((resolve,reject) => {
      const key=++id;
      const timer=setTimeout(()=>{pending.delete(key);reject(new Error(`CDP timeout: ${method}`));},15000);
      pending.set(key,{resolve,reject,timer});ws.send(JSON.stringify({id:key,method,params}));
    });
    const evaluate = async expression => {
      const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
      if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    await send('Runtime.enable');
    let ready=false;
    for(let i=0;i<60;i++) {
      ready=await evaluate("typeof activeSettings !== 'undefined' && !!activeSettings");
      if(ready)break;
      await delay(500);
    }
    assert(ready,'Native settings bridge did not initialize');
    if (webview2) {
      assert(await evaluate("!!window.chrome?.webview && !window.qt?.webChannelTransport"));
      await evaluate("location.assign('https://outside.invalid/')");
      await delay(300);
      assert.equal(await evaluate('location.href'), 'https://nhis-checker.invalid/index.html');
      await evaluate("document.querySelector('#tab-treatments').click()");
      assert.equal(await evaluate('location.hash'), '#treatments');
      assert(await evaluate("(async () => (await desktop('settings')).environment === 'test')()"),
        'Native bridge stopped responding after changing tabs');
      const sample = 'Тест на клипборда';
      await evaluate("desktop('copyErrorLog', {text: " + JSON.stringify(sample) + "})");
      await send('Page.bringToFront');
      await evaluate("document.querySelector('#first-name').focus()");
      const paste = {key:'v', code:'KeyV', windowsVirtualKeyCode:86, modifiers:2};
      await send('Input.dispatchKeyEvent', {type:'rawKeyDown', ...paste});
      await send('Input.dispatchKeyEvent', {type:'keyUp', ...paste});
      let pasted;
      for (let i = 0; i < 20; i++) {
        pasted = await evaluate("document.querySelector('#first-name').value");
        if (pasted === sample) break;
        await delay(100);
      }
      assert.equal(pasted, sample, 'Clipboard paste into the patient form failed');
      await evaluate("document.querySelector('#first-name').value = ''");
    }
    assert(await evaluate(`(async()=>{
      document.querySelector('#open-settings').click();
      await desktop('clearErrorLog');
      setNotice('settings',['Installer smoke test','Неуспешна дентална справка D005 (HTTP 400).','Код E003'].join(String.fromCharCode(10)),'cancelled');
      await errorLogQueue;
      const log = document.querySelector('#error-log').value;
      return document.querySelector('#view-settings').open && log.includes('E003') && log.includes('HTTP 400') &&
        !log.includes('Installer smoke test') && !!document.querySelector('.toast');
    })()`),'Drawer, native journal or toast failed');
    await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    assert.equal(await evaluate("document.querySelector('#view-settings').open"),false);
    assert(await evaluate(`(() => {
      const drawer = document.querySelector('#view-settings');
      drawer.showModal = undefined;
      drawer.close = undefined;
      openSettings();
      const opened = drawer.hasAttribute('open') && !get('settings-backdrop').hidden;
      closeSettings();
      delete drawer.showModal;
      delete drawer.close;
      return opened && !drawer.hasAttribute('open') && get('settings-backdrop').hidden;
    })()`), 'Settings fallback did not open and close');
    assert(await evaluate(`(() => {
      const day = '2026-01-02';
      displayDentition({date:'2026-01-03',history:[],current:[
        {fdi:'11',date:day,conditions:['E']}, {fdi:'51',date:day,conditions:['O']},
        {fdi:'11.1',date:day,conditions:['C']}
      ]});
      const additional = [...get('additional-teeth').children].map(button => button.textContent);
      return additional.includes('51') && additional.includes('11.1') &&
        dentitionByDate.get(day).size === 3;
    })()`), 'Mixed dentition or supernumerary tooth disappeared');
    assert(await evaluate(`(async()=>{document.querySelector('#open-settings').click();document.querySelector('#clear-errors').click();await errorLogQueue;return document.querySelector('#error-log').value==='';})()`));
    await evaluate(`(() => {
      document.querySelector('#view-settings').close();
      showView('treatments');
      document.querySelector('#view-treatments [data-result]').hidden=false;
      const body=document.querySelector('#records');
      for(let row=0;row<60;row++) {
        const tr=body.insertRow();tr.className='summary-row';
        for(let col=0;col<7;col++)tr.insertCell().textContent='Test '+row+' / '+col;
      }
    })()`);
    for(const offset of [400,900]) {
      await evaluate(`document.querySelector('main').scrollTop=${offset}`);
      await delay(100);
      assert(await evaluate(`(() => {
        const main=document.querySelector('main').getBoundingClientRect();
        const cells=[...document.querySelectorAll('.treatment-table th')];
        return cells.length===7 && cells.every(cell=>Math.abs(cell.getBoundingClientRect().top-main.top)<2);
      })()`),'Column headings must stay at the top of the results viewport');
    }
    await fs.mkdir('build-win',{recursive:true});
    const screenshot=await send('Page.captureScreenshot',{format:'png'});
    await fs.writeFile('build-win/windows-installed.png',Buffer.from(screenshot.data,'base64'));
    assert.deepEqual(errors,[]);
    console.log(`PASS: installed app, ${webview2 ? 'WebView2' : 'WebEngine'}, native bridge, drawer, toast and journal`);
  } finally {
    if(ws)ws.close();
    app.kill();
    await closed;
    if (browserData) {
      await fs.rm(browserData, {recursive: true, force: true, maxRetries: 8, retryDelay: 250});
    }
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
