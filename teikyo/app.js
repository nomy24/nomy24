/* 提供票チェック — 画面の組み立てと、読み取り〜照合の流れ */

import * as store from './store.js';
import * as scan from './scan.js';
import {
  WEEKDAY_LABELS, WEEK_PATTERNS, emptyPattern, currentMonth, daysInMonth,
  weekdayOf, dateKey, formatMonth, compare, partsText, patternText,
} from './schedule.js';

const $ = (id) => document.getElementById(id);

const ROW_KINDS = [
  { value: 'actual-am', label: '実績・午前' },
  { value: 'actual-pm', label: '実績・午後' },
  { value: 'plan-am', label: '予定・午前' },
  { value: 'plan-pm', label: '予定・午後' },
  { value: 'skip', label: '読まない' },
];

const STATUS_LABELS = {
  unplanned: '予定外の利用',
  missing: 'マークなし',
  part: '時間帯ちがい',
};

const state = {
  step: 1,
  image: null,          // 読み込んだ画像（canvas）
  corners: null,        // 表の四隅（画像の座標）
  measurement: null,    // scan.measure の結果
  rowKinds: [],         // 読み取ったときの行の設定（あとで変えても結果とずれないよう控える）
  threshold: 0.1,
  manual: new Map(),    // 手で直したマス "row:col" → true/false
  marks: [],            // いま画面に出ている判定
  result: null,         // compare の結果
  ignoredDays: [],      // その月に存在しない日（31日など）でマークがあったもの
  editingUserId: null,
  detailHistoryId: null,
};

/* ---------- 画面の切り替え ---------- */

