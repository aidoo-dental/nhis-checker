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
  Rp: 'Radicular-post', S: 'Splint', T: 'Calculus',
  N: 'Pulp-necrosis', Res: 'Resorption'
};
const surfaceKinds = { O:'Restoration', C:'Caries', NC:'Non-caries-lesion', DR:'Defective-restoration' };
const surfaces = {
  o:['occlusal'], m:['mesial'], d:['distal'], b:['vestibular'],
  l:['lingual','palatal'], c:['cervical_vestibular','cervical_lingual','cervical_palatal']
};

const toothTemplates = new Map();

function createToothArt(tooth, codes, upper) {
  const key = (upper ? 'upper' : 'lower') + tooth % 10;
  const quadrant = Math.floor(tooth / 10);
  const wrapper = document.createElement('div');
  wrapper.className = 'tooth-art' + ([1,3,5,7].includes(quadrant) ? ' mirrored' : '');
  wrapper.setAttribute('data-v-6523b72c', '');
  if (!toothTemplates.has(key)) {
    const parsed = new DOMParser().parseFromString(aidooGeometry[key], 'image/svg+xml');
    toothTemplates.set(key, document.importNode(parsed.documentElement, true));
  }
  const svg = toothTemplates.get(key).cloneNode(true);
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
    const surface = code.match(/^(DR|NC|O|C)([omdblc])?$/);
    if (!surface) continue;
    const color = surfaceKinds[surface[1]];
    const matchingSurfaces = surfaces[surface[2] ?? 'o'];
    for (const layer of anatomy.querySelectorAll('g[class*="-surface"]')) {
      const layerName = layer.getAttribute('class').split(' ')[0].replace(/^(up|front|back)-/, '').replace(/-surface$/, '');
      if (matchingSurfaces.includes(layerName)) layer.classList.add(color);
    }
  }
  wrapper.append(svg);
  return wrapper;
}

// Isolate SVG masks and paths from the page's layout/paint tree. The browser
// can reuse the decoded image when revisiting a snapshot or showing the tab.
const toothImageCache = new Map();
let toothImageStyles;
function makeToothArt(tooth, codes, upper) {
  const key = JSON.stringify([upper, tooth % 10, [...new Set(codes)].sort()]);
  let source = toothImageCache.get(key);
  if (!source) {
    if (toothImageStyles === undefined) {
      toothImageStyles = [...document.styleSheets].flatMap(sheet => [...sheet.cssRules])
        .filter(rule => rule.selectorText?.includes('[data-v-6523b72c]'))
        .map(rule => rule.cssText).join(' ');
    }
    const svg = createToothArt(tooth, codes, upper).firstElementChild;
    // Each cached image has its own SVG document and hatch definition.
    if (svg.querySelector('.Defective-restoration')) {
      svg.insertAdjacentHTML('afterbegin', '<defs><pattern id="dr-hatch" patternUnits="userSpaceOnUse" width="4" height="4" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="4" stroke="#2a2a2a" stroke-width="1"/></pattern></defs>');
    }
    svg.setAttribute('data-v-6523b72c', '');
    const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    style.textContent = toothImageStyles;
    svg.prepend(style);
    source = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(svg));
    // Bound memory use while browsing patients with many historical states.
    if (toothImageCache.size >= 256) toothImageCache.delete(toothImageCache.keys().next().value);
    toothImageCache.set(key, source);
  }
  const wrapper = document.createElement('div');
  wrapper.className = 'tooth-art' + ([1,3,5,7].includes(Math.floor(tooth / 10)) ? ' mirrored' : '');
  const image = document.createElement('img');
  image.alt = '';
  image.draggable = false;
  image.width = 65;
  image.height = 190;
  image.src = source;
  wrapper.append(image);
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

  positionChartTooltip(tooltip, button);
  toothTooltipAnchor = button;
  button.setAttribute('aria-describedby', tooltip.id);
}

function positionChartTooltip(tooltip, button) {
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
}

function updateToothSummary(codes) {
  get('tooth-summary').hidden = selectedTooth === null;
  if (selectedTooth === null) return;
  get('selected-tooth').textContent = 'Зъб ' + selectedTooth;
  showConditionCodes(get('selected-conditions'), codes);
}

