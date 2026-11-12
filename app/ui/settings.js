let activeSettings;
const settingsFields = ['lpk', 'practice', 'environment', 'driver'];
const settingsDrawer = get('view-settings');
const settingsBackdrop = get('settings-backdrop');
let previousSettingsFocus;
function applySettings(settings) {
  activeSettings = settings;
  for (const id of settingsFields) get(id).value = settings[id];
  get('remember').checked = settings.remember;
  get('environment-note').textContent = settings.environment === 'production'
    ? 'НЗИС · Продукционна среда' : 'НЗИС · Тестова среда';
}

function openSettings() {
  if (settingsDrawer.hasAttribute('open')) return;
  previousSettingsFocus = document.activeElement;
  if (activeSettings) applySettings(activeSettings);
  setNotice('settings', '');
  settingsDrawer.append(get('toast-region'));
  if (typeof settingsDrawer.showModal === 'function') settingsDrawer.showModal();
  else {
    settingsBackdrop.hidden = false;
    settingsDrawer.setAttribute('open', '');
    settingsDrawer.setAttribute('aria-modal', 'true');
    get('close-settings').focus();
  }
  get('drawer-body').scrollTop = 0;
  updateErrorLog('errorLog');
}
function closeSettings() {
  if (typeof settingsDrawer.close === 'function') settingsDrawer.close();
  else {
    settingsDrawer.removeAttribute('open');
    settingsDrawer.removeAttribute('aria-modal');
    settingsDrawer.dispatchEvent(new Event('close'));
  }
}
get('open-settings').addEventListener('click', openSettings);
settingsBackdrop.addEventListener('click', closeSettings);
settingsDrawer.addEventListener('close', () => {
  settingsBackdrop.hidden = true;
  document.body.append(get('toast-region'));
  previousSettingsFocus?.focus();
});
document.addEventListener('focusin', event => {
  if (!settingsBackdrop.hidden && !settingsDrawer.contains(event.target)) get('close-settings').focus();
});
settingsDrawer.addEventListener('keydown', event => {
  if (settingsBackdrop.hidden) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    closeSettings();
  } else if (event.key === 'Tab') {
    const controls = [...settingsDrawer.querySelectorAll('button, input, select, textarea')]
      .filter(control => !control.disabled && control.tabIndex >= 0 && control.getClientRects().length);
    const index = controls.indexOf(document.activeElement);
    if (controls.length && (index < 0 || (event.shiftKey ? index === 0 : index === controls.length - 1))) {
      event.preventDefault();
      controls[event.shiftKey ? controls.length - 1 : 0].focus();
    }
  }
});
settingsDrawer.addEventListener('click', event => {
  const bounds = settingsDrawer.getBoundingClientRect();
  if (event.target === settingsDrawer &&
      (event.clientX < bounds.left || event.clientX > bounds.right ||
       event.clientY < bounds.top || event.clientY > bounds.bottom)) closeSettings();
});
get('settings-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const fields = Object.fromEntries(settingsFields.map(id => [id, get(id).value.trim()]));
    const next = await desktop('saveSettings', {...fields, remember: get('remember').checked});
    if (JSON.stringify(next) !== JSON.stringify(activeSettings)) resetResults();
    applySettings(next);
    setNotice('settings', 'Настройките са запазени.', 'done');
  } catch (error) { setNotice('settings', error.message, 'cancelled'); }
});
get('choose-driver').addEventListener('click', async () => {
  try {
    const {driver} = await desktop('chooseDriver');
    if (driver) get('driver').value = driver;
  } catch (error) { setNotice('settings', error.message, 'cancelled'); }
});
get('reset-driver').addEventListener('click', () => { get('driver').value = ''; });
get('check-sign').addEventListener('click', async () => {
  if (activeSettings && (get('driver').value !== activeSettings.driver || get('remember').checked !== activeSettings.remember)) {
    setNotice('settings', 'Запази промените за КЕП, преди да провериш подписването.');
    return;
  }
  try {
    const result = await desktop('checkSignature');
    setNotice('settings', 'Успешен пробен подпис · ' + result.certificate, 'done');
  } catch (error) { setNotice('settings', error.message, 'cancelled'); }
});
get('lock-sign').addEventListener('click', async () => {
  try {
    await desktop('lock');
    setNotice('settings', 'КЕП сесията е заключена.', 'done');
  } catch (error) { setNotice('settings', error.message, 'cancelled'); }
});
desktop('settings').then(applySettings).catch(error => setNotice('patient', error.message, 'cancelled'));