function showScreen(name) {
  for (const screen of document.querySelectorAll('.screen')) {
    screen.classList.toggle('is-active', screen.id === `screen-${name}`);
  }
  for (const tab of document.querySelectorAll('.tab')) {
    const active = tab.dataset.screen === name;
    tab.classList.toggle('is-active', active);
    if (active) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
  if (name === 'users') renderUserList();
  if (name === 'history') renderHistoryList();
  window.scrollTo({ top: 0 });
}

function showStep(step) {
  state.step = step;
  for (const panel of document.querySelectorAll('.step')) {
    panel.classList.toggle('is-active', panel.id === `step-${step}`);
  }
  for (const item of document.querySelectorAll('.steps__item')) {
    const value = Number(item.dataset.step);
    item.classList.toggle('is-current', value === step);
    item.classList.toggle('is-done', value < step);
  }
  window.scrollTo({ top: 0 });
  if (step === 2) requestAnimationFrame(renderStage);
}

let toastTimer = null;
function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

/* ---------- 手順1 準備 ---------- */

function renderUserSelect() {
  const select = $('userSelect');
  const users = store.listUsers();
  const settings = store.getSettings();
  const keep = select.value || settings.lastUserId || '';

  select.innerHTML = '';
  const blank = new Option(users.length ? '選んでください' : '（利用者が未登録です）', '');
  select.append(blank);
  for (const user of users) select.append(new Option(user.name, user.id));
  select.value = users.some((user) => user.id === keep) ? keep : '';
  renderPatternSummary();
}

function renderPatternSummary() {
  const user = store.getUser($('userSelect').value);
  $('patternSummary').textContent = user
    ? `登録：${patternText(user.pattern)}`
    : '利用者を登録すると、登録した曜日と照らし合わせます。';
}

/* ---------- 手順2 枠合わせ ---------- */

function defaultCorners(image) {
  const x0 = image.width * 0.08, x1 = image.width * 0.92;
  const y0 = image.height * 0.4, y1 = image.height * 0.6;
  return [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
}

function displayScale() {
  const preview = $('preview');
  return preview.clientWidth / (state.image?.width || 1);
}

function renderStage() {
  if (!state.image) return;
  const preview = $('preview');
  preview.width = state.image.width;
  preview.height = state.image.height;
  preview.getContext('2d').drawImage(state.image, 0, 0);
  renderOverlay();
}

function renderOverlay() {
  if (!state.image || !state.corners) return;
  const overlay = $('overlay');
  const scale = displayScale();
  const width = Math.round(state.image.width * scale);
  const height = Math.round(state.image.height * scale);
  if (!width || !height) return;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  overlay.width = width * dpr;
  overlay.height = height * dpr;
  overlay.style.width = `${width}px`;
  overlay.style.height = `${height}px`;

  const ctx = overlay.getContext('2d');
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
  ctx.clearRect(0, 0, state.image.width, state.image.height);

  const map = scan.projection(state.corners);
  const columns = currentColumns();
  const rows = currentRowKinds().length;
  const line = (a, b) => { ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); };
  const lineWidth = 1.6 / scale;

  // 白い紙にも黒い罫線にも重なるので、白い下地を敷いてから色を乗せる
  const strokeAll = (paths, color, width) => {
    for (const pass of [{ color: 'rgba(255, 255, 255, .7)', width: width * 2.2 }, { color, width }]) {
      ctx.lineWidth = pass.width;
      ctx.strokeStyle = pass.color;
      ctx.beginPath();
      for (const [from, to] of paths) line(from, to);
      ctx.stroke();
    }
  };

  const columnLines = [];
  for (let i = 1; i < columns; i++) columnLines.push([map(i / columns, 0), map(i / columns, 1)]);
  strokeAll(columnLines, 'rgba(0, 122, 204, .75)', lineWidth);

  const rowLines = [];
  for (let i = 1; i < rows; i++) rowLines.push([map(0, i / rows), map(1, i / rows)]);
  strokeAll(rowLines, 'rgba(214, 122, 24, .95)', lineWidth * 1.4);

  ctx.lineWidth = lineWidth * 1.8;
  ctx.strokeStyle = '#ff8a3d';
  ctx.beginPath();
  ctx.moveTo(state.corners[0].x, state.corners[0].y);
  for (const corner of state.corners.slice(1)) ctx.lineTo(corner.x, corner.y);
  ctx.closePath();
  ctx.stroke();

  for (const [index, corner] of state.corners.entries()) {
    const handle = document.querySelector(`.handle[data-corner="${index}"]`);
    handle.style.left = `${corner.x * scale}px`;
    handle.style.top = `${corner.y * scale}px`;
  }
}

function showLoupe(corner) {
  const loupe = $('loupe');
  const size = loupe.width;
  const span = 48; // 画像側で覗く範囲（px）
  const ctx = loupe.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(state.image, corner.x - span / 2, corner.y - span / 2, span, span, 0, 0, size, size);
  ctx.strokeStyle = '#ff8a3d';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(size / 2, 0); ctx.lineTo(size / 2, size);
  ctx.moveTo(0, size / 2); ctx.lineTo(size, size / 2);
  ctx.stroke();

  const scale = displayScale();
  const onLeft = corner.x * scale > $('preview').clientWidth / 2;
  loupe.style.left = onLeft ? '8px' : 'auto';
  loupe.style.right = onLeft ? 'auto' : '8px';
  loupe.hidden = false;
}

function moveCorner(index, x, y) {
  state.corners[index] = {
    x: Math.min(state.image.width, Math.max(0, x)),
    y: Math.min(state.image.height, Math.max(0, y)),
  };
  renderOverlay();
}

function setupHandles() {
  for (const handle of document.querySelectorAll('.handle')) {
    const index = Number(handle.dataset.corner);

    handle.addEventListener('pointerdown', (event) => {
      handle.setPointerCapture(event.pointerId);
      handle.classList.add('is-active');
      showLoupe(state.corners[index]);
      event.preventDefault();
    });

    handle.addEventListener('pointermove', (event) => {
      if (!handle.hasPointerCapture(event.pointerId)) return;
      const rect = $('preview').getBoundingClientRect();
      const scale = displayScale();
      moveCorner(index, (event.clientX - rect.left) / scale, (event.clientY - rect.top) / scale);
      showLoupe(state.corners[index]);
    });

    const end = () => {
      handle.classList.remove('is-active');
      $('loupe').hidden = true;
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);

    // 指では合わせきれないときのために、矢印キーでも動かせるようにする
    handle.addEventListener('keydown', (event) => {
      const steps = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      const move = steps[event.key];
      if (!move) return;
      event.preventDefault();
      const amount = (event.shiftKey ? 10 : 1) / displayScale();
      const corner = state.corners[index];
      moveCorner(index, corner.x + move[0] * amount, corner.y + move[1] * amount);
    });
  }
}

function currentColumns() {
  return $('columnMode').value === 'month' ? daysInMonth($('monthInput').value || currentMonth()) : 31;
}

function currentRowKinds() {
  return [...$('rowConfig').querySelectorAll('select')].map((select) => select.value);
}

function renderRowConfig(kinds) {
  const container = $('rowConfig');
  container.innerHTML = '';
  kinds.forEach((kind, index) => {
    const row = document.createElement('label');
    row.className = 'rows__item';
    const label = document.createElement('span');
    label.className = 'rows__num';
    label.textContent = `${index + 1}行目`;
    const select = document.createElement('select');
    select.className = 'input input--small';
    for (const option of ROW_KINDS) select.append(new Option(option.label, option.value));
    select.value = kind;
    select.addEventListener('change', () => {
      store.updateSettings({ rowKinds: currentRowKinds() });
      renderOverlay();
    });
    row.append(label, select);
    container.append(row);
  });
}

/* ---------- 読み取り ---------- */

function readSheet() {
  const columns = currentColumns();
  const kinds = currentRowKinds();
  if (!kinds.some((kind) => kind !== 'skip')) {
    toast('読む行を1つ以上えらんでください');
    return;
  }

  state.measurement = scan.measure(state.image, state.corners, { columns, rows: kinds.length });
  state.rowKinds = kinds;
  const auto = scan.autoThreshold(state.measurement.cells);
  state.threshold = auto.threshold;
  state.manual.clear();

  store.updateSettings({ columnMode: $('columnMode').value, rowKinds: kinds });
  renderReview();
  showStep(3);
  if (!auto.confident) toast('似た濃さのマスがあります。確認してください');
}

function applyClassification() {
  const sensitivity = Number($('sensitivity').value);
  const classified = scan.classify(state.measurement.cells, state.threshold, sensitivity);
  state.marks = classified.map((cell) => {
    const key = `${cell.row}:${cell.col}`;
    return state.manual.has(key)
      ? { ...cell, marked: state.manual.get(key), unsure: false, fixed: true }
      : cell;
  });
}

function renderReview() {
  applyClassification();
  const container = $('reviewGrid');
  container.innerHTML = '';

  const kinds = state.rowKinds;
  const ym = $('monthInput').value || currentMonth();
  const columns = state.measurement.columns;
  const total = daysInMonth(ym);

  const head = document.createElement('div');
  head.className = 'review__row review__row--head';
  head.append(cellDiv('日', 'review__day'));
  for (const kind of kinds) {
    const label = ROW_KINDS.find((item) => item.value === kind)?.label ?? kind;
    head.append(cellDiv(label.replace('・', '\n'), 'review__label'));
  }
  container.append(head);

  for (let col = 0; col < columns; col++) {
    const day = col + 1;
    const row = document.createElement('div');
    row.className = 'review__row';
    const weekday = day <= total ? weekdayOf(ym, day) : null;
    if (weekday === 0) row.classList.add('is-sunday');
    if (weekday === 6) row.classList.add('is-saturday');
    if (day > total) row.classList.add('is-outside');

    const dayCell = cellDiv(weekday === null ? `${day}` : `${day}（${WEEKDAY_LABELS[weekday]}）`, 'review__day');
    row.append(dayCell);

    kinds.forEach((kind, rowIndex) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'cell';
      button.dataset.key = `${rowIndex}:${col}`;
      if (kind === 'skip') button.classList.add('is-skipped');
      const canvas = document.createElement('canvas');
      const cell = state.measurement.cells[rowIndex * columns + col];
      scan.paintCell(canvas, cell.pixels);
      button.append(canvas);
      const dot = document.createElement('span');
      dot.className = 'cell__dot';
      button.append(dot);
      button.addEventListener('click', () => {
        const key = button.dataset.key;
        const current = state.marks.find((mark) => `${mark.row}:${mark.col}` === key);
        state.manual.set(key, !current.marked);
        applyClassification();
        paintMarks();
      });
      row.append(button);
    });

    container.append(row);
  }
  paintMarks();
}