function selectTooth(button, tooth = null, codes) {
  get('view-status').querySelectorAll('.tooth[aria-pressed="true"]').forEach(item => {
    item.setAttribute('aria-pressed', 'false');
  });
  selectedTooth = tooth;
  if (button) button.setAttribute('aria-pressed', 'true');
  updateToothSummary(codes);
}

document.addEventListener('click', event => {
  if (selectedTooth === null || event.target.closest('#dentition-chart, #additional-teeth')) return;
  selectTooth(null);
  hideToothTooltip();
}, true);

function markChangedTooth(button, changed) {
  const label = 'Ново или променено състояние спрямо предишната дата';
  button.classList.toggle('snapshot-changed', changed);
  if (changed) {
    button.setAttribute('aria-description', label);
    button.title = label;
  } else {
    button.removeAttribute('aria-description');
    button.removeAttribute('title');
  }
}

function changedSnapshotTeeth(date) {
  const dates = [...dentitionByDate.keys()].sort();
  const index = dates.indexOf(date);
  const previous = dentitionByDate.get(dates[index - 1]) ?? new Map();
  const changed = new Set();
  for (const [tooth, codes] of dentitionByDate.get(date) ?? []) {
    const before = new Set(previous.get(tooth) ?? []);
    const after = new Set(codes);
    if (!previous.has(tooth) || before.size !== after.size || [...after].some(code => !before.has(code)))
      changed.add(tooth);
  }
  return changed;
}

function renderOdontogram(statuses, changed = new Set()) {
  hideToothTooltip();
  const displayed = new Set();
  for (const [index, teeth] of quadrants.entries()) {
    const jaw = get(index < 2 ? 'upper' : 'lower');
    let quadrant = jaw.children[index % 2];
    if (!quadrant) {
      quadrant = document.createElement('div');
      quadrant.className = 'quad';
      jaw.append(quadrant);
    }
    for (const [position, permanent] of teeth.entries()) {
      const temporary = [5,6,8,7][index] * 10 + permanent % 10;
      const tooth = permanent % 10 <= 5 && statuses.has(String(temporary)) && !statuses.has(String(permanent)) ? temporary : permanent;
      displayed.add(String(tooth));
      const codes = statuses.get(String(tooth)) ?? [];
      const previous = quadrant.children[position];
      const state = JSON.stringify([tooth, codes]);
      if (previous?.dataset.state === state) {
        markChangedTooth(previous, changed.has(String(tooth)));
        previous.setAttribute('aria-pressed', String(String(tooth) === selectedTooth));
        continue;
      }
      const button = document.createElement('button');
      button.dataset.state = state;
      button.type = 'button';
      button.className = 'tooth' + (codes.includes('E') ? ' missing' : '') + (codes.length ? '' : ' unreported');
      button.setAttribute('aria-label', 'Зъб ' + tooth + (codes.length ? ', ' + codes.join(', ') : ', няма подаден статус'));
      button.setAttribute('aria-pressed', String(String(tooth) === selectedTooth));
      markChangedTooth(button, changed.has(String(tooth)));
      const number = document.createElement('span');
      number.className = 'tooth-number';
      number.textContent = tooth;
      button.append(makeToothArt(tooth, codes, index < 2), number);
      button.addEventListener('click', () => selectTooth(button, String(tooth), codes));
      button.addEventListener('pointerenter', (event) => {
        if (event.pointerType !== 'touch') showToothTooltip(button, tooth, codes);
      });
      button.addEventListener('pointerleave', () => {
        if (document.activeElement !== button) hideToothTooltip(button);
      });
      button.addEventListener('focus', () => {
        showToothTooltip(button, tooth, codes);
      });
      button.addEventListener('blur', () => hideToothTooltip(button));
      if (previous) previous.replaceWith(button);
      else quadrant.append(button);
    }
  }
  const additional = get('additional-teeth');
  additional.replaceChildren();
  for (const [tooth, codes] of statuses) {
    if (displayed.has(tooth)) continue;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'control tooth';
    button.textContent = tooth;
    button.setAttribute('aria-label', 'Зъб ' + tooth + (codes.length ? ', ' + codes.join(', ') : ', няма подаден статус'));
    button.setAttribute('aria-pressed', String(String(tooth) === selectedTooth));
    markChangedTooth(button, changed.has(String(tooth)));
    button.addEventListener('click', () => selectTooth(button, String(tooth), codes));
    additional.append(button);
  }
  get('additional-teeth-section').hidden = additional.childElementCount === 0;
}
function showDentitionDate(date) {
  const statuses = dentitionByDate.get(date);
  if (!statuses) return;
  renderOdontogram(statuses, changedSnapshotTeeth(date));
  updateToothSummary(statuses.get(selectedTooth));
  for (const button of get('dentition-timeline').querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(button.dataset.date === date));
  }
  get('dentition-chart').classList.toggle('is-historical', date < chartDate);
  const caption = date === chartDate ? 'Актуален статус' : 'Записани състояния';
  get('chart-date').textContent = caption + (date ? ' · ' + formatDate(date) : '');
}

