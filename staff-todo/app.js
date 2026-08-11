import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  deleteDoc,
  doc,
  updateDoc,
  onSnapshot,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { STAFF_NAMES } from "./app-config.js";

const statusMessage = document.getElementById("status-message");

function showError(message) {
  statusMessage.textContent = message;
  statusMessage.hidden = false;
}

let db;
try {
  const { firebaseConfig } = await import("./firebase-config.js");
  const app = initializeApp(firebaseConfig);
  db = getFirestore(app);
} catch (err) {
  showError(
    "firebase-config.js が見つかりません。firebase-config.example.js をコピーして設定してください。"
  );
  throw err;
}

const tasksCollection = collection(db, "tasks");

const taskForm = document.getElementById("task-form");
const titleInput = document.getElementById("task-title");
const assigneeSelect = document.getElementById("task-assignee");
const dueInput = document.getElementById("task-due");
const submitBtn = document.getElementById("submit-btn");
const taskListEl = document.getElementById("task-list");
const emptyMessage = document.getElementById("empty-message");
const filterTabs = document.getElementById("filter-tabs");
const assigneeFilterEl = document.getElementById("assignee-filter");

let statusFilter = "all";
let assigneeFilter = "all";
let allTasks = [];

STAFF_NAMES.forEach((name) => {
  const opt = document.createElement("option");
  opt.value = name;
  opt.textContent = name;
  assigneeSelect.appendChild(opt);

  const chip = document.createElement("button");
  chip.className = "chip";
  chip.dataset.assignee = name;
  chip.textContent = name;
  assigneeFilterEl.appendChild(chip);
});

filterTabs.addEventListener("click", (e) => {
  const btn = e.target.closest(".tab");
  if (!btn) return;
  statusFilter = btn.dataset.filter;
  [...filterTabs.querySelectorAll(".tab")].forEach((t) =>
    t.classList.toggle("active", t === btn)
  );
  render();
});

assigneeFilterEl.addEventListener("click", (e) => {
  const btn = e.target.closest(".chip");
  if (!btn) return;
  assigneeFilter = btn.dataset.assignee;
  [...assigneeFilterEl.querySelectorAll(".chip")].forEach((c) =>
    c.classList.toggle("active", c === btn)
  );
  render();
});

taskForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = titleInput.value.trim();
  if (!title) return;

  submitBtn.disabled = true;
  try {
    await addDoc(tasksCollection, {
      title,
      assignee: assigneeSelect.value || null,
      dueDate: dueInput.value || null,
      completed: false,
      createdAt: serverTimestamp(),
    });
    taskForm.reset();
  } catch (err) {
    showError("タスクの追加に失敗しました。通信環境を確認してください。");
    console.error(err);
  } finally {
    submitBtn.disabled = false;
  }
});

taskListEl.addEventListener("click", async (e) => {
  const item = e.target.closest(".task-item");
  if (!item) return;
  const id = item.dataset.id;

  if (e.target.classList.contains("task-check")) {
    try {
      await updateDoc(doc(db, "tasks", id), {
        completed: e.target.checked,
      });
    } catch (err) {
      showError("更新に失敗しました。");
      console.error(err);
    }
  }

  if (e.target.closest(".delete-btn")) {
    if (!confirm("このタスクを削除しますか？")) return;
    try {
      await deleteDoc(doc(db, "tasks", id));
    } catch (err) {
      showError("削除に失敗しました。");
      console.error(err);
    }
  }
});

onSnapshot(
  tasksCollection,
  (snapshot) => {
    allTasks = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    statusMessage.hidden = true;
    render();
  },
  (err) => {
    showError("データの取得に失敗しました。Firebaseの設定を確認してください。");
    console.error(err);
  }
);

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function render() {
  let tasks = allTasks.slice();

  if (statusFilter === "open") tasks = tasks.filter((t) => !t.completed);
  if (statusFilter === "done") tasks = tasks.filter((t) => t.completed);
  if (assigneeFilter !== "all")
    tasks = tasks.filter((t) => t.assignee === assigneeFilter);

  tasks.sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    if (a.dueDate && b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
    if (a.dueDate) return -1;
    if (b.dueDate) return 1;
    return 0;
  });

  taskListEl.innerHTML = "";
  emptyMessage.hidden = tasks.length !== 0;

  const today = todayStr();

  tasks.forEach((task) => {
    const li = document.createElement("li");
    li.className = "task-item" + (task.completed ? " done" : "");
    li.dataset.id = task.id;

    const overdue =
      !task.completed && task.dueDate && task.dueDate < today;

    li.innerHTML = `
      <input type="checkbox" class="task-check" ${task.completed ? "checked" : ""}>
      <div class="task-body">
        <div class="task-title"></div>
        <div class="task-meta">
          ${task.assignee ? `<span class="badge">${escapeHtml(task.assignee)}</span>` : ""}
          ${task.dueDate ? `<span class="badge due${overdue ? " overdue" : ""}">${overdue ? "期限超過 " : "期限 "}${escapeHtml(task.dueDate)}</span>` : ""}
        </div>
      </div>
      <button class="delete-btn" aria-label="削除">×</button>
    `;
    li.querySelector(".task-title").textContent = task.title;
    taskListEl.appendChild(li);
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
