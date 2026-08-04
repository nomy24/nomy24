/* 南区インフォ — 画面の描画と新着チェック */
(() => {
  'use strict';

  const DATA_URL = 'data/news.json';
  const STORE_KEY = 'minami-info/v1';
  const TZ = 'Asia/Tokyo';

  const defaults = {
    lastReadAt: null,     // この時刻より後に見つかった記事を「新着」とする
    readIds: [],          // 個別に開いた記事
    knownIds: [],         // 前回チェック時点で存在していた記事
    savedIds: [],         // 保存した記事
    scope: 'minami',      // 'minami' | 'all'
    category: 'all',
    notify: false,
    importantOnly: false,
    intervalMinutes: 30,
    largeText: false,
    revision: null,
  };

  const state = {
    prefs: loadPrefs(),
    data: null,
    unreadOnly: false,
    lastCheckedAt: 0,
    timer: null,
  };

  const $ = (id) => document.getElementById(id);
  const el = {
    bell: $('bell'),
    bellBadge: $('bellBadge'),
    status: $('status'),
    statusNumber: $('statusNumber'),
    statusHeading: $('statusHeading'),
    statusUpdated: $('statusUpdated'),
    refresh: $('refresh'),
    markAllRead: $('markAllRead'),
    chips: $('chips'),
    search: $('search'),
    homeList: $('homeList'),
    savedList: $('savedList'),
    sourceNote: $('sourceNote'),
    notifyToggle: $('notifyToggle'),
    notifyDesc: $('notifyDesc'),
    importantOnlyToggle: $('importantOnlyToggle'),
    intervalSelect: $('intervalSelect'),
    largeTextToggle: $('largeTextToggle'),
    clearCache: $('clearCache'),
    toast: $('toast'),
  };

  /* ---------- 設定の保存 ---------- */

  function loadPrefs() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      return raw ? { ...defaults, ...JSON.parse(raw) } : { ...defaults };
    } catch {
      return { ...defaults };
    }
  }

  function savePrefs() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state.prefs));
    } catch {
      /* 保存できない環境（プライベートブラウズなど）でも動作は続ける */
    }
  }

  /* ---------- 日付 ---------- */

  const dayFormatter = new Intl.DateTimeFormat('ja-JP', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const weekdayFormatter = new Intl.DateTimeFormat('ja-JP', { timeZone: TZ, weekday: 'short' });
  const stampFormatter = new Intl.DateTimeFormat('ja-JP', {
    timeZone: TZ, month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  function dayKey(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    return dayFormatter.format(date); // 例: 2026/08/04
  }

  function todayKey() {
    return dayFormatter.format(new Date());
  }

  function relativeLabel(key) {
    const today = todayKey();
    if (key === today) return '今日';
    const asDate = (k) => {
      const [y, m, d] = k.split('/').map(Number);
      return Date.UTC(y, m - 1, d);
    };
    const diff = Math.round((asDate(today) - asDate(key)) / 86400000);
    if (diff === 1) return 'きのう';
    if (diff > 1 && diff <= 6) return `${diff}日前`;
    return '';
  }

  /* ---------- 記事の状態 ---------- */

  function isNew(item) {
    if (state.prefs.readIds.includes(item.id)) return false;
    if (!state.prefs.lastReadAt) return true;
    const seen = Date.parse(item.firstSeenAt || item.publishedAt || 0) || 0;
    return seen > Date.parse(state.prefs.lastReadAt);
  }

  function allItems() {
    return (state.data && Array.isArray(state.data.items)) ? state.data.items : [];
  }

  /** 「南区」表示中は南区の話題だけ。ただし重要なお知らせは地域にかかわらず必ず出す。 */
  function matchesScope(item) {
    if (state.prefs.scope === 'all') return true;
    return item.scope === 'minami' || Boolean(item.important);
  }

  function scopedItems() {
    return allItems().filter(matchesScope);
  }

  function unreadItems() {
    return scopedItems().filter(isNew);
  }

  function visibleItems() {
    const query = el.search.value.trim().toLowerCase();
    return scopedItems().filter((item) => {
      if (state.prefs.category !== 'all' && item.category !== state.prefs.category) return false;
      if (state.unreadOnly && !isNew(item)) return false;
      if (query) {
        const hay = `${item.title} ${item.summary || ''} ${item.categoryLabel || ''}`.toLowerCase();
        if (!hay.includes(query)) return false;
      }
      return true;
    });
  }

  /* ---------- 描画 ---------- */

  function renderStatus() {
    const unread = unreadItems();
    const total = scopedItems().length;
    const hasUrgent = unread.some((item) => item.important);

    el.status.classList.toggle('is-zero', unread.length === 0);
    el.status.classList.toggle('is-alert', hasUrgent);

    el.statusNumber.hidden = total === 0;
    if (total === 0) {
      el.statusNumber.textContent = '';
      el.statusHeading.textContent = 'まだ情報がありません';
    } else if (unread.length > 0) {
      el.statusNumber.textContent = String(unread.length);
      el.statusHeading.textContent = hasUrgent ? '件の新着（重要をふくむ）' : '件の新しいお知らせ';
    } else {
      el.statusNumber.textContent = String(total);
      el.statusHeading.textContent = '件すべて確認済みです';
    }

    const generatedAt = state.data && state.data.generatedAt;
    el.statusUpdated.textContent = generatedAt
      ? `最終更新 ${stampFormatter.format(new Date(generatedAt))}`
      : '更新の記録がありません';

    el.markAllRead.hidden = unread.length === 0;
    el.bellBadge.hidden = unread.length === 0;
    el.bellBadge.textContent = unread.length > 99 ? '99+' : String(unread.length);
    el.bell.setAttribute(
      'aria-label',
      unread.length > 0 ? `新着${unread.length}件を表示する` : '新着のお知らせはありません'
    );
  }

  function renderChips() {
    const categories = (state.data && state.data.categories) || [];
    const pool = scopedItems();
    const counts = new Map();
    for (const item of pool) counts.set(item.category, (counts.get(item.category) || 0) + 1);

    const entries = [{ id: 'all', label: 'すべて', count: pool.length }].concat(
      categories
        .filter((c) => counts.get(c.id))
        .map((c) => ({ id: c.id, label: c.label, count: counts.get(c.id) }))
    );

    el.chips.textContent = '';
    for (const entry of entries) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.dataset.category = entry.id;
      chip.setAttribute('aria-pressed', String(state.prefs.category === entry.id));
      chip.append(entry.label);
      const n = document.createElement('span');
      n.className = 'chip__n';
      n.textContent = String(entry.count);
      chip.append(n);
      el.chips.append(chip);
    }
  }

  function safeUrl(url) {
    try {
      const parsed = new URL(url, location.href);
      return (parsed.protocol === 'https:' || parsed.protocol === 'http:') ? parsed.href : null;
    } catch {
      return null;
    }
  }

  function bookmarkIcon() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M7 4h10v16l-5-4-5 4Z');
    svg.append(path);
    return svg;
  }

  function buildCard(item) {
    const href = safeUrl(item.url);
    const card = document.createElement(href ? 'a' : 'div');
    card.className = 'item';
    if (href) {
      card.href = href;
      card.target = '_blank';
      card.rel = 'noopener noreferrer';
    }
    const fresh = isNew(item);
    card.classList.toggle('is-new', fresh && !item.important);
    card.classList.toggle('is-important', Boolean(item.important));
    card.classList.toggle('is-read', !fresh);

    const top = document.createElement('p');
    top.className = 'item__top';

    const cat = document.createElement('span');
    cat.className = 'item__cat';
    const dot = document.createElement('span');
    dot.className = 'item__dot';
    cat.append(dot, item.categoryLabel || 'お知らせ');
    top.append(cat);

    if (item.important) {
      const urgent = document.createElement('span');
      urgent.className = 'item__urgent';
      urgent.textContent = '重要';
      top.append(urgent);
    }
    if (fresh) {
      const badge = document.createElement('span');
      badge.className = 'item__new';
      badge.textContent = 'NEW';
      top.append(badge);
    }

    const title = document.createElement('h3');
    title.className = 'item__title';
    title.textContent = item.title;

    card.append(top, title);

    if (item.summary) {
      const summary = document.createElement('p');
      summary.className = 'item__summary';
      summary.textContent = item.summary;
      card.append(summary);
    }

    const meta = document.createElement('p');
    meta.className = 'item__meta';
    for (const area of (item.areaHits || []).slice(0, 2)) {
      const tag = document.createElement('span');
      tag.className = 'item__area';
      tag.textContent = area;
      meta.append(tag);
    }
    if (item.scope === 'citywide') {
      const tag = document.createElement('span');
      tag.className = 'item__area';
      tag.textContent = '市全体';
      meta.append(tag);
    }
    const source = document.createElement('span');
    source.textContent = item.source || '相模原市';
    meta.append(source);
    card.append(meta);

    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'item__save';
    save.dataset.saveId = item.id;
    const saved = state.prefs.savedIds.includes(item.id);
    save.setAttribute('aria-pressed', String(saved));
    save.setAttribute('aria-label', saved ? 'このお知らせの保存をやめる' : 'このお知らせを保存する');
    save.append(bookmarkIcon());
    card.append(save);

    if (href) {
      card.addEventListener('click', () => markRead(item.id));
    }
    return card;
  }

  function renderList(container, items, emptyNode) {
    container.textContent = '';
    if (items.length === 0) {
      container.append(emptyNode);
      return;
    }

    let currentKey = null;
    let group = null;
    for (const item of items) {
      const key = dayKey(item.publishedAt || item.firstSeenAt);
      if (key !== currentKey) {
        currentKey = key;
        group = document.createElement('section');
        group.className = 'daygroup';

        const head = document.createElement('div');
        head.className = 'daygroup__head';

        const [, month, day] = key.split('/');
        const dayEl = document.createElement('span');
        dayEl.className = 'daygroup__day';
        dayEl.textContent = String(Number(day));

        const unit = document.createElement('span');
        unit.className = 'daygroup__unit';
        const date = new Date(item.publishedAt || item.firstSeenAt);
        const weekday = Number.isNaN(date.getTime()) ? '' : weekdayFormatter.format(date);
        unit.textContent = `${Number(month)}月 ${weekday}`;

        const rule = document.createElement('span');
        rule.className = 'daygroup__rule';

        head.append(dayEl, unit, rule);

        const rel = relativeLabel(key);
        if (rel) {
          const relEl = document.createElement('span');
          relEl.className = 'daygroup__rel';
          relEl.textContent = rel;
          head.append(relEl);
        }

        group.append(head);
        container.append(group);
      }
      group.append(buildCard(item));
    }
  }

  function emptyState(title, body) {
    const box = document.createElement('div');
    box.className = 'empty';
    const h = document.createElement('p');
    h.className = 'empty__title';
    h.textContent = title;
    const p = document.createElement('p');
    p.className = 'empty__body';
    if (typeof body === 'string') p.textContent = body;
    else p.append(...body);
    box.append(h, p);
    return box;
  }

  function homeEmpty() {
    if (allItems().length === 0) {
      const code = document.createElement('code');
      code.textContent = 'Update Sagamihara Minami news';
      return emptyState('まだお知らせを取り込んでいません', [
        'GitHub の Actions で ',
        code,
        ' を実行すると、相模原市の新着情報が取り込まれます。以降は毎日自動で更新されます。',
      ]);
    }
    if (state.unreadOnly) return emptyState('新しいお知らせはありません', '次の更新までお待ちください。');
    if (el.search.value.trim()) return emptyState('見つかりませんでした', '別のことばで探すか、カテゴリの絞り込みを外してください。');
    return emptyState('この条件のお知らせはありません', '「すべて」を選ぶと、ほかのお知らせが表示されます。');
  }

  function render() {
    renderStatus();
    renderChips();
    renderList(el.homeList, visibleItems(), homeEmpty());

    const savedItems = allItems().filter((item) => state.prefs.savedIds.includes(item.id));
    renderList(
      el.savedList,
      savedItems,
      emptyState('保存したお知らせはありません', 'カードの右上にある旗マークを押すと、ここにまとまります。')
    );

    if (state.data && state.data.sourceUrl) {
      el.sourceNote.textContent = '';
      el.sourceNote.append('情報の取得元: ');
      const link = document.createElement('a');
      const href = safeUrl(state.data.sourceUrl);
      if (href) {
        link.href = href;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
      }
      link.textContent = state.data.source || '相模原市公式ホームページ';
      el.sourceNote.append(link);
    }
  }

  /* ---------- 操作 ---------- */

  function markRead(id) {
    if (state.prefs.readIds.includes(id)) return;
    state.prefs.readIds.push(id);
    // 記事の保持上限より多く覚えておく必要はない
    if (state.prefs.readIds.length > 600) state.prefs.readIds = state.prefs.readIds.slice(-600);
    savePrefs();
    renderStatus();
  }

  function markAllRead() {
    state.prefs.lastReadAt = new Date().toISOString();
    state.prefs.readIds = allItems().map((item) => item.id).slice(0, 600);
    state.unreadOnly = false;
    savePrefs();
    render();
    showToast('すべて既読にしました');
  }

  let toastTimer = null;
  function showToast(message) {
    el.toast.textContent = message;
    el.toast.hidden = false;
    requestAnimationFrame(() => el.toast.classList.add('is-shown'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.toast.classList.remove('is-shown');
      setTimeout(() => { el.toast.hidden = true; }, 300);
    }, 3200);
  }

  function switchScreen(name) {
    for (const screen of document.querySelectorAll('.screen')) {
      screen.hidden = screen.id !== `screen-${name}`;
    }
    for (const tab of document.querySelectorAll('.tab')) {
      const active = tab.dataset.screen === name;
      tab.classList.toggle('is-active', active);
      if (active) tab.setAttribute('aria-current', 'page');
      else tab.removeAttribute('aria-current');
    }
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  /* ---------- 更新の確認 ---------- */

  async function loadData({ manual = false } = {}) {
    el.refresh.disabled = true;
    el.refresh.textContent = '確認中…';
    try {
      const res = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data || !Array.isArray(data.items)) throw new Error('形式が不正です');

      const previousIds = new Set(state.prefs.knownIds);
      const firstRun = state.prefs.knownIds.length === 0 && !state.prefs.lastReadAt;
      state.data = data;
      state.lastCheckedAt = Date.now();

      // 通知は表示中の地域設定に合わせる（重要なお知らせは地域を問わず対象）
      const added = data.items.filter((item) => !previousIds.has(item.id) && matchesScope(item));
      state.prefs.knownIds = data.items.map((item) => item.id);
      state.prefs.revision = data.revision || null;
      // 初回起動では全件を「既読の起点」にして、通知が一気に出ないようにする
      if (firstRun) state.prefs.lastReadAt = new Date().toISOString();
      savePrefs();
      render();

      if (!firstRun && added.length > 0) {
        const urgent = added.filter((item) => item.important);
        announce(added, urgent);
      } else if (manual) {
        showToast(added.length > 0 ? `新しいお知らせが${added.length}件あります` : '新しいお知らせはありません');
      }
      return true;
    } catch (err) {
      if (state.data === null) {
        state.data = { items: [], categories: [], generatedAt: null };
        render();
      }
      if (manual) showToast('更新を確認できませんでした。通信状態をご確認ください。');
      return false;
    } finally {
      el.refresh.disabled = false;
      el.refresh.textContent = '更新する';
    }
  }

  function announce(added, urgent) {
    const target = state.prefs.importantOnly ? urgent : added;
    if (target.length === 0) return;

    el.bell.classList.remove('is-ringing');
    void el.bell.offsetWidth; // アニメーションを再生し直す
    el.bell.classList.add('is-ringing');
    showToast(`新しいお知らせが${target.length}件あります`);

    if (!state.prefs.notify || !('Notification' in window) || Notification.permission !== 'granted') return;

    const title = urgent.length > 0 ? '南区の重要なお知らせ' : '南区の新しいお知らせ';
    const body = target.length === 1 ? target[0].title : `${target[0].title} ほか${target.length - 1}件`;
    const options = {
      body,
      tag: 'minami-info-update',
      renotify: true,
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      data: { url: location.href },
    };
    if (navigator.serviceWorker && navigator.serviceWorker.ready) {
      navigator.serviceWorker.ready.then((reg) => reg.showNotification(title, options)).catch(() => {});
    } else {
      try { new Notification(title, options); } catch { /* 表示できない環境では黙って諦める */ }
    }
  }

  function restartTimer() {
    clearInterval(state.timer);
    const minutes = Number(state.prefs.intervalMinutes) || 30;
    state.timer = setInterval(() => loadData(), minutes * 60 * 1000);
  }

  /* ---------- 通知の許可 ---------- */

  function describeNotifyState() {
    if (!('Notification' in window)) {
      el.notifyToggle.disabled = true;
      el.notifyToggle.checked = false;
      el.notifyDesc.textContent = 'このブラウザは通知に対応していません。アプリ内の🔔マークで新着を確認できます。';
      return;
    }
    if (Notification.permission === 'denied') {
      el.notifyToggle.disabled = true;
      el.notifyToggle.checked = false;
      el.notifyDesc.textContent = '通知がブロックされています。ブラウザのサイト設定で許可してください。';
      return;
    }
    el.notifyToggle.disabled = false;
    el.notifyToggle.checked = state.prefs.notify && Notification.permission === 'granted';
    el.notifyDesc.textContent = el.notifyToggle.checked
      ? '新しいお知らせが届くと、端末の通知でお知らせします。'
      : 'オンにすると、端末の通知で新しいお知らせを受け取れます。';
  }

  async function enableNotifications() {
    const permission = Notification.permission === 'granted'
      ? 'granted'
      : await Notification.requestPermission();
    state.prefs.notify = permission === 'granted';
    savePrefs();
    describeNotifyState();
    if (state.prefs.notify) {
      showToast('通知をオンにしました');
      registerPeriodicSync();
    } else {
      showToast('通知は許可されませんでした');
    }
  }

  async function registerPeriodicSync() {
    // 対応ブラウザ（インストール済みPWA）ではアプリを開いていなくても更新を確認する
    try {
      const reg = await navigator.serviceWorker.ready;
      if (!('periodicSync' in reg)) return;
      const status = await navigator.permissions.query({ name: 'periodic-background-sync' });
      if (status.state !== 'granted') return;
      await reg.periodicSync.register('minami-news-check', { minInterval: 6 * 60 * 60 * 1000 });
    } catch {
      /* 未対応でも通常のポーリングで更新される */
    }
  }

  /* ---------- 起動 ---------- */

  function bindEvents() {
    el.bell.addEventListener('click', () => {
      if (unreadItems().length === 0) {
        showToast('新しいお知らせはありません');
        return;
      }
      state.unreadOnly = !state.unreadOnly;
      if (state.unreadOnly) {
        state.prefs.scope = 'all';
        state.prefs.category = 'all';
        el.search.value = '';
        savePrefs();
        syncScopeButtons();
        showToast('新着だけを表示しています');
      }
      switchScreen('home');
      render();
    });

    el.refresh.addEventListener('click', () => loadData({ manual: true }));
    el.markAllRead.addEventListener('click', markAllRead);

    el.chips.addEventListener('click', (event) => {
      const chip = event.target.closest('.chip');
      if (!chip) return;
      state.prefs.category = chip.dataset.category;
      savePrefs();
      render();
    });

    for (const button of document.querySelectorAll('.scope')) {
      button.addEventListener('click', () => {
        state.prefs.scope = button.dataset.scope;
        savePrefs();
        syncScopeButtons();
        render();
      });
    }

    let searchTimer = null;
    el.search.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => renderList(el.homeList, visibleItems(), homeEmpty()), 160);
    });

    document.addEventListener('click', (event) => {
      const button = event.target.closest('[data-save-id]');
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();
      const id = button.dataset.saveId;
      const index = state.prefs.savedIds.indexOf(id);
      if (index === -1) state.prefs.savedIds.push(id);
      else state.prefs.savedIds.splice(index, 1);
      savePrefs();
      render();
      showToast(index === -1 ? '保存しました' : '保存をやめました');
    });

    for (const tab of document.querySelectorAll('.tab')) {
      tab.addEventListener('click', () => switchScreen(tab.dataset.screen));
    }

    el.notifyToggle.addEventListener('change', () => {
      if (el.notifyToggle.checked) {
        enableNotifications();
      } else {
        state.prefs.notify = false;
        savePrefs();
        describeNotifyState();
      }
    });

    el.importantOnlyToggle.addEventListener('change', () => {
      state.prefs.importantOnly = el.importantOnlyToggle.checked;
      savePrefs();
    });

    el.intervalSelect.addEventListener('change', () => {
      state.prefs.intervalMinutes = Number(el.intervalSelect.value);
      savePrefs();
      restartTimer();
    });

    el.largeTextToggle.addEventListener('change', () => {
      state.prefs.largeText = el.largeTextToggle.checked;
      document.body.classList.toggle('is-large-text', state.prefs.largeText);
      savePrefs();
    });

    el.clearCache.addEventListener('click', () => {
      if (!confirm('保存したお知らせ・既読の記録・設定をすべて消去します。よろしいですか？')) return;
      try { localStorage.removeItem(STORE_KEY); } catch { /* 消せなくても続行 */ }
      state.prefs = { ...defaults };
      state.unreadOnly = false;
      applyPrefsToUi();
      render();
      showToast('保存データを消去しました');
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - state.lastCheckedAt > 5 * 60 * 1000) loadData();
    });
  }

  function syncScopeButtons() {
    for (const button of document.querySelectorAll('.scope')) {
      button.setAttribute('aria-pressed', String(button.dataset.scope === state.prefs.scope));
    }
  }

  function applyPrefsToUi() {
    syncScopeButtons();
    el.importantOnlyToggle.checked = state.prefs.importantOnly;
    el.intervalSelect.value = String(state.prefs.intervalMinutes);
    el.largeTextToggle.checked = state.prefs.largeText;
    document.body.classList.toggle('is-large-text', state.prefs.largeText);
    describeNotifyState();
  }

  function showSkeleton() {
    const skeleton = document.createElement('div');
    skeleton.className = 'skeleton';
    for (let i = 0; i < 3; i += 1) {
      const row = document.createElement('div');
      row.className = 'skeleton__row';
      skeleton.append(row);
    }
    el.homeList.append(skeleton);
  }

  async function init() {
    applyPrefsToUi();
    bindEvents();
    showSkeleton();
    el.status.classList.add('reveal');

    await loadData();
    restartTimer();

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').then(() => {
        if (state.prefs.notify) registerPeriodicSync();
      }).catch(() => { /* オフライン対応が使えないだけで、アプリは動作する */ });

      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'news-updated') loadData();
      });
    }
  }

  init();
})();
