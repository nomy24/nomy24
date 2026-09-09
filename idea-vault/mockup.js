/* アイデア貯蔵庫 — 案の見た目を、その場で組み立てるところ
   3案それぞれについて、スマホ1画面ぶんの見本を作る。中身はためたメモから取る。
   本物のアプリではないので、動くのはタブの切り替えと、1タップぶんの変化だけ。 */

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));

const FALLBACK_SAMPLES = [
  { text: "思いついたことをここに書く", tag: "" },
  { text: "あとで読む記事をためておく", tag: "" },
  { text: "引き継ぎで漏れることを減らす", tag: "" },
];

/* --- 色 ------------------------------------------------------------------ */

function toRgb(hex) {
  let value = String(hex ?? "").replace("#", "");
  if (value.length === 3) value = value.split("").map((char) => char + char).join("");
  const number = Number.parseInt(value.slice(0, 6), 16);
  return Number.isFinite(number) ? [(number >> 16) & 255, (number >> 8) & 255, number & 255] : [30, 26, 46];
}

const toHex = (rgb) => "#" + rgb.map((value) => Math.round(Math.max(0, Math.min(255, value))).toString(16).padStart(2, "0")).join("");

/** 2色を混ぜる。ratio=0 で a、1 で b */
function mix(a, b, ratio) {
  const [ar, ag, ab] = toRgb(a);
  const [br, bg, bb] = toRgb(b);
  return toHex([ar + (br - ar) * ratio, ag + (bg - ag) * ratio, ab + (bb - ab) * ratio]);
}

