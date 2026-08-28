/* アイデア貯蔵庫 — 画面の組み立てと操作
   置き場所は端末の中だけ。声とキーボードの2つの入口から同じ1件をためる。 */

import { store, normalizeTags } from "./store.js";
import { proposeLocally } from "./propose.js";

const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));

const state = {
  screen: "add",
  search: "",
  tag: null,
  selectMode: false,
  selected: new Set(),
  scope: "recent",
  planTag: "",
  openMenu: null,
  editingId: null,
  planSet: null,
  generating: false,
};

const RECENT_LIMIT = 20;

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

  const select = $("planTagSelect");
  const current = state.planTag;
  select.innerHTML = counts.map(([tag, count]) => `<option value="${esc(tag)}">${esc(tag)}（${count}件）</option>`).join("")
    || '<option value="">タグがありません</option>';
  if (counts.some(([tag]) => tag === current)) select.value = current;
  else state.planTag = select.value ?? "";
}

function renderSelectBar() {
  $("selectBar").hidden = !state.selectMode || state.selected.size === 0;
  $("selectCount").textContent = String(state.selected.size);
  $("scopeSelectedCount").textContent = String(state.selected.size);
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
  updatePlanNote();
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
  buffer: [],         // ひと区切りごとに保存しない設定のとき、ためておく場所
  restarts: 0,
  lastRestart: 0,
};

function voiceSupported() {
  return Boolean(SpeechRecognitionClass);
}

