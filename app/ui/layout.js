'use strict';
const get = (id) => document.getElementById(id);
const views = ['status', 'treatments'];
const labels = { status:'Дентален статус', treatments:'Лечения' };
const appName = document.title;

function showView(view) {
  const active = views.includes(view) ? view : 'status';
  if (active !== 'status') hideToothTooltip();
  for (const name of views) {
    const selected = name === active;
    const tab = get('tab-' + name);
    get('view-' + name).hidden = !selected;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
  }
  document.title = labels[active] + ' · ' + appName;
  document.querySelector('main').scrollTop = 0;
}
function selectView(view) {
  showView(view);
  location.hash = view;
}

document.querySelectorAll('[data-view]').forEach((button) =>
  button.addEventListener('click', () => selectView(button.dataset.view)));
get('lookup-tabs').addEventListener('keydown', (event) => {
  const current = views.indexOf(event.target.dataset.view);
  if (current < 0) return;
  const next = {
    ArrowLeft: (current - 1 + views.length) % views.length,
    ArrowRight: (current + 1) % views.length,
    Home: 0,
    End: views.length - 1
  }[event.key];
  if (next === undefined) return;
  event.preventDefault();
  const tab = get('tab-' + views[next]);
  tab.focus();
  tab.click();
});
window.addEventListener('hashchange', () => showView(location.hash.slice(1)));
get('patient-form').addEventListener('submit', (event) => event.preventDefault());
get('close-settings').addEventListener('click', () => get('view-settings').close());

function formatDate(date) { return date.split('-').reverse().join('.'); }
function visitStamp(value, treatmentStart) {
  const [date, recordedTime] = (value ?? '').split('T');
  const [startDate, startTime] = (treatmentStart ?? '').split('T');
  const startOnSameDate = date && date === startDate ? startTime : null;
  const clock = (recordedTime || startOnSameDate)?.match(/^\d{2}:\d{2}/)?.[0];
  const stamp = document.createElement('span');
  stamp.className = 'visit-date';
  const day = document.createElement('span');
  day.className = 'visit-day';
  setFieldValue(day, date ? formatDate(date) : null);
  const time = document.createElement('span');
  time.className = 'visit-time';
  time.textContent = clock || 'Няма час';
  if (clock && !recordedTime) {
    time.title = 'Час на начало на лечението';
    time.setAttribute('aria-label', 'Начало на лечението ' + clock);
  }
  stamp.append(day, time);
  return stamp;
}

function codeLabel(value) {
  return [value?.name, value?.code].filter(Boolean).join(' · ');
}

function appendField(list, label, value) {
  const field = document.createElement('div');
  const title = document.createElement('dt');
  title.textContent = label;
  const detail = document.createElement('dd');
  if (value?.nodeType === 1) detail.append(value);
  else setFieldValue(detail, value);
  field.append(title, detail);
  list.append(field);
}