/** 明るさ。文字色を白と黒のどちらにするかの判断に使う */
function luminance(hex) {
  const [r, g, b] = toRgb(hex).map((value) => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const readable = (background) => (luminance(background) > 0.5 ? "#14121c" : "#ffffff");

/** 案の配色から、見本の中で使う色をつくる。3案目だけ暗い画面を想定している */
function paletteOf(plan) {
  const colors = (plan.design?.palette ?? []).map((color) => color.hex).filter(Boolean);
  const base = colors[0] ?? "#1c1b22";
  const accent = colors[1] ?? "#6d4ad0";
  const second = colors[2] ?? accent;
  const dark = plan.axis === "c" && luminance(base) < 0.45;

  if (dark) {
    return {
      dark: true,
      bg: base,
      surface: mix(base, "#ffffff", 0.1),
      line: mix(base, "#ffffff", 0.22),
      ink: mix(base, "#ffffff", 0.92),
      muted: mix(base, "#ffffff", 0.55),
      accent, second, onAccent: readable(accent), onSecond: readable(second),
    };
  }
  return {
    dark: false,
    bg: "#f5f5f8",
    surface: "#ffffff",
    line: "#e6e4ee",
    ink: luminance(base) < 0.5 ? base : "#1c1b22",
    muted: "#767085",
    accent, second, onAccent: readable(accent), onSecond: readable(second),
  };
}

/* --- 部品 ---------------------------------------------------------------- */

const card = (text, meta = "") => `
  <li class="mock__card">
    <p class="mock__text">${escapeHtml(text)}</p>
    ${meta ? `<p class="mock__meta">${meta}</p>` : ""}
  </li>`;

const tab = (label, target, on) =>
  `<button class="mock__tab${on ? " is-on" : ""}" type="button" data-mock="tab" data-target="${target}">${escapeHtml(label)}</button>`;

const sampleAt = (samples, index) => samples[index % samples.length] ?? FALLBACK_SAMPLES[0];

/* --- 案1：いちばん小さく ------------------------------------------------- */

function screensMinimum(plan, samples, topic) {
  const cards = [0, 1, 2].map((i) => {
    const item = sampleAt(samples, i);
    return card(item.text, `<span>${i === 0 ? "たった今" : `${i + 1}日前`}</span>${item.tag ? `<span class="mock__tag">${escapeHtml(item.tag)}</span>` : ""}`);
  }).join("");

  return {
    body: `
      <div class="mock__screen is-on" data-mock-screen="1">
        <div class="mock__field">
          <span class="mock__placeholder">${escapeHtml(topic)}のことを書く</span>
          <button class="mock__btn" type="button" data-mock="add">ためる</button>
        </div>
        <ul class="mock__list" data-mock-list>${cards}</ul>
      </div>
      <div class="mock__screen" data-mock-screen="2" hidden>
        <div class="mock__field mock__field--search"><span class="mock__placeholder">${escapeHtml(topic)}</span></div>
        <p class="mock__label">1件</p>
        <ul class="mock__list">${card(sampleAt(samples, 0).text, "<span>見つかった1件</span>")}</ul>
      </div>`,
    tabs: tab("ためる", "1", true) + tab("さがす", "2", false),
  };
}

/* --- 案2：仕事に組み込む ------------------------------------------------- */

function stateCard(text, owner, due, state) {
  const cls = state === "完了" ? " is-done" : state === "対応中" ? " is-doing" : "";
  return `
  <li class="mock__card">
    <p class="mock__text">${escapeHtml(text)}</p>
    <p class="mock__meta">
      <span>${escapeHtml(owner)}</span><span>${escapeHtml(due)}</span>
      <button class="mock__chip${cls}" type="button" data-mock="state">${escapeHtml(state)}</button>
    </p>
  </li>`;
}

function screensWorkflow(plan, samples) {
  return {
    body: `
      <div class="mock__screen is-on" data-mock-screen="1">
        <p class="mock__label">自分の分・2件</p>
        <ul class="mock__list">
          ${stateCard(sampleAt(samples, 0).text, "自分", "今日", "未着手")}
          ${stateCard(sampleAt(samples, 1).text, "自分", "明日", "対応中")}
        </ul>
      </div>
      <div class="mock__screen" data-mock-screen="2" hidden>
        <p class="mock__label">みんなの分・2件</p>
        <ul class="mock__list">
          ${stateCard(sampleAt(samples, 2).text, "Aさん", "今週", "未着手")}
          ${stateCard(sampleAt(samples, 3).text, "Bさん", "来週", "未着手")}
        </ul>
      </div>
      <div class="mock__screen" data-mock-screen="3" hidden>
        <p class="mock__label">終わったもの</p>
        <ul class="mock__list">${stateCard(sampleAt(samples, 0).text, "自分", "昨日", "完了")}</ul>
      </div>`,
    tabs: tab("自分", "1", true) + tab("みんな", "2", false) + tab("完了", "3", false),
  };
}

/* --- 案3：機械にやらせる ------------------------------------------------- */

function screensLeverage(plan, samples, topic) {
  const first = sampleAt(samples, 0).text;
  const second = sampleAt(samples, 1).text;
  const bars = [["今週", 72], ["先週", 45], ["先々週", 28]]
    .map(([label, width]) => `<div class="mock__bar"><span>${label}</span><i style="width:${width}%"></i></div>`)
    .join("");

  return {
    body: `
      <div class="mock__screen is-on" data-mock-screen="1">
        <p class="mock__label">機械の下書き</p>
        <div class="mock__draft" data-mock-draft>
          <p class="mock__text">「${escapeHtml(first)}」と「${escapeHtml(second)}」は同じ話。${escapeHtml(topic)}のまとめとして1件にできます。</p>
          <p class="mock__meta"><span class="mock__tag">タグ案：${escapeHtml(topic)}</span></p>
          <div class="mock__acts">
            <button class="mock__btn" type="button" data-mock="adopt">採用</button>
            <button class="mock__btn mock__btn--quiet" type="button" data-mock="edit">直す</button>
            <button class="mock__btn mock__btn--quiet" type="button" data-mock="drop">捨てる</button>
          </div>
        </div>
        <p class="mock__label">採用したもの</p>
        <ul class="mock__list" data-mock-adopted><li class="mock__empty">まだありません</li></ul>
      </div>
      <div class="mock__screen" data-mock-screen="2" hidden>
        <p class="mock__label">ためた数</p>
        <div class="mock__bars">${bars}</div>
        <p class="mock__note">今月の生成 12回・目安 30円</p>
      </div>`,
    tabs: tab("下書き", "1", true) + tab("ふりかえり", "2", false),
  };
}

/* --- 入口 ---------------------------------------------------------------- */

export function renderMockup(plan, samples, topic) {
  const list = Array.isArray(samples) && samples.length ? samples : FALLBACK_SAMPLES;
  const word = topic || "思いつき";
  const color = paletteOf(plan);
  const screens = plan.axis === "b"
    ? screensWorkflow(plan, list)
    : plan.axis === "c"
      ? screensLeverage(plan, list, word)
      : screensMinimum(plan, list, word);

  const style = [
    `--m-bg:${color.bg}`, `--m-surface:${color.surface}`, `--m-line:${color.line}`,
    `--m-ink:${color.ink}`, `--m-muted:${color.muted}`, `--m-accent:${color.accent}`,
    `--m-second:${color.second}`, `--m-on-accent:${color.onAccent}`, `--m-on-second:${color.onSecond}`,
  ].join(";");

  return `
  <div class="mock" style="${style}" data-mock-samples="${escapeHtml(JSON.stringify(list.map((item) => item.text)))}">
    <div class="mock__phone">
      <div class="mock__bar-top">
        <span class="mock__name">${escapeHtml(plan.name)}</span>
        <span class="mock__mic" aria-hidden="true"></span>
      </div>
      <div class="mock__screens">${screens.body}</div>
      <div class="mock__tabs">${screens.tabs}</div>
    </div>
    <p class="mock__hint">タップすると動きます。見た目と操作の感じを確かめるためのもので、中身は本物ではありません。</p>
  </div>`;
}

/* --- さわったときの動き --------------------------------------------------- */

const STATES = ["未着手", "対応中", "完了"];

export function handleMockAction(button) {
  const root = button.closest(".mock");
  if (!root) return;
  const kind = button.dataset.mock;

  if (kind === "tab") {
    for (const screen of root.querySelectorAll("[data-mock-screen]")) {
      const on = screen.dataset.mockScreen === button.dataset.target;
      screen.hidden = !on;
      screen.classList.toggle("is-on", on);
    }
    for (const item of root.querySelectorAll(".mock__tab")) item.classList.toggle("is-on", item === button);
    return;
  }

  if (kind === "state") {
    const next = STATES[(STATES.indexOf(button.textContent.trim()) + 1) % STATES.length];
    button.textContent = next;
    button.classList.toggle("is-doing", next === "対応中");
    button.classList.toggle("is-done", next === "完了");
    button.closest(".mock__card")?.classList.toggle("is-done", next === "完了");
    return;
  }

  if (kind === "add") {
    const list = root.querySelector("[data-mock-list]");
    if (!list) return;
    let texts = [];
    try { texts = JSON.parse(root.dataset.mockSamples || "[]"); } catch { texts = []; }
    const at = Number(root.dataset.mockAt || "0");
    root.dataset.mockAt = String(at + 1);
    const item = document.createElement("li");
    item.className = "mock__card is-new";
    item.innerHTML = `<p class="mock__text"></p><p class="mock__meta"><span>たった今</span></p>`;
    item.querySelector(".mock__text").textContent = texts[at % Math.max(1, texts.length)] ?? "いま話した内容";
    list.prepend(item);
    while (list.children.length > 4) list.lastElementChild.remove();
    return;
  }

  if (kind === "adopt" || kind === "drop") {
    const draft = root.querySelector("[data-mock-draft]");
    const adopted = root.querySelector("[data-mock-adopted]");
    if (!draft) return;
    if (kind === "adopt" && adopted) {
      adopted.querySelector(".mock__empty")?.remove();
      const item = document.createElement("li");
      item.className = "mock__card is-new";
      item.innerHTML = `<p class="mock__text"></p><p class="mock__meta"><span>採用済み</span></p>`;
      item.querySelector(".mock__text").textContent = draft.querySelector(".mock__text")?.textContent ?? "";
      adopted.prepend(item);
    }
    draft.classList.add("is-gone");
    setTimeout(() => {
      draft.remove();
      const label = root.querySelector(".mock__label");
      if (label) label.textContent = "機械の下書き（いまはありません）";
    }, 180);
  }
}