function setVoiceStatus(text) {
  $("voiceStatus").textContent = text;
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
    setVoiceStatus(store.settings.continuous ? "聞いています（区切るたびに保存）" : "聞いています（とめたときに保存）");
  };

  recognition.onresult = (event) => {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      const text = result[0]?.transcript ?? "";
      if (result.isFinal) {
        const clean = text.trim();
        if (clean.length >= 2) {
          if (store.settings.continuous) {
            addIdea(clean, "voice");
            showSaved(clean);
            if (navigator.vibrate) navigator.vibrate(12);
          } else {
            voice.buffer.push(clean);
          }
        }
      } else {
        interim += text;
      }
    }
    const pending = voice.buffer.join("。");
    $("voiceInterim").textContent = [pending, interim].filter(Boolean).join(" ").trim();
  };

  recognition.onerror = (event) => {
    if (event.error === "no-speech" || event.error === "aborted") return; // 黙っていただけ
    if (event.error === "not-allowed" || event.error === "service-not-allowed") {
      stopVoice({ save: true });
      toast("マイクが使えません。ブラウザの設定で許可してください");
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

function startVoice() {
  if (!voiceSupported()) {
    toast("この端末では音声入力が使えません。文字で入力してください");
    return;
  }
  showScreen("add");
  voice.buffer = [];
  $("voiceInterim").textContent = "";
  $("voicePanel").hidden = false;
  $("micButton").setAttribute("aria-pressed", "true");
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
  voice.listening = false;
  $("micButton").setAttribute("aria-pressed", "false");
  $("voicePanel").hidden = true;
  try { voice.recognition?.stop(); } catch { /* すでに止まっている */ }

  if (save && voice.buffer.length > 0) {
    const text = voice.buffer.join("。");
    addIdea(text, "voice");
    toast("ためました");
  }
  voice.buffer = [];
  $("voiceInterim").textContent = "";
}

function toggleVoice() {
  if (voice.listening) stopVoice({ save: true });
  else startVoice();
}

/* --------------------------------------------------------------------------
   3案
   -------------------------------------------------------------------------- */

function scopeIdeas() {
  const sorted = store.sorted();
  if (state.scope === "all") return sorted;
  if (state.scope === "recent") return sorted.slice(0, RECENT_LIMIT);
  if (state.scope === "selected") return sorted.filter((idea) => state.selected.has(idea.id));
  if (state.scope === "tag") return sorted.filter((idea) => idea.tags.includes(state.planTag));
  return sorted;
}

function updatePlanNote() {
  const count = scopeIdeas().length;
  $("planSourceNote").textContent = count === 0
    ? "対象が0件です。ためてから、もう一度どうぞ"
    : `対象 ${count}件。ここから3案をつくります`;
  $("planGenerate").disabled = count === 0 || state.generating;
  renderSelectBar();
}

const SCORE_LABEL = { build: "作りやすさ", keep: "続けやすさ", effect: "効き目" };

function scoreBar(scores) {
  return Object.entries(SCORE_LABEL)
    .map(([key, label]) => `<span class="score">${label}<b>${"★".repeat(Math.max(1, Math.min(5, scores[key] ?? 3)))}</b></span>`)
    .join("");
}

function list(items, className = "pts") {
  if (!items || items.length === 0) return "";
  return `<ul class="${className}">${items.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>`;
}

function planCard(plan, index) {
  const design = plan.design ?? {};
  const long = plan.longTerm ?? {};
  const swatches = (design.palette ?? []).map((color) => `<span class="swatch" style="background:${esc(color.hex)}" title="${esc(color.role)}"></span>`).join("");
  const wire = (design.wire ?? []).map((row) => `<div class="wire__row"><span class="wire__tag">${esc(row.tag)}</span><span>${esc(row.text)}</span></div>`).join("");
  const paletteRoles = (design.palette ?? []).map((color) => `<li><span class="swatchlabel">${esc(color.hex)}</span>　${esc(color.role)}</li>`).join("");

  return `
  <article class="plan plan--${"abc"[index] ?? "a"}" data-index="${index}">
    <header class="plan__head">
      <span class="plan__axis">案${index + 1}・${esc(plan.axisLabel)}</span>
      <h3 class="plan__name">${esc(plan.name)}</h3>
      <p class="plan__lead">${esc(plan.lead)}</p>
      <div class="plan__scores">${scoreBar(plan.scores ?? {})}</div>
    </header>

    <div class="verdict ${plan.verdict?.tone === "ok" ? "verdict--ok" : ""}">
      <b>${plan.verdict?.tone === "ok" ? "率直に言うと" : "率直に言うと（おすすめしない）"}</b>${esc(plan.verdict?.text ?? "")}
    </div>

    <details class="sec sec--build">
      <summary class="sec__sum"><span class="sec__mark">機</span>この案でつくるもの</summary>
      <div class="sec__body">
        ${list(plan.features)}
        <p class="subhead">ざっくりの作業量</p><p class="dl">${esc(plan.effort ?? "")}</p>
      </div>
    </details>

    <details class="sec sec--design">
      <summary class="sec__sum"><span class="sec__mark">デ</span>デザイン案</summary>
      <div class="sec__body">
        <dl class="dl">
          <dt>画面の型</dt><dd>${esc(design.pattern ?? "")}</dd>
          <dt>並べ方</dt><dd>${esc(design.layout ?? "")}</dd>
          <dt>操作の核</dt><dd>${esc(design.interaction ?? "")}</dd>
          <dt>文字</dt><dd>${esc(design.typography ?? "")}</dd>
          <dt>動き</dt><dd>${esc(design.motion ?? "")}</dd>
        </dl>
        <p class="subhead">画面の並び</p>
        <div class="wire">${wire}</div>
        <p class="subhead">配色</p>
        <div class="swatches">${swatches}</div>
        <ul class="pts">${paletteRoles}</ul>
      </div>
    </details>

    <details class="sec sec--good" open>
      <summary class="sec__sum"><span class="sec__mark">＋</span>よいところ</summary>
      <div class="sec__body">${list(plan.pros, "pts pts--good")}</div>
    </details>

    <details class="sec sec--bad" open>
      <summary class="sec__sum"><span class="sec__mark">−</span>容赦なく言うと</summary>
      <div class="sec__body">${list(plan.cons, "pts pts--bad")}</div>
    </details>

    <details class="sec sec--long">
      <summary class="sec__sum"><span class="sec__mark">年</span>業務で長く使うなら（3年で見る）</summary>
      <div class="sec__body">
        <p class="subhead">効いてくるところ</p>${list(long.works, "pts pts--good")}
        <p class="subhead">時間とともに壊れるところ</p>${list(long.breaks, "pts pts--bad")}
        <p class="subhead">維持にかかるもの</p>${list(long.cost)}
        ${plan.watch?.length ? `<p class="subhead">設計で気をつける点</p>${list(plan.watch)}` : ""}
      </div>
    </details>

    <details class="sec sec--build">
      <summary class="sec__sum"><span class="sec__mark">歩</span>作る前にやること・やめどき</summary>
      <div class="sec__body">
        <dl class="dl">
          <dt>最初の一歩</dt><dd>${esc(plan.firstStep ?? "")}</dd>
          <dt>やめる条件</dt><dd>${esc(plan.exit ?? "")}</dd>
        </dl>
      </div>
    </details>

    <div class="plan__foot">
      <button class="btn btn--ghost btn--small" type="button" data-act="copy-plan" data-index="${index}">この案をコピー</button>
    </div>
  </article>`;
}

function renderPlanSet(planSet) {
  state.planSet = planSet;
  if (!planSet) {
    $("planResults").innerHTML = "";
    $("planEmpty").hidden = false;
    return;
  }
  $("planEmpty").hidden = true;

  const keys = (planSet.summary?.keywords ?? []).map((word) => `<span class="plansum__key">${esc(word)}</span>`).join("");
  const head = `
    <div class="plansum">
      <b>${esc(planSet.summary?.headline ?? "")}</b>
      <p style="margin:.375rem 0 0">${esc(planSet.summary?.note ?? "")}</p>
      <div class="plansum__keys">${keys}</div>
      <p style="margin:.625rem 0 0;font-size:.75rem">${planSet.engine === "ai" ? "AIがつくった提案" : "端末の中でつくった提案"}・${esc(String(planSet.sourceCount))}件から・${timeFormat.format(new Date(planSet.createdAt))}</p>
    </div>`;

  const tail = planSet.alternative
    ? `<div class="panel panel--muted"><h3 class="panel__title">そもそも作らない案</h3><p style="margin:0;font-size:.8125rem;line-height:1.85">${esc(planSet.alternative)}</p>
       <div class="btnrow"><button class="btn btn--ghost btn--small" type="button" data-act="copy-all">3案ぜんぶをコピー</button></div></div>`
    : "";

  $("planResults").innerHTML = head + planSet.plans.map((plan, index) => planCard(plan, index)).join("") + tail;
  $("planResults").scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderHistory() {
  const wrap = $("planHistoryWrap");
  wrap.hidden = store.plans.length === 0;
  $("planHistory").innerHTML = store.plans
    .map((record) => `
      <li class="history__item">
        <button class="history__btn" type="button" data-plan="${esc(record.id)}">
          ${esc(record.summary?.headline ?? "提案")}
          <span class="history__when">${timeFormat.format(new Date(record.createdAt))}・${record.engine === "ai" ? "AI" : "端末"}</span>
        </button>
        <button class="history__del" type="button" data-plan-del="${esc(record.id)}" aria-label="この提案を消す">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 7h12M9 7V5h6v2M8 7l.8 12h6.4L16 7"/></svg>
        </button>
      </li>`)
    .join("");
}

async function generatePlans() {
  if (state.generating) return;
  const ideas = scopeIdeas();
  if (ideas.length === 0) { toast("もとにするメモがありません"); return; }

  state.generating = true;
  $("planGenerate").disabled = true;
  $("planLoading").hidden = false;
  const harsh = $("planHarsh").checked;

  try {
    let planSet;
    if (store.settings.aiEnabled && store.settings.aiKey) {
      try {
        const { proposeWithAi } = await import("./ai.js");
        planSet = await proposeWithAi(ideas, { apiKey: store.settings.aiKey, model: store.settings.aiModel, harsh });
      } catch (error) {
        toast(`AIは使えませんでした（${error.message}）。端末の中でつくります`);
        planSet = proposeLocally(ideas, { harsh });
      }
    } else {
      planSet = proposeLocally(ideas, { harsh });
    }
    store.addPlanSet(planSet);
    renderPlanSet(planSet);
    renderHistory();
  } finally {
    state.generating = false;
    $("planLoading").hidden = true;
    updatePlanNote();
  }
}

/* --------------------------------------------------------------------------
   書き出し
   -------------------------------------------------------------------------- */

function planToMarkdown(plan, index) {
  const design = plan.design ?? {};
  const long = plan.longTerm ?? {};
  const bullets = (items) => (items ?? []).map((item) => `- ${item}`).join("\n");
  return [
    `## 案${index + 1}：${plan.name}（${plan.axisLabel}）`,
    plan.lead,
    "",
    `率直に言うと：${plan.verdict?.text ?? ""}`,
    "",
    "### つくるもの",
    bullets(plan.features),
    `作業量：${plan.effort ?? ""}`,
    "",
    "### デザイン案",
    `- 画面の型：${design.pattern ?? ""}`,
    `- 並べ方：${design.layout ?? ""}`,
    `- 操作の核：${design.interaction ?? ""}`,
    `- 文字：${design.typography ?? ""}`,
    `- 動き：${design.motion ?? ""}`,
    `- 配色：${(design.palette ?? []).map((color) => `${color.hex}（${color.role}）`).join(" / ")}`,
    `- 画面の並び：${(design.wire ?? []).map((row) => `${row.tag}=${row.text}`).join(" / ")}`,
    "",
    "### よいところ",
    bullets(plan.pros),
    "",
    "### 容赦なく言うと",
    bullets(plan.cons),
    "",
    "### 業務で長く使うなら（3年）",
    "効いてくるところ",
    bullets(long.works),
    "時間とともに壊れるところ",
    bullets(long.breaks),
    "維持にかかるもの",
    bullets(long.cost),
    "",
    `最初の一歩：${plan.firstStep ?? ""}`,
    `やめる条件：${plan.exit ?? ""}`,
  ].join("\n");
}

function planSetToMarkdown(planSet) {
  return [
    `# ${planSet.summary?.headline ?? "アイデアからの3案"}`,
    planSet.summary?.note ?? "",
    "",
    planSet.plans.map((plan, index) => planToMarkdown(plan, index)).join("\n\n"),
    "",
    `## そもそも作らない案`,
    planSet.alternative ?? "",
  ].join("\n");
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("コピーしました");
  } catch {
    // 権限がないときは選択できる形で出す
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    try { document.execCommand("copy"); toast("コピーしました"); }
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
  const plans = store.plans.map((record) => planSetToMarkdown(record)).join("\n\n---\n\n");
  download(`アイデア貯蔵庫-${stamp()}.txt`, [`# ためたもの（${store.ideas.length}件）`, ...lines, "", plans].join("\n"), "text/plain;charset=utf-8");
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
  if (name === "plan") updatePlanNote();
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
  $("setAiEnabled").checked = store.settings.aiEnabled;
  $("setAiKey").value = store.settings.aiKey;
  $("setAiModel").value = store.settings.aiModel;
  $("aiFields").hidden = !store.settings.aiEnabled;
  $("planHarsh").checked = store.settings.harsh;

  $("speechSupportNote").textContent = voiceSupported()
    ? "この端末では音声入力が使えます。マイクの許可を聞かれたら「許可」を選んでください。"
    : "この端末（ブラウザ）は音声入力に対応していません。Chrome か Safari でお試しください。文字入力はそのまま使えます。";
  $("micButton").disabled = !voiceSupported();

  updateStorageInfo();
}

/** 設定画面をひらくたびに数え直す */
function updateStorageInfo() {
  const bytes = new Blob([JSON.stringify(store.toBackup())]).size;
  $("storageInfo").textContent = `この端末の中だけに保存しています。いま ${store.ideas.length}件・提案 ${store.plans.length}件・約${(bytes / 1024).toFixed(1)}KB。機種変更やブラウザのデータ削除で消えるので、ときどき書き出してください。`;
}

function bindSetting(id, key, prop = "checked") {
  $(id).addEventListener("change", (event) => {
    store.settings[key] = event.target[prop];
    store.saveSettings();
    if (key === "aiEnabled") $("aiFields").hidden = !event.target.checked;
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
    updatePlanNote();
  });
  $("selectPlan").addEventListener("click", () => {
    setScope("selected");
    showScreen("plan");
    generatePlans();
  });
  $("selectDelete").addEventListener("click", () => {
    const removed = store.remove([...state.selected]);
    state.selected.clear();
    renderIdeas();
    renderTags();
    renderSelectBar();
    updatePlanNote();
    toast(`${removed.length}件を消しました`, () => {
      store.restore(removed);
      renderIdeas();
      renderTags();
      updatePlanNote();
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
      updatePlanNote();
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
      updatePlanNote();
      toast("消しました", () => {
        store.restore(removed);
        renderIdeas();
        renderTags();
        updatePlanNote();
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
      updatePlanNote();
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
    if ($("editDialog").returnValue === "save" && state.editingId) {
      store.update(state.editingId, { text: $("editText").value, tags: $("editTags").value });
      renderIdeas();
      renderTags();
      updatePlanNote();
      toast("直しました");
    }
    state.editingId = null;
  });

  // 音声
  $("micButton").addEventListener("click", toggleVoice);
  $("voiceDone").addEventListener("click", () => stopVoice({ save: true }));

  // 3案
  for (const button of document.querySelectorAll(".scope__btn")) {
    button.addEventListener("click", () => setScope(button.dataset.scope));
  }
  $("planTagSelect").addEventListener("change", (event) => { state.planTag = event.target.value; updatePlanNote(); });
  $("planHarsh").addEventListener("change", (event) => {
    store.settings.harsh = event.target.checked;
    store.saveSettings();
  });
  $("planGenerate").addEventListener("click", generatePlans);

  $("planResults").addEventListener("click", (event) => {
    const button = event.target.closest("[data-act]");
    if (!button || !state.planSet) return;
    if (button.dataset.act === "copy-plan") {
      const index = Number(button.dataset.index);
      copyText(planToMarkdown(state.planSet.plans[index], index));
    }
    if (button.dataset.act === "copy-all") copyText(planSetToMarkdown(state.planSet));
  });

  $("planHistory").addEventListener("click", (event) => {
    const open = event.target.closest("[data-plan]");
    if (open) {
      const record = store.plans.find((item) => item.id === open.dataset.plan);
      if (record) renderPlanSet(record);
      return;
    }
    const del = event.target.closest("[data-plan-del]");
    if (del) {
      store.removePlanSet(del.dataset.planDel);
      renderHistory();
      applySettingsToForm();
    }
  });

  // 設定
  bindSetting("setContinuous", "continuous");
  bindSetting("setKeepMic", "keepMic");
  bindSetting("setLang", "lang", "value");
  bindSetting("setAiEnabled", "aiEnabled");
  bindSetting("setAiModel", "aiModel", "value");
  $("setAiKey").addEventListener("change", (event) => {
    store.settings.aiKey = event.target.value.trim();
    store.saveSettings();
  });

  $("exportJson").addEventListener("click", () => {
    download(`idea-vault-${stamp()}.json`, JSON.stringify(store.toBackup(), null, 2), "application/json");
    toast("書き出しました");
  });
  $("exportMd").addEventListener("click", () => { exportText(); toast("書き出しました"); });
  $("importBtn").addEventListener("click", () => $("importFile").click());
  $("importFile").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const result = store.merge(JSON.parse(await file.text()));
      renderIdeas();
      renderTags();
      renderHistory();
      applySettingsToForm();
      updatePlanNote();
      toast(`${result.added}件を読み込みました（更新 ${result.updated}件）`);
    } catch (error) {
      toast(`読み込めませんでした（${error.message}）`);
    }
    event.target.value = "";
  });

  $("clearAll").addEventListener("click", () => {
    if (!confirm(`ためた${store.ideas.length}件と提案をすべて消します。元に戻せません。よろしいですか？`)) return;
    store.clearAll();
    state.selected.clear();
    state.planSet = null;
    renderIdeas();
    renderTags();
    renderHistory();
    renderPlanSet(null);
    applySettingsToForm();
    updatePlanNote();
    toast("すべて消しました");
  });

  // 画面を閉じるときに、聞き取り中のものを取りこぼさない
  window.addEventListener("pagehide", () => { if (voice.listening) stopVoice({ save: true }); });
}

function setScope(scope) {
  state.scope = scope;
  for (const button of document.querySelectorAll(".scope__btn")) {
    const on = button.dataset.scope === scope;
    button.classList.toggle("is-on", on);
    button.setAttribute("aria-pressed", String(on));
  }
  $("planTagField").hidden = scope !== "tag";
  updatePlanNote();
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
  renderHistory();
  renderPlanSet(null);
  setScope(store.ideas.length > RECENT_LIMIT ? "recent" : "all");
  showScreen("add");

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(() => { /* オフライン用の下ごしらえなので、失敗しても使える */ });
    });
  }
}

init();
