/* アイデア貯蔵庫 — 画面の組み立てと操作
   置き場所は端末の中だけ。声とキーボードの2つの入口から同じ1件をためる。 */

import { store, normalizeTags } from "./store.js";
import { toCode, fromCode, codeAdvice, canShareFile, shareBackupFile } from "./migrate.js";

const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));

const state = {
  screen: "add",
  search: "",
  tag: null,
  selectMode: false,
  selected: new Set(),
  openMenu: null,
  editingId: null,
  pendingImport: null,
};

/* --------------------------------------------------------------------------
   日付の表示
   -------------------------------------------------------------------------- */

const dateFormat = new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric" });
const timeFormat = new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

function whenText(time) {
  const diff = Date.now() - time;
  if (diff < 60_000) return "たった今";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}分前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}時間前`;
  if (diff < 172_800_000) return "昨日";
  return dateFormat.format(new Date(time));
}

/* --------------------------------------------------------------------------
   知らせ（元に戻す付き）
   -------------------------------------------------------------------------- */

let toastTimer = null;
let toastUndo = null;

function toast(message, undo) {
  clearTimeout(toastTimer);
  $("toastText").textContent = message;
  toastUndo = undo ?? null;
  $("toastAction").hidden = !undo;
  $("toast").hidden = false;
  toastTimer = setTimeout(() => { $("toast").hidden = true; toastUndo = null; }, undo ? 6000 : 2600);
}

/* --------------------------------------------------------------------------
   一覧
   -------------------------------------------------------------------------- */

function visibleIdeas() {
  const query = state.search.trim().toLowerCase();
  return store.sorted().filter((idea) => {
    if (state.tag && !idea.tags.includes(state.tag)) return false;
    if (!query) return true;
    return idea.text.toLowerCase().includes(query) || idea.tags.some((tag) => tag.toLowerCase().includes(query));
  });
}

const MIC_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0"/><path d="M12 18v3"/></svg>';
const KEY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10h.01M11 10h.01M15 10h.01M7 14h10"/></svg>';

function ideaCard(idea, isNew) {
  const picked = state.selected.has(idea.id);
  const tags = idea.tags.map((tag) => `<span class="idea__tag">${esc(tag)}</span>`).join("");
  return `
  <li class="idea ${idea.source === "voice" ? "is-voice" : "is-text"}${isNew ? " is-new" : ""}${picked ? " is-picked" : ""}" data-id="${idea.id}">
    <input class="idea__pick" type="checkbox" ${state.selectMode ? "" : "hidden"} ${picked ? "checked" : ""} aria-label="このメモを選ぶ">
    <div class="idea__body"><p class="idea__text">${esc(idea.text)}</p></div>
    <div class="idea__meta">
      <span class="idea__src">${idea.source === "voice" ? MIC_ICON : KEY_ICON}${idea.source === "voice" ? "声" : "入力"}</span>
      <span class="idea__when">${whenText(idea.createdAt)}</span>
      ${idea.pinned ? '<span class="idea__tag">上に固定</span>' : ""}
      ${tags}
    </div>
    <button class="idea__menu" type="button" data-act="menu" aria-label="このメモの操作" aria-expanded="${state.openMenu === idea.id}">
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="6" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="18" r="1.4"/></svg>
    </button>
    <div class="idea__actions" ${state.openMenu === idea.id ? "" : "hidden"}>
      <button class="idea__action" type="button" data-act="edit">書きなおす</button>
      <button class="idea__action" type="button" data-act="pin">${idea.pinned ? "固定をやめる" : "上に固定"}</button>
      <button class="idea__action idea__action--danger" type="button" data-act="delete">消す</button>
    </div>
  </li>`;
}

let lastAddedId = null;

function renderIdeas() {
  const items = visibleIdeas();
  $("ideaList").innerHTML = items.map((idea) => ideaCard(idea, idea.id === lastAddedId)).join("");
  lastAddedId = null;

  $("ideaEmpty").hidden = items.length > 0;
  if (items.length === 0 && store.ideas.length > 0) {
    $("ideaEmpty").innerHTML = '<p class="empty__title">見つかりません</p><p class="empty__body">ことばを変えるか、タグの絞り込みを外してみてください。</p>';
  } else if (items.length === 0) {
    $("ideaEmpty").innerHTML = '<p class="empty__title">まだ何もありません</p><p class="empty__body">思いついた瞬間に、右下のマイクか上の入力欄からためてください。整える必要はありません。断片のままで十分です。</p>';
  }

  $("ideaCount").textContent = `${items.length}件`;
  const filtered = state.tag || state.search.trim();
  $("filterNote").hidden = !filtered;
  $("filterNote").textContent = filtered ? `（全${store.ideas.length}件のうち）` : "";
  $("headerCount").textContent = String(store.ideas.length);
}

function renderTags() {
  const counts = store.tagCounts();
  $("tagFilters").innerHTML = counts
    .map(([tag, count]) => `<button class="tagchip" type="button" data-tag="${esc(tag)}" aria-pressed="${state.tag === tag}">${esc(tag)}<span class="scope__num">${count}</span></button>`)
    .join("");

}

function renderSelectBar() {
  $("selectBar").hidden = !state.selectMode || state.selected.size === 0;
  $("selectCount").textContent = String(state.selected.size);
  $("selectToggle").setAttribute("aria-pressed", String(state.selectMode));
  $("selectToggle").textContent = state.selectMode ? "選ぶのをやめる" : "選ぶ";
}

/* --------------------------------------------------------------------------
   ためる
   -------------------------------------------------------------------------- */

function addIdea(text, source, tagsInput) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return null;
  const idea = store.add({ text: trimmed, tags: normalizeTags(tagsInput ?? []), source });
  if (!idea) return null;
  if (store.writeFailed) toast("端末に保存できませんでした。空き容量を確かめてください");
  lastAddedId = idea.id;
  renderIdeas();
  renderTags();
  renderSelectBar();
  return idea;
}

function submitCompose() {
  const text = $("composeText").value;
  if (!text.trim()) {
    $("composeText").focus();
    return;
  }
  addIdea(text, "text", $("composeTags").value);
  $("composeText").value = "";
  autoGrow($("composeText"));
  toast("ためました");
  $("composeText").focus();
}

function autoGrow(area) {
  area.style.height = "auto";
  area.style.height = `${Math.min(area.scrollHeight, 240)}px`;
}

/* --------------------------------------------------------------------------
   音声
   -------------------------------------------------------------------------- */

const SpeechRecognitionClass = window.SpeechRecognition || window.webkitSpeechRecognition;

const voice = {
  recognition: null,
  listening: false,   // 利用者が「聞いてほしい」と思っている状態
  mode: "capture",    // capture = 1件ずつためる / dictate = 書きなおしの欄に書き足す
  target: null,       // dictate のときの書き込み先
  buffer: [],         // ひと区切りごとに保存しない設定のとき、ためておく場所
  restarts: 0,
  lastRestart: 0,
};

function voiceSupported() {
  return Boolean(SpeechRecognitionClass);
}

function setVoiceStatus(text) {
  $(voice.mode === "dictate" ? "editVoiceStatus" : "voiceStatus").textContent = text;
}

function setVoiceInterim(text) {
  $(voice.mode === "dictate" ? "editVoiceText" : "voiceInterim").textContent = text;
}

/** 聞き取れた分を、書きなおしの欄の続きに足す（元の文は消さない） */
function appendDictation(text) {
  const target = voice.target;
  if (!target) return;
  const current = target.value.replace(/\s+$/, "");
  target.value = current ? `${current}\n${text}` : text;
  target.scrollTop = target.scrollHeight;
}

function showSaved(text) {
  const el = $("voiceSaved");
  el.textContent = `ためました：${text.slice(0, 24)}${text.length > 24 ? "…" : ""}`;
  el.hidden = false;
  setTimeout(() => { el.hidden = true; }, 2400);
}

function createRecognition() {
  const recognition = new SpeechRecognitionClass();
  recognition.lang = store.settings.lang || "ja-JP";
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    voice.restarts = 0;
    if (voice.mode === "dictate") {
      setVoiceStatus("聞いています。話した分が下の欄に足されます");
      return;
    }
    setVoiceStatus(store.settings.continuous ? "聞いています（区切るたびに保存）" : "聞いています（とめたときに保存）");
  };

  recognition.onresult = (event) => {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      const text = result[0]?.transcript ?? "";
      if (result.isFinal) {
        const clean = text.trim();
        if (clean.length < 2) continue;
        if (voice.mode === "dictate") {
          appendDictation(clean);
          if (navigator.vibrate) navigator.vibrate(12);
        } else if (store.settings.continuous) {
          addIdea(clean, "voice");
          showSaved(clean);
          if (navigator.vibrate) navigator.vibrate(12);
        } else {
          voice.buffer.push(clean);
        }
      } else {
        interim += text;
      }
    }
    if (voice.mode === "dictate") {
      setVoiceInterim(interim.trim());
      return;
    }
    const pending = voice.buffer.join("。");
    setVoiceInterim([pending, interim].filter(Boolean).join(" ").trim());
  };

  recognition.onerror = (event) => {
    if (event.error === "no-speech" || event.error === "aborted") return; // 黙っていただけ
    if (event.error === "not-allowed" || event.error === "service-not-allowed") {
      stopVoice({ save: true });
      // ファイルを直接開いたときはブラウザ側がマイクを渡さない。原因ごとに言い方を変える。
      toast(window.isSecureContext
        ? "マイクが使えません。ブラウザの設定で、このページのマイクを許可してください"
        : "この開き方ではマイクが使えません。https か localhost で開いてください");
      return;
    }
    if (event.error === "network") {
      setVoiceStatus("通信が不安定です。つなぎ直しています");
      return;
    }
    setVoiceStatus(`うまく聞き取れませんでした（${event.error}）`);
  };

  recognition.onend = () => {
    if (!voice.listening) return;
    // 端末側が勝手に切ることがあるので、つなぎ直す。ただし短時間に繰り返すときは諦める。
    if (!store.settings.keepMic) { stopVoice({ save: true }); return; }
    const now = Date.now();
    voice.restarts = now - voice.lastRestart < 1500 ? voice.restarts + 1 : 0;
    voice.lastRestart = now;
    if (voice.restarts > 4) {
      stopVoice({ save: true });
      toast("マイクが続けて切れました。もう一度ボタンを押してください");
      return;
    }
    try { voice.recognition.start(); } catch { /* すでに動いているときは何もしない */ }
  };

  return recognition;
}

function startVoice({ mode = "capture", target = null } = {}) {
  if (!voiceSupported()) {
    toast("この端末では音声入力が使えません。文字で入力してください");
    return;
  }
  if (voice.listening) stopVoice({ save: true });

  voice.mode = mode;
  voice.target = target;
  voice.buffer = [];

  if (mode === "dictate") {
    $("editVoice").hidden = false;
    $("editMic").setAttribute("aria-pressed", "true");
    $("editMicLabel").textContent = "とめる";
  } else {
    showScreen("add");
    $("voicePanel").hidden = false;
    $("micButton").setAttribute("aria-pressed", "true");
  }
  setVoiceInterim("");
  voice.listening = true;
  setVoiceStatus("マイクの準備をしています");

  if (!voice.recognition) voice.recognition = createRecognition();
  voice.recognition.lang = store.settings.lang || "ja-JP";
  try {
    voice.recognition.start();
  } catch {
    // 直前の停止処理が終わっていないだけのことが多いので、少し待って入れ直す
    setTimeout(() => { try { voice.recognition.start(); } catch { /* あきらめる */ } }, 250);
  }
}

function stopVoice({ save = true } = {}) {
  const wasDictating = voice.mode === "dictate";
  voice.listening = false;
  $("micButton").setAttribute("aria-pressed", "false");
  $("voicePanel").hidden = true;
  $("editMic").setAttribute("aria-pressed", "false");
  $("editMicLabel").textContent = "声で書き足す";
  $("editVoice").hidden = true;
  try { voice.recognition?.stop(); } catch { /* すでに止まっている */ }

  // 書き足しは欄にそのまま入っているので、ここで保存するのはためる側だけ
  if (!wasDictating && save && voice.buffer.length > 0) {
    const text = voice.buffer.join("。");
    addIdea(text, "voice");
    toast("ためました");
  }
  voice.buffer = [];
  voice.target = null;
  setVoiceInterim("");
  voice.mode = "capture";
  $("voiceInterim").textContent = "";
  $("editVoiceText").textContent = "";
}

function toggleVoice() {
  if (voice.listening && voice.mode === "capture") stopVoice({ save: true });
  else startVoice({ mode: "capture" });
}

/** 書きなおしの画面から使う口述モード */
function toggleDictate() {
  if (voice.listening && voice.mode === "dictate") stopVoice({ save: false });
  else startVoice({ mode: "dictate", target: $("editText") });
}

/* --------------------------------------------------------------------------
   書き出し
   -------------------------------------------------------------------------- */

/* 対象のメモを、そのまま生成AIに貼れる形にまとめる。
   はじめの数行は依頼文。本文は切り詰めない（切ると相手が読み違える）。 */
function sourceToPrompt(ideas) {
  const ask = [
    "次のメモは、私が思いついたことをためたものです。断片で、文章として整っていません。",
    "ここから、目的そのものが違うアプリ案を3つ立ててください。「同じアプリの大・中・小」は避けてください。",
    "各案について、つくるもの／デザイン案（配色と画面の並び）／よいところ／欠点（容赦なく）／業務で3年使ったときに効いてくる点・壊れる点・維持の手間／やめる条件、を書いてください。",
    "最後に「そもそも作らない案」も書いてください。",
    "",
    `--- メモ（${ideas.length}件・${dateFormat.format(new Date())}書き出し） ---`,
  ];
  const lines = ideas.map((idea) => {
    const when = dateFormat.format(new Date(idea.createdAt));
    const tags = idea.tags.length ? ` #${idea.tags.join(" #")}` : "";
    return `- [${when}]${tags} ${idea.text.replace(/\s*\n\s*/g, " ")}`;
  });
  return [...ask, ...lines].join("\n");
}

