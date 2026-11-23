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
    assert(await evaluate(`(async () => {
      if (get('middle-name')) return false;
      get('first-name').value = 'Тест';
      get('last-name').value = 'Пациент';
      get('patient-id').value = '0000000000';
      syncPatient();
      const expandedHeight = get('view-patient').getBoundingClientRect().height;
      const originalDesktop = desktop;
      desktop = async () => ({id:'test-patient', xml:'<message xmlns="https://www.his.bg"><header><messageType value="D006"/></header><contents><foundNumber value="0"/></contents></message>'});
      try {
        await fetchLookup();
        if (!get('patient-form').hidden || !get('patient-summary').textContent.includes('Тест Пациент') ||
            !get('patient-summary').textContent.includes('0000000000') ||
            get('view-patient').getBoundingClientRect().height >= expandedHeight - 50 ||
            get('toggle-patient').getAttribute('aria-expanded') !== 'false') return false;
        get('toggle-patient').click();
        if (get('patient-form').hidden || !lookups.treatments.id) return false;
        get('first-name').value = 'Друг';
        get('first-name').dispatchEvent(new Event('input', {bubbles:true}));
        if (lookups.treatments.id || get('patient-form').hidden || !get('toggle-patient').hidden) return false;
        for (const id of ['first-name', 'last-name', 'patient-id']) get(id).value = '';
        syncPatient();
        return true;
      } finally { desktop = originalDesktop; }
    })()`), 'Patient form must collapse after loading and expand for another patient');
    assert(await evaluate(`(async () => {
      const originalDesktop = desktop;
      get('first-name').value = 'Тест';
      get('last-name').value = 'Пациент';
      get('patient-id').value = '0000000000';
      syncPatient();
      const xml = '<message xmlns="https://www.his.bg"><header><messageType value="D006"/></header><contents><foundNumber value="1"/><results><dentalTreatment><status value="2"/><dentalProcedure><datePerformed value="2026-01-02"/><status value="6"/><tooth><toothIndex value="11"/><condition><code value="O"/></condition></tooth></dentalProcedure><dentalProcedure><datePerformed value="2026-01-01"/><status value="6"/><tooth><toothIndex value="11"/><condition><code value="C"/></condition></tooth></dentalProcedure></dentalTreatment></results></contents></message>';
      let requests = 0;
      desktop = async (action) => { if (action === 'lookup') ++requests; return {id:'test-status', xml}; };
      try {
        await fetchLookup();
        if (requests !== 1 || document.querySelectorAll('#fetch-data').length !== 1 ||
            get('fetch-status') || get('fetch-treatments') || records.length !== 1 ||
            lookups.treatments.id !== 'test-status' || lookups.status.id !== 'test-status' || chartDate !== '2026-01-02' ||
            dentitionByDate.get(chartDate).get('11')[0] !== 'O' ||
            dentitionByDate.get('2026-01-01').get('11')[0] !== 'C') return false;
        displayDentition({treatments:[]});
        if (dentitionByDate.size || get('dentition-timeline').children.length ||
            !get('tooth-summary').hidden || get('additional-teeth').children.length) return false;
        desktop = async () => ({empty:true});
        await fetchLookup();
        return lookups.status.empty && lookups.treatments.empty && !lookups.status.id && !lookups.treatments.id &&
          get('view-status').querySelector('[data-result]').hidden;
      } finally {
        for (const id of ['first-name', 'last-name', 'patient-id']) get(id).value = '';
        syncPatient();
        desktop = originalDesktop;
      }
    })()`), 'Status lookup must replay D006 and clear empty results');
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
    assert(await evaluate(`(async()=>{
      const prefs = {lpk:'123456789', practice:'1234567890', environment:'production', driver:'', remember:true};
      const saved = await desktop('saveSettings', prefs);
      const readBack = await desktop('settings');
      setNotice('settings','Сертификатът не може да бъде прочетен.','cancelled','checkSignature');
      await errorLogQueue;
      const log = document.querySelector('#error-log').value.split('\\n\\n')[0];
      await desktop('saveSettings', {...prefs, environment:'test'});
      return saved.environment === 'production' && readBack.environment === 'production' &&
        log.includes('Локален пробен подпис') && log.includes('Сертификатът не може да бъде прочетен.') &&
        !log.includes('Тестова среда') && !log.includes('Продукционна среда');
    })()`),'The local certificate check must be logged independently of the saved NHIS environment');
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
      showView('status');
      get('view-status').querySelector('[data-result]').hidden = false;
      displayDentition({treatments:[{procedures:[{date:day,teeth:[
        {fdi:'11',date:day,conditions:['E']}, {fdi:'51',date:day,conditions:['O']},
        {fdi:'11.1',date:day,conditions:['C']}
      ]}, {date:'2026-01-03',teeth:[{fdi:'11',conditions:['O']}]}]}]});
      const additional = [...get('additional-teeth').children];
      const tooth = get('upper').querySelector('button[aria-label^="Зъб 11,"]');
      tooth.click();
      const selected = tooth.getAttribute('aria-pressed') === 'true' && !get('tooth-summary').hidden;
      get('dentition-chart').click();
      const inside = tooth.getAttribute('aria-pressed') === 'true';
      get('chart-date').click();
      const cleared = tooth.getAttribute('aria-pressed') === 'false' && get('tooth-summary').hidden;
      additional[0].click();
      const extraSelected = additional[0].getAttribute('aria-pressed') === 'true';
      const [earlier, latest] = get('dentition-timeline').querySelectorAll('button');
      const dates = earlier.dataset.date === day && latest.dataset.date === '2026-01-03' &&
        latest.getAttribute('aria-pressed') === 'true';
      earlier.dispatchEvent(new PointerEvent('pointerenter', {pointerType:'mouse'}));
      const hover = !dateTooltip.hidden && dateTooltip.textContent === '02.01.2026';
      earlier.dispatchEvent(new PointerEvent('pointerleave', {pointerType:'mouse'}));
      const left = dateTooltip.hidden;
      earlier.focus();
      const focus = !dateTooltip.hidden && dateTooltip.textContent === '02.01.2026';
      earlier.click();
      const historical = earlier.getAttribute('aria-pressed') === 'true' &&
        get('dentition-chart').classList.contains('is-historical') && get('tooth-summary').hidden;
      return additional.map(button => button.textContent).includes('51') &&
        additional.map(button => button.textContent).includes('11.1') && dentitionByDate.get(day).size === 3 &&
        selected && inside && cleared && extraSelected && dates && hover && left && focus && historical;
    })()`), 'Odontogram selection, additional teeth or status timeline failed');
    assert(await evaluate(`(async () => {
      const pixels = async (tooth, codes, upper) => {
        const image = makeToothArt(tooth, codes, upper).firstElementChild;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = 65; canvas.height = 190;
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, 65, 190).data;
      };
      for (const upper of [true, false]) {
        for (let number = 1; number <= 8; number++) {
          const tooth = (upper ? 10 : 40) + number;
          const baseline = await pixels(tooth, [], upper);
          for (const code of ['DR', 'N', 'Res', 'NC']) {
            const rendered = await pixels(tooth, [code], upper);
            if (!rendered.some((value, index) => value !== baseline[index])) return false;
          }
        }
      }
      const sources = new Set();
      for (const kind of ['DR', 'NC']) {
        for (const region of ['o', 'm', 'd', 'b', 'l', 'c']) {
          const image = makeToothArt(16, [kind + region], true).firstElementChild;
          await image.decode();
          sources.add(image.src);
          const svg = new DOMParser().parseFromString(decodeURIComponent(image.src.split(',')[1]), 'image/svg+xml');
          if (kind === 'DR' && !svg.querySelector('#dr-hatch line')) return false;
        }
      }
      return sources.size === 12;
    })()`), 'All tooth shapes must render DR, N, Res and NC, including their surface variants');
    assert(await evaluate(`(() => {
      const statuses = new Map([['11', ['C']]]);
      renderOdontogram(statuses);
      if (document.querySelectorAll('.tooth-art img').length !== 32 || document.querySelector('.tooth-art svg')) return false;
      const original = get('upper').querySelectorAll('.tooth');
      renderOdontogram(statuses);
      if (get('upper').querySelectorAll('.tooth')[7] !== original[7]) return false;
      statuses.set('11', ['E']);
      renderOdontogram(statuses);
      const updated = get('upper').querySelectorAll('.tooth');
      if (updated[0] !== original[0] || updated[7] === original[7] || !updated[7].classList.contains('missing')) return false;
      records = Array.from({length:205}, (_, i) => ({nrn:String(i), statusCode:'2', status:'Затворено', start:'2026-01-01',
        procedures:[{date:'2026-01-01', code:'101', teeth:[{fdi:'11',conditions:['C']}]}]}));
      populateTreatmentFilters();
      recordPage = 0; renderRecords();
      const seen = new Set();
      for (let page = 0; page < 3; page++) {
        const rows = get('records').querySelectorAll('.summary-row');
        if (rows.length !== (page === 2 ? 5 : 100)) return false;
        for (const row of rows) seen.add(row.cells[6].textContent);
        if (page < 2) get('records-next').click();
      }
      if (seen.size !== 205 || !get('records-next').disabled) return false;
      get('record-tooth').value = '11';
      get('record-tooth').dispatchEvent(new Event('change'));
      const reset = recordPage === 0 && get('records').querySelectorAll('.summary-row').length === 100;
      records = []; populateTreatmentFilters(); renderRecords();
      return reset;
    })()`), 'Tooth reuse and complete paginated treatment navigation failed');
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
