const nhisNamespace = 'https://www.his.bg';
const treatmentStates = {1: 'Отворено', 2: 'Затворено', 3: 'Анулирано'};
const elements = (node, tag) => Array.from(node?.children ?? [])
  .filter(element => element.namespaceURI === nhisNamespace && element.localName === tag);
const element = (node, tag) => elements(node, tag)[0];
const xmlValue = (node, tag) => element(node, tag)?.getAttribute('value') ?? '';
const conditions = nomenclatures.conditions;

function readTooth(node) {
  const index = xmlValue(node, 'toothIndex');
  const extra = xmlValue(node, 'supernumeralIndex');
  return {
    fdi: extra && index ? index + '.' + extra : index,
    date: xmlValue(node, 'dentalStatusDate').slice(0, 10),
    conditions: elements(node, 'condition').map(condition => xmlValue(condition, 'code')).filter(Boolean)
  };
}

function readProcedure(node) {
  const code = xmlValue(node, 'code');
  const type = xmlValue(node, 'type');
  const financing = xmlValue(node, 'financingSource');
  const diagnosis = element(node, 'diagnosis');
  const diagnosisCode = xmlValue(diagnosis, 'code');
  return {
    code, name: nomenclatures.procedures[code],
    date: xmlValue(node, 'datePerformed'),
    statusCode: xmlValue(node, 'status'),
    type: {code: type, name: nomenclatures.types[type]},
    financing: nomenclatures.financing[financing] || (financing ? 'Неизвестен източник' : ''),
    diagnosis: diagnosis ? {code: diagnosisCode, name: nomenclatures.diagnoses?.[diagnosisCode],
      description: xmlValue(diagnosis, 'note')} : undefined,
    note: xmlValue(node, 'note'),
    teeth: elements(node, 'tooth').map(readTooth)
  };
}

function readTreatment(result) {
  const node = element(result, 'dentalTreatment');
  if (!node) throw new Error('НЗИС върна резултат без запис за лечение.');
  const performer = element(result, 'performer');
  const statusCode = xmlValue(node, 'status');
  return {
    nrn: xmlValue(node, 'nrnDental'), statusCode,
    status: treatmentStates[statusCode] || (statusCode ? 'Неизвестен статус (' + statusCode + ')' : ''),
    start: xmlValue(node, 'treatmentStart'), end: xmlValue(node, 'treatmentEnd'),
    performer: {
      pmi: xmlValue(performer, 'pmi'), pmiDeputy: xmlValue(performer, 'pmiDeputy'),
      practiceNumber: xmlValue(performer, 'practiceNumber')
    },
    procedures: elements(node, 'dentalProcedure').map(readProcedure)
  };
}

function readDentalResponse(text, type) {
  const readable = text.replace(/^(\uFEFF?<\?xml[ \t\r\n]+version[ \t\r\n]*=[ \t\r\n]*(['"]))1\.1\2/,
    (_declaration, prefix, quote) => `${prefix}1.0${quote}`);
  const document = new DOMParser().parseFromString(readable, 'application/xml');
  const root = document.documentElement;
  const header = element(root, 'header');
  const contents = element(root, 'contents');
  if (root.namespaceURI !== nhisNamespace || root.localName !== 'message' ||
      xmlValue(header, 'messageType') !== type || !contents)
    throw new Error('Невалиден XML отговор от НЗИС.');

  if (type === 'D006') {
    const total = xmlValue(contents, 'foundNumber').trim();
    const found = Number(total);
    return {
      found: /^\+?\d+$/.test(total) && Number.isSafeInteger(found) && found <= 4294967295 ? found : null,
      treatments: elements(contents, 'results').map(readTreatment)
    };
  }
  const dentalStatus = element(contents, 'dentalStatus');
  if (!dentalStatus) throw new Error('Отговорът не съдържа дентален статус.');
  return {
    current: elements(dentalStatus, 'tooth').map(readTooth),
    history: elements(contents, 'dentalProcedure').map(readProcedure)
      .filter(({statusCode}) => !statusCode || statusCode === '6'),
    date: xmlValue(header, 'createdOn').slice(0, 10)
  };
}