async function copyText(text, message = "コピーしました") {
  try {
    await navigator.clipboard.writeText(text);
    toast(message);
  } catch {
    // 権限がないときは選択できる形で出す
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    try { document.execCommand("copy"); toast(message); }
    catch { toast("コピーできませんでした"); }
    area.remove();
  }
}

function download(name, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function stamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
}

function exportText() {
  const lines = store.sorted().map((idea) => {
    const when = timeFormat.format(new Date(idea.createdAt));
    const tags = idea.tags.length ? ` #${idea.tags.join(" #")}` : "";
    return `- [${when}]${tags} ${idea.text.replace(/\n/g, " ")}`;
  });
  download(`アイデア貯蔵庫-${stamp()}.txt`, [`# ためたもの（${store.ideas.length}件）`, ...lines].join("\n"), "text/plain;charset=utf-8");
}

/* --------------------------------------------------------------------------
   移行（持ち出しと取り込み）
   -------------------------------------------------------------------------- */

function backupNow() {
  return store.toBackup();
}

/** 取り込む前に、何がどう変わるかを見せる */
function openImport(backup, from) {
  let report;
  try {
    report = store.inspect(backup);
  } catch (error) {
    toast(`取り込めません（${error.message}）`);
    return;
  }
  if (report.incoming === 0) {
    toast("中身が空でした");
    return;
  }

  state.pendingImport = backup;
  const when = report.exportedAt ? timeFormat.format(new Date(report.exportedAt)) : "不明";
  $("importLead").textContent = `${from}から ${report.incoming}件。この端末にはいま ${report.here}件あります。`;
  $("importDetail").innerHTML = [
    ["新しく増える", `${report.added}件`],
    ["内容が新しくなる", `${report.updated}件`],
    ["すでに同じものがある", `${report.same}件`],
    ["書き出した日時", when],
  ].map(([label, value]) => `<dt>${esc(label)}</dt><dd>${esc(value)}</dd>`).join("");
  $("importDialog").showModal();
}