function cellDiv(text, className) {
  const div = document.createElement('div');
  div.className = className;
  div.textContent = text;
  return div;
}

function paintMarks() {
  for (const mark of state.marks) {
    const button = $('reviewGrid').querySelector(`.cell[data-key="${mark.row}:${mark.col}"]`);
    if (!button) continue;
    button.classList.toggle('is-marked', mark.marked);
    button.classList.toggle('is-unsure', !!mark.unsure);
    button.classList.toggle('is-fixed', !!mark.fixed);
    button.setAttribute('aria-pressed', String(mark.marked));
    button.setAttribute('aria-label', `${mark.col + 1}日 ${mark.marked ? 'マークあり' : 'マークなし'}`);
  }
}

/* ---------- 照合 ---------- */

function collectMarks() {
  const kinds = state.rowKinds;
  const columns = state.measurement.columns;
  const ym = $('monthInput').value || currentMonth();
  const total = daysInMonth(ym);

  const sheets = { actual: null, plan: null };
  const ignored = new Set();

  kinds.forEach((kind, rowIndex) => {
    if (kind === 'skip') return;
    const [group, part] = kind.split('-');
    sheets[group] = sheets[group] ?? new Map();
    for (let col = 0; col < columns; col++) {
      const mark = state.marks.find((item) => item.row === rowIndex && item.col === col);
      if (!mark?.marked) continue;
      const day = col + 1;
      if (day > total) { ignored.add(day); continue; }
      const slot = sheets[group].get(day) ?? { am: false, pm: false };
      slot[part] = true;
      sheets[group].set(day, slot);
    }
  });

  state.ignoredDays = [...ignored].sort((a, b) => a - b);
  return sheets;
}

