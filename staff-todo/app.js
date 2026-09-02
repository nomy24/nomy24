import { mode as storeModeRef, ready as storeReady, staffStore, todoStore, eventStore, routineTaskStore, routineLogStore, groupStore, photoStore, phoneMemoStore, minutesStore, configStore } from "./store.js";
import { isConfigured as firebaseConfigured, signIn, signOutUser, onAuthChange } from "./firebase-init.js";

// ---------------- 共通ユーティリティ ----------------

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function pad2(n) { return String(n).padStart(2, "0"); }

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const CHECK_ANIM_MS = 620;
const TAB_SLIDE_MS = 170;

// タブ切り替え（フリック／タップ）を左右へのスライドで見せる共通処理。
// container: 中身を作り直す一覧要素（同じ要素を使い回す）
// delta: 1=次のタブへ（左へ抜けて右から入る）, -1=前のタブへ（右へ抜けて左から入る）
// applyChange: 状態を更新して一覧を再描画する関数
// onDone: アニメーション完了後に呼ばれる（多重実行防止のロック解除などに使う）
function slideSwapContent(container, delta, applyChange, onDone) {
  if (prefersReducedMotion()) {
    applyChange();
    if (onDone) onDone();
    return;
  }
  container.classList.add(delta > 0 ? "is-sliding-out-left" : "is-sliding-out-right");
  setTimeout(() => {
    applyChange();
    container.classList.remove("is-sliding-out-left", "is-sliding-out-right");
    container.classList.add(delta > 0 ? "is-sliding-in-from-right" : "is-sliding-in-from-left");
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        container.classList.remove("is-sliding-in-from-right", "is-sliding-in-from-left");
        if (onDone) onDone();
      });
    });
  }, TAB_SLIDE_MS);
}

// スワイプ（左右フリック）で前後のタブに切り替えられるようにする共通処理。
// order配列内でのcurrentの位置を基準に、フリック方向に応じたタブへ切り替える。
function setupSwipeNav(el, getCurrent, order, onSwitch) {
  let touchStartX = null;
  let touchStartY = null;
  let touchHandled = false;
  el.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) return;
    if (!sheetEl.hidden) return; // 編集画面（シート）を開いている間はフリックでタブが切り替わらないようにする
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    touchHandled = false;
  }, { passive: true });
  el.addEventListener("touchmove", (e) => {
    if (touchStartX === null || touchHandled) return;
    const dx = e.touches[0].clientX - touchStartX;
    const dy = e.touches[0].clientY - touchStartY;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
      touchHandled = true;
      const idx = order.indexOf(getCurrent());
      const nextIdx = idx + (dx < 0 ? 1 : -1);
      if (nextIdx >= 0 && nextIdx < order.length) onSwitch(order[nextIdx]);
    }
  }, { passive: true });
  el.addEventListener("touchend", () => {
    touchStartX = null;
    touchStartY = null;
  });
}
const SPARK_COLORS = ["var(--color-primary)", "var(--color-accent)", "var(--color-warning)"];

function spawnSparkles(btn) {
  const count = 10;
  const frag = document.createDocumentFragment();
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.5;
    const dist = 20 + Math.random() * 18;
    const spark = document.createElement("span");
    spark.className = "spark";
    spark.style.setProperty("--dx", `${(Math.cos(angle) * dist).toFixed(1)}px`);
    spark.style.setProperty("--dy", `${(Math.sin(angle) * dist).toFixed(1)}px`);
    spark.style.setProperty("--delay", `${Math.round(Math.random() * 70)}ms`);
    spark.style.background = SPARK_COLORS[i % SPARK_COLORS.length];
    frag.appendChild(spark);
  }
  btn.appendChild(frag);
}

// 完了ボタンを押した瞬間にアニメーションを見せてから、実際の状態更新を確定する。
// 更新は同期的に一覧を再描画してカードごと作り直してしまうため、
// アニメーションが目に入るよう一呼吸だけ遅らせている。
function animateCheck(btn, commit) {
  if (prefersReducedMotion()) {
    commit();
    return;
  }
  btn.classList.add("is-checking");
  btn.disabled = true;
  spawnSparkles(btn);
  btn.closest(".card")?.classList.add("is-completing");
  setTimeout(commit, CHECK_ANIM_MS);
}

