import { mode as storeModeRef, ready as storeReady, staffStore, todoStore, eventStore, routineTaskStore, routineLogStore } from "./store.js";

// ---------------- 共通ユーティリティ ----------------

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function pad2(n) { return String(n).padStart(2, "0"); }

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

const ME_KEY = "staffTodo:me";
const LARGE_TEXT_KEY = "staffTodo:largeText";

// ---------------- 状態 ----------------

const state = {
  storeMode: "local",
  staff: [],
  todos: [],
  events: [],
  routineTasks: [],
  routineLogs: [],
  meId: localStorage.getItem(ME_KEY) || null,
  screen: "todo",
  todoFilter: "open",
  routineCat: "daily",
  calMonth: (() => { const d = new Date(); d.setDate(1); return d; })(),
  calSelected: todayKey(),
};

function meStaff() { return state.staff.find((s) => s.id === state.meId) || null; }
function staffById(id) { return state.staff.find((s) => s.id === id) || null; }

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
    <div class="sheet__actions">
      ${onDelete ? `<button type="button" class="btn btn--danger" id="sheetDeleteBtn">削除</button>` : ""}
      <button type="submit" class="btn btn--primary">${submitLabel}</button>
    </div>
  `;
  sheetSubmitHandler = onSubmit;
  if (onDelete) {
    sheetForm.querySelector("#sheetDeleteBtn").addEventListener("click", async () => {
      if (confirm("削除しますか？この操作は取り消せません。")) {
        await onDelete();
        closeSheet();
      }
    });
  }
  wirePillGroups(sheetForm);
  sheetBackdrop.hidden = false;
  sheetEl.hidden = false;
  requestAnimationFrame(() => {
    sheetBackdrop.classList.add("is-open");
    sheetEl.classList.add("is-open");
  });
  const firstField = sheetForm.querySelector("input, select, textarea");
  if (firstField) setTimeout(() => firstField.focus({ preventScroll: true }), 260);
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
  else if (name === "settings") renderSettings();
}

// ---------------- FAB ----------------

document.getElementById("fab").addEventListener("click", () => {
  if (state.screen === "todo") openTodoSheet();
  else if (state.screen === "calendar") openEventSheet(state.calSelected);
  else if (state.screen === "routine") openRoutineTaskSheet(state.routineCat);
  else openStaffSheet();
});

// ================================================================
// Todo
// ================================================================

document.querySelectorAll("[data-todo-filter]").forEach((btn) => {
  btn.addEventListener("click", () => {
    state.todoFilter = btn.dataset.todoFilter;
    document.querySelectorAll("[data-todo-filter]").forEach((b) => b.classList.toggle("is-active", b === btn));
    renderTodoList();
  });
});

function dueLabel(dueDate) {
  if (!dueDate) return "";
  const t = todayKey();
  if (dueDate === t) return "今日";
  if (dueDate < t) return `${dueDate.slice(5).replace("-", "/")}(期限切れ)`;
  return dueDate.slice(5).replace("-", "/");
}

function filteredTodos() {
  const t = todayKey();
  let list = [...state.todos];
  if (state.todoFilter === "open") list = list.filter((x) => !x.done);
  else if (state.todoFilter === "today") list = list.filter((x) => !x.done && x.dueDate && x.dueDate <= t);
  else if (state.todoFilter === "mine") list = state.meId ? list.filter((x) => x.assigneeId === state.meId) : [];
  list.sort((a, b) => {
    if (!!a.done !== !!b.done) return a.done ? 1 : -1;
    const ad = a.dueDate || "9999-99-99", bd = b.dueDate || "9999-99-99";
    if (ad !== bd) return ad < bd ? -1 : 1;
    return (a.createdAt || 0) - (b.createdAt || 0);
  });
  return list;
}

function renderTodoList() {
  const list = filteredTodos();
  const el = document.getElementById("todoList");
  const empty = document.getElementById("todoEmpty");
  if (state.todoFilter === "mine" && !state.meId) {
    el.innerHTML = "";
    empty.hidden = false;
    empty.textContent = "設定画面で「あなたの名前」を選ぶと、自分の担当タスクを表示できます。";
    return;
  }
  empty.textContent = "Todoはまだありません。右下の＋から追加できます。";
  empty.hidden = list.length > 0;
  el.innerHTML = list.map((t) => {
    const assignee = staffById(t.assigneeId);
    const badges = [];
    if (t.dueDate) badges.push(`<span class="badge ${!t.done && t.dueDate < todayKey() ? "badge--danger" : t.dueDate === todayKey() ? "badge--warning" : ""}">${escapeHtml(dueLabel(t.dueDate))}</span>`);
    if (t.priority === "high") badges.push(`<span class="badge badge--danger">重要</span>`);
    if (assignee) badges.push(`<span class="badge">${escapeHtml(assignee.name)}</span>`);
    return `
      <div class="card" data-id="${t.id}">
        <button type="button" class="check ${t.done ? "is-done" : ""}" data-action="toggle" aria-label="完了にする">
          <svg viewBox="0 0 24 24"><path d="M5 12l4 4 10-10"/></svg>
        </button>
        <div class="card__body" data-action="edit">
          <div class="card__title ${t.done ? "is-done" : ""}">${escapeHtml(t.title)}</div>
          ${t.memo ? `<div class="card__memo">${escapeHtml(t.memo)}</div>` : ""}
          ${badges.length ? `<div class="card__meta">${badges.join("")}</div>` : ""}
        </div>
      </div>`;
  }).join("");

  el.querySelectorAll('[data-action="toggle"]').forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = btn.closest(".card").dataset.id;
      const todo = state.todos.find((x) => x.id === id);
      todoStore.update(id, { done: !todo.done, doneBy: !todo.done ? (meStaff()?.name || null) : null });
    });
  });
  el.querySelectorAll('[data-action="edit"]').forEach((body) => {
    body.addEventListener("click", () => {
      const id = body.closest(".card").dataset.id;
      openTodoSheet(state.todos.find((x) => x.id === id));
    });
  });
}

function staffOptionsHtml(selectedId) {
  return `<option value="">誰でも</option>` + state.staff.map((s) => `<option value="${s.id}" ${s.id === selectedId ? "selected" : ""}>${escapeHtml(s.name)}</option>`).join("");
}

function openTodoSheet(existing) {
  const priority = existing?.priority || "normal";
  const html = `
    <div class="field">
      <label for="f-title">タイトル</label>
      <input id="f-title" name="title" type="text" required maxlength="100" value="${escapeHtml(existing?.title || "")}" placeholder="例：〇〇さんへ電話">
    </div>
    <div class="field">
      <label for="f-memo">メモ（任意）</label>
      <textarea id="f-memo" name="memo" maxlength="500" placeholder="詳しい内容があれば">${escapeHtml(existing?.memo || "")}</textarea>
    </div>
    <div class="field-row">
      <div class="field">
        <label for="f-assignee">担当</label>
        <select id="f-assignee" name="assigneeId">${staffOptionsHtml(existing?.assigneeId)}</select>
      </div>
      <div class="field">
        <label for="f-due">期限（任意）</label>
        <input id="f-due" name="dueDate" type="date" value="${existing?.dueDate || ""}">
      </div>
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
        assigneeId: data.assigneeId || null,
        dueDate: data.dueDate || null,
        priority: data.priority || "normal",
      };
      if (!payload.title) return;
      if (existing) {
        await todoStore.update(existing.id, payload);
      } else {
        await todoStore.add({ ...payload, done: false, createdBy: meStaff()?.name || null });
      }
      toast("保存しました");
    },
    onDelete: existing ? async () => { await todoStore.remove(existing.id); toast("削除しました"); } : null,
  });
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