function runCompare() {
  const user = store.getUser($('userSelect').value);
  if (!user) {
    toast('利用者を選んでください');
    return;
  }
  const ym = $('monthInput').value || currentMonth();
  const marks = collectMarks();
  if (!marks.actual && !marks.plan) {
    toast('マークが1つも読めていません');
    return;
  }

  state.result = { user, ym, marks, ...compare(user, ym, marks) };
  renderResult();
  showStep(4);
}

function renderResult() {
  const { user, ym, summary, alerts, planGaps } = state.result;

  const chips = [
    `一致 ${summary.matched}日`,
    summary.unplanned ? `予定外 ${summary.unplanned}件` : null,
    summary.missing ? `マークなし ${summary.missing}件` : null,
    summary.part ? `時間帯ちがい ${summary.part}件` : null,
  ].filter(Boolean);

  const head = document.createElement('div');
  head.className = `card result ${alerts.length ? 'result--alert' : 'result--ok'}`;
  head.innerHTML = `
    <p class="result__eyebrow">${escapeHtml(user.name)}・${formatMonth(ym)}</p>
    <p class="result__headline">${alerts.length ? `確認したいところが ${alerts.length}件` : 'ちがいはありませんでした'}</p>
    <p class="result__note">${summary.comparedWith === 'actual' ? '実績の行' : '予定の行'}と、登録した曜日を比べています。提供票では ${summary.usedDays}日 にマークがありました。</p>
    <div class="chips">${chips.map((text) => `<span class="chip">${escapeHtml(text)}</span>`).join('')}</div>
  `;

  const container = $('resultSummary');
  container.innerHTML = '';
  container.append(head);

  if (state.ignoredDays.length) {
    const note = document.createElement('p');
    note.className = 'hint hint--warn';
    note.textContent = `${state.ignoredDays.join('・')}日の欄にマークがありますが、${formatMonth(ym)}にその日はありません。枠のずれかもしれません。`;
    container.append(note);
  }

  const list = $('alertList');
  list.innerHTML = '';

  for (const row of alerts) {
    list.append(alertCard(row, ym));
  }

  if (planGaps.length) {
    const heading = document.createElement('h3');
    heading.className = 'section__title';
    heading.textContent = `予定と実績のちがい ${planGaps.length}件`;
    list.append(heading);
    for (const row of planGaps) {
      const card = document.createElement('div');
      card.className = 'card alert alert--plan';
      card.innerHTML = `
        <p class="alert__day">${row.day}日（${WEEKDAY_LABELS[row.weekday]}）</p>
        <p class="alert__body">予定：${escapeHtml(partsText(row.plan))} ／ 実績：${escapeHtml(partsText(row.marked))}</p>
      `;
      list.append(card);
    }
  }

  if (!alerts.length && !planGaps.length) {
    const done = document.createElement('p');
    done.className = 'hint';
    done.textContent = '登録した曜日と提供票のマークは、すべて一致していました。';
    list.append(done);
  }
}

