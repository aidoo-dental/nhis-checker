let activeSettings;
const settingsFields = ['lpk', 'practice', 'environment', 'driver'];
function applySettings(settings) {
  activeSettings = settings;
  for (const id of settingsFields) get(id).value = settings[id];
  get('remember').checked = settings.remember;
  get('environment-note').textContent = settings.environment === 'production'
    ? 'НЗИС · Продукционна среда' : 'НЗИС · Тестова среда';
}

function openSettings() {
  if (get('view-settings').open) return;
  if (activeSettings) applySettings(activeSettings);
  setNotice('settings', '');
  get('view-settings').append(get('toast-region'));
  get('view-settings').showModal();
  get('drawer-body').scrollTop = 0;
  updateErrorLog('errorLog');
}
get('open-settings').addEventListener('click', openSettings);
get('view-settings').addEventListener('close', () => document.body.append(get('toast-region')));
get('view-settings').addEventListener('click', event => {
  const bounds = get('view-settings').getBoundingClientRect();
  if (event.target === get('view-settings') &&
      (event.clientX < bounds.left || event.clientX > bounds.right ||
       event.clientY < bounds.top || event.clientY > bounds.bottom)) get('view-settings').close();
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
