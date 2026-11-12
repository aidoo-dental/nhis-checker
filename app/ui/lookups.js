const lookups = {
  status: {type: 'D010', id: '', pending: false, empty: false},
  treatments: {type: 'D006', id: '', pending: false, empty: false}
};
let busy = false;
const patientFields = {first: 'first-name', middle: 'middle-name', last: 'last-name',
  identifierType: 'id-type', identifier: 'patient-id'};
const readPatient = () => Object.fromEntries(Object.entries(patientFields).map(([name, id]) => [name, get(id).value.trim()]));
let patientKey = JSON.stringify(readPatient());
let patientVersion = 0;

function updateLookups() {
  for (const [view, lookup] of Object.entries(lookups)) {
    const section = get('view-' + view);
    get('fetch-' + view).disabled = busy;
    section.querySelector('[data-xml]').disabled = busy || !lookup.id;
    section.querySelector('[data-result]').hidden = !lookup.id;
    section.querySelector('[data-empty]').hidden = lookup.pending || Boolean(lookup.id);
    if (view === 'treatments') section.querySelector('[data-empty]').textContent = lookup.empty
      ? 'Няма намерени лечения.' : 'Изтегли леченията, за да видиш списъка.';
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
  setNotice('patient', '');
  resetResults();
}

async function fetchLookup(view) {
  if (busy) return;
  const form = get('patient-form');
  const missing = [...form.querySelectorAll('[required]')].find(field => !field.value.trim());
  if (missing) {
    setNotice('patient', 'Въведи задължителните данни за пациента.');
    if (form.reportValidity()) missing.focus();
    return;
  }
  syncPatient();
  const version = patientVersion;
  const lookup = lookups[view];
  lookup.id = '';
  lookup.empty = false;
  lookup.pending = busy = true;
  setNotice(view, 'Проверка на пациентските данни и извличане от НЗИС…', 'loading');
  updateLookups();
  try {
    const reply = await desktop('lookup', {view, ...readPatient()});
    if (version !== patientVersion) {
      if (reply.id) await desktop('discard', {view, id: reply.id});
      return;
    }
    if (reply.empty) {
      lookup.empty = true;
      setNotice(view, '');
      return;
    }
    const data = readDentalResponse(reply.xml, lookup.type);
    if (view === 'status') displayDentition(data);
    else {
      records = data.treatments;
      foundTreatmentCount = data.found;
      get('record-filter').value = '';
      populateTreatmentFilters();
      renderRecords();
    }
    lookup.id = reply.id;
    setNotice(view, 'Данните са получени от НЗИС.', 'done');
  } catch (error) {
    if (version === patientVersion) setNotice(view, error.message, 'cancelled');
  } finally {
    lookup.pending = busy = false;
    updateLookups();
  }
}

get('patient-form').addEventListener('input', syncPatient);
get('patient-form').addEventListener('change', syncPatient);
document.querySelectorAll('[data-fetch]').forEach(button => button.addEventListener('click', () => {
  selectView(button.dataset.fetch);
  fetchLookup(button.dataset.fetch);
}));
document.querySelectorAll('[data-xml]').forEach(button => button.addEventListener('click', async () => {
  const view = button.dataset.xml;
  if (busy || !lookups[view].id) return;
  try {
    const result = await desktop('saveXml', {view, id: lookups[view].id});
    if (result.saved) setNotice(view, 'Оригиналният XML отговор е запазен.', 'done');
  } catch (error) { setNotice(view, error.message, 'cancelled'); }
}));

showView(location.hash.slice(1));
