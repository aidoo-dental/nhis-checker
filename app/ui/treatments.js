let records = [];
let foundTreatmentCount = 0;

function treatmentState(record) {
  const hasEndDate = Boolean(record.end) && Number.isFinite(Date.parse(record.end));
  if (record.statusCode === '2' || (record.statusCode === '1' && hasEndDate)) return 'Приключено';
  return record.status;
}

function statusIcon(label, state) {
  const icon = document.createElement('span');
  const name = label || 'Няма данни';
  icon.className = 'status-icon ' + (state || 'unknown');
  icon.title = name;
  icon.setAttribute('role', 'img');
  icon.setAttribute('aria-label', name);
  return icon;
}

function toothChips(teeth) {
  const result = document.createElement('span');
  result.className = 'tooth-chips';
  const numbers = [...new Set((teeth ?? []).map((tooth) => tooth.fdi).filter(Boolean).map(String))]
    .sort((a, b) => a.localeCompare(b, 'en', {numeric: true}));
  if (!numbers.length) setFieldValue(result, null);
  const labels = [];
  for (let start = 0; start < numbers.length;) {
    let end = start;
    while (/^(?:[1-4][1-8]|[5-8][1-5])$/.test(numbers[end]) &&
           /^(?:[1-4][1-8]|[5-8][1-5])$/.test(numbers[end + 1]) &&
           numbers[end][0] === numbers[end + 1][0] &&
           Number(numbers[end + 1]) === Number(numbers[end]) + 1) {
      ++end;
    }
    if (end - start >= 2) labels.push(numbers[start] + '–' + numbers[end]);
    else labels.push(...numbers.slice(start, end + 1));
    start = end + 1;
  }
  if (numbers.length > 1) {
    result.title = 'Зъби ' + numbers.join(', ');
    result.setAttribute('aria-label', result.title);
  }
  for (const number of labels) {
    const chip = document.createElement('span');
    chip.className = 'tooth-chip';
    chip.textContent = number;
    result.append(chip);
  }
  return result;
}

function diagnosisDisplay(diagnosis) {
  const result = document.createElement('span');
  setFieldValue(result, diagnosis?.name || diagnosis?.code);
  if (diagnosis?.name && diagnosis.code) {
    const code = document.createElement('span');
    code.className = 'code diagnosis-code';
    code.textContent = diagnosis.code;
    result.append(code);
  }
  return result;
}

function activityName(procedure, fallback = 'Дентална дейност') {
  const activity = document.createElement('span');
  activity.className = 'activity-name';
  const code = document.createElement('span');
  code.className = 'code procedure-code';
  code.title = 'Код на дейността';
  setFieldValue(code, procedure.code);
  const name = document.createElement('span');
  name.textContent = procedure.name || fallback;
  activity.append(code, name);
  return activity;
}

function procedureConditions(teeth = []) {
  if (teeth.length <= 1) {
    const codes = document.createElement('div');
    codes.className = 'detail-list';
    showConditionCodes(codes, teeth[0]?.conditions);
    return codes;
  }
  const list = document.createElement('ul');
  list.className = 'condition-teeth';
  for (const tooth of [...teeth].sort((a, b) =>
    String(a.fdi ?? '').localeCompare(String(b.fdi ?? ''), 'en', {numeric: true}))) {
    const row = document.createElement('li');
    const codes = document.createElement('div');
    codes.className = 'detail-list';
    showConditionCodes(codes, tooth.conditions);
    row.append(toothChips([tooth]), codes);
    list.append(row);
  }
  return list;
}

function appendDetailSection(detail, heading) {
  const section = document.createElement('section');
  const title = document.createElement('h3');
  title.textContent = heading;
  const fields = document.createElement('dl');
  fields.className = 'detail-fields';
  section.append(title, fields);
  detail.append(section);
  return fields;
}

function treatmentDetails(record, procedure) {
  const detail = document.createElement('div');
  detail.className = 'record-detail';
  const activity = appendDetailSection(detail, 'За дейността');
  appendField(activity, 'Тип дейност', codeLabel(procedure.type));
  appendField(activity, 'Статус на дейността', nomenclatures.procedureStatus[procedure.statusCode] ||
    (procedure.statusCode ? 'Неизвестен статус (' + procedure.statusCode + ')' : null));
  appendField(activity, 'Финансиране', procedure.financing);
  appendField(activity, 'Състояние по зъб', procedureConditions(procedure.teeth));
  appendField(activity, 'Допълнително описание на диагнозата', procedure.diagnosis?.description);
  appendField(activity, 'Бележки', procedure.note);

  const treatment = appendDetailSection(detail, 'Лечение и изпълнител');
  const [day, clock] = (procedure.date || record.start || '').split('T');
  const [startDay, startClock] = (record.start ?? '').split('T');
  // The table already shows the start clock for procedures on that day without their own time.
  const startShown = startDay && day === startDay && (!clock || clock.slice(0, 5) === startClock?.slice(0, 5));
  if (!startShown) appendField(treatment, 'Начало на лечението', record.start ? visitStamp(record.start) : null);
  appendField(treatment, 'Край на лечението', record.end ? visitStamp(record.end) : null);
  const { pmi, pmiDeputy, practiceNumber } = record.performer ?? {};
  if (!pmiDeputy) appendField(treatment, 'ЛПК на заместващия лекар', null);
  else if (pmi !== pmiDeputy) appendField(treatment, 'ЛПК на титуляря', pmi);
  appendField(treatment, 'РЗИ номер на практиката', practiceNumber);
  return detail;
}