function shiftMonth(delta) {
  state.calMonth = new Date(state.calMonth.getFullYear(), state.calMonth.getMonth() + delta, 1);
  renderCalendar();
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
      renderCalendar();
    });
  });

  renderAgenda();
}

function renderAgenda() {
  const list = eventsOn(state.calSelected).sort((a, b) => (a.startTime || "") < (b.startTime || "") ? -1 : 1);
  const [y, m, d] = state.calSelected.split("-");
  document.getElementById("agendaTitle").textContent = `${y}年${Number(m)}月${Number(d)}日の予定${state.calSelected === todayKey() ? "（今日）" : ""}`;
  const el = document.getElementById("agendaList");
  const empty = document.getElementById("agendaEmpty");
  empty.hidden = list.length > 0;
  el.innerHTML = list.map((e) => {
    const time = e.allDay ? "終日" : [e.startTime, e.endTime].filter(Boolean).join(" - ");
    return `
      <div class="card" data-id="${e.id}" data-action="edit-event">
        <div class="card__body">
          <div class="card__title">${escapeHtml(e.title)}</div>
          ${e.memo ? `<div class="card__memo">${escapeHtml(e.memo)}</div>` : ""}
          <div class="card__meta">${time ? `<span class="badge badge--info">${escapeHtml(time)}</span>` : ""}</div>
        </div>
      </div>`;
  }).join("");
  el.querySelectorAll('[data-action="edit-event"]').forEach((card) => {
    card.addEventListener("click", () => openEventSheet(state.calSelected, state.events.find((x) => x.id === card.dataset.id)));
  });
}

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
      toast("保存しました");
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

