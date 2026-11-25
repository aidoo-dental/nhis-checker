const lookups = {
  status: {id: '', pending: false, empty: false},
  treatments: {id: '', pending: false, empty: false}
};
let busy = false;
// Durations only: no identifiers or response contents are retained here.
let lastLookupTimings = {};
const patientFields = {first: 'first-name', last: 'last-name',
  identifierType: 'id-type', identifier: 'patient-id'};
const readPatient = () => Object.fromEntries(Object.entries(patientFields).map(([name, id]) => [name, get(id).value.trim()]));
let patientKey = JSON.stringify(readPatient());
let patientVersion = 0;
let loadedPatient = false;

function setPatientCollapsed(collapsed) {
  const patient = readPatient();
  const toggle = get('toggle-patient');
  get('patient-summary').textContent = `${patient.first} ${patient.last} · ${get('id-type').selectedOptions[0].textContent}: ${patient.identifier}`;
  get('patient-summary').hidden = !collapsed;
  get('patient-form').hidden = collapsed;
  get('view-patient').classList.toggle('is-collapsed', collapsed);
  toggle.hidden = !loadedPatient;
  toggle.setAttribute('aria-expanded', String(!collapsed));
  const label = collapsed ? 'Разгъни полетата за друг пациент' : 'Свий полетата за пациента';
  toggle.setAttribute('aria-label', label);
  toggle.title = label;
  if (collapsed && get('patient-form').contains(document.activeElement)) toggle.focus();
}

function patientLoaded() {
  loadedPatient = true;
  setPatientCollapsed(true);
}

get('toggle-patient').addEventListener('click', () => {
  const expand = get('patient-form').hidden;
  setPatientCollapsed(!expand);
  if (expand) get('first-name').focus();
});

function updateLookups() {
  get('fetch-data').disabled = busy;
  for (const [view, lookup] of Object.entries(lookups)) {
    const section = get('view-' + view);
    section.querySelector('[data-xml]').disabled = busy || !lookup.id;
    section.querySelector('[data-result]').hidden = !lookup.id;
    section.querySelector('[data-empty]').hidden = lookup.pending || Boolean(lookup.id);
    if (view === 'status') section.querySelector('[data-empty]').textContent = lookup.empty
      ? 'Няма намерени лечения за изчисляване на статус. Името не може да се потвърди.' : 'Изтегли данните, за да видиш зъбната схема.';
    if (view === 'treatments') section.querySelector('[data-empty]').textContent = lookup.empty
      ? 'Няма намерени лечения. Името не може да се потвърди.' : 'Изтегли данните, за да видиш списъка.';
  }
}
function resetResults() {
  ++patientVersion;
  for (const [view, lookup] of Object.entries(lookups)) {
    if (lookup.id) desktop('discard', {view, id: lookup.id}).catch(() => {});
    lookup.id = '';
    lookup.empty = false;
    setNotice(view, '');
  }
  records = [];
  recordPage = 0;
  foundTreatmentCount = 0;
  populateTreatmentFilters();
  renderRecords();
  dentitionByDate.clear();
  hideToothTooltip();
  for (const id of ['upper', 'lower', 'dentition-timeline']) get(id).replaceChildren();
  get('additional-teeth').replaceChildren();
  get('tooth-summary').hidden = true;
  updateLookups();
}
function syncPatient() {
  const key = JSON.stringify(readPatient());
  if (patientKey === key) return;
  patientKey = key;
  loadedPatient = false;
  setPatientCollapsed(false);
  setNotice('patient', '');
  resetResults();
}

async function fetchLookup() {
  const view = get('view-status').hidden ? 'treatments' : 'status';
  if (busy) return;
  const form = get('patient-form');
  const missing = [...form.querySelectorAll('[required]')].find(field => !field.value.trim());
  if (missing) {
    setNotice('patient', 'Въведи задължителните данни за пациента.');
    if (form.reportValidity()) missing.focus();
    return;
  }
  syncPatient();
  resetResults();
  const version = patientVersion;
  busy = true;
  for (const lookup of Object.values(lookups)) lookup.pending = true;
  setNotice(view, 'Проверка на пациентските данни и извличане от НЗИС…', 'loading');
  updateLookups();
  try {
    const started = performance.now();
    const reply = await desktop('lookup', {view, ...readPatient()});
    lastLookupTimings = {requestMs: performance.now() - started};
    if (version !== patientVersion) {
      if (reply.id) await Promise.all(Object.keys(lookups).map(view => desktop('discard', {view, id: reply.id})));
      return;
    }
    if (reply.empty) {
      for (const lookup of Object.values(lookups)) lookup.empty = true;
      setNotice(view, '');
      patientLoaded();
      return;
    }
    setNotice(view, 'Данните са получени. Подготовка на изгледите…', 'loading');
    await new Promise(resolve => setTimeout(resolve, 16));
    if (version !== patientVersion) {
      await Promise.all(Object.keys(lookups).map(view => desktop('discard', {view, id: reply.id})));
      return;
    }
    let stage = performance.now();
    const data = readDentalResponse(reply.xml);
    lastLookupTimings.xmlParseMs = performance.now() - stage;
    stage = performance.now();
    displayDentition(data);
    lastLookupTimings.dentitionMs = performance.now() - stage;
    stage = performance.now();
    records = data.treatments;
    foundTreatmentCount = data.found;
    get('record-filter').querySelectorAll('input').forEach(input => { input.checked = input.value !== 'Анулирано'; });
    populateTreatmentFilters();
    renderRecords();
    lastLookupTimings.treatmentsMs = performance.now() - stage;
    for (const lookup of Object.values(lookups)) lookup.id = reply.id;
    setNotice(view, 'Данните са получени от НЗИС.', 'done');
    patientLoaded();
  } catch (error) {
    if (version === patientVersion) setNotice(view, error.message, 'cancelled');
  } finally {
    busy = false;
    for (const lookup of Object.values(lookups)) lookup.pending = false;
    updateLookups();
  }
}

get('patient-form').addEventListener('input', syncPatient);
get('patient-form').addEventListener('change', syncPatient);
get('patient-form').addEventListener('submit', event => {
  event.preventDefault();
  fetchLookup();
});
document.querySelectorAll('[data-xml]').forEach(button => button.addEventListener('click', async () => {
  const view = button.dataset.xml;
  if (busy || !lookups[view].id) return;
  try {
    const result = await desktop('saveXml', {view, id: lookups[view].id});
    if (result.saved) setNotice(view, 'Оригиналният XML отговор е запазен.', 'done');
  } catch (error) { setNotice(view, error.message, 'cancelled'); }
}));

showView(location.hash.slice(1));
