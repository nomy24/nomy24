// データの保存・同期を担当するレイヤー。
//
// Firebase が設定されていれば Firestore を使って全員のデータをリアルタイムに共有する。
// 設定されていなければ、この端末の localStorage だけで動く「お試しモード」にフォールバックする。
// 呼び出す側（app.js）はどちらのモードでも同じ関数を使えばよい。

import { isConfigured, ready as firebaseReady } from "./firebase-init.js";

const LOCAL_PREFIX = "staffTodo:v1:";

const COLLECTIONS = {
  staff: "staff",
  todos: "todos",
  events: "events",
  routineTasks: "routineTasks",
  routineLogs: "routineLogs",
  groups: "groups",
  photos: "photos",
  phoneMemos: "phoneMemos",
};

let firebase = null; // { db, firestore, auth } once ready, else null
export let mode = "local";

export const ready = (async () => {
  if (isConfigured) {
    firebase = await firebaseReady;
    mode = firebase ? "shared" : "local";
  } else {
    mode = "local";
  }
  return mode;
})();

function uid() {
  return (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
}

// ---------- localStorage バックエンド ----------

function localKey(name) {
  return `${LOCAL_PREFIX}${name}`;
}

function localGetAll(name) {
  try {
    const raw = localStorage.getItem(localKey(name));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function localSetAll(name, list) {
  localStorage.setItem(localKey(name), JSON.stringify(list));
  notifyLocal(name, list);
}

const localSubscribers = new Map(); // name -> Set(cb)

function notifyLocal(name, list) {
  const subs = localSubscribers.get(name);
  if (!subs) return;
  const sorted = [...list];
  for (const cb of subs) cb(sorted);
}

function localSubscribe(name, cb) {
  if (!localSubscribers.has(name)) localSubscribers.set(name, new Set());
  localSubscribers.get(name).add(cb);
  cb(localGetAll(name));
  return () => localSubscribers.get(name)?.delete(cb);
}

function localAdd(name, data, id = uid()) {
  const list = localGetAll(name);
  const now = Date.now();
  const doc = { id, ...data, createdAt: data.createdAt ?? now, updatedAt: now };
  list.push(doc);
  localSetAll(name, list);
  return id;
}

function localUpdate(name, id, data) {
  const list = localGetAll(name);
  const idx = list.findIndex((d) => d.id === id);
  if (idx === -1) return;
  list[idx] = { ...list[idx], ...data, updatedAt: Date.now() };
  localSetAll(name, list);
}

function localSet(name, id, data) {
  const list = localGetAll(name);
  const idx = list.findIndex((d) => d.id === id);
  const now = Date.now();
  if (idx === -1) {
    list.push({ id, ...data, createdAt: now, updatedAt: now });
  } else {
    list[idx] = { ...list[idx], ...data, updatedAt: now };
  }
  localSetAll(name, list);
}

function localRemove(name, id) {
  const list = localGetAll(name).filter((d) => d.id !== id);
  localSetAll(name, list);
}

// ---------- Firestore バックエンド ----------

function fsSubscribe(name, cb, orderField) {
  const { db, firestore } = firebase;
  const col = firestore.collection(db, name);
  const q = orderField ? firestore.query(col, firestore.orderBy(orderField, "asc")) : col;
  return firestore.onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      cb(list);
    },
    (err) => console.error(`${name} の購読でエラー`, err)
  );
}

async function fsAdd(name, data, id = uid()) {
  const { db, firestore } = firebase;
  await firestore.setDoc(firestore.doc(db, name, id), {
    ...data,
    createdAt: data.createdAt ?? Date.now(),
    updatedAt: Date.now(),
  });
  return id;
}

async function fsUpdate(name, id, data) {
  const { db, firestore } = firebase;
  await firestore.updateDoc(firestore.doc(db, name, id), { ...data, updatedAt: Date.now() });
}

async function fsSet(name, id, data) {
  const { db, firestore } = firebase;
  await firestore.setDoc(firestore.doc(db, name, id), { ...data, updatedAt: Date.now() }, { merge: true });
}

async function fsRemove(name, id) {
  const { db, firestore } = firebase;
  await firestore.deleteDoc(firestore.doc(db, name, id));
}

// ---------- 公開 API ----------
// mode が確定してから使うこと（app.js 側で `await store.ready` してから呼ぶ）

function makeCrud(name, orderField) {
  return {
    subscribe(cb) {
      return mode === "shared" ? fsSubscribe(name, cb, orderField) : localSubscribe(name, cb);
    },
    add(data, id) {
      return mode === "shared" ? fsAdd(name, data, id) : Promise.resolve(localAdd(name, data, id));
    },
    update(id, data) {
      return mode === "shared" ? fsUpdate(name, id, data) : Promise.resolve(localUpdate(name, id, data));
    },
    set(id, data) {
      return mode === "shared" ? fsSet(name, id, data) : Promise.resolve(localSet(name, id, data));
    },
    remove(id) {
      return mode === "shared" ? fsRemove(name, id) : Promise.resolve(localRemove(name, id));
    },
  };
}

export const staffStore = makeCrud(COLLECTIONS.staff, "order");
export const todoStore = makeCrud(COLLECTIONS.todos);
export const eventStore = makeCrud(COLLECTIONS.events);
export const routineTaskStore = makeCrud(COLLECTIONS.routineTasks, "order");
export const routineLogStore = makeCrud(COLLECTIONS.routineLogs);
export const groupStore = makeCrud(COLLECTIONS.groups, "order");
export const photoStore = makeCrud(COLLECTIONS.photos);
export const phoneMemoStore = makeCrud(COLLECTIONS.phoneMemos);