function toDateKey(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function todayKey() { return toDateKey(new Date()); }
function currentMonthKey() { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`; }

const WEEKDAYS_JA = ["日", "月", "火", "水", "木", "金", "土"];

const AVATAR_COLORS = ["#0d9488", "#ea580c", "#2563eb", "#7c3aed", "#db2777", "#65a30d", "#0891b2", "#c2410c"];

function colorForStaff(staff) {
  return staff?.color || AVATAR_COLORS[0];
}

function hexToRgba(hex, alpha) {
  const h = (hex || "").replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  if (Number.isNaN(n)) return `rgba(13, 148, 136, ${alpha})`;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

const ME_KEY = "staffTodo:me";
let authedEmail = null; // 共有モードでログイン中のメールアドレス（職員との紐付けに使う）
const LARGE_TEXT_KEY = "staffTodo:largeText";
const HIDE_HEADER_KEY = "staffTodo:hideHeader";
const GROUPS_SEEDED_KEY = "staffTodo:groupsSeeded";
const DEFAULT_GROUPS = ["機能訓練指導員", "生活相談員"];

// ---------------- 状態 ----------------

const state = {
  storeMode: "local",
  staff: [],
  todos: [],
  events: [],
  routineTasks: [],
  routineLogs: [],
  groups: [],
  photos: [],
  phoneMemos: [],
  minutes: [],
  // 共有モードでは、ログイン中のメールアドレスから自動的に決まる（端末側で自由に選べない）
  meId: firebaseConfigured ? null : (localStorage.getItem(ME_KEY) || null),
  screen: "todo",
  todoFilter: "open",
  todoSearch: "",
  memoFilter: "all",
  memoSearch: "",
  routineCat: "daily",
  photosSub: "files",
  calMonth: (() => { const d = new Date(); d.setDate(1); return d; })(),
  calSelected: todayKey(),
};

function meStaff() { return state.staff.find((s) => s.id === state.meId) || null; }
function staffById(id) { return state.staff.find((s) => s.id === id) || null; }

// 共有モード用：ログイン中のメールアドレスに一致する職員をstate.meIdに反映する。
// 一致する職員がいない（まだ紐付けていない）場合はnullのまま。
function syncMeFromAuth() {
  if (!firebaseConfigured) return;
  const staff = authedEmail
    ? state.staff.find((s) => (s.email || "").toLowerCase() === authedEmail.toLowerCase())
    : null;
  state.meId = staff ? staff.id : null;
}
function groupById(id) { return state.groups.find((g) => g.id === id) || null; }

// ---------------- 職員削除の権限（共有モードのみ） ----------------
// ログイン用メールアドレスが紐付いている職員は、本人しか削除できない
// （なりすまし等で他人のアカウントを勝手に消せてしまわないようにするため）。
// 未リンクの職員（お試し登録段階）は今まで通り誰でも削除できる。
//
// これは firestore.rules の delete 条件とそろえてある。以前はここだけ
// 「管理者なら他人も消せる」と判定していたが、ルール側は本人のみを許すため、
// 管理者には押せる削除ボタンが出るのに必ず失敗する、という状態になっていた。
// 退職者の削除は Firebase コンソールから行う。
function canDeleteStaff(target) {
  if (!firebaseConfigured) return true;
  if (!target?.email) return true;
  const me = meStaff();
  return !!me && me.id === target.id;
}

// ---------------- トースト ----------------

let toastTimer = null;
function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2400);
}

// ---------------- ボトムシート ----------------

const sheetEl = document.getElementById("sheet");
const sheetBackdrop = document.getElementById("sheetBackdrop");
const sheetForm = document.getElementById("sheetForm");
const sheetTitle = document.getElementById("sheetTitle");
let sheetSubmitHandler = null;

function openSheet(title, bodyHtml, { onSubmit, onDelete, submitLabel = "保存" } = {}) {
  sheetTitle.textContent = title;
  sheetForm.innerHTML = bodyHtml + `
    <div class="sheet__actions" id="sheetActions">
      ${onDelete ? `<button type="button" class="btn btn--danger" id="sheetDeleteBtn">削除</button>` : ""}
      <button type="submit" class="btn btn--primary">${submitLabel}</button>
    </div>
    ${onDelete ? `
    <div class="delete-confirm" id="deleteConfirm" hidden>
      <p class="delete-confirm__text">削除しますか？この操作は取り消せません。</p>
      <div class="delete-confirm__actions">
        <button type="button" class="btn btn--ghost" id="deleteCancelBtn">キャンセル</button>
        <button type="button" class="btn btn--danger-solid" id="deleteConfirmBtn">削除する</button>
      </div>
    </div>` : ""}
  `;
  sheetSubmitHandler = onSubmit;
  if (onDelete) {
    // 埋め込み先(プレビューのサンドボックス等)では window.confirm が使えないことがあるため、
    // シート内蔵の2段階確認に置き換えている。
    const deleteBtn = sheetForm.querySelector("#sheetDeleteBtn");
    const sheetActions = sheetForm.querySelector("#sheetActions");
    const confirmBox = sheetForm.querySelector("#deleteConfirm");
    deleteBtn.addEventListener("click", () => {
      sheetActions.hidden = true;
      confirmBox.hidden = false;
    });
    confirmBox.querySelector("#deleteCancelBtn").addEventListener("click", () => {
      confirmBox.hidden = true;
      sheetActions.hidden = false;
    });
    confirmBox.querySelector("#deleteConfirmBtn").addEventListener("click", async () => {
      await onDelete();
      closeSheet();
    });
  }
  wirePillGroups(sheetForm);
  sheetBackdrop.hidden = false;
  sheetEl.hidden = false;
  requestAnimationFrame(() => {
    sheetBackdrop.classList.add("is-open");
    sheetEl.classList.add("is-open");
  });
}

function closeSheet() {
  sheetBackdrop.classList.remove("is-open");
  sheetEl.classList.remove("is-open");
  setTimeout(() => {
    sheetBackdrop.hidden = true;
    sheetEl.hidden = true;
    sheetForm.innerHTML = "";
  }, 220);
}

document.getElementById("sheetClose").addEventListener("click", closeSheet);
sheetBackdrop.addEventListener("click", closeSheet);
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !sheetEl.hidden) closeSheet(); });

// ================================================================
// 写真・PDFのプレビュー表示（拡大・回転・PDF埋め込み表示）
// ================================================================

const mediaViewer = document.getElementById("mediaViewer");
const mvStage = document.getElementById("mvStage");
const mvImage = document.getElementById("mvImage");
const mvFrame = document.getElementById("mvFrame");
const mvRotateBtn = document.getElementById("mvRotateBtn");
const mvDownloadBtn = document.getElementById("mvDownloadBtn");
const mvCloseBtn = document.getElementById("mvCloseBtn");

let mvState = { scale: 1, tx: 0, ty: 0, rotate: 0 };
let mvObjectUrl = null; // PDFのiframe表示に使うblob URL（閉じるときに解放する）

function dataUrlToBlob(dataUrl) {
  const [header, base64] = dataUrl.split(",");
  const mime = header.match(/data:([^;]+)/)?.[1] || "application/octet-stream";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

// animated=true: 回転ボタン・ダブルタップ・指を離した後のスナップなど、単発の変化を
// なめらかにアニメーションさせる。animated=false（既定）: 指でのドラッグ・ピンチ中は
// アニメーションを付けず、指の動きにそのまま追従させる（もたつき防止）。
function applyMvTransform(animated = false) {
  mvImage.classList.toggle("mv-animated", animated);
  mvImage.style.transform = `translate(${mvState.tx}px, ${mvState.ty}px) rotate(${mvState.rotate}deg) scale(${mvState.scale})`;
}

function resetMvTransform(animated = false) {
  mvState = { scale: 1, tx: 0, ty: 0, rotate: 0 };
  applyMvTransform(animated);
}

// 画像・PDFはこのビューアで表示する。それ以外の形式は、ブラウザに表示を任せて
// 新しいタブで開く（ダウンロードは別のボタンで明示的に行う）。
function openMediaViewer(item) {
  const isImg = isImageAttachment(item);
  const isPdf = !isImg && isPdfAttachment(item);
  if (!isImg && !isPdf) {
    window.open(item.dataUrl, "_blank", "noopener");
    return;
  }
  mvImage.hidden = !isImg;
  mvFrame.hidden = isImg;
  mvRotateBtn.hidden = !isImg;
  if (isImg) {
    resetMvTransform();
    mvImage.src = item.dataUrl;
  } else {
    if (mvObjectUrl) URL.revokeObjectURL(mvObjectUrl);
    mvObjectUrl = URL.createObjectURL(dataUrlToBlob(item.dataUrl));
    mvFrame.src = mvObjectUrl;
  }
  mvDownloadBtn.href = item.dataUrl;
  mvDownloadBtn.download = item.fileName || (isImg ? "photo.jpg" : "file");
  mediaViewer.hidden = false;
  requestAnimationFrame(() => mediaViewer.classList.add("is-open"));
}

function closeMediaViewer() {
  mediaViewer.classList.remove("is-open");
  setTimeout(() => {
    mediaViewer.hidden = true;
    mvImage.src = "";
    mvFrame.src = "";
    if (mvObjectUrl) { URL.revokeObjectURL(mvObjectUrl); mvObjectUrl = null; }
  }, 200);
}

mvCloseBtn.addEventListener("click", closeMediaViewer);
mediaViewer.addEventListener("click", (e) => { if (e.target === mediaViewer) closeMediaViewer(); });
mvRotateBtn.addEventListener("click", () => {
  mvState.rotate = (mvState.rotate + 90) % 360;
  applyMvTransform(true);
});

// ピンチズーム・パン・ダブルタップ（画像のみ）
let mvPinchStartDist = 0;
let mvPinchStartScale = 1;
let mvPanStart = null;
let mvLastTapTime = 0;

function touchDist(t1, t2) {
  return Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
}

mvStage.addEventListener("touchstart", (e) => {
  if (mvImage.hidden) return;
  if (e.touches.length === 2) {
    mvPinchStartDist = touchDist(e.touches[0], e.touches[1]);
    mvPinchStartScale = mvState.scale;
    mvPanStart = null;
  } else if (e.touches.length === 1) {
    const now = Date.now();
    if (now - mvLastTapTime < 300) {
      if (mvState.scale > 1) resetMvTransform(true);
      else { mvState.scale = 2.5; applyMvTransform(true); }
      mvLastTapTime = 0;
      mvPanStart = null;
      return;
    }
    mvLastTapTime = now;
    mvPanStart = { x: e.touches[0].clientX, y: e.touches[0].clientY, tx: mvState.tx, ty: mvState.ty };
  }
}, { passive: true });

mvStage.addEventListener("touchmove", (e) => {
  if (mvImage.hidden) return;
  if (e.touches.length === 2 && mvPinchStartDist) {
    const dist = touchDist(e.touches[0], e.touches[1]);
    mvState.scale = Math.min(4, Math.max(1, mvPinchStartScale * (dist / mvPinchStartDist)));
    applyMvTransform();
  } else if (e.touches.length === 1 && mvPanStart && mvState.scale > 1) {
    mvState.tx = mvPanStart.tx + (e.touches[0].clientX - mvPanStart.x);
    mvState.ty = mvPanStart.ty + (e.touches[0].clientY - mvPanStart.y);
    applyMvTransform();
  }
}, { passive: true });

mvStage.addEventListener("touchend", (e) => {
  if (e.touches.length === 0) {
    mvPinchStartDist = 0;
    mvPanStart = null;
    if (mvState.scale <= 1) { mvState.scale = 1; mvState.tx = 0; mvState.ty = 0; applyMvTransform(true); }
  }
});

// デスクトップ用: ダブルクリックでズームのオン/オフ
mvImage.addEventListener("dblclick", () => {
  if (mvState.scale > 1) resetMvTransform(true);
  else { mvState.scale = 2.5; applyMvTransform(true); }
});

sheetForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!sheetSubmitHandler) return;
  const data = Object.fromEntries(new FormData(sheetForm).entries());
  try {
    await sheetSubmitHandler(data);
    closeSheet();
  } catch (err) {
    console.error(err);
    toast("保存できませんでした。もう一度お試しください。");
  }
});

function wirePillGroups(root) {
  root.querySelectorAll(".pill-group").forEach((group) => {
    const input = group.parentElement.querySelector('input[type="hidden"]');
    group.querySelectorAll(".pill-option").forEach((btn) => {
      btn.addEventListener("click", () => {
        group.querySelectorAll(".pill-option").forEach((b) => b.classList.remove("is-active"));
        btn.classList.add("is-active");
        if (input) input.value = btn.dataset.value;
      });
    });
  });
}

// ---------------- 画面切り替え ----------------

function setScreen(name) {
  state.screen = name;
  document.querySelectorAll(".screen").forEach((s) => { s.hidden = s.id !== `screen-${name}`; });
  document.querySelectorAll(".tab").forEach((t) => {
    const active = t.dataset.screen === name;
    t.classList.toggle("is-active", active);
    if (active) t.setAttribute("aria-current", "page"); else t.removeAttribute("aria-current");
  });
  renderScreen(name);
}

document.querySelectorAll(".tab").forEach((btn) => btn.addEventListener("click", () => setScreen(btn.dataset.screen)));

function renderScreen(name) {
  if (name === "todo") renderTodoList();
  else if (name === "calendar") renderCalendar();
  else if (name === "routine") renderRoutineList();
  else if (name === "photos") { if (state.photosSub === "minutes") renderMinutesList(); else renderPhotoTimeline(); }
  else if (name === "phoneMemo") renderMemoList();
  else if (name === "settings") renderSettings();
}

// ---------------- FAB ----------------

document.getElementById("fab").addEventListener("click", () => {
  if (state.screen === "todo") openTodoSheet();
  else if (state.screen === "calendar") openEventSheet(state.calSelected);
  else if (state.screen === "routine") openRoutineTaskSheet(state.routineCat);
  else if (state.screen === "photos") {
    if (state.photosSub === "minutes") openMinutesSheet();
    else document.getElementById("photoFileInput").click();
  }
  else if (state.screen === "phoneMemo") openMemoSheet();
  else if (state.screen === "settings") openStaffSheet();
});

// 資料画面のサブ切り替え（写真・ファイル / 議事録）
document.querySelectorAll("[data-photos-sub]").forEach((btn) => {
  btn.addEventListener("click", () => {
    state.photosSub = btn.dataset.photosSub;
    document.querySelectorAll("[data-photos-sub]").forEach((b) => {
      const active = b.dataset.photosSub === state.photosSub;
      b.classList.toggle("is-active", active);
      b.setAttribute("aria-selected", String(active));
    });
    document.getElementById("photosFilesView").hidden = state.photosSub !== "files";
    document.getElementById("photosMinutesView").hidden = state.photosSub !== "minutes";
    document.getElementById("photosSubNote").textContent = state.photosSub === "minutes"
      ? "右下の＋から会議の議事録を追加できます。日付・月ごとにまとまります。"
      : "右下の＋から写真やPDF・文書ファイルを追加できます。日付・月ごとにまとまります。";
    renderScreen("photos");
  });
});

// ================================================================
// Todo
// ================================================================

const TODO_FILTER_ORDER = ["open", "today", "mine", "done", "all"];
let todoFilterAnimating = false;

function switchTodoFilter(newFilter) {
  if (!TODO_FILTER_ORDER.includes(newFilter) || newFilter === state.todoFilter || todoFilterAnimating) return;
  const oldIndex = TODO_FILTER_ORDER.indexOf(state.todoFilter);
  const newIndex = TODO_FILTER_ORDER.indexOf(newFilter);
  const delta = newIndex > oldIndex ? 1 : -1;
  todoFilterAnimating = true;
  slideSwapContent(document.getElementById("todoList"), delta, () => {
    state.todoFilter = newFilter;
    document.querySelectorAll("[data-todo-filter]").forEach((b) => b.classList.toggle("is-active", b.dataset.todoFilter === newFilter));
    renderTodoList();
  }, () => { todoFilterAnimating = false; });
}

document.querySelectorAll("[data-todo-filter]").forEach((btn) => {
  btn.addEventListener("click", () => switchTodoFilter(btn.dataset.todoFilter));
});

// タスクが1件もないとき#todoListの高さが0になり、指の位置は隣の空表示メッセージの
// 上になってしまうため、スワイプの検知範囲は画面全体（section）にしておく。
setupSwipeNav(document.getElementById("screen-todo"), () => state.todoFilter, TODO_FILTER_ORDER, (cat) => {
  if (!document.getElementById("todoFilters").hidden) switchTodoFilter(cat);
});

function dueLabel(dueDate) {
  if (!dueDate) return "";
  const t = todayKey();
  if (dueDate === t) return "今日";
  if (dueDate < t) return `${dueDate.slice(5).replace("-", "/")}(期限切れ)`;
  return dueDate.slice(5).replace("-", "/");
}

function dateKeyWeekday(dateKey) {
  const [y, m, d] = dateKey.split("-").map(Number);
  return WEEKDAYS_JA[new Date(y, m - 1, d).getDay()];
}

// 日付ごとに積み重なっても見分けやすいよう、Todoをグループ見出しの単位に振り分ける。
function todoGroupLabel(t) {
  if (t.done) return "完了済み";
  if (!t.dueDate) return "期限なし";
  const tKey = todayKey();
  if (t.dueDate < tKey) return "期限切れ";
  if (t.dueDate === tKey) return "今日";
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (t.dueDate === toDateKey(tomorrow)) return "明日";
  const [, m, d] = t.dueDate.split("-");
  return `${Number(m)}月${Number(d)}日(${dateKeyWeekday(t.dueDate)})`;
}

function filteredTodos() {
  const t = todayKey();
  const q = state.todoSearch.trim().toLowerCase();
  if (q) {
    // 検索中はフィルターの絞り込みを無視し、完了済みも含めて全件からさかのぼって探す。
    return state.todos
      .filter((x) => x.title.toLowerCase().includes(q) || (x.memo || "").toLowerCase().includes(q))
      .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
  }
  let list = [...state.todos];
  if (state.todoFilter === "open") list = list.filter((x) => !x.done);
  else if (state.todoFilter === "today") list = list.filter((x) => !x.done && x.dueDate && x.dueDate <= t);
  else if (state.todoFilter === "mine") list = state.meId ? list.filter((x) => todoAssigneeIds(x).includes(state.meId)) : [];
  else if (state.todoFilter === "done") list = list.filter((x) => x.done);
  list.sort((a, b) => {
    if (!!a.done !== !!b.done) return a.done ? 1 : -1;
    const ad = a.dueDate || "9999-99-99", bd = b.dueDate || "9999-99-99";
    if (ad !== bd) return ad < bd ? -1 : 1;
    return (a.createdAt || 0) - (b.createdAt || 0);
  });
  return list;
}

// タブのアイコンに、未完了のTodo件数を数字で重ねて表示する。
function updateTodoTabBadge() {
  const badge = document.getElementById("todoTabBadge");
  const count = state.todos.filter((t) => !t.done).length;
  badge.hidden = count === 0;
  badge.textContent = count > 99 ? "99+" : String(count);
}

function renderTodoList() {
  const list = filteredTodos();
  const el = document.getElementById("todoList");
  const empty = document.getElementById("todoEmpty");
  const searching = !!state.todoSearch.trim();
  const seenAt = getSeenAt("todo");

  document.getElementById("todoFilters").hidden = searching;
  const note = document.getElementById("todoSearchNote");
  note.hidden = !searching;
  note.textContent = searching ? `「${state.todoSearch.trim()}」の検索結果: ${list.length}件` : "";

  if (!searching && state.todoFilter === "mine" && !state.meId) {
    el.innerHTML = "";
    empty.hidden = false;
    empty.textContent = "設定画面で「あなたの名前」を選ぶと、自分の担当タスクを表示できます。";
    return;
  }
  empty.textContent = searching
    ? `「${state.todoSearch.trim()}」に一致するタスクが見つかりません。`
    : state.todoFilter === "done"
      ? "完了済みのタスクはまだありません。"
      : "Todoはまだありません。右下の＋から追加できます。";
  empty.hidden = list.length > 0;

  let lastGroup = null;
  const parts = [];
  list.forEach((t) => {
    if (!searching) {
      const group = todoGroupLabel(t);
      if (group !== lastGroup) {
        parts.push(`<div class="list-group-header">${escapeHtml(group)}</div>`);
        lastGroup = group;
      }
    }
    const assignees = todoAssigneeIds(t).map((id) => staffById(id)).filter(Boolean);
    const isMine = !!state.meId && todoAssigneeIds(t).includes(state.meId);
    const mineColor = isMine ? colorForStaff(meStaff()) : null;
    const mineStyle = isMine ? ` style="background:${hexToRgba(mineColor, 0.16)}; border-left-color:${mineColor};"` : "";
    const badges = [];
    if (t.sourceRoutineTaskId) badges.push(`<span class="badge badge--purple">定型タスクから自動追加</span>`);
    if (t.dueDate) badges.push(`<span class="badge ${!t.done && t.dueDate < todayKey() ? "badge--danger" : t.dueDate === todayKey() ? "badge--warning" : ""}">${escapeHtml(dueLabel(t.dueDate))}</span>`);
    if (t.priority === "high") badges.push(`<span class="badge badge--danger">重要</span>`);
    assignees.forEach((a) => badges.push(`<span class="badge">${escapeHtml(a.name)}</span>`));
    if (t.responder) badges.push(`<span class="badge">対応: ${escapeHtml(t.responder)}</span>`);
    parts.push(`
      <div class="card ${isMine ? "card--mine" : ""}" data-id="${t.id}"${mineStyle}>
        <button type="button" class="check ${t.done ? "is-done" : ""}" data-action="toggle" aria-label="完了にする">
          <svg viewBox="0 0 24 24"><path d="M5 12l4 4 10-10"/></svg>
        </button>
        <div class="card__body" data-action="edit">
          <div class="card__title ${t.done ? "is-done" : ""}">${newTagHtml(isNewItem(t, seenAt))}${escapeHtml(t.title)}</div>
          ${t.memo ? `<div class="card__memo">${escapeHtml(t.memo)}</div>` : ""}
          ${badges.length ? `<div class="card__meta">${badges.join("")}</div>` : ""}
        </div>
      </div>`);
  });
  el.innerHTML = parts.join("");
  markSeen("todo");

  el.querySelectorAll('[data-action="toggle"]').forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = btn.closest(".card").dataset.id;
      const todo = state.todos.find((x) => x.id === id);
      const nowDone = !todo.done;
      const commit = () => {
        todoStore.update(id, { done: nowDone, doneBy: nowDone ? (meStaff()?.name || null) : null });
        if (nowDone) toast("完了しました");
      };
      if (nowDone) animateCheck(btn, commit);
      else commit();
    });
  });
  el.querySelectorAll('[data-action="edit"]').forEach((body) => {
    body.addEventListener("click", () => {
      const id = body.closest(".card").dataset.id;
      openTodoSheet(state.todos.find((x) => x.id === id));
    });
  });
}

const todoSearchInput = document.getElementById("todoSearchInput");
const todoSearchClear = document.getElementById("todoSearchClear");
todoSearchInput.addEventListener("input", () => {
  state.todoSearch = todoSearchInput.value;
  todoSearchClear.hidden = !state.todoSearch;
  renderTodoList();
});
todoSearchClear.addEventListener("click", () => {
  state.todoSearch = "";
  todoSearchInput.value = "";
  todoSearchClear.hidden = true;
  renderTodoList();
  todoSearchInput.focus();
});

function todoAssigneeIds(todo) {
  return todo?.assigneeIds || (todo?.assigneeId ? [todo.assigneeId] : []);
}

function assigneeChipsHtml(selectedIds) {
  if (!state.staff.length) return `<p class="note">まだ職員が登録されていません。設定画面から追加できます。</p>`;
  return state.staff.map((s) => `<button type="button" class="chip ${selectedIds.includes(s.id) ? "is-active" : ""}" data-id="${s.id}">${escapeHtml(s.name)}</button>`).join("");
}

function openTodoSheet(existing) {
  const priority = existing?.priority || "normal";
  const selectedAssigneeIds = new Set(todoAssigneeIds(existing));
  const currentResponderName = existing?.responder ?? "";
  const extraResponderOption = currentResponderName && !state.staff.some((s) => s.name === currentResponderName)
    ? `<option value="${escapeHtml(currentResponderName)}" selected>${escapeHtml(currentResponderName)}（一覧になし）</option>` : "";
  const html = `
    <div class="field">
      <label for="f-title">タイトル</label>
      <input id="f-title" name="title" type="text" required maxlength="100" value="${escapeHtml(existing?.title || "")}" placeholder="例：〇〇さんへ電話">
    </div>
    <div class="field">
      <label for="f-memo">メモ（任意）</label>
      <textarea id="f-memo" name="memo" maxlength="500" placeholder="詳しい内容があれば">${escapeHtml(existing?.memo || "")}</textarea>
    </div>
    <div class="field">
      <label>担当（複数選択可）</label>
      ${state.groups.length ? `
      <div class="chip-group" id="assigneeGroupChips">
        ${state.groups.map((g) => `<button type="button" class="chip chip--group" data-group-id="${g.id}">${escapeHtml(g.name)}</button>`).join("")}
      </div>` : ""}
      <div class="chip-group" id="assigneeGroup">${assigneeChipsHtml([...selectedAssigneeIds])}</div>
    </div>
    <div class="field">
      <label for="f-responder">対応者（任意）</label>
      <select id="f-responder" name="responder">
        <option value="">選択してください</option>
        ${extraResponderOption}
        ${state.staff.map((s) => `<option value="${escapeHtml(s.name)}" ${currentResponderName === s.name ? "selected" : ""}>${escapeHtml(s.name)}</option>`).join("")}
      </select>
    </div>
    <div class="field">
      <label for="f-due">期限（任意）</label>
      <input id="f-due" name="dueDate" type="date" value="${existing?.dueDate || ""}">
    </div>
    <div class="field">
      <label>優先度</label>
      <input type="hidden" name="priority" value="${priority}">
      <div class="pill-group">
        <button type="button" class="pill-option ${priority === "normal" ? "is-active" : ""}" data-value="normal">通常</button>
        <button type="button" class="pill-option ${priority === "high" ? "is-active" : ""}" data-value="high">重要</button>
      </div>
    </div>
  `;
  openSheet(existing ? "Todoを編集" : "Todoを追加", html, {
    onSubmit: async (data) => {
      const payload = {
        title: data.title.trim(),
        memo: data.memo?.trim() || "",
        assigneeIds: [...selectedAssigneeIds],
        assigneeId: null,
        responder: data.responder.trim(),
        dueDate: data.dueDate || null,
        priority: data.priority || "normal",
      };
      if (!payload.title) return;
      if (existing) {
        await todoStore.update(existing.id, payload);
      } else {
        await todoStore.add({ ...payload, done: false, createdBy: meStaff()?.name || null });
      }
      toast(existing ? "保存しました" : "Todoを追加しました");
    },
    onDelete: existing ? async () => { await todoStore.remove(existing.id); toast("削除しました"); } : null,
  });
  const groupMembers = (groupId) => state.staff.filter((s) => s.groupId === groupId).map((s) => s.id);
  function syncAssigneeChipsUI() {
    sheetForm.querySelectorAll("#assigneeGroup .chip").forEach((btn) => {
      btn.classList.toggle("is-active", selectedAssigneeIds.has(btn.dataset.id));
    });
    sheetForm.querySelectorAll("#assigneeGroupChips .chip--group").forEach((btn) => {
      const members = groupMembers(btn.dataset.groupId);
      const allSelected = members.length > 0 && members.every((id) => selectedAssigneeIds.has(id));
      btn.classList.toggle("is-active", allSelected);
    });
  }
  sheetForm.querySelector("#assigneeGroup")?.querySelectorAll(".chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      if (selectedAssigneeIds.has(id)) selectedAssigneeIds.delete(id);
      else selectedAssigneeIds.add(id);
      syncAssigneeChipsUI();
    });
  });
  sheetForm.querySelector("#assigneeGroupChips")?.querySelectorAll(".chip--group").forEach((btn) => {
    btn.addEventListener("click", () => {
      const members = groupMembers(btn.dataset.groupId);
      const allSelected = members.length > 0 && members.every((id) => selectedAssigneeIds.has(id));
      if (allSelected) members.forEach((id) => selectedAssigneeIds.delete(id));
      else members.forEach((id) => selectedAssigneeIds.add(id));
      syncAssigneeChipsUI();
    });
  });
  syncAssigneeChipsUI();
}

// ================================================================
// カレンダー
// ================================================================

document.getElementById("calPrev").addEventListener("click", () => shiftMonth(-1));
document.getElementById("calNext").addEventListener("click", () => shiftMonth(1));
document.getElementById("calMonthLabel").addEventListener("click", () => {
  state.calMonth = (() => { const d = new Date(); d.setDate(1); return d; })();
  state.calSelected = todayKey();
  renderCalendar();
});

let calAnimating = false;
const CAL_SLIDE_MS = 170;

function shiftMonth(delta) {
  const grid = document.getElementById("calGrid");
  const applyChange = () => {
    state.calMonth = new Date(state.calMonth.getFullYear(), state.calMonth.getMonth() + delta, 1);
    renderCalendar();
  };
  if (calAnimating || prefersReducedMotion()) {
    applyChange();
    return;
  }
  calAnimating = true;
  // 次の月へは左へ、前の月へは右へ抜けていき、逆側から新しい月が入ってくる。
  grid.classList.add(delta > 0 ? "is-sliding-out-left" : "is-sliding-out-right");
  setTimeout(() => {
    applyChange();
    const freshGrid = document.getElementById("calGrid");
    freshGrid.classList.remove("is-sliding-out-left", "is-sliding-out-right");
    freshGrid.classList.add(delta > 0 ? "is-sliding-in-from-right" : "is-sliding-in-from-left");
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        freshGrid.classList.remove("is-sliding-in-from-right", "is-sliding-in-from-left");
        calAnimating = false;
      });
    });
  }, CAL_SLIDE_MS);
}

function eventsOn(dateKey) { return state.events.filter((e) => e.date === dateKey); }

function renderCalendarWeekdaysOnce() {
  const el = document.getElementById("calWeekdays");
  if (el.childElementCount) return;
  el.innerHTML = WEEKDAYS_JA.map((w) => `<span>${w}</span>`).join("");
}

function renderCalendar() {
  renderCalendarWeekdaysOnce();
  const label = document.getElementById("calMonthLabel");
  const year = state.calMonth.getFullYear();
  const month = state.calMonth.getMonth();
  label.textContent = `${year}年${month + 1}月`;

  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();
  const totalCells = Math.ceil((firstDow + daysInMonth) / 7) * 7;

  const cells = [];
  for (let i = 0; i < totalCells; i++) {
    const dayNum = i - firstDow + 1;
    let cellDate, outside = false;
    if (dayNum < 1) { cellDate = new Date(year, month - 1, daysInPrevMonth + dayNum); outside = true; }
    else if (dayNum > daysInMonth) { cellDate = new Date(year, month + 1, dayNum - daysInMonth); outside = true; }
    else { cellDate = new Date(year, month, dayNum); }
    cells.push({ key: toDateKey(cellDate), num: cellDate.getDate(), outside, dow: cellDate.getDay() });
  }

  const grid = document.getElementById("calGrid");
  grid.innerHTML = cells.map((c) => {
    const evCount = eventsOn(c.key).length;
    const classes = ["cal-day"];
    if (c.outside) classes.push("is-outside");
    if (c.key === todayKey()) classes.push("is-today");
    if (c.key === state.calSelected) classes.push("is-selected");
    if (c.dow === 0) classes.push("is-sunday"); else if (c.dow === 6) classes.push("is-saturday");
    const dots = evCount ? `<span class="cal-day__dots">${Array.from({ length: Math.min(evCount, 3) }).map(() => "<span></span>").join("")}</span>` : "";
    return `<button type="button" class="${classes.join(" ")}" data-date="${c.key}">${c.num}${dots}</button>`;
  }).join("");

  grid.querySelectorAll(".cal-day").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.calSelected = btn.dataset.date;
      grid.querySelectorAll(".cal-day").forEach((b) => b.classList.toggle("is-selected", b === btn));
      openDayEventsSheet(btn.dataset.date);
    });
  });

  renderMonthOverview();
}

// 日付をタップすると、その日の予定をウィンドウ（ボトムシート）でまとめて確認できる。
function openDayEventsSheet(dateKey) {
  const list = eventsOn(dateKey).sort((a, b) => (a.startTime || "") < (b.startTime || "") ? -1 : 1);
  const label = `${Number(dateKey.slice(5, 7))}月${Number(dateKey.slice(8, 10))}日(${dateKeyWeekday(dateKey)})の予定${dateKey === todayKey() ? "（今日）" : ""}`;
  const seenAt = getSeenAt("calendar");
  const html = list.length
    ? `<div class="list">${list.map((e) => {
        const time = e.allDay ? "終日" : [e.startTime, e.endTime].filter(Boolean).join(" - ");
        return `
          <div class="card" data-id="${e.id}" data-action="edit-event">
            <div class="card__body">
              <div class="card__title">${newTagHtml(isNewItem(e, seenAt))}${escapeHtml(e.title)}</div>
              ${e.memo ? `<div class="card__memo">${escapeHtml(e.memo)}</div>` : ""}
              <div class="card__meta">${time ? `<span class="badge badge--info">${escapeHtml(time)}</span>` : ""}</div>
            </div>
          </div>`;
      }).join("")}</div>`
    : `<p class="empty">この日の予定はまだありません。閉じてから右下の＋で追加できます。</p>`;
  markSeen("calendar");
  openSheet(label, html, { onSubmit: async () => {}, submitLabel: "閉じる" });
  sheetForm.querySelectorAll('[data-action="edit-event"]').forEach((card) => {
    card.addEventListener("click", () => {
      openEventSheet(dateKey, state.events.find((x) => x.id === card.dataset.id));
    });
  });
}

// カレンダー画面下部には、選択中の1日ではなく表示中の月全体の予定を日付ごとにまとめて表示する。
function renderMonthOverview() {
  const year = state.calMonth.getFullYear();
  const month = state.calMonth.getMonth();
  const monthPrefix = `${year}-${pad2(month + 1)}`;
  const list = state.events
    .filter((e) => e.date && e.date.startsWith(monthPrefix))
    .sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return (a.startTime || "") < (b.startTime || "") ? -1 : 1;
    });
  document.getElementById("agendaTitle").textContent = `${month + 1}月の予定`;
  const el = document.getElementById("agendaList");
  const empty = document.getElementById("agendaEmpty");
  empty.hidden = list.length > 0;
  empty.textContent = "この月の予定はまだありません。日付をタップするか、右下の＋から追加できます。";
  const seenAt = getSeenAt("calendar");
  let lastDate = null;
  const parts = [];
  list.forEach((e) => {
    if (e.date !== lastDate) {
      const label = e.date === todayKey() ? "今日" : `${Number(e.date.slice(5, 7))}月${Number(e.date.slice(8, 10))}日(${dateKeyWeekday(e.date)})`;
      parts.push(`<div class="list-group-header">${escapeHtml(label)}</div>`);
      lastDate = e.date;
    }
    const time = e.allDay ? "終日" : [e.startTime, e.endTime].filter(Boolean).join(" - ");
    parts.push(`
      <div class="card" data-id="${e.id}" data-action="edit-event">
        <div class="card__body">
          <div class="card__title">${newTagHtml(isNewItem(e, seenAt))}${escapeHtml(e.title)}</div>
          ${e.memo ? `<div class="card__memo">${escapeHtml(e.memo)}</div>` : ""}
          <div class="card__meta">${time ? `<span class="badge badge--info">${escapeHtml(time)}</span>` : ""}</div>
        </div>
      </div>`);
  });
  el.innerHTML = parts.join("");
  markSeen("calendar");
  el.querySelectorAll('[data-action="edit-event"]').forEach((card) => {
    card.addEventListener("click", () => {
      const ev = state.events.find((x) => x.id === card.dataset.id);
      if (ev) openEventSheet(ev.date, ev);
    });
  });
}

// カレンダーをスワイプ／スクロールしても前後の月に切り替えられるようにする。
// #calGrid の中身は毎回作り直されるが、要素自体は同じなのでリスナーは一度だけ張ればよい。
(function setupCalendarScrollNav() {
  const grid = document.getElementById("calGrid");
  let touchStartX = null;
  let touchStartY = null;
  let touchHandled = false;

  grid.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) return;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    touchHandled = false;
  }, { passive: true });

  grid.addEventListener("touchmove", (e) => {
    if (touchStartX === null || touchHandled) return;
    const dx = e.touches[0].clientX - touchStartX;
    const dy = e.touches[0].clientY - touchStartY;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
      touchHandled = true;
      shiftMonth(dx < 0 ? 1 : -1);
    }
  }, { passive: true });

  grid.addEventListener("touchend", () => {
    touchStartX = null;
    touchStartY = null;
  });

  let wheelLocked = false;
  grid.addEventListener("wheel", (e) => {
    if (wheelLocked) return;
    const delta = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    if (Math.abs(delta) < 24) return;
    wheelLocked = true;
    shiftMonth(delta > 0 ? 1 : -1);
    setTimeout(() => { wheelLocked = false; }, 350);
  }, { passive: true });
})();

function openEventSheet(dateKey, existing) {
  const allDay = existing ? !!existing.allDay : true;
  const html = `
    <div class="field">
      <label for="e-title">予定名</label>
      <input id="e-title" name="title" type="text" required maxlength="100" value="${escapeHtml(existing?.title || "")}" placeholder="例：会議、〇〇さん来訪">
    </div>
    <div class="field">
      <label for="e-date">日付</label>
      <input id="e-date" name="date" type="date" required value="${existing?.date || dateKey}">
    </div>
    <div class="field">
      <label class="row" style="padding:0;">
        <span class="row__label">終日</span>
        <input type="checkbox" class="switch" name="allDay" ${allDay ? "checked" : ""} id="e-allday">
      </label>
    </div>
    <div class="field-row" id="e-time-fields" style="${allDay ? "display:none;" : ""}">
      <div class="field">
        <label for="e-start">開始</label>
        <input id="e-start" name="startTime" type="time" value="${existing?.startTime || ""}">
      </div>
      <div class="field">
        <label for="e-end">終了</label>
        <input id="e-end" name="endTime" type="time" value="${existing?.endTime || ""}">
      </div>
    </div>
    <div class="field">
      <label for="e-memo">メモ（任意）</label>
      <textarea id="e-memo" name="memo" maxlength="500">${escapeHtml(existing?.memo || "")}</textarea>
    </div>
  `;
  openSheet(existing ? "予定を編集" : "予定を追加", html, {
    onSubmit: async (data) => {
      const payload = {
        title: data.title.trim(),
        date: data.date,
        allDay: data.allDay === "on",
        startTime: data.allDay === "on" ? "" : (data.startTime || ""),
        endTime: data.allDay === "on" ? "" : (data.endTime || ""),
        memo: data.memo?.trim() || "",
      };
      if (!payload.title || !payload.date) return;
      if (existing) await eventStore.update(existing.id, payload);
      else await eventStore.add({ ...payload, createdBy: meStaff()?.name || null });
      state.calSelected = payload.date;
      toast(existing ? "保存しました" : "予定を追加しました");
    },
    onDelete: existing ? async () => { await eventStore.remove(existing.id); toast("削除しました"); } : null,
  });
  const allDayBox = document.getElementById("e-allday");
  allDayBox.addEventListener("change", () => {
    document.getElementById("e-time-fields").style.display = allDayBox.checked ? "none" : "flex";
  });
}

// ================================================================
// 定型タスク
// ================================================================

const ROUTINE_LABELS = { daily: "毎日", monthStart: "月初", monthEnd: "月末", adhoc: "随時" };
const ROUTINE_NOTES = {
  daily: "毎日の始業・終業時などに確認するタスクです。日付が変わると未実施に戻ります。",
  monthStart: "月の初めに行うタスクです。月が変わると未実施に戻ります。",
  monthEnd: "月の終わりに行うタスクです。月が変わると未実施に戻ります。",
  adhoc: "必要なときに行うタスクです。実施したらチェックし、次に必要になったら外してください。",
};

const ROUTINE_CAT_ORDER = ["daily", "monthStart", "monthEnd", "adhoc"];
let routineCatAnimating = false;

function switchRoutineCat(newCat) {
  if (!ROUTINE_CAT_ORDER.includes(newCat) || newCat === state.routineCat || routineCatAnimating) return;
  const oldIndex = ROUTINE_CAT_ORDER.indexOf(state.routineCat);
  const newIndex = ROUTINE_CAT_ORDER.indexOf(newCat);
  const delta = newIndex > oldIndex ? 1 : -1;
  routineCatAnimating = true;
  slideSwapContent(document.getElementById("routineList"), delta, () => {
    state.routineCat = newCat;
    document.querySelectorAll("[data-routine-cat]").forEach((b) => {
      const active = b.dataset.routineCat === newCat;
      b.classList.toggle("is-active", active);
      b.setAttribute("aria-selected", String(active));
    });
    renderRoutineList();
  }, () => { routineCatAnimating = false; });
}

document.querySelectorAll("[data-routine-cat]").forEach((btn) => {
  btn.addEventListener("click", () => switchRoutineCat(btn.dataset.routineCat));
});

// タスクが1件もないと#routineListの高さが0になり、指の位置は隣の空表示メッセージの
// 上になってしまうため、スワイプの検知範囲は画面全体（section）にしておく。
setupSwipeNav(document.getElementById("screen-routine"), () => state.routineCat, ROUTINE_CAT_ORDER, switchRoutineCat);

function periodKeyFor(cat) {
  if (cat === "daily") return todayKey();
  if (cat === "monthStart" || cat === "monthEnd") return currentMonthKey();
  return "once";
}

function routineLogFor(taskId, cat) {
  const id = `${taskId}__${periodKeyFor(cat)}`;
  return state.routineLogs.find((l) => l.id === id) || null;
}

// カテゴリタブ（毎日・月初・月末・随時）それぞれに、今対応が必要な（＝未実施の）
// 定型タスクの件数を表示する。月初・月末は、その期間の日付になっているものだけを数える。
function updateRoutineCatCounts() {
  const day = new Date().getDate();
  Object.keys(ROUTINE_LABELS).forEach((cat) => {
    const badge = document.getElementById(`routineCatCount-${cat}`);
    if (!badge) return;
    const count = state.routineTasks.filter((task) => {
      if (task.category !== cat) return false;
      if (cat === "monthStart" || cat === "monthEnd") {
        if (!task.periodStartDay || !task.periodEndDay) return false;
        if (day < task.periodStartDay || day > task.periodEndDay) return false;
      }
      return !routineLogFor(task.id, cat)?.done;
    }).length;
    badge.hidden = count === 0;
    badge.textContent = count > 99 ? "99+" : String(count);
  });
}

function renderRoutineList() {
  document.getElementById("routinePeriodNote").textContent = ROUTINE_NOTES[state.routineCat];
  const tasks = state.routineTasks.filter((t) => t.category === state.routineCat)
    .sort((a, b) => (a.order || 0) - (b.order || 0));
  const el = document.getElementById("routineList");
  const empty = document.getElementById("routineEmpty");
  empty.hidden = tasks.length > 0;
  const seenAt = getSeenAt("routine");
  el.innerHTML = tasks.map((task) => {
    const log = routineLogFor(task.id, state.routineCat);
    const done = !!log?.done;
    let statusHtml;
    if (done) {
      const time = log.doneAt ? new Date(log.doneAt).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
      statusHtml = `<span class="badge badge--primary">${escapeHtml(log.doneBy || "実施済み")}${time ? " ・ " + time : ""}</span>`;
    } else {
      statusHtml = `<span class="badge">未実施</span>`;
    }
    const periodHtml = task.periodStartDay && task.periodEndDay
      ? `<span class="badge badge--info">${task.periodStartDay}日〜${task.periodEndDay}日</span>` : "";
    const assigneeHtml = (task.assigneeIds || []).map((id) => staffById(id)).filter(Boolean)
      .map((a) => `<span class="badge">${escapeHtml(a.name)}</span>`).join("");
    return `
      <div class="card" data-id="${task.id}">
        <button type="button" class="check ${done ? "is-done" : ""}" data-action="toggle" aria-label="実施済みにする">
          <svg viewBox="0 0 24 24"><path d="M5 12l4 4 10-10"/></svg>
        </button>
        <div class="card__body" data-action="edit">
          <div class="card__title ${done ? "is-done" : ""}">${newTagHtml(isNewItem(task, seenAt))}${escapeHtml(task.title)}</div>
          ${task.memo ? `<div class="card__memo">${escapeHtml(task.memo)}</div>` : ""}
          <div class="card__meta">${periodHtml}${statusHtml}${assigneeHtml}</div>
        </div>
      </div>`;
  }).join("");
  markSeen("routine");

  el.querySelectorAll('[data-action="toggle"]').forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const taskId = btn.closest(".card").dataset.id;
      const cat = state.routineCat;
      const periodKey = periodKeyFor(cat);
      const logId = `${taskId}__${periodKey}`;
      const log = routineLogFor(taskId, cat);
      const nowDone = !log?.done;
      const commit = () => {
        routineLogStore.set(logId, {
          taskId, category: cat, periodKey,
          done: nowDone,
          doneBy: nowDone ? (meStaff()?.name || "スタッフ") : null,
          doneAt: nowDone ? Date.now() : null,
        });
        if (nowDone) toast("完了しました");
      };
      if (nowDone) animateCheck(btn, commit);
      else commit();
    });
  });
  el.querySelectorAll('[data-action="edit"]').forEach((body) => {
    body.addEventListener("click", () => {
      const id = body.closest(".card").dataset.id;
      openRoutineTaskSheet(state.routineCat, state.routineTasks.find((x) => x.id === id));
    });
  });
}

function routineHasPeriod(category) {
  return category === "monthStart" || category === "monthEnd";
}

function openRoutineTaskSheet(cat, existing) {
  const category = existing?.category || cat;
  const selectedAssigneeIds = new Set(existing?.assigneeIds || []);
  const html = `
    <div class="field">
      <label for="r-title">タスク名</label>
      <input id="r-title" name="title" type="text" required maxlength="80" value="${escapeHtml(existing?.title || "")}" placeholder="例：施錠確認">
    </div>
    <div class="field">
      <label>種類</label>
      <input type="hidden" name="category" value="${category}">
      <div class="pill-group" id="r-category-group">
        ${Object.entries(ROUTINE_LABELS).map(([k, label]) => `<button type="button" class="pill-option ${category === k ? "is-active" : ""}" data-value="${k}">${label}</button>`).join("")}
      </div>
    </div>
    <div class="field">
      <label>対象職員（任意・複数選択可）</label>
      ${state.groups.length ? `
      <div class="chip-group" id="r-assigneeGroupChips">
        ${state.groups.map((g) => `<button type="button" class="chip chip--group" data-group-id="${g.id}">${escapeHtml(g.name)}</button>`).join("")}
      </div>` : ""}
      <div class="chip-group" id="r-assigneeGroup">${assigneeChipsHtml([...selectedAssigneeIds])}</div>
    </div>
    <div class="field" id="r-period-field" ${routineHasPeriod(category) ? "" : "hidden"}>
      <label>期間（任意・毎月の日付）</label>
      <p class="field__hint">この日付の範囲になったら、自動でTodoにも追加されます。</p>
      <div class="field-row">
        <div class="field">
          <label for="r-period-start">開始日</label>
          <input id="r-period-start" name="periodStartDay" type="number" min="1" max="31" value="${existing?.periodStartDay || ""}" placeholder="例：1">
        </div>
        <div class="field">
          <label for="r-period-end">終了日</label>
          <input id="r-period-end" name="periodEndDay" type="number" min="1" max="31" value="${existing?.periodEndDay || ""}" placeholder="例：5">
        </div>
      </div>
    </div>
    <div class="field">
      <label for="r-memo">メモ（任意）</label>
      <textarea id="r-memo" name="memo" maxlength="300" placeholder="手順の補足など">${escapeHtml(existing?.memo || "")}</textarea>
    </div>
  `;
  openSheet(existing ? "定型タスクを編集" : "定型タスクを追加", html, {
    onSubmit: async (data) => {
      const hasPeriod = routineHasPeriod(data.category);
      const startDay = hasPeriod && data.periodStartDay ? Number(data.periodStartDay) : null;
      const endDay = hasPeriod && data.periodEndDay ? Number(data.periodEndDay) : null;
      const payload = {
        title: data.title.trim(),
        category: data.category,
        memo: data.memo?.trim() || "",
        periodStartDay: startDay && endDay ? Math.min(startDay, endDay) : startDay,
        periodEndDay: startDay && endDay ? Math.max(startDay, endDay) : endDay,
        assigneeIds: [...selectedAssigneeIds],
      };
      if (!payload.title) return;
      if (existing) await routineTaskStore.update(existing.id, payload);
      else await routineTaskStore.add({ ...payload, order: Date.now(), createdBy: meStaff()?.name || null });
      state.routineCat = payload.category;
      document.querySelectorAll("[data-routine-cat]").forEach((b) => {
        const active = b.dataset.routineCat === payload.category;
        b.classList.toggle("is-active", active);
        b.setAttribute("aria-selected", String(active));
      });
      toast(existing ? "保存しました" : "定型タスクを追加しました");
    },
    onDelete: existing ? async () => { await routineTaskStore.remove(existing.id); toast("削除しました"); } : null,
  });
  sheetForm.querySelector("#r-category-group").querySelectorAll(".pill-option").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.getElementById("r-period-field").hidden = !routineHasPeriod(btn.dataset.value);
    });
  });
  const groupMembers = (groupId) => state.staff.filter((s) => s.groupId === groupId).map((s) => s.id);
  function syncRoutineAssigneeChipsUI() {
    sheetForm.querySelectorAll("#r-assigneeGroup .chip").forEach((btn) => {
      btn.classList.toggle("is-active", selectedAssigneeIds.has(btn.dataset.id));
    });
    sheetForm.querySelectorAll("#r-assigneeGroupChips .chip--group").forEach((btn) => {
      const members = groupMembers(btn.dataset.groupId);
      const allSelected = members.length > 0 && members.every((id) => selectedAssigneeIds.has(id));
      btn.classList.toggle("is-active", allSelected);
    });
  }
  sheetForm.querySelector("#r-assigneeGroup")?.querySelectorAll(".chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      if (selectedAssigneeIds.has(id)) selectedAssigneeIds.delete(id);
      else selectedAssigneeIds.add(id);
      syncRoutineAssigneeChipsUI();
    });
  });
  sheetForm.querySelector("#r-assigneeGroupChips")?.querySelectorAll(".chip--group").forEach((btn) => {
    btn.addEventListener("click", () => {
      const members = groupMembers(btn.dataset.groupId);
      const allSelected = members.length > 0 && members.every((id) => selectedAssigneeIds.has(id));
      if (allSelected) members.forEach((id) => selectedAssigneeIds.delete(id));
      else members.forEach((id) => selectedAssigneeIds.add(id));
      syncRoutineAssigneeChipsUI();
    });
  });
  syncRoutineAssigneeChipsUI();
}

// ================================================================
// 資料（写真・ファイル）
// ================================================================

// 共有モードではFirestoreの1ドキュメント1MiB制限に収まる必要がある（Base64化で約1.37倍に膨らむため余裕を持たせる）。
// お試しモード(localStorage)側もこの範囲なら十分収まるため、共通の上限として扱う。
const MAX_FILE_BYTES = 700 * 1024;

function isImageAttachment(item) {
  return !item.type || item.type === "image"; // 旧データ(typeフィールドなし)は写真として扱う
}

function formatBytes(n) {
  if (!n) return "";
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

// 端末の保存容量を圧迫しないよう、長辺を縮小してJPEGに再エンコードしてから保存する。
function compressImageToDataUrl(file) {
  const MAX_DIM = 1280;
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        let { width, height } = img;
        if (width > MAX_DIM || height > MAX_DIM) {
          if (width > height) { height = Math.round((height * MAX_DIM) / width); width = MAX_DIM; }
          else { width = Math.round((width * MAX_DIM) / height); height = MAX_DIM; }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.72));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });
}

async function addAttachmentFromFile(file) {
  if (!file) return;
  const isImage = file.type.startsWith("image/");
  if (!isImage && file.size > MAX_FILE_BYTES) {
    toast(`ファイルが大きすぎます（上限${formatBytes(MAX_FILE_BYTES)}）。`);
    return;
  }
  try {
    if (isImage) {
      const dataUrl = await compressImageToDataUrl(file);
      await photoStore.add({ type: "image", dataUrl, memo: "", createdBy: meStaff()?.name || null });
      toast("写真を追加しました");
    } else {
      const dataUrl = await readFileAsDataUrl(file);
      await photoStore.add({
        type: "file", dataUrl, fileName: file.name, fileType: file.type || "application/octet-stream",
        sizeBytes: file.size, memo: "", createdBy: meStaff()?.name || null,
      });
      toast("ファイルを追加しました");
    }
  } catch (e) {
    console.error(e);
    toast("保存できませんでした。容量が足りない可能性があります。");
  }
}

const photoFileInput = document.getElementById("photoFileInput");
photoFileInput.addEventListener("change", () => {
  const file = photoFileInput.files?.[0];
  photoFileInput.value = "";
  if (file) addAttachmentFromFile(file);
});

// クリップボードに画像をコピーしていれば、資料画面上での貼り付け（Ctrl/Cmd+V）でも追加できる。
document.addEventListener("paste", (e) => {
  if (state.screen !== "photos") return;
  const item = [...(e.clipboardData?.items || [])].find((it) => it.type.startsWith("image/"));
  if (!item) return;
  const file = item.getAsFile();
  if (file) addAttachmentFromFile(file);
});

function monthLabelJa(monthKey) {
  const [y, m] = monthKey.split("-");
  return `${y}年${Number(m)}月`;
}

function renderPhotoTimeline() {
  const el = document.getElementById("photoTimeline");
  const empty = document.getElementById("photoEmpty");
  const items = [...state.photos].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  empty.hidden = items.length > 0;
  const seenAt = getSeenAt("photos");

  // 日付ごとにひとまとめにし、月が変わったところにも見出しを挟む
  const dateGroups = [];
  let lastMonth = null;
  let lastDate = null;
  items.forEach((p) => {
    const d = new Date(p.createdAt || 0);
    const monthKey = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
    const dateKey = toDateKey(d);
    if (dateKey !== lastDate) {
      dateGroups.push({ monthKey, dateKey, showMonthHeader: monthKey !== lastMonth, items: [] });
      lastDate = dateKey;
      lastMonth = monthKey;
    }
    dateGroups[dateGroups.length - 1].items.push(p);
  });

  el.innerHTML = dateGroups.map((group) => {
    const dateLabel = group.dateKey === todayKey() ? "今日" : `${Number(group.dateKey.slice(5, 7))}月${Number(group.dateKey.slice(8, 10))}日(${dateKeyWeekday(group.dateKey)})`;
    const images = group.items.filter(isImageAttachment);
    const files = group.items.filter((p) => !isImageAttachment(p));
    const monthHeaderHtml = group.showMonthHeader ? `<h3 class="agenda__title photo-month-header">${escapeHtml(monthLabelJa(group.monthKey))}</h3>` : "";
    const gridHtml = images.length ? `<div class="photo-grid">${images.map((p) => `
      <button type="button" class="photo-thumb" data-id="${p.id}">
        <img src="${p.dataUrl}" alt="">${newTagHtml(isNewItem(p, seenAt))}
      </button>`).join("")}</div>` : "";
    const filesHtml = files.length ? `<div class="list file-list">${files.map((p) => `
      <div class="card" data-id="${p.id}" data-action="open-file">
        <div class="file-icon">${escapeHtml(fileExtLabel(p))}</div>
        <div class="card__body">
          <div class="card__title">${newTagHtml(isNewItem(p, seenAt))}${escapeHtml(p.fileName || "ファイル")}</div>
          <div class="card__meta">${p.sizeBytes ? `<span class="badge">${formatBytes(p.sizeBytes)}</span>` : ""}</div>
        </div>
      </div>`).join("")}</div>` : "";
    return `${monthHeaderHtml}<div class="list-group-header">${escapeHtml(dateLabel)}</div>${gridHtml}${filesHtml}`;
  }).join("");
  markSeen("photos");

  el.querySelectorAll(".photo-thumb, [data-action=\"open-file\"]").forEach((node) => {
    node.addEventListener("click", () => openAttachmentSheet(state.photos.find((x) => x.id === node.dataset.id)));
  });
}

function fileExtLabel(item) {
  const fromName = (item.fileName || "").split(".").pop();
  if (fromName && fromName.length <= 5) return fromName.toUpperCase();
  return (item.fileType || "").split("/").pop()?.slice(0, 4).toUpperCase() || "FILE";
}

function isPdfAttachment(item) {
  return item.fileType === "application/pdf" || /\.pdf$/i.test(item.fileName || "");
}

function openAttachmentSheet(item) {
  if (!item) return;
  const d = new Date(item.createdAt || 0);
  const label = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  const meta = `${escapeHtml(label)}${item.createdBy ? ` ・ ${escapeHtml(item.createdBy)}` : ""}`;
  const isImg = isImageAttachment(item);
  const downloadName = escapeHtml(item.fileName || (isImg ? "photo.jpg" : "file"));
  const previewHtml = isImg
    ? `
      <button type="button" class="photo-sheet__img-btn" id="attOpenBtn" aria-label="拡大表示">
        <img class="photo-sheet__img" src="${item.dataUrl}" alt="">
      </button>
      <div class="sheet-btn-row">
        <a class="ghost-btn" id="attDownloadBtn" href="${item.dataUrl}" download="${downloadName}">ダウンロード</a>
      </div>
    `
    : `
      <div class="file-preview">
        <div class="file-icon file-icon--lg">${escapeHtml(fileExtLabel(item))}</div>
        <div class="file-preview__body">
          <div class="card__title">${escapeHtml(item.fileName || "ファイル")}</div>
          <div class="card__meta">${item.sizeBytes ? `<span class="badge">${formatBytes(item.sizeBytes)}</span>` : ""}</div>
        </div>
      </div>
      <div class="sheet-btn-row">
        <button type="button" class="ghost-btn" id="attOpenBtn">${isPdfAttachment(item) ? "プレビュー表示" : "開く"}</button>
        <a class="ghost-btn" id="attDownloadBtn" href="${item.dataUrl}" download="${downloadName}">ダウンロード</a>
      </div>
    `;
  const html = `
    ${previewHtml}
    <p class="field__hint">${meta}</p>
    <div class="field">
      <label for="p-memo">メモ（任意）</label>
      <textarea id="p-memo" name="memo" maxlength="300" placeholder="気づいたことなど">${escapeHtml(item.memo || "")}</textarea>
    </div>
  `;
  openSheet(isImg ? "写真" : "ファイル", html, {
    onSubmit: async (data) => {
      await photoStore.update(item.id, { memo: data.memo?.trim() || "" });
      toast("保存しました");
    },
    onDelete: async () => { await photoStore.remove(item.id); toast("削除しました"); },
  });
  sheetForm.querySelector("#attOpenBtn")?.addEventListener("click", () => openMediaViewer(item));
}

// ================================================================
// 議事録
// ================================================================

function minutesSortKey(m) {
  return `${m.meetingDate || "0000-00-00"} ${m.meetingTime || "00:00"}`;
}

function renderMinutesList() {
  const el = document.getElementById("minutesList");
  const empty = document.getElementById("minutesEmpty");
  const items = [...state.minutes].sort((a, b) => (minutesSortKey(b) > minutesSortKey(a) ? 1 : -1));
  empty.hidden = items.length > 0;
  const seenAt = getSeenAt("minutes");

  const dateGroups = [];
  let lastMonth = null;
  let lastDate = null;
  items.forEach((m) => {
    const dateKey = m.meetingDate || todayKey();
    const monthKey = dateKey.slice(0, 7);
    if (dateKey !== lastDate) {
      dateGroups.push({ monthKey, dateKey, showMonthHeader: monthKey !== lastMonth, items: [] });
      lastDate = dateKey;
      lastMonth = monthKey;
    }
    dateGroups[dateGroups.length - 1].items.push(m);
  });

  el.innerHTML = dateGroups.map((group) => {
    const dateLabel = group.dateKey === todayKey() ? "今日" : `${Number(group.dateKey.slice(5, 7))}月${Number(group.dateKey.slice(8, 10))}日(${dateKeyWeekday(group.dateKey)})`;
    const monthHeaderHtml = group.showMonthHeader ? `<h3 class="agenda__title photo-month-header">${escapeHtml(monthLabelJa(group.monthKey))}</h3>` : "";
    const cardsHtml = group.items.map((m) => `
      <div class="card" data-id="${m.id}" data-action="edit">
        <div class="card__body">
          <div class="card__title">${newTagHtml(isNewItem(m, seenAt))}${escapeHtml(m.title || "(会議名未入力)")}</div>
          ${m.agenda ? `<div class="card__memo">${escapeHtml(m.agenda)}</div>` : ""}
          ${m.decisions ? `
          <div class="memo-progress">
            <span class="memo-progress__label">決定事項</span>
            <span class="memo-progress__text">${escapeHtml(m.decisions)}</span>
          </div>` : ""}
          <div class="card__meta">${m.meetingTime ? `<span class="badge badge--info">${escapeHtml(m.meetingTime)}</span>` : ""}</div>
        </div>
      </div>`).join("");
    return `${monthHeaderHtml}<div class="list-group-header">${escapeHtml(dateLabel)}</div>${cardsHtml}`;
  }).join("");
  markSeen("minutes");

  el.querySelectorAll('[data-action="edit"]').forEach((card) => {
    card.addEventListener("click", () => openMinutesSheet(state.minutes.find((x) => x.id === card.dataset.id)));
  });
}

function openMinutesSheet(existing) {
  const html = `
    <div class="field">
      <label for="mt-title">会議名</label>
      <input id="mt-title" name="title" type="text" required maxlength="80" value="${escapeHtml(existing?.title || "")}" placeholder="例：職員会議">
    </div>
    <div class="field-row">
      <div class="field">
        <label for="mt-date">日付</label>
        <input id="mt-date" name="meetingDate" type="date" required value="${existing?.meetingDate || todayKey()}">
      </div>
      <div class="field">
        <label for="mt-time">開始時刻（任意）</label>
        <input id="mt-time" name="meetingTime" type="time" value="${existing?.meetingTime || ""}">
      </div>
    </div>
    <div class="field">
      <label for="mt-agenda">議題・内容（任意）</label>
      <textarea id="mt-agenda" name="agenda" maxlength="2000" placeholder="話し合った内容など">${escapeHtml(existing?.agenda || "")}</textarea>
    </div>
    <div class="field">
      <label for="mt-decisions">決定事項（任意）</label>
      <textarea id="mt-decisions" name="decisions" maxlength="2000" placeholder="決まったこと・次回までの宿題など">${escapeHtml(existing?.decisions || "")}</textarea>
    </div>
  `;
  openSheet(existing ? "議事録を編集" : "議事録を追加", html, {
    onSubmit: async (data) => {
      const payload = {
        title: data.title.trim(),
        meetingDate: data.meetingDate || todayKey(),
        meetingTime: data.meetingTime || "",
        agenda: data.agenda?.trim() || "",
        decisions: data.decisions?.trim() || "",
      };
      if (!payload.title) return;
      if (existing) await minutesStore.update(existing.id, payload);
      else await minutesStore.add({ ...payload, createdBy: meStaff()?.name || null });
      toast(existing ? "保存しました" : "議事録を追加しました");
    },
    onDelete: existing ? async () => { await minutesStore.remove(existing.id); toast("削除しました"); } : null,
  });
}

// ================================================================
// 電話メモ
// ================================================================

const MEMO_STATUSES = ["未対応", "対応中", "完了"];
const MEMO_STATUS_BADGE = { 未対応: "badge--danger", 対応中: "badge--warning", 完了: "" };

// タブのアイコンに、未対応・対応中（＝まだ完了していない）件数を数字で重ねて表示する。
function updateMemoTabBadge() {
  const badge = document.getElementById("memoTabBadge");
  const count = state.phoneMemos.filter((m) => m.status !== "完了").length;
  badge.hidden = count === 0;
  badge.textContent = count > 99 ? "99+" : String(count);
}

const MEMO_FILTER_ORDER = ["all", "未対応", "対応中", "完了"];
let memoFilterAnimating = false;

function switchMemoFilter(newFilter) {
  if (!MEMO_FILTER_ORDER.includes(newFilter) || newFilter === state.memoFilter || memoFilterAnimating) return;
  const oldIndex = MEMO_FILTER_ORDER.indexOf(state.memoFilter);
  const newIndex = MEMO_FILTER_ORDER.indexOf(newFilter);
  const delta = newIndex > oldIndex ? 1 : -1;
  memoFilterAnimating = true;
  slideSwapContent(document.getElementById("memoList"), delta, () => {
    state.memoFilter = newFilter;
    document.querySelectorAll("[data-memo-filter]").forEach((b) => b.classList.toggle("is-active", b.dataset.memoFilter === newFilter));
    renderMemoList();
  }, () => { memoFilterAnimating = false; });
}

document.getElementById("memoFilters").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-memo-filter]");
  if (!btn) return;
  switchMemoFilter(btn.dataset.memoFilter);
});

setupSwipeNav(document.getElementById("screen-phoneMemo"), () => state.memoFilter, MEMO_FILTER_ORDER, switchMemoFilter);

const memoSearchInput = document.getElementById("memoSearchInput");
memoSearchInput.addEventListener("input", () => {
  state.memoSearch = memoSearchInput.value;
  renderMemoList();
});

function filteredMemos() {
  const q = state.memoSearch.trim().toLowerCase();
  let list = [...state.phoneMemos];
  if (state.memoFilter !== "all") list = list.filter((m) => m.status === state.memoFilter);
  if (q) list = list.filter((m) => (m.caller || "").toLowerCase().includes(q) || (m.content || "").toLowerCase().includes(q));
  list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return list;
}

function renderMemoList() {
  const list = filteredMemos();
  const el = document.getElementById("memoList");
  const empty = document.getElementById("memoEmpty");
  empty.hidden = list.length > 0;
  const seenAt = getSeenAt("phoneMemo");
  el.innerHTML = list.map((m) => {
    const time = new Date(m.createdAt || 0).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
    const badgeClass = MEMO_STATUS_BADGE[m.status] || "";
    const options = MEMO_STATUSES.map((s) => `<option value="${s}" ${s === m.status ? "selected" : ""}>${s}</option>`).join("");
    return `
      <div class="card ${m.status === "完了" ? "card--done" : ""}" data-id="${m.id}">
        <div class="card__body" data-action="edit">
          <div class="memo-top">
            <span class="memo-caller">${newTagHtml(isNewItem(m, seenAt))}${escapeHtml(m.caller || "(相手先未入力)")}</span>
            <span class="badge ${badgeClass}">${escapeHtml(m.status)}</span>
          </div>
          <div class="card__memo">${escapeHtml(m.content || "")}</div>
          ${m.progress ? `
          <div class="memo-progress">
            <span class="memo-progress__label">経過</span>
            <span class="memo-progress__text">${escapeHtml(m.progress)}</span>
          </div>` : ""}
          <div class="card__meta"><span class="badge">${escapeHtml(time)}受電</span><span class="badge">受: ${escapeHtml(m.staff || "-")}</span>${m.responder ? `<span class="badge">対応: ${escapeHtml(m.responder)}</span>` : ""}</div>
        </div>
        <select class="memo-select" data-action="quick-status" aria-label="対応状況を変更">${options}</select>
      </div>`;
  }).join("");
  markSeen("phoneMemo");

  el.querySelectorAll('[data-action="edit"]').forEach((body) => {
    body.addEventListener("click", () => openMemoSheet(state.phoneMemos.find((x) => x.id === body.closest(".card").dataset.id)));
  });
  el.querySelectorAll('[data-action="quick-status"]').forEach((select) => {
    select.addEventListener("click", (e) => e.stopPropagation());
    select.addEventListener("change", () => {
      const id = select.closest(".card").dataset.id;
      phoneMemoStore.update(id, { status: select.value });
    });
  });
}

function openMemoSheet(existing) {
  const status = existing?.status || "未対応";
  const currentStaffName = existing?.staff ?? meStaff()?.name ?? "";
  const currentResponderName = existing?.responder ?? "";
  // 過去に手入力された名前が今の職員一覧にない場合(退職・改名など)も選択肢から消えないようにする
  const extraStaffOption = currentStaffName && !state.staff.some((s) => s.name === currentStaffName)
    ? `<option value="${escapeHtml(currentStaffName)}" selected>${escapeHtml(currentStaffName)}（一覧になし）</option>` : "";
  const extraResponderOption = currentResponderName && !state.staff.some((s) => s.name === currentResponderName)
    ? `<option value="${escapeHtml(currentResponderName)}" selected>${escapeHtml(currentResponderName)}（一覧になし）</option>` : "";
  const html = `
    <div class="field">
      <label for="m-caller">相手先（氏名・施設名など）</label>
      <input id="m-caller" name="caller" type="text" maxlength="60" value="${escapeHtml(existing?.caller || "")}" placeholder="例：田中様（ご家族）">
    </div>
    <div class="field">
      <label for="m-content">要件</label>
      <textarea id="m-content" name="content" required maxlength="500" placeholder="例：来週の送迎時間を変更したい">${escapeHtml(existing?.content || "")}</textarea>
    </div>
    <div class="field">
      <label for="m-staff">受けた担当者</label>
      <select id="m-staff" name="staff">
        <option value="">選択してください</option>
        ${extraStaffOption}
        ${state.staff.map((s) => `<option value="${escapeHtml(s.name)}" ${currentStaffName === s.name ? "selected" : ""}>${escapeHtml(s.name)}</option>`).join("")}
      </select>
    </div>
    <div class="field">
      <label for="m-responder">対応者（任意）</label>
      <select id="m-responder" name="responder">
        <option value="">選択してください</option>
        ${extraResponderOption}
        ${state.staff.map((s) => `<option value="${escapeHtml(s.name)}" ${currentResponderName === s.name ? "selected" : ""}>${escapeHtml(s.name)}</option>`).join("")}
      </select>
    </div>
    <div class="field">
      <label for="m-progress">経過（任意）</label>
      <textarea id="m-progress" name="progress" maxlength="500" placeholder="例：ご家族に折り返し、来週火曜に変更で承諾済み">${escapeHtml(existing?.progress || "")}</textarea>
    </div>
    <div class="field">
      <label>対応状況</label>
      <input type="hidden" name="status" value="${status}">
      <div class="pill-group">
        ${MEMO_STATUSES.map((s) => `<button type="button" class="pill-option ${status === s ? "is-active" : ""}" data-value="${s}">${s}</button>`).join("")}
      </div>
    </div>
  `;
  openSheet(existing ? "電話メモを編集" : "電話メモを追加", html, {
    onSubmit: async (data) => {
      const payload = {
        caller: data.caller.trim(),
        content: data.content.trim(),
        progress: data.progress?.trim() || "",
        staff: data.staff.trim(),
        responder: data.responder.trim(),
        status: data.status || "未対応",
      };
      if (!payload.content) return;
      if (existing) await phoneMemoStore.update(existing.id, payload);
      else await phoneMemoStore.add({ ...payload, createdBy: meStaff()?.name || null });
      toast(existing ? "保存しました" : "電話メモを追加しました");
    },
    onDelete: existing ? async () => { await phoneMemoStore.remove(existing.id); toast("削除しました"); } : null,
  });
}

// ================================================================
// 設定
// ================================================================

function renderYouBadge() {
  const badge = document.getElementById("youBadge");
  const initial = document.getElementById("youInitial");
  const me = meStaff();
  if (me) {
    initial.textContent = me.name.slice(0, 1);
    badge.style.background = colorForStaff(me);
    badge.title = `${me.name}として利用中`;
  } else {
    initial.textContent = "?";
    badge.style.background = "";
    badge.title = firebaseConfigured
      ? "このアカウントはまだ職員に紐付けられていません。設定画面を確認してください。"
      : "設定画面で名前を選んでください";
  }
}

function renderStaffPicker() {
  const el = document.getElementById("staffPicker");
  if (!state.staff.length) {
    el.innerHTML = `<p class="note">まだ職員が登録されていません。「職員を追加する」から登録してください。</p>`;
    return;
  }

  const warnHtml = (firebaseConfigured && !state.meId)
    ? `<p class="note note--warn">このアカウント${authedEmail ? `（${escapeHtml(authedEmail)}）` : ""}はまだ職員に紐付けられていません。下の職員の鉛筆マークから、ログイン用メールアドレス欄にこのアドレスを入力してください。</p>`
    : "";

  const rowsHtml = state.staff.map((s) => `
    <div class="staff-row">
      ${firebaseConfigured ? `
      <div class="staff-chip staff-chip--readonly ${s.id === state.meId ? "is-active" : ""}">
        <span class="staff-chip__dot" style="background:${s.color || AVATAR_COLORS[0]}">${escapeHtml(s.name.slice(0, 1))}</span>
        ${escapeHtml(s.name)}
        ${s.id === state.meId ? `<span class="staff-chip__you">あなた</span>` : ""}
        ${!s.email ? `<span class="staff-chip__unlinked">未リンク</span>` : ""}
      </div>` : `
      <button type="button" class="staff-chip ${s.id === state.meId ? "is-active" : ""}" data-id="${s.id}">
        <span class="staff-chip__dot" style="background:${s.color || AVATAR_COLORS[0]}">${escapeHtml(s.name.slice(0, 1))}</span>
        ${escapeHtml(s.name)}
      </button>`}
      <button type="button" class="staff-chip__edit" data-edit-id="${s.id}" aria-label="${escapeHtml(s.name)}を編集する">
        <svg viewBox="0 0 24 24"><path d="M4 20h4l10.5-10.5a2 2 0 0 0 0-2.8l-1.2-1.2a2 2 0 0 0-2.8 0L4 16v4Z"/></svg>
      </button>
    </div>`).join("");

  el.innerHTML = warnHtml + rowsHtml;

  if (!firebaseConfigured) {
    el.querySelectorAll(".staff-chip").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.meId = btn.dataset.id;
        localStorage.setItem(ME_KEY, state.meId);
        renderStaffPicker();
        renderYouBadge();
        toast(`${meStaff().name}として利用します`);
      });
    });
  }
  el.querySelectorAll("[data-edit-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      openStaffSheet(state.staff.find((s) => s.id === btn.dataset.editId));
    });
  });
}

document.getElementById("addStaffBtn").addEventListener("click", () => openStaffSheet());

function openStaffSheet(existing) {
  const color = existing?.color || AVATAR_COLORS[state.staff.length % AVATAR_COLORS.length];
  const groupId = existing?.groupId || "";
  const deletable = !existing || canDeleteStaff(existing);
  // ログイン用メールが紐付いたあとは、その職員のメールは変更できない
  // （他人の doc のメールを書き換えてなりすます経路を塞ぐため、firestore.rules
  //   の update 条件でも拒否される）。入れ替えが必要なら Firebase コンソールから。
  const emailLocked = firebaseConfigured && !!existing?.email;
  const html = `
    <div class="field">
      <label for="s-name">名前</label>
      <input id="s-name" name="name" type="text" required maxlength="20" value="${escapeHtml(existing?.name || "")}" placeholder="例：山田">
    </div>
    ${firebaseConfigured ? `
    <div class="field">
      <label for="s-email">ログイン用メールアドレス（任意）</label>
      <input id="s-email" name="email" type="email" maxlength="100" value="${escapeHtml(existing?.email || "")}" placeholder="例：asuka_yamada@example.com" ${emailLocked ? "readonly" : ""}>
      <p class="field__hint">${emailLocked
        ? "この職員はすでにログイン用アカウントと紐付いているため、メールアドレスは変更できません。変更が必要なときは Firebase コンソールから行ってください。"
        : "Firebaseで発行したこの職員のログイン用アカウントと同じメールアドレスを入力すると、その職員がログインしたときに自動的に「あなた」として認識されます。"}</p>
    </div>` : ""}
    <div class="field">
      <label>色</label>
      <input type="hidden" name="color" value="${color}">
      <div class="pill-group" id="s-color-group">
        ${AVATAR_COLORS.map((c) => `<button type="button" class="pill-option ${c === color ? "is-active" : ""}" data-value="${c}" style="background:${c === color ? c : "transparent"}; border-color:${c}; color:${c === color ? "#fff" : c};">●</button>`).join("")}
      </div>
    </div>
    <div class="field">
      <label>職種グループ（任意）</label>
      <input type="hidden" name="groupId" value="${groupId}">
      <div class="pill-group" id="s-group-group">
        <button type="button" class="pill-option ${!groupId ? "is-active" : ""}" data-value="">なし</button>
        ${state.groups.map((g) => `<button type="button" class="pill-option ${g.id === groupId ? "is-active" : ""}" data-value="${g.id}">${escapeHtml(g.name)}</button>`).join("")}
      </div>
    </div>
    ${existing && existing.email && !deletable ? `<p class="note note--warn">この職員はログイン済みのため、本人しか削除できません。退職などで消す必要があるときは Firebase コンソールから行ってください。</p>` : ""}
  `;
  openSheet(existing ? "職員を編集" : "職員を追加", html, {
    onSubmit: async (data) => {
      const payload = { name: data.name.trim(), color: data.color, groupId: data.groupId || null };
      if (!payload.name) return;
      // 紐付け済みのメールは送らない（ルール側でも変更は拒否される）
      if (firebaseConfigured && !emailLocked) payload.email = (data.email || "").trim().toLowerCase() || null;
      if (existing) await staffStore.update(existing.id, payload);
      else {
        const id = await staffStore.add({ ...payload, order: Date.now() });
        if (!firebaseConfigured && !state.meId) { state.meId = id; localStorage.setItem(ME_KEY, id); }
      }
      toast(existing ? "保存しました" : "職員を追加しました");
    },
    onDelete: (existing && deletable) ? async () => {
      await staffStore.remove(existing.id);
      if (!firebaseConfigured && state.meId === existing.id) { state.meId = null; localStorage.removeItem(ME_KEY); }
      toast("削除しました");
    } : null,
  });
  // 色スウォッチのクリックで見た目も切り替える
  const colorGroup = sheetForm.querySelector("#s-color-group");
  colorGroup.querySelectorAll(".pill-option").forEach((btn) => {
    btn.addEventListener("click", () => {
      colorGroup.querySelectorAll(".pill-option").forEach((b) => { b.style.background = "transparent"; b.style.color = b.dataset.value; });
      btn.style.background = btn.dataset.value;
      btn.style.color = "#fff";
    });
  });
}

// ================================================================
// 職種グループ
// ================================================================

function renderGroupPicker() {
  const el = document.getElementById("groupPicker");
  if (!state.groups.length) {
    el.innerHTML = `<p class="note">まだグループが登録されていません。「グループを追加する」から登録してください。</p>`;
    return;
  }
  el.innerHTML = state.groups.map((g) => {
    const count = state.staff.filter((s) => s.groupId === g.id).length;
    return `
    <div class="staff-row">
      <span class="staff-chip">${escapeHtml(g.name)}<span class="badge">${count}人</span></span>
      <button type="button" class="staff-chip__edit" data-edit-group-id="${g.id}" aria-label="${escapeHtml(g.name)}を編集する">
        <svg viewBox="0 0 24 24"><path d="M4 20h4l10.5-10.5a2 2 0 0 0 0-2.8l-1.2-1.2a2 2 0 0 0-2.8 0L4 16v4Z"/></svg>
      </button>
    </div>`;
  }).join("");
  el.querySelectorAll("[data-edit-group-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      openGroupSheet(state.groups.find((g) => g.id === btn.dataset.editGroupId));
    });
  });
}

document.getElementById("addGroupBtn").addEventListener("click", () => openGroupSheet());

function openGroupSheet(existing) {
  const html = `
    <div class="field">
      <label for="g-name">グループ名</label>
      <input id="g-name" name="name" type="text" required maxlength="20" value="${escapeHtml(existing?.name || "")}" placeholder="例：生活相談員">
    </div>
  `;
  openSheet(existing ? "グループを編集" : "グループを追加", html, {
    onSubmit: async (data) => {
      const payload = { name: data.name.trim() };
      if (!payload.name) return;
      if (existing) await groupStore.update(existing.id, payload);
      else await groupStore.add({ ...payload, order: Date.now() });
      toast(existing ? "保存しました" : "グループを追加しました");
    },
    onDelete: existing ? async () => {
      await groupStore.remove(existing.id);
      const affected = state.staff.filter((s) => s.groupId === existing.id);
      await Promise.all(affected.map((s) => staffStore.update(s.id, { groupId: null })));
      toast("削除しました");
    } : null,
  });
}

function renderModeInfo() {
  const modebar = document.getElementById("modebar");
  const modebarText = document.getElementById("modebarText");
  const modeNote = document.getElementById("modeNote");
  const localDataCard = document.getElementById("localDataCard");
  if (state.storeMode === "shared") {
    modebar.hidden = true;
    modeNote.textContent = "共有モードで動作中です。Firebase を通じて、この端末で入力した内容がほかの職員の画面にもリアルタイムに反映されます。";
    localDataCard.hidden = true;
  } else {
    modebar.hidden = false;
    modebarText.textContent = "お試しモード：この端末だけに保存されています（共有されません）";
    modeNote.textContent = "現在はお試しモードです。この端末の中だけにデータが保存されており、他の職員とは共有されません。共有するには README.md の手順で Firebase を設定してください。";
    localDataCard.hidden = false;
  }
}

function renderSettings() {
  renderStaffPicker();
  renderGroupPicker();
  renderModeInfo();
}

document.getElementById("clearLocalBtn").addEventListener("click", () => {
  if (confirm("この端末に保存されているデータをすべて消去します。よろしいですか？")) {
    ["staff", "todos", "events", "routineTasks", "routineLogs"].forEach((k) => localStorage.removeItem(`staffTodo:v1:${k}`));
    localStorage.removeItem(ME_KEY);
    location.reload();
  }
});

const largeTextToggle = document.getElementById("largeTextToggle");
largeTextToggle.checked = localStorage.getItem(LARGE_TEXT_KEY) === "1";
document.body.classList.toggle("large-text", largeTextToggle.checked);
largeTextToggle.addEventListener("change", () => {
  localStorage.setItem(LARGE_TEXT_KEY, largeTextToggle.checked ? "1" : "0");
  document.body.classList.toggle("large-text", largeTextToggle.checked);
});

const hideHeaderToggle = document.getElementById("hideHeaderToggle");
hideHeaderToggle.checked = localStorage.getItem(HIDE_HEADER_KEY) === "1";
document.body.classList.toggle("header-hidden", hideHeaderToggle.checked);
hideHeaderToggle.addEventListener("change", () => {
  localStorage.setItem(HIDE_HEADER_KEY, hideHeaderToggle.checked ? "1" : "0");
  document.body.classList.toggle("header-hidden", hideHeaderToggle.checked);
});

// ================================================================
// ロック画面 / ログイン
// ================================================================
// 共有モード(Firebase設定済み)では、Firebase Authenticationのメール+パスワードでの
// ログインを必須にする（Firestoreのルール側でも匿名ユーザーを弾く設定にしてある前提）。
// お試しモード(Firebase未設定)では、この端末だけの簡易合言葉で入口を塞ぐ
// （こちらはクライアント側だけの簡易チェックで、本格的なセキュリティではない）。

const UNLOCKED_KEY = "staffTodo:unlocked";
const lockForm = document.getElementById("lockForm");
const lockNote = document.getElementById("lockNote");
const lockEmailInput = document.getElementById("lockEmailInput");
const lockPasscodeInput = document.getElementById("lockPasscodeInput");
const lockPasscodeConfirm = document.getElementById("lockPasscodeConfirm");
const lockSubmitBtn = document.getElementById("lockSubmitBtn");
const lockError = document.getElementById("lockError");

let appPasscode; // お試しモードのみで使用。undefined = 確認中, null = 未設定(初回), string = 設定済み
let appStarted = false;
let authChecked = false; // 共有モードのみで使用。ログイン済みかどうかの確認が終わるまでtrueにならない

function startApp() {
  if (appStarted) return;
  appStarted = true;
  main();
}

function unlockApp() {
  document.documentElement.classList.remove("is-locked");
  document.getElementById("lockScreen").hidden = true;
  startApp();
}

function lockAppUi() {
  document.documentElement.classList.add("is-locked");
  document.getElementById("lockScreen").hidden = false;
}

function showLockUi() {
  lockError.hidden = true;
  if (firebaseConfigured) {
    if (!authChecked) {
      // ログイン済みかどうかの確認が終わるまでは、フォームを出さず「確認中…」だけ見せる。
      // こうしないと、既にログイン済みの人でもページ再読み込みのたびに一瞬ログイン画面が見えてしまう。
      lockNote.textContent = "確認中…";
      lockEmailInput.hidden = true;
      lockPasscodeInput.hidden = true;
      lockPasscodeConfirm.hidden = true;
      lockSubmitBtn.hidden = true;
      return;
    }
    lockNote.textContent = "職員用のメールアドレスとパスワードでログインしてください。";
    lockEmailInput.hidden = false;
    lockPasscodeInput.hidden = false;
    lockPasscodeInput.type = "password";
    lockPasscodeInput.placeholder = "パスワード";
    lockPasscodeInput.autocomplete = "current-password";
    lockPasscodeConfirm.hidden = true;
    lockSubmitBtn.hidden = false;
    lockSubmitBtn.textContent = "ログイン";
    return;
  }
  lockEmailInput.hidden = true;
  if (appPasscode === undefined) {
    lockNote.textContent = "確認中…";
    lockPasscodeInput.hidden = true;
    lockPasscodeConfirm.hidden = true;
    lockSubmitBtn.hidden = true;
  } else if (appPasscode === null) {
    lockNote.textContent = "はじめに、この端末用の合言葉を決めてください。";
    lockPasscodeInput.placeholder = "合言葉を決める";
    lockPasscodeInput.hidden = false;
    lockPasscodeConfirm.hidden = false;
    lockSubmitBtn.hidden = false;
    lockSubmitBtn.textContent = "設定する";
  } else {
    lockNote.textContent = "合言葉を入力してください。";
    lockPasscodeInput.placeholder = "合言葉";
    lockPasscodeInput.hidden = false;
    lockPasscodeConfirm.hidden = true;
    lockSubmitBtn.hidden = false;
    lockSubmitBtn.textContent = "入る";
  }
}

lockForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  lockError.hidden = true;

  if (firebaseConfigured) {
    const email = lockEmailInput.value.trim();
    const password = lockPasscodeInput.value;
    if (!email || !password) {
      lockError.textContent = "メールアドレスとパスワードを入力してください。";
      lockError.hidden = false;
      return;
    }
    lockSubmitBtn.disabled = true;
    try {
      await signIn(email, password);
      // unlockApp() は onAuthChange 側のコールバックで行う
    } catch (err) {
      console.error(err);
      lockError.textContent = "ログインできませんでした。メールアドレスとパスワードを確認してください。";
      lockError.hidden = false;
    } finally {
      lockSubmitBtn.disabled = false;
    }
    return;
  }

  if (appPasscode === undefined) return;
  if (appPasscode === null) {
    const value = lockPasscodeInput.value.trim();
    if (!value) { lockError.textContent = "合言葉を入力してください。"; lockError.hidden = false; return; }
    if (value !== lockPasscodeConfirm.value.trim()) { lockError.textContent = "確認用の合言葉が一致しません。"; lockError.hidden = false; return; }
    await configStore.set("main", { passcode: value });
    localStorage.setItem(UNLOCKED_KEY, "1");
    unlockApp();
  } else {
    if (lockPasscodeInput.value === appPasscode) {
      localStorage.setItem(UNLOCKED_KEY, "1");
      unlockApp();
    } else {
      lockError.textContent = "合言葉が違います。";
      lockError.hidden = false;
      lockPasscodeInput.value = "";
      lockPasscodeInput.focus();
    }
  }
});

document.getElementById("lockNowBtn").addEventListener("click", async () => {
  if (firebaseConfigured) {
    await signOutUser();
    // 画面の状態は onAuthChange のコールバックでリセットされる
    return;
  }
  localStorage.removeItem(UNLOCKED_KEY);
  lockAppUi();
  lockPasscodeInput.value = "";
  lockPasscodeConfirm.value = "";
  showLockUi();
  lockPasscodeInput.focus();
});

document.getElementById("lockNowBtn").textContent = firebaseConfigured ? "ログアウトする" : "この端末をロックする";
document.getElementById("lockNowDesc").textContent = firebaseConfigured
  ? "ログアウトすると、次にアプリを開いたときにメールアドレスとパスワードの入力が必要になります。"
  : "共有の合言葉でこの端末をロックし直せます。次にアプリを開いたときに合言葉の入力が必要になります。";
document.getElementById("staffPickerDesc").textContent = firebaseConfigured
  ? "ログインしているアカウントに応じて自動的に決まります。他の職員の名前に変更することはできません。"
  : "選んだ名前で「担当」や「実施者」が記録されます。";

showLockUi();

if (firebaseConfigured) {
  onAuthChange((user) => {
    authChecked = true;
    if (user) {
      authedEmail = user.email || null;
      syncMeFromAuth();
      renderYouBadge();
      unlockApp();
    } else {
      authedEmail = null;
      state.meId = null;
      lockAppUi();
      showLockUi();
    }
  });
} else {
  // お試しモード: configStore(ローカル保存)から合言葉の有無を確認する
  configStore.subscribe((list) => {
    const doc = list.find((d) => d.id === "main");
    appPasscode = doc ? doc.passcode : null;
    showLockUi();
    if (appPasscode && localStorage.getItem(UNLOCKED_KEY) === "1") unlockApp();
  });
  startApp();
}

// ================================================================
// 新着タグ
// ================================================================
// 自分以外が追加した新着の Todo・予定・定型タスクに「NEW」タグを表示する。
// この端末は複数の職員が名前を切り替えて使うため、既読カーソルは
// カテゴリ×自分の名前ごとに分けて記録する（他の人の閲覧で自分の未読が消えないように）。
// 一覧を見た時点（その一覧を描画したタイミング）でそのカテゴリは既読になり、
// 次に表示したときには同じ項目にはタグが付かなくなる。

function seenKey(category) {
  return `staffTodo:seenAt:${category}:${state.meId || "anon"}`;
}

function getSeenAt(category) {
  return Number(localStorage.getItem(seenKey(category)) || 0);
}

function markSeen(category) {
  localStorage.setItem(seenKey(category), String(Date.now()));
}

function isNewItem(item, seenAt) {
  return !!item.createdBy && item.createdBy !== (meStaff()?.name || null) && (item.createdAt || 0) > seenAt;
}

function newTagHtml(isNew) {
  return isNew ? `<span class="new-tag">NEW</span>` : "";
}

// ================================================================
// 起動
// ================================================================

// 「月初」「月末」の定型タスクに期間（開始日〜終了日）が設定されていて、
// 今日がその範囲に入っていれば、対応するTodoを自動でひとつ用意する。
// 同じ月に二重生成しないよう、定型タスクID×月をキーにしたマーカーをTodo側に持たせて判定する。
// state.todosはFirestoreへの書き込みが反映されるまでの一瞬の間ずれることがあるため、
// それだけでは間に合わず、書き込み前に確保する専用のSetでも二重生成を防ぐ。
let syncingRoutineTodos = false;
const claimedRoutinePeriods = new Set();
function syncRoutineTodos() {
  if (syncingRoutineTodos) return;
  syncingRoutineTodos = true;
  try {
    const now = new Date();
    const day = now.getDate();
    const monthKey = currentMonthKey();
    const daysInThisMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    state.routineTasks.forEach((task) => {
      if (!routineHasPeriod(task.category)) return;
      if (!task.periodStartDay || !task.periodEndDay) return;
      if (day < task.periodStartDay || day > task.periodEndDay) return;
      const periodKey = `${task.id}__${monthKey}`;
      if (claimedRoutinePeriods.has(periodKey)) return;
      const already = state.todos.some((t) => t.sourceRoutinePeriodKey === periodKey);
      if (already) { claimedRoutinePeriods.add(periodKey); return; }
      claimedRoutinePeriods.add(periodKey);
      const dueDay = Math.min(task.periodEndDay, daysInThisMonth);
      todoStore.add({
        title: task.title,
        memo: task.memo || "",
        assigneeIds: task.assigneeIds || [],
        dueDate: `${monthKey}-${pad2(dueDay)}`,
        priority: "normal",
        done: false,
        createdBy: null,
        sourceRoutineTaskId: task.id,
        sourceRoutinePeriodKey: periodKey,
      });
    });
  } finally {
    syncingRoutineTodos = false;
  }
}

async function main() {
  state.storeMode = await storeReady;
  renderModeInfo();

  staffStore.subscribe((list) => {
    state.staff = list;
    if (firebaseConfigured) syncMeFromAuth();
    renderYouBadge();
    if (state.screen === "settings") { renderStaffPicker(); renderGroupPicker(); }
    if (state.screen === "todo") renderTodoList();
  });
  todoStore.subscribe((list) => {
    state.todos = list;
    if (state.screen === "todo") renderTodoList();
    syncRoutineTodos();
    updateTodoTabBadge();
  });
  eventStore.subscribe((list) => {
    state.events = list;
    if (state.screen === "calendar") renderCalendar();
  });
  routineTaskStore.subscribe((list) => {
    state.routineTasks = list;
    if (state.screen === "routine") renderRoutineList();
    syncRoutineTodos();
    updateRoutineCatCounts();
  });
  routineLogStore.subscribe((list) => {
    state.routineLogs = list;
    if (state.screen === "routine") renderRoutineList();
    updateRoutineCatCounts();
  });
  groupStore.subscribe((list) => {
    state.groups = list;
    if (state.screen === "settings") renderGroupPicker();
    if (!localStorage.getItem(GROUPS_SEEDED_KEY) && list.length === 0) {
      localStorage.setItem(GROUPS_SEEDED_KEY, "1");
      DEFAULT_GROUPS.forEach((name, i) => groupStore.add({ name, order: i }));
    }
  });
  photoStore.subscribe((list) => {
    state.photos = list;
    if (state.screen === "photos" && state.photosSub === "files") renderPhotoTimeline();
  });
  minutesStore.subscribe((list) => {
    state.minutes = list;
    if (state.screen === "photos" && state.photosSub === "minutes") renderMinutesList();
  });
  phoneMemoStore.subscribe((list) => {
    state.phoneMemos = list;
    if (state.screen === "phoneMemo") renderMemoList();
    updateMemoTabBadge();
  });

  // URLの#以降で画面を指定できるようにする（例: .../staff-todo/#phoneMemo）。
  // ログイン（あるいはお試しモードの合言葉）を通った後、main()が呼ばれた時点で反映される。
  const linkedScreen = location.hash.slice(1);
  if (["todo", "calendar", "routine", "photos", "phoneMemo", "settings"].includes(linkedScreen)) {
    setScreen(linkedScreen);
  } else {
    renderScreen(state.screen);
  }

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}