document.querySelectorAll("[data-routine-cat]").forEach((btn) => {
  btn.addEventListener("click", () => {
    state.routineCat = btn.dataset.routineCat;
    document.querySelectorAll("[data-routine-cat]").forEach((b) => {
      const active = b === btn;
      b.classList.toggle("is-active", active);
      b.setAttribute("aria-selected", String(active));
    });
    renderRoutineList();
  });
});

function periodKeyFor(cat) {
  if (cat === "daily") return todayKey();
  if (cat === "monthStart" || cat === "monthEnd") return currentMonthKey();
  return "once";
}

function routineLogFor(taskId, cat) {
  const id = `${taskId}__${periodKeyFor(cat)}`;
  return state.routineLogs.find((l) => l.id === id) || null;
}

function renderRoutineList() {
  document.getElementById("routinePeriodNote").textContent = ROUTINE_NOTES[state.routineCat];
  const tasks = state.routineTasks.filter((t) => t.category === state.routineCat)
    .sort((a, b) => (a.order || 0) - (b.order || 0));
  const el = document.getElementById("routineList");
  const empty = document.getElementById("routineEmpty");
  empty.hidden = tasks.length > 0;
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
    return `
      <div class="card" data-id="${task.id}">
        <button type="button" class="check ${done ? "is-done" : ""}" data-action="toggle" aria-label="実施済みにする">
          <svg viewBox="0 0 24 24"><path d="M5 12l4 4 10-10"/></svg>
        </button>
        <div class="card__body" data-action="edit">
          <div class="card__title ${done ? "is-done" : ""}">${escapeHtml(task.title)}</div>
          ${task.memo ? `<div class="card__memo">${escapeHtml(task.memo)}</div>` : ""}
          <div class="card__meta">${statusHtml}</div>
        </div>
      </div>`;
  }).join("");

  el.querySelectorAll('[data-action="toggle"]').forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const taskId = btn.closest(".card").dataset.id;
      const cat = state.routineCat;
      const periodKey = periodKeyFor(cat);
      const logId = `${taskId}__${periodKey}`;
      const log = routineLogFor(taskId, cat);
      const nowDone = !log?.done;
      routineLogStore.set(logId, {
        taskId, category: cat, periodKey,
        done: nowDone,
        doneBy: nowDone ? (meStaff()?.name || "スタッフ") : null,
        doneAt: nowDone ? Date.now() : null,
      });
    });
  });
  el.querySelectorAll('[data-action="edit"]').forEach((body) => {
    body.addEventListener("click", () => {
      const id = body.closest(".card").dataset.id;
      openRoutineTaskSheet(state.routineCat, state.routineTasks.find((x) => x.id === id));
    });
  });
}