function afterImport(message, undo) {
  renderIdeas();
  renderTags();
  renderSelectBar();
  updateStorageInfo();
  toast(message, undo);
}

async function makeCode() {
  const button = $("makeCode");
  button.disabled = true;
  try {
    const code = await toCode(backupNow());
    $("codeText").value = code;
    $("codeNote").textContent = codeAdvice(code);
    $("codeOut").hidden = false;
    $("codeText").focus();
    $("codeText").select();
  } catch {
    toast("コードを作れませんでした");
  } finally {
    button.disabled = false;
  }
}

/* --------------------------------------------------------------------------
   画面の切り替え
   -------------------------------------------------------------------------- */

function showScreen(name) {
  state.screen = name;
  for (const section of document.querySelectorAll(".screen")) {
    section.classList.toggle("is-active", section.id === `screen-${name}`);
  }
  for (const tab of document.querySelectorAll(".tab")) {
    const on = tab.dataset.screen === name;
    tab.classList.toggle("is-on", on);
    if (on) tab.setAttribute("aria-current", "page");
    else tab.removeAttribute("aria-current");
  }
  $("micButton").hidden = name === "settings";
  if (name === "settings") updateStorageInfo();
  window.scrollTo(0, 0);
}

/* --------------------------------------------------------------------------
   設定
   -------------------------------------------------------------------------- */