const dateTooltip = document.createElement('div');
dateTooltip.className = 'tooth-tooltip';
dateTooltip.setAttribute('aria-hidden', 'true');
dateTooltip.hidden = true;
get('view-status').append(dateTooltip);
let dateTooltipAnchor = null;

function hideDateTooltip(button = dateTooltipAnchor) {
  if (button !== dateTooltipAnchor) return;
  dateTooltip.hidden = true;
  dateTooltipAnchor = null;
}

function renderDentitionTimeline() {
  const timeline = get('dentition-timeline');
  hideDateTooltip();
  timeline.replaceChildren();
  for (const date of [...dentitionByDate.keys()].filter(Boolean).sort()) {
    const point = document.createElement('li');
    const button = document.createElement('button');
    const label = formatDate(date) + (date === chartDate ? ' · Актуален статус' : '');
    button.type = 'button';
    button.dataset.date = date;
    button.setAttribute('aria-label', label);
    const showDateTooltip = () => {
      dateTooltipAnchor = button;
      dateTooltip.textContent = label;
      dateTooltip.hidden = false;
      positionChartTooltip(dateTooltip, button);
    };
    button.addEventListener('click', () => showDentitionDate(date));
    button.addEventListener('pointerenter', event => {
      if (event.pointerType !== 'touch') showDateTooltip();
    });
    button.addEventListener('pointerleave', () => hideDateTooltip(button));
    button.addEventListener('focus', showDateTooltip);
    button.addEventListener('blur', () => hideDateTooltip(button));
    point.append(button);
    timeline.append(point);
  }
  requestAnimationFrame(() => { timeline.scrollLeft = timeline.scrollWidth; });
}

// One cumulative snapshot per day, after replaying that day's procedures in time order.
// Missing tooth conditions are not updates; a reported condition replaces the prior set.
function buildDentitionSnapshots(treatments) {
  const procedures = treatments.filter(treatment => treatment.statusCode !== '3')
    .flatMap(treatment => treatment.procedures)
    .filter(procedure => procedure.statusCode !== '7' &&
      /^\d{4}-\d{2}-\d{2}(?:$|T)/.test(procedure.date) && Number.isFinite(Date.parse(procedure.date)))
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  const snapshots = new Map();
  const known = new Map();
  for (const procedure of procedures) {
    const updates = procedure.teeth.filter(tooth => tooth.fdi && tooth.conditions.length);
    if (!updates.length) continue;
    for (const tooth of updates) known.set(tooth.fdi, [...tooth.conditions]);
    snapshots.set(procedure.date.slice(0, 10), new Map(known));
  }
  return snapshots;
}

function displayDentition({treatments}) {
  selectedTooth = null;
  dentitionByDate = buildDentitionSnapshots(treatments);
  chartDate = [...dentitionByDate.keys()].sort().pop() || '';
  renderDentitionTimeline();
  if (chartDate) showDentitionDate(chartDate);
  else {
    renderOdontogram(new Map());
    updateToothSummary();
    get('dentition-chart').classList.remove('is-historical');
    get('chart-date').textContent = 'Няма записани състояния на зъби.';
  }
}

function hideChartTooltips() {
  hideToothTooltip();
  hideDateTooltip();
}

window.addEventListener('scroll', hideChartTooltips, true);
window.addEventListener('resize', hideChartTooltips);
window.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  hideChartTooltips();
  if (selectedTooth !== null && !get('view-settings').hasAttribute('open')) selectTooth(null);
});