function openRoutineTaskSheet(cat, existing) {
  const category = existing?.category || cat;
  const html = `
    <div class="field">
      <label for="r-title">タスク名</label>
      <input id="r-title" name="title" type="text" required maxlength="80" value="${escapeHtml(existing?.title || "")}" placeholder="例：施錠確認">
    </div>
    <div class="field">
      <label>種類</label>
      <input type="hidden" name="category" value="${category}">
      <div class="pill-group">
        ${Object.entries(ROUTINE_LABELS).map(([k, label]) => `<button type="button" class="pill-option ${category === k ? "is-active" : ""}" data-value="${k}">${label}</button>`).join("")}
      </div>
    </div>
    <div class="field">
      <label for="r-memo">メモ（任意）</label>
      <textarea id="r-memo" name="memo" maxlength="300" placeholder="手順の補足など">${escapeHtml(existing?.memo || "")}</textarea>
    </div>
  `;
  openSheet(existing ? "定型タスクを編集" : "定型タスクを追加", html, {
    onSubmit: async (data) => {
      const payload = { title: data.title.trim(), category: data.category, memo: data.memo?.trim() || "" };
      if (!payload.title) return;
      if (existing) await routineTaskStore.update(existing.id, payload);
      else await routineTaskStore.add({ ...payload, order: Date.now(), createdBy: meStaff()?.name || null });
      state.routineCat = payload.category;
      document.querySelectorAll("[data-routine-cat]").forEach((b) => {
        const active = b.dataset.routineCat === payload.category;
        b.classList.toggle("is-active", active);
        b.setAttribute("aria-selected", String(active));
      });
      toast("保存しました");
    },
    onDelete: existing ? async () => { await routineTaskStore.remove(existing.id); toast("削除しました"); } : null,
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
    badge.title = "設定画面で名前を選んでください";
  }
}

function renderStaffPicker() {
  const el = document.getElementById("staffPicker");
  if (!state.staff.length) {
    el.innerHTML = `<p class="note">まだ職員が登録されていません。「職員を追加する」から登録してください。</p>`;
    return;
  }
  el.innerHTML = state.staff.map((s) => `
    <button type="button" class="staff-chip ${s.id === state.meId ? "is-active" : ""}" data-id="${s.id}">
      <span class="staff-chip__dot" style="background:${s.color || AVATAR_COLORS[0]}">${escapeHtml(s.name.slice(0, 1))}</span>
      ${escapeHtml(s.name)}
    </button>`).join("");
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

document.getElementById("addStaffBtn").addEventListener("click", () => openStaffSheet());

function openStaffSheet(existing) {
  const color = existing?.color || AVATAR_COLORS[state.staff.length % AVATAR_COLORS.length];
  const html = `
    <div class="field">
      <label for="s-name">名前</label>
      <input id="s-name" name="name" type="text" required maxlength="20" value="${escapeHtml(existing?.name || "")}" placeholder="例：山田">
    </div>
    <div class="field">
      <label>色</label>
      <input type="hidden" name="color" value="${color}">
      <div class="pill-group">
        ${AVATAR_COLORS.map((c) => `<button type="button" class="pill-option ${c === color ? "is-active" : ""}" data-value="${c}" style="background:${c === color ? c : "transparent"}; border-color:${c}; color:${c === color ? "#fff" : c};">●</button>`).join("")}
      </div>
    </div>
  `;
  openSheet(existing ? "職員を編集" : "職員を追加", html, {
    onSubmit: async (data) => {
      const payload = { name: data.name.trim(), color: data.color };
      if (!payload.name) return;
      if (existing) await staffStore.update(existing.id, payload);
      else {
        const id = await staffStore.add({ ...payload, order: Date.now() });
        if (!state.meId) { state.meId = id; localStorage.setItem(ME_KEY, id); }
      }
      toast("保存しました");
    },
    onDelete: existing ? async () => {
      await staffStore.remove(existing.id);
      if (state.meId === existing.id) { state.meId = null; localStorage.removeItem(ME_KEY); }
      toast("削除しました");
    } : null,
  });
  // 色スウォッチのクリックで見た目も切り替える
  const group = sheetForm.querySelector(".pill-group");
  group.querySelectorAll(".pill-option").forEach((btn) => {
    btn.addEventListener("click", () => {
      group.querySelectorAll(".pill-option").forEach((b) => { b.style.background = "transparent"; b.style.color = b.dataset.value; });
      btn.style.background = btn.dataset.value;
      btn.style.color = "#fff";
    });
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

// ================================================================
// 起動
// ================================================================

async function main() {
  state.storeMode = await storeReady;
  renderModeInfo();

  staffStore.subscribe((list) => {
    state.staff = list;
    renderYouBadge();
    if (state.screen === "settings") renderStaffPicker();
    if (state.screen === "todo") renderTodoList();
  });
  todoStore.subscribe((list) => {
    state.todos = list;
    if (state.screen === "todo") renderTodoList();
  });
  eventStore.subscribe((list) => {
    state.events = list;
    if (state.screen === "calendar") renderCalendar();
  });
  routineTaskStore.subscribe((list) => {
    state.routineTasks = list;
    if (state.screen === "routine") renderRoutineList();
  });
  routineLogStore.subscribe((list) => {
    state.routineLogs = list;
    if (state.screen === "routine") renderRoutineList();
  });

  renderScreen(state.screen);

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

main();
