/* 提供票チェック — 保存を担当する。
 *
 * 保存先はこの端末の localStorage だけ。利用者名も提供票の写真も外には送らない。
 * 写真そのものは残さず、読み取った結果（どの日にマークがあったか）だけを履歴に残す。
 */

import { emptyPattern } from './schedule.js';

const KEY = 'teikyo-check/v1';
const HISTORY_LIMIT = 60;

const defaults = () => ({
  users: [],
  history: [],
  settings: {
    columnMode: '31',   // '31' = 用紙どおり31列 / 'month' = その月の日数
    sensitivity: 1,     // 読み取りの感度（0.6〜1.6）
    rowKinds: ['actual-am', 'actual-pm'],
  },
});

function newId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

let state = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults();
    const saved = JSON.parse(raw);
    const base = defaults();
    return {
      users: Array.isArray(saved.users) ? saved.users.map(normalizeUser) : [],
      history: Array.isArray(saved.history) ? saved.history : [],
      settings: { ...base.settings, ...(saved.settings ?? {}) },
    };
  } catch {
    return defaults();
  }
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* 保存できない環境（プライベートブラウズや容量いっぱい）でも、その場の操作は続けられる */
  }
}

function normalizeUser(user) {
  const pattern = emptyPattern();
  (user.pattern ?? []).forEach((slot, index) => {
    if (index < pattern.length && slot) {
      pattern[index] = { am: !!slot.am, pm: !!slot.pm, weeks: slot.weeks ?? 'every' };
    }
  });
  return {
    id: user.id ?? newId(),
    name: user.name ?? '',
    note: user.note ?? '',
    pattern,
    overrides: user.overrides ?? {},
    createdAt: user.createdAt ?? Date.now(),
  };
}

/* ---------- 利用者 ---------- */

export function listUsers() {
  return [...state.users].sort((a, b) => a.name.localeCompare(b.name, 'ja'));
}

export function getUser(id) {
  return state.users.find((user) => user.id === id) ?? null;
}

export function saveUser(input) {
  const user = normalizeUser(input);
  const index = state.users.findIndex((item) => item.id === user.id);
  if (index >= 0) state.users[index] = user;
  else state.users.push(user);
  persist();
  return user;
}

export function removeUser(id) {
  state.users = state.users.filter((user) => user.id !== id);
  state.history = state.history.filter((entry) => entry.userId !== id);
  persist();
}

/** その月だけの追加・休みを登録する。slot が null なら登録を取り消す。 */
export function setOverride(userId, key, slot) {
  const user = getUser(userId);
  if (!user) return;
  if (slot) user.overrides[key] = { am: !!slot.am, pm: !!slot.pm };
  else delete user.overrides[key];
  persist();
}

/* ---------- 履歴 ---------- */

export function listHistory(userId = null) {
  const items = userId ? state.history.filter((entry) => entry.userId === userId) : state.history;
  return [...items].sort((a, b) => b.checkedAt - a.checkedAt);
}

export function getHistory(id) {
  return state.history.find((entry) => entry.id === id) ?? null;
}

/** 同じ利用者・同じ月の結果は上書きする（読み直したら最新だけ残す）。 */
export function saveHistory(entry) {
  const saved = { ...entry, id: entry.id ?? newId(), checkedAt: entry.checkedAt ?? Date.now() };
  state.history = state.history.filter(
    (item) => !(item.userId === saved.userId && item.ym === saved.ym)
  );
  state.history.unshift(saved);
  if (state.history.length > HISTORY_LIMIT) state.history.length = HISTORY_LIMIT;
  persist();
  return saved;
}

export function removeHistory(id) {
  state.history = state.history.filter((entry) => entry.id !== id);
  persist();
}

/* ---------- 設定 ---------- */

export function getSettings() {
  return { ...state.settings };
}

export function updateSettings(changes) {
  state.settings = { ...state.settings, ...changes };
  persist();
}

export function clearAll() {
  state = defaults();
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* 消せなくても既定値には戻っている */
  }
}

/* ---------- 履歴に入れる形（マークの一覧を小さくする） ---------- */

/** Map<day, {am,pm}> → { am:[日...], pm:[日...] } */
export function packMarks(map) {
  const packed = { am: [], pm: [] };
  if (!map) return null;
  for (const [day, slot] of map) {
    if (slot.am) packed.am.push(day);
    if (slot.pm) packed.pm.push(day);
  }
  return packed;
}

/** packMarks の逆。 */
export function unpackMarks(packed) {
  if (!packed) return null;
  const map = new Map();
  for (const day of packed.am ?? []) map.set(day, { ...(map.get(day) ?? { am: false, pm: false }), am: true });
  for (const day of packed.pm ?? []) map.set(day, { ...(map.get(day) ?? { am: false, pm: false }), pm: true });
  return map;
}
