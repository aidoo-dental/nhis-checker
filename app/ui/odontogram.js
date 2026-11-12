const quadrants = [
  [18,17,16,15,14,13,12,11], [21,22,23,24,25,26,27,28],
  [48,47,46,45,44,43,42,41], [31,32,33,34,35,36,37,38]
];
let chartDate = "";
let selectedTooth = null;
let dentitionByDate = new Map();
const wholeToothClasses = {
  E: 'Missing', K: 'Crown', Kb: 'Fixed-prosthodontic-retainer',
  B: 'Fixed-prosthodontic-pontic', X: 'Removable-prosthodontic',
  P: 'Pulpitis', G: 'Periapical-lesion', R: 'Root', Pa: 'Periodontitis',
  F: 'Fracture', I: 'Implant', Re: 'Impacted', Rc: 'Root-canal-treatment',
  Rp: 'Radicular-post', S: 'Splint', T: 'Calculus'
};
const surfaceKinds = { O:'Restoration', C:'Caries' };
const surfaces = {
  o:['occlusal'], m:['mesial'], d:['distal'], b:['vestibular'],
  l:['lingual','palatal'], c:['cervical_vestibular','cervical_lingual','cervical_palatal']
};

function makeToothArt(tooth, codes, upper) {
  const key = (upper ? 'upper' : 'lower') + tooth % 10;
  const quadrant = Math.floor(tooth / 10);
  const wrapper = document.createElement('div');
  wrapper.className = 'tooth-art' + ([1,3,5,7].includes(quadrant) ? ' mirrored' : '');
  wrapper.setAttribute('data-v-6523b72c', '');
  const parser = new DOMParser();
  const svg = document.importNode(parser.parseFromString(aidooGeometry[key], 'image/svg+xml').documentElement, true);
  const ids = new Map();
  svg.querySelectorAll('[id]').forEach((element, index) => {
    const old = element.id;
    const unique = 'tooth-' + tooth + '-' + index;
    ids.set(old, unique);
    element.id = unique;
  });
  for (const element of svg.querySelectorAll('[mask], [clip-path]')) {
    for (const attribute of ['mask','clip-path']) {
      const match = element.getAttribute(attribute)?.match(/^url\(#([^)]*)\)$/);
      if (match && ids.has(match[1])) element.setAttribute(attribute, 'url(#' + ids.get(match[1]) + ')');
    }
  }
  const anatomy = svg.querySelector('g.' + key);
  for (const code of codes) {
    if (wholeToothClasses[code]) anatomy.classList.add(wholeToothClasses[code]);
    const color = surfaceKinds[code[0]];
    const matchingSurfaces = surfaces[code[1]];
    if (!color || !matchingSurfaces) continue;
    for (const layer of anatomy.querySelectorAll('g[class*="-surface"]')) {
      const layerName = layer.getAttribute('class').split(' ')[0].replace(/^(up|front|back)-/, '').replace(/-surface$/, '');
      if (matchingSurfaces.includes(layerName)) layer.classList.add(color);
    }
  }
  wrapper.append(svg);
  return wrapper;
}

function setFieldValue(element, value) {
  const missing = value === undefined || value === null || value === '';
  element.textContent = missing ? 'Няма данни' : value;
  element.classList.toggle('field-missing', missing);
}

function showConditionCodes(element, codes) {
  if (!codes?.length) {
    setFieldValue(element, null);
    return;
  }
  element.classList.remove('field-missing');
  const tags = codes.map((code) => {
    const item = document.createElement('span');
    item.className = 'tag';
    const abbreviation = document.createElement('b');
    abbreviation.textContent = code;
    item.append(abbreviation);
    if (conditions[code]) item.append(conditions[code]);
    return item;
  });
  element.replaceChildren(...tags);
}

let toothTooltipAnchor = null;

function hideToothTooltip(button = toothTooltipAnchor) {
  if (!button || button !== toothTooltipAnchor) return;
  button.removeAttribute('aria-describedby');
  get('tooth-tooltip').hidden = true;
  toothTooltipAnchor = null;
}

function showToothTooltip(button, tooth, codes) {
  if (toothTooltipAnchor === button) return;
  hideToothTooltip();
  const tooltip = get('tooth-tooltip');
  get('tooth-tooltip-name').textContent = 'Зъб ' + tooth;
  showConditionCodes(get('tooth-tooltip-conditions'), codes);
  tooltip.hidden = false;

  const margin = 8;
  const anchor = button.getBoundingClientRect();
  const { width, height } = tooltip.getBoundingClientRect();
  const viewport = document.documentElement;
  const left = anchor.left + (anchor.width - width) / 2;
  const below = anchor.bottom + margin;
  const top = below + height <= viewport.clientHeight - margin
    ? below : Math.max(margin, anchor.top - height - margin);
  tooltip.style.left = Math.max(margin, Math.min(left, viewport.clientWidth - width - margin)) + 'px';
  tooltip.style.top = top + 'px';
  toothTooltipAnchor = button;
  button.setAttribute('aria-describedby', tooltip.id);
}

function updateToothSummary(codes) {
  get('tooth-summary').hidden = selectedTooth === null;
  if (selectedTooth === null) return;
  get('selected-tooth').textContent = 'Зъб ' + selectedTooth;
  showConditionCodes(get('selected-conditions'), codes);
}

function selectTooth(button, tooth, codes) {
  document.querySelectorAll('.tooth[aria-pressed="true"]').forEach((item) => item.setAttribute('aria-pressed','false'));
  button.setAttribute('aria-pressed','true');
  selectedTooth = tooth;
  updateToothSummary(codes);
}

function renderOdontogram(statuses) {
  hideToothTooltip();
  get('upper').replaceChildren();
  get('lower').replaceChildren();
  for (const [index, teeth] of quadrants.entries()) {
    const quadrant = document.createElement('div');
    quadrant.className = 'quad';
    for (const permanent of teeth) {
      const temporary = [5,6,8,7][index] * 10 + permanent % 10;
      const tooth = permanent % 10 <= 5 && statuses.has(String(temporary)) && !statuses.has(String(permanent)) ? temporary : permanent;
      const codes = statuses.get(String(tooth)) ?? [];
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'tooth' + (codes.includes('E') ? ' missing' : '') + (codes.length ? '' : ' unreported');
      button.setAttribute('aria-label', 'Зъб ' + tooth + (codes.length ? ', ' + codes.join(', ') : ', няма подаден статус'));
      button.setAttribute('aria-pressed', String(tooth === selectedTooth));
      const number = document.createElement('span');
      number.className = 'tooth-number';
      number.textContent = tooth;
      button.append(makeToothArt(tooth, codes, index < 2), number);
      button.addEventListener('click', () => selectTooth(button, tooth, codes));
      button.addEventListener('pointerenter', (event) => {
        if (event.pointerType !== 'touch') showToothTooltip(button, tooth, codes);
      });
      button.addEventListener('pointerleave', () => {
        if (!button.matches(':focus-visible')) hideToothTooltip(button);
      });
      button.addEventListener('focus', () => {
        if (button.matches(':focus-visible')) showToothTooltip(button, tooth, codes);
      });
      button.addEventListener('blur', () => hideToothTooltip(button));
      quadrant.append(button);
    }
    get(index < 2 ? 'upper' : 'lower').append(quadrant);
  }
}
function showDentitionDate(date) {
  const statuses = dentitionByDate.get(date);
  if (!statuses) return;
  renderOdontogram(statuses);
  updateToothSummary(statuses.get(String(selectedTooth)));
  for (const button of get('dentition-timeline').querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(button.dataset.date === date));
  }
  get('dentition-chart').classList.toggle('is-historical', date < chartDate);
  const caption = date === chartDate ? 'Актуален статус' : 'Записани състояния';
  get('chart-date').textContent = caption + (date ? ' · ' + formatDate(date) : '');
}

function renderDentitionTimeline() {
  const timeline = get('dentition-timeline');
  timeline.replaceChildren();
  for (const date of [...dentitionByDate.keys()].filter(Boolean).sort()) {
    const statuses = dentitionByDate.get(date);
    const point = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.date = date;
    button.addEventListener('click', () => showDentitionDate(date));
    const time = document.createElement('time');
    time.dateTime = date;
    time.textContent = formatDate(date);
    const note = document.createElement('span');
    note.textContent = date === chartDate ? 'Актуален' :
      statuses.size === 1 ? '1 зъб с данни' : statuses.size + ' зъба с данни';
    button.append(time, note);
    point.append(button);
    timeline.append(point);
  }
}


function displayDentition({current, history, date}) {
  selectedTooth = null;
  chartDate = date || [...current.map(tooth => tooth.date), ...history.map(item => item.date.slice(0, 10))].sort().at(-1) || '';
  const updates = new Map();
  const record = (day, tooth) => {
    if (!day || (chartDate && day > chartDate)) return;
    if (!updates.has(day)) updates.set(day, new Map());
    if (tooth?.fdi && tooth.conditions.length) updates.get(day).set(tooth.fdi, tooth.conditions);
  };
  for (const procedure of history) {
    const day = procedure.date.slice(0, 10);
    record(day);
    for (const tooth of procedure.teeth) record(day, tooth);
  }
  for (const tooth of current) record(tooth.date, tooth);
  dentitionByDate = new Map();
  const known = new Map();
  for (const [day, teeth] of [...updates].sort(([a], [b]) => a.localeCompare(b))) {
    for (const [tooth, codes] of teeth) {
      // The FDI numbers for primary and permanent teeth at the same position differ by 40.
      if (/^[1-8][1-5]$/.test(tooth)) {
        const number = Number(tooth);
        known.delete(String(number < 50 ? number + 40 : number - 40));
      }
      known.set(tooth, codes);
    }
    dentitionByDate.set(day, new Map(known));
  }
  dentitionByDate.set(chartDate, new Map(current.filter(tooth => tooth.fdi).map(tooth => [tooth.fdi, tooth.conditions])));
  renderDentitionTimeline();
  showDentitionDate(chartDate);
}

window.addEventListener('scroll', () => hideToothTooltip(), true);
window.addEventListener('resize', () => hideToothTooltip());
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') hideToothTooltip();
});