function alertCard(row, ym) {
  const card = document.createElement('div');
  card.className = `card alert alert--${row.status}`;
  card.innerHTML = `
    <p class="alert__day">${row.day}日（${WEEKDAY_LABELS[row.weekday]}）<span class="alert__tag">${STATUS_LABELS[row.status]}</span></p>
    <p class="alert__body">登録：${escapeHtml(partsText(row.expected))} ／ 提供票：${escapeHtml(partsText(row.marked))}</p>
  `;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn--small alert__fix';
  button.textContent = 'この月だけ提供票に合わせる';
  button.addEventListener('click', () => {
    store.setOverride(state.result.user.id, dateKey(ym, row.day), row.marked);
    const user = store.getUser(state.result.user.id);
    state.result = { user, ym, marks: state.result.marks, ...compare(user, ym, state.result.marks) };
    renderResult();
    toast(`${row.day}日を、この月だけの予定として登録しました`);
  });
  card.append(button);
  return card;
}

function saveResult() {
  const { user, ym, summary, alerts, marks } = state.result;
  store.saveHistory({
    userId: user.id,
    userName: user.name,
    ym,
    summary,
    alerts: alerts.map((row) => ({
      day: row.day,
      weekday: row.weekday,
      status: row.status,
      expected: row.expected,
      marked: row.marked,
    })),
    marks: { actual: store.packMarks(marks.actual), plan: store.packMarks(marks.plan) },
  });
  store.updateSettings({ lastUserId: user.id });
  toast('結果を保存しました');
  showScreen('history');
}

function restart() {
  state.image = null;
  state.corners = null;
  state.measurement = null;
  state.result = null;
  state.manual.clear();
  $('fileInput').value = '';
  $('cameraInput').value = '';
  showStep(1);
}

/* ---------- 利用者 ---------- */

function renderUserList() {
  const container = $('userList');
  container.innerHTML = '';
  const users = store.listUsers();

  if (!users.length) {
    container.innerHTML = '<p class="empty">まだ登録がありません。右上の「追加」から登録してください。</p>';
    return;
  }

  for (const user of users) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'card listitem';
    const overrides = Object.keys(user.overrides ?? {}).length;
    card.innerHTML = `
      <p class="listitem__title">${escapeHtml(user.name)}</p>
      <p class="listitem__body">${escapeHtml(patternText(user.pattern))}</p>
      ${user.note ? `<p class="listitem__note">${escapeHtml(user.note)}</p>` : ''}
      ${overrides ? `<p class="listitem__note">その月だけの予定：${overrides}件</p>` : ''}
    `;
    card.addEventListener('click', () => openUserEditor(user.id));
    container.append(card);
  }
}

function renderWeekEditor(pattern) {
  const container = $('weekEditor');
  container.innerHTML = '';

  pattern.forEach((slot, weekday) => {
    const row = document.createElement('div');
    row.className = 'week__row';
    if (weekday === 0) row.classList.add('is-sunday');
    if (weekday === 6) row.classList.add('is-saturday');

    const name = document.createElement('span');
    name.className = 'week__day';
    name.textContent = WEEKDAY_LABELS[weekday];
    row.append(name);

    for (const part of ['am', 'pm']) {
      const label = document.createElement('label');
      label.className = 'week__part';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = !!slot[part];
      input.dataset.weekday = String(weekday);
      input.dataset.part = part;
      const text = document.createElement('span');
      text.textContent = part === 'am' ? '午前' : '午後';
      label.append(input, text);
      row.append(label);
    }

    const select = document.createElement('select');
    select.className = 'input input--small week__weeks';
    select.dataset.weekday = String(weekday);
    for (const option of WEEK_PATTERNS) select.append(new Option(option.label, option.value));
    select.value = slot.weeks ?? 'every';
    select.setAttribute('aria-label', `${WEEKDAY_LABELS[weekday]}曜日の週`);
    row.append(select);

    container.append(row);
  });
}