function applySettingsToForm() {
  $("setContinuous").checked = store.settings.continuous;
  $("setKeepMic").checked = store.settings.keepMic;
  $("setLang").value = store.settings.lang;
  $("speechSupportNote").textContent = voiceSupported()
    ? "この端末では音声入力が使えます。マイクの許可を聞かれたら「許可」を選んでください。"
    : "この端末（ブラウザ）は音声入力に対応していません。Chrome か Safari でお試しください。文字入力はそのまま使えます。";
  $("micButton").disabled = !voiceSupported();
  $("editMic").hidden = !voiceSupported();
  $("shareFile").hidden = !canShareFile();

  updateStorageInfo();
}

/** 設定画面をひらくたびに数え直す */
function updateStorageInfo() {
  const bytes = new Blob([JSON.stringify(store.toBackup())]).size;
  $("storageInfo").textContent = `この端末の中だけに保存しています。いま ${store.ideas.length}件・約${(bytes / 1024).toFixed(1)}KB。機種変更やブラウザのデータ削除で消えるので、ときどき書き出してください。`;
}

function bindSetting(id, key, prop = "checked") {
  $(id).addEventListener("change", (event) => {
    store.settings[key] = event.target[prop];
    store.saveSettings();
    if (key === "lang" && voice.recognition) voice.recognition.lang = event.target.value;
  });
}

