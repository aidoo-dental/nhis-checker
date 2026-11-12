const activeToasts = new Map();
let errorLogQueue = Promise.resolve();

function renderErrorLog(entries) {
  get('error-log').value = entries.map(entry => {
    const time = new Date(entry.time).toLocaleString('bg-BG', {hour12: false});
    const environment = entry.environment === 'production' ? 'Продукционна среда' : 'Тестова среда';
    return time + ' · ' + entry.context + '\n' + environment + ' · NHIS Checker ' +
      entry.version + '\n' + entry.message;
  }).join('\n\n');
  get('copy-errors').disabled = get('clear-errors').disabled = entries.length === 0;
}

function updateErrorLog(action, data = {}) {
  errorLogQueue = errorLogQueue.then(async () => {
    try {
      const reply = await desktop(action, data);
      renderErrorLog(reply.entries);
      get('error-log-note').textContent = 'Последните 100 грешки се запазват на този компютър.';
    } catch (error) {
      get('error-log-note').textContent = error.message;
    }
  });
  return errorLogQueue;
}

function setNotice(view, message, state = 'info') {
  const notice = get('view-' + view).querySelector('[data-notice]');
  notice.textContent = state === 'loading' ? message : '';
  activeToasts.get(view)?.dismiss();
  if (!message || state === 'loading') return;
  if (state === 'cancelled') {
    updateErrorLog('logError', {view, message});
  }
  const toast = document.createElement('div');
  toast.className = 'toast';
  if (state === 'done' || state === 'cancelled') {
    const icon = statusIcon('', state);
    icon.removeAttribute('title');
    icon.setAttribute('aria-hidden', 'true');
    toast.append(icon);
  }
  const text = document.createElement('div');
  text.className = 'toast-message';
  text.setAttribute('role', state === 'cancelled' ? 'alert' : 'status');
  text.textContent = message;
  toast.append(text);
  if (state === 'cancelled') {
    const details = document.createElement('button');
    details.type = 'button';
    details.className = 'toast-details';
    details.textContent = 'Журнал';
    details.addEventListener('click', () => {
      openSettings();
      get('error-log-section').scrollIntoView({block: 'start'});
      get('error-log').focus({preventScroll: true});
      dismiss();
    });
    toast.append(details);
  }
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'toast-close';
  close.textContent = '×';
  close.setAttribute('aria-label', 'Затвори известието');
  toast.append(close);
  let timer;
  let remaining = state === 'cancelled' ? 10000 : 4500;
  let started;
  function dismiss() {
    clearTimeout(timer);
    toast.remove();
    activeToasts.delete(view);
  }
  function pause() {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
    remaining = Math.max(0, remaining - (Date.now() - started));
  }
  function resume() {
    if (!toast.isConnected || timer || toast.matches(':hover') || toast.contains(document.activeElement)) return;
    started = Date.now();
    timer = setTimeout(dismiss, remaining);
  }
  close.addEventListener('click', dismiss);
  toast.addEventListener('mouseenter', pause);
  toast.addEventListener('mouseleave', resume);
  toast.addEventListener('focusin', pause);
  toast.addEventListener('focusout', () => setTimeout(resume, 0));
  activeToasts.set(view, {dismiss});
  get('toast-region').append(toast);
  if (activeToasts.size > 3) activeToasts.values().next().value.dismiss();
  resume();
}

get('clear-errors').addEventListener('click', () => updateErrorLog('clearErrorLog'));
get('copy-errors').addEventListener('click', async () => {
  try {
    await desktop('copyErrorLog', {text: get('error-log').value});
    setNotice('settings', 'Журналът е копиран.', 'done');
  } catch (error) {
    setNotice('settings', error.message, 'cancelled');
  }
});