function openUserEditor(id) {
  const user = id ? store.getUser(id) : null;
  state.editingUserId = user?.id ?? null;
  $('userEditorTitle').textContent = user ? '利用者の編集' : '利用者の登録';
  $('userName').value = user?.name ?? '';
  $('userNote').value = user?.note ?? '';
  renderWeekEditor(user?.pattern ?? emptyPattern());
  $('deleteUserBtn').hidden = !user;
  $('userEditor').showModal();
}

function readWeekEditor() {
  const pattern = emptyPattern();
  for (const input of $('weekEditor').querySelectorAll('input[type="checkbox"]')) {
    pattern[Number(input.dataset.weekday)][input.dataset.part] = input.checked;
  }
  for (const select of $('weekEditor').querySelectorAll('select')) {
    pattern[Number(select.dataset.weekday)].weeks = select.value;
  }
  return pattern;
}

function submitUser(event) {
  event.preventDefault();
  const name = $('userName').value.trim();
  if (!name) {
    toast('名前を入れてください');
    return;
  }
  const existing = state.editingUserId ? store.getUser(state.editingUserId) : null;
  const user = store.saveUser({
    ...(existing ?? {}),
    id: state.editingUserId ?? undefined,
    name,
    note: $('userNote').value.trim(),
    pattern: readWeekEditor(),
  });
  $('userEditor').close();
  renderUserList();
  renderUserSelect();
  $('userSelect').value = user.id;
  renderPatternSummary();
  toast('保存しました');
}

/* ---------- 履歴 ---------- */

function renderHistoryList() {
  const container = $('historyList');
  container.innerHTML = '';
  const items = store.listHistory();

  if (!items.length) {
    container.innerHTML = '<p class="empty">まだ結果がありません。読み取ったあとに「結果を保存する」を押すと、ここに残ります。</p>';
    return;
  }

  const stamp = new Intl.DateTimeFormat('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  for (const entry of items) {
    const alerts = entry.alerts?.length ?? 0;
    const card = document.createElement('button');
    card.type = 'button';
    card.className = `card listitem ${alerts ? 'listitem--alert' : ''}`;
    card.innerHTML = `
      <p class="listitem__title">${escapeHtml(entry.userName)}・${formatMonth(entry.ym)}</p>
      <p class="listitem__body">${alerts ? `確認したいところ ${alerts}件` : 'ちがいなし'} ／ 利用 ${entry.summary?.usedDays ?? 0}日</p>
      <p class="listitem__note">${stamp.format(new Date(entry.checkedAt))} に読み取り</p>
    `;
    card.addEventListener('click', () => openHistoryDetail(entry.id));
    container.append(card);
  }
}

function openHistoryDetail(id) {
  const entry = store.getHistory(id);
  if (!entry) return;
  state.detailHistoryId = id;
  $('historyDetailTitle').textContent = `${entry.userName}・${formatMonth(entry.ym)}`;

  const body = $('historyDetailBody');
  body.innerHTML = '';

  const summary = document.createElement('div');
  summary.className = 'card card--tight';
  const used = store.unpackMarks(entry.marks?.actual ?? entry.marks?.plan);
  const days = used
    ? [...used.entries()].sort((a, b) => a[0] - b[0]).map(([day, slot]) => `${day}日（${partsText(slot)}）`)
    : [];
  summary.innerHTML = `
    <p class="card__text">提供票にマークがあった日：${days.length ? escapeHtml(days.join('、')) : 'なし'}</p>
  `;
  body.append(summary);

  if (!entry.alerts?.length) {
    const done = document.createElement('p');
    done.className = 'hint';
    done.textContent = 'ちがいはありませんでした。';
    body.append(done);
  } else {
    for (const row of entry.alerts) {
      const card = document.createElement('div');
      card.className = `card alert alert--${row.status}`;
      card.innerHTML = `
        <p class="alert__day">${row.day}日（${WEEKDAY_LABELS[row.weekday]}）<span class="alert__tag">${STATUS_LABELS[row.status]}</span></p>
        <p class="alert__body">登録：${escapeHtml(partsText(row.expected))} ／ 提供票：${escapeHtml(partsText(row.marked))}</p>
      `;
      body.append(card);
    }
  }

  $('historyDetail').showModal();
}

/* ---------- 小物 ---------- */

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]
  ));
}