/* --------------------------------------------------------------------------
   組み立て
   -------------------------------------------------------------------------- */

function bindEvents() {
  // タブ
  for (const tab of document.querySelectorAll(".tab")) {
    tab.addEventListener("click", () => showScreen(tab.dataset.screen));
  }

  // 入力
  $("composeAdd").addEventListener("click", submitCompose);
  $("composeText").addEventListener("input", (event) => autoGrow(event.target));
  $("composeText").addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); submitCompose(); }
  });
  $("composeTags").addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); submitCompose(); }
  });

  $("copyVisible").addEventListener("click", () => {
    const ideas = visibleIdeas();
    if (ideas.length === 0) { toast("コピーするメモがありません"); return; }
    copyText(sourceToPrompt(ideas), `${ideas.length}件をコピーしました。AIの入力欄に貼ってください`);
  });

  // 検索・タグ
  $("searchInput").addEventListener("input", (event) => { state.search = event.target.value; renderIdeas(); });
  $("tagFilters").addEventListener("click", (event) => {
    const button = event.target.closest("[data-tag]");
    if (!button) return;
    state.tag = state.tag === button.dataset.tag ? null : button.dataset.tag;
    renderTags();
    renderIdeas();
  });

  // 選ぶ
  $("selectToggle").addEventListener("click", () => {
    state.selectMode = !state.selectMode;
    if (!state.selectMode) state.selected.clear();
    renderIdeas();
    renderSelectBar();
  });
  $("selectClear").addEventListener("click", () => {
    state.selectMode = false;
    state.selected.clear();
    renderIdeas();
    renderSelectBar();
    renderSelectBar();
  });
  $("selectCopy").addEventListener("click", () => {
    const ideas = store.sorted().filter((idea) => state.selected.has(idea.id));
    if (ideas.length === 0) return;
    copyText(sourceToPrompt(ideas), `${ideas.length}件をコピーしました。AIの入力欄に貼ってください`);
  });
  $("selectDelete").addEventListener("click", () => {
    const removed = store.remove([...state.selected]);
    state.selected.clear();
    renderIdeas();
    renderTags();
    renderSelectBar();
    renderSelectBar();
    toast(`${removed.length}件を消しました`, () => {
      store.restore(removed);
      renderIdeas();
      renderTags();
      renderSelectBar();
    });
  });

  // カードの操作
  $("ideaList").addEventListener("click", (event) => {
    const card = event.target.closest(".idea");
    if (!card) return;
    const id = card.dataset.id;
    const action = event.target.closest("[data-act]")?.dataset.act;

    if (event.target.classList.contains("idea__pick")) {
      if (event.target.checked) state.selected.add(id);
      else state.selected.delete(id);
      card.classList.toggle("is-picked", event.target.checked);
      renderSelectBar();
      renderSelectBar();
      return;
    }

    if (action === "menu") {
      state.openMenu = state.openMenu === id ? null : id;
      renderIdeas();
      return;
    }
    if (action === "edit") { openEdit(id); return; }
    if (action === "pin") {
      const idea = store.ideas.find((item) => item.id === id);
      store.update(id, { pinned: !idea?.pinned });
      state.openMenu = null;
      renderIdeas();
      return;
    }
    if (action === "delete") {
      const removed = store.remove([id]);
      state.openMenu = null;
      state.selected.delete(id);
      renderIdeas();
      renderTags();
      renderSelectBar();
      toast("消しました", () => {
        store.restore(removed);
        renderIdeas();
        renderTags();
        renderSelectBar();
      });
      return;
    }

    // 本文をたたいたら選択（選ぶモードのとき）
    if (state.selectMode) {
      const box = card.querySelector(".idea__pick");
      box.checked = !box.checked;
      if (box.checked) state.selected.add(id);
      else state.selected.delete(id);
      card.classList.toggle("is-picked", box.checked);
      renderSelectBar();
      renderSelectBar();
    }
  });

  // 元に戻す
  $("toastAction").addEventListener("click", () => {
    toastUndo?.();
    toastUndo = null;
    $("toast").hidden = true;
  });

  // 書きなおす
  $("editDialog").addEventListener("close", () => {
    if (voice.listening && voice.mode === "dictate") stopVoice({ save: false });
    if ($("editDialog").returnValue === "save" && state.editingId) {
      store.update(state.editingId, { text: $("editText").value, tags: $("editTags").value });
      renderIdeas();
      renderTags();
      renderSelectBar();
      toast("直しました");
    }
    state.editingId = null;
  });

  // 音声
  $("micButton").addEventListener("click", toggleVoice);
  $("voiceDone").addEventListener("click", () => stopVoice({ save: true }));
  $("editMic").addEventListener("click", toggleDictate);

  // 設定
  bindSetting("setContinuous", "continuous");
  bindSetting("setKeepMic", "keepMic");
  bindSetting("setLang", "lang", "value");
  $("exportJson").addEventListener("click", () => {
    download(`idea-vault-${stamp()}.json`, JSON.stringify(backupNow(), null, 2), "application/json");
    toast("書き出しました");
  });
  $("exportMd").addEventListener("click", () => { exportText(); toast("書き出しました"); });

  $("shareFile").addEventListener("click", async () => {
    try {
      const sent = await shareBackupFile(backupNow(), `idea-vault-${stamp()}.json`);
      if (sent) toast("送りました");
    } catch (error) {
      toast(error.message);
    }
  });

  $("makeCode").addEventListener("click", makeCode);
  $("copyCode").addEventListener("click", () => copyText($("codeText").value));
  $("closeCode").addEventListener("click", () => { $("codeOut").hidden = true; });

  $("pasteToggle").addEventListener("click", () => {
    const box = $("pasteBox");
    box.hidden = !box.hidden;
    $("pasteToggle").setAttribute("aria-pressed", String(!box.hidden));
    if (!box.hidden) $("pasteText").focus();
  });

  $("pasteRead").addEventListener("click", async () => {
    const text = $("pasteText").value;
    if (!text.trim()) { toast("コードが貼り付けられていません"); return; }
    try {
      openImport(await fromCode(text), "貼り付けたコード");
    } catch (error) {
      toast(error.message);
    }
  });

  $("importBtn").addEventListener("click", () => $("importFile").click());
  $("importFile").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      openImport(await fromCode(await file.text()), "ファイル");
    } catch {
      toast("このファイルは読み込めません。書き出した JSON ファイルを選んでください");
    }
    event.target.value = "";
  });

  $("importDialog").addEventListener("close", () => {
    const backup = state.pendingImport;
    const choice = $("importDialog").returnValue;
    state.pendingImport = null;
    if (!backup || choice === "cancel" || !choice) return;

    if (choice === "replace") {
      const before = store.replaceAll(backup);
      state.selected.clear();
      afterImport(`入れ替えました（${store.ideas.length}件）`, () => {
        store.restoreAll(before);
        afterImport("元に戻しました");
      });
      return;
    }

    const result = store.merge(backup);
    afterImport(`${result.added}件を足しました（内容が新しくなった分 ${result.updated}件）`);
    $("pasteText").value = "";
    $("pasteBox").hidden = true;
    $("pasteToggle").setAttribute("aria-pressed", "false");
  });

  $("clearAll").addEventListener("click", () => {
    if (!confirm(`ためた${store.ideas.length}件をすべて消します。元に戻せません。よろしいですか？`)) return;
    store.clearAll();
    state.selected.clear();
    renderIdeas();
    renderTags();
    applySettingsToForm();
    renderSelectBar();
    toast("すべて消しました");
  });

  // 画面を閉じるときに、聞き取り中のものを取りこぼさない
  window.addEventListener("pagehide", () => { if (voice.listening) stopVoice({ save: true }); });
}

function openEdit(id) {
  const idea = store.ideas.find((item) => item.id === id);
  if (!idea) return;
  state.editingId = id;
  state.openMenu = null;
  $("editText").value = idea.text;
  $("editTags").value = idea.tags.join(" ");
  $("editDialog").showModal();
  renderIdeas();
}

function init() {
  store.load();
  applySettingsToForm();
  bindEvents();
  renderTags();
  renderIdeas();
  renderSelectBar();
  showScreen("add");

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(() => { /* オフライン用の下ごしらえなので、失敗しても使える */ });
    });
  }
}

init();