function treatmentCell(row, label, className = '') {
  const cell = row.insertCell();
  cell.className = className;
  cell.dataset.label = label;
  cell.setAttribute('role', 'cell');
  return cell;
}

function treatmentDay(record, procedure) {
  return (procedure?.date || record.start || '').split('T')[0];
}

function treatmentSortDate(record, procedure) {
  const day = treatmentDay(record, procedure);
  if (!day) return '';
  const time = (procedure.date || '').split('T')[1] ||
    (day === record.start?.split('T')[0] ? record.start.split('T')[1] : '');
  return day + 'T' + (time?.slice(0, 8) || '00:00:00');
}

function populateTreatmentFilters() {
  const procedures = records.flatMap((record) => record.procedures ?? []);
  const dates = new Set(records.flatMap((record) => record.procedures?.length
    ? record.procedures.map((procedure) => treatmentDay(record, procedure))
    : [treatmentDay(record)]).filter(Boolean));
  const teeth = new Set(procedures.flatMap((procedure) =>
    (procedure.teeth ?? []).map((tooth) => tooth.fdi).filter(Boolean).map(String)));
  for (const [id, values, label] of [
    ['record-date', [...dates].sort().reverse(), formatDate],
    ['record-tooth', [...teeth].sort((a, b) => Number(a) - Number(b)), String]
  ]) {
    const select = get(id);
    select.length = 1;
    for (const value of values) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label(value);
      select.append(option);
    }
  }
}

function renderRecords() {
  const filter = get('record-filter').value;
  const date = get('record-date').value;
  const tooth = get('record-tooth').value;
  const matching = records.filter((record) => !filter || treatmentState(record) === filter).map((record) => {
    const procedures = record.procedures?.length ? record.procedures : [{}];
    return {
      record,
      procedures: procedures.filter((procedure) =>
        (!date || treatmentDay(record, procedure) === date) &&
        (!tooth || procedure.teeth?.some((entry) => String(entry.fdi) === tooth)))
    };
  }).filter(({ procedures }) => procedures.length > 0);
  const rows = get('records');
  rows.replaceChildren();
  get('records-count').textContent = 'Получени лечения (' + records.length + ')';
  get('records-limit').textContent = foundTreatmentCount === null
    ? 'НЗИС не посочи валиден общ брой лечения.'
    : records.length < foundTreatmentCount
      ? 'НЗИС върна ' + records.length + ' от ' + foundTreatmentCount + ' лечения. Справката е непълна.'
      : records.length > foundTreatmentCount
        ? 'НЗИС посочи общ брой ' + foundTreatmentCount + ', а върна ' + records.length + ' записа.' : '';
  get('records-filtered').textContent = matching.length < records.length
    ? 'Филтрирани: ' + matching.length + ' от ' + records.length + ' получени лечения.' : '';
  get('no-records').hidden = matching.length !== 0;
  const entries = matching.flatMap(({record, procedures}, recordIndex) =>
    procedures.map((procedure, index) => ({record, procedure, recordIndex, index})));
  entries.sort((a, b) => treatmentSortDate(b.record, b.procedure)
    .localeCompare(treatmentSortDate(a.record, a.procedure)));
  let previousRecord;
  for (const {record, procedure, recordIndex, index} of entries) {
    const detailsId = 'treatment-details-' + recordIndex + '-' + index;
    const row = rows.insertRow();
    row.className = record !== previousRecord ? 'summary-row treatment-start' : 'summary-row';
    previousRecord = record;
    row.setAttribute('role', 'row');
    treatmentCell(row, 'Дата и час').append(visitStamp(procedure.date || record.start, record.start));
    treatmentCell(row, 'Зъб').append(toothChips(procedure.teeth));
    treatmentCell(row, 'Диагноза', 'diagnosis-cell').append(diagnosisDisplay(procedure.diagnosis));
    const toggle = document.createElement('button');
    toggle.className = 'activity-toggle';
    toggle.type = 'button';
    toggle.setAttribute('aria-controls', detailsId);
    toggle.setAttribute('aria-expanded', 'false');
    toggle.append(activityName(procedure, 'Детайли за лечението'));
    treatmentCell(row, 'Дейност', 'activity-cell').append(toggle);
    const doctor = treatmentCell(row, 'ЛПК на лекаря', 'code record-id');
    const status = treatmentCell(row, 'Лечение', 'record-state');
    const nrnCell = treatmentCell(row, 'НРН', 'code record-id');
    setFieldValue(doctor, record.performer?.pmiDeputy || record.performer?.pmi);
    const state = treatmentState(record);
    const stateIcon = {'Приключено': 'done', 'Анулирано': 'cancelled'}[state];
    if (stateIcon) status.append(statusIcon(state, stateIcon));
    else setFieldValue(status, state);
    status.title = state === 'Приключено' && record.statusCode === '1'
      ? 'Приключено според върнатата крайна дата.' : '';
    setFieldValue(nrnCell, record.nrn);

    const details = rows.insertRow();
    details.id = detailsId;
    details.className = 'detail-row';
    details.hidden = true;
    details.setAttribute('role', 'row');
    const cell = details.insertCell();
    cell.setAttribute('role', 'cell');
    cell.colSpan = 7;
    toggle.addEventListener('click', () => {
      const expanding = details.hidden;
      if (expanding && !cell.firstElementChild) cell.append(treatmentDetails(record, procedure));
      details.hidden = !expanding;
      toggle.setAttribute('aria-expanded', String(expanding));
    });
  }
}
for (const id of ['record-filter', 'record-date', 'record-tooth']) get(id).addEventListener('change', renderRecords);