async function pickImage(input) {
  const file = input.files?.[0];
  if (!file) return;
  try {
    state.image = await scan.loadImage(file);
    state.corners = defaultCorners(state.image);
    showStep(2);
  } catch {
    toast('この画像は読み込めませんでした');
  }
}

/* ---------- 起動 ---------- */

function init() {
  const settings = store.getSettings();
  $('monthInput').value = currentMonth();
  $('columnMode').value = settings.columnMode ?? '31';
  $('sensitivity').value = String(settings.sensitivity ?? 1);
  renderRowConfig(settings.rowKinds?.length ? settings.rowKinds : ['actual-am', 'actual-pm']);
  renderUserSelect();
  setupHandles();

  for (const tab of document.querySelectorAll('.tab')) {
    tab.addEventListener('click', () => showScreen(tab.dataset.screen));
  }
  for (const button of document.querySelectorAll('[data-goto-step]')) {
    button.addEventListener('click', () => showStep(Number(button.dataset.gotoStep)));
  }

  $('userSelect').addEventListener('change', () => {
    renderPatternSummary();
    store.updateSettings({ lastUserId: $('userSelect').value });
  });
  $('monthInput').addEventListener('change', renderOverlay);
  $('columnMode').addEventListener('change', renderOverlay);

  $('pickFileBtn').addEventListener('click', () => $('fileInput').click());
  $('takePhotoBtn').addEventListener('click', () => $('cameraInput').click());
  $('fileInput').addEventListener('change', (event) => pickImage(event.target));
  $('cameraInput').addEventListener('change', (event) => pickImage(event.target));
  $('changeImageBtn').addEventListener('click', () => showStep(1));

  $('rotateBtn').addEventListener('click', () => {
    state.image = scan.rotate90(state.image);
    state.corners = defaultCorners(state.image);
    renderStage();
  });
  $('resetCornersBtn').addEventListener('click', () => {
    state.corners = defaultCorners(state.image);
    renderOverlay();
  });

  $('addRowBtn').addEventListener('click', () => {
    const kinds = currentRowKinds();
    if (kinds.length >= 8) return;
    renderRowConfig([...kinds, 'skip']);
    store.updateSettings({ rowKinds: currentRowKinds() });
    renderOverlay();
  });
  $('removeRowBtn').addEventListener('click', () => {
    const kinds = currentRowKinds();
    if (kinds.length <= 1) return;
    renderRowConfig(kinds.slice(0, -1));
    store.updateSettings({ rowKinds: currentRowKinds() });
    renderOverlay();
  });

  $('readBtn').addEventListener('click', readSheet);
  $('sensitivity').addEventListener('input', () => {
    store.updateSettings({ sensitivity: Number($('sensitivity').value) });
    applyClassification();
    paintMarks();
  });
  $('compareBtn').addEventListener('click', runCompare);
  $('saveResultBtn').addEventListener('click', saveResult);
  $('restartBtn').addEventListener('click', restart);

  $('addUserBtn').addEventListener('click', () => openUserEditor(null));
  $('userForm').addEventListener('submit', submitUser);
  $('closeUserEditor').addEventListener('click', () => $('userEditor').close());
  $('deleteUserBtn').addEventListener('click', () => {
    const user = store.getUser(state.editingUserId);
    if (!user) return;
    if (!confirm(`${user.name}さんの登録と履歴を消します。よろしいですか。`)) return;
    store.removeUser(user.id);
    $('userEditor').close();
    renderUserList();
    renderUserSelect();
    toast('削除しました');
  });

  $('closeHistoryDetail').addEventListener('click', () => $('historyDetail').close());
  $('deleteHistoryBtn').addEventListener('click', () => {
    store.removeHistory(state.detailHistoryId);
    $('historyDetail').close();
    renderHistoryList();
    toast('消しました');
  });

  $('openSettings').addEventListener('click', () => $('settingsSheet').showModal());
  $('closeSettings').addEventListener('click', () => $('settingsSheet').close());
  $('clearDataBtn').addEventListener('click', () => {
    if (!confirm('利用者・履歴・設定をすべて消します。よろしいですか。')) return;
    store.clearAll();
    $('settingsSheet').close();
    renderUserList();
    renderUserSelect();
    renderHistoryList();
    restart();
    toast('消しました');
  });

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (state.step === 2) renderStage(); }, 150);
  });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
}

init();
