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
  // 暗い画面にするかどうかは、案そのものが決める（配色の1色目が背景か文字かは案による）
  const dark = plan.design?.dark === true && luminance(base) < 0.5;

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

const tabs = (labels) => labels.map((label, index) => tab(label, String(index + 1), index === 0)).join("");

const screen = (index, inner) =>
  `<div class="mock__screen${index === 1 ? " is-on" : ""}" data-mock-screen="${index}"${index === 1 ? "" : " hidden"}>${inner}</div>`;

const sampleAt = (samples, index) => samples[index % samples.length] ?? FALLBACK_SAMPLES[0];

/* --- 見本のかたち --------------------------------------------------------
   切り口ごとに、画面の作りが変わる。動くのはタップ1回ぶんだけ。
   -------------------------------------------------------------------------- */

const LAYOUTS = {
  /* ためて一覧で見る */
  list(samples, topic) {
    const cards = [0, 1, 2].map((i) => {
      const item = sampleAt(samples, i);
      return card(item.text, `<span>${i === 0 ? "たった今" : `${i + 1}日前`}</span>${item.tag ? `<span class="mock__tag">${escapeHtml(item.tag)}</span>` : ""}`);
    }).join("");

    return {
      body: screen(1, `
        <div class="mock__field">
          <span class="mock__placeholder">${escapeHtml(topic)}のことを書く</span>
          <button class="mock__btn" type="button" data-mock="add">ためる</button>
        </div>
        <ul class="mock__list" data-mock-list>${cards}</ul>`)
        + screen(2, `
        <div class="mock__field mock__field--search"><span class="mock__placeholder">${escapeHtml(topic)}</span></div>
        <p class="mock__label">1件</p>
        <ul class="mock__list">${card(sampleAt(samples, 0).text, "<span>見つかった1件</span>")}</ul>`),
      tabs: tabs(["ためる", "さがす"]),
    };
  },

  /* 担当と状態で回す */
  board(samples) {
    const row = (text, owner, due, state) => {
      const cls = state === "完了" ? " is-done" : state === "対応中" ? " is-doing" : "";
      return `
      <li class="mock__card">
        <p class="mock__text">${escapeHtml(text)}</p>
        <p class="mock__meta">
          <span>${escapeHtml(owner)}</span><span>${escapeHtml(due)}</span>
          <button class="mock__chip${cls}" type="button" data-mock="state">${escapeHtml(state)}</button>
        </p>
      </li>`;
    };
    return {
      body: screen(1, `<p class="mock__label">自分の分・2件</p><ul class="mock__list">
          ${row(sampleAt(samples, 0).text, "自分", "今日", "未着手")}
          ${row(sampleAt(samples, 1).text, "自分", "明日", "対応中")}</ul>`)
        + screen(2, `<p class="mock__label">みんなの分・2件</p><ul class="mock__list">
          ${row(sampleAt(samples, 2).text, "Aさん", "今週", "未着手")}
          ${row(sampleAt(samples, 3).text, "Bさん", "来週", "未着手")}</ul>`)
        + screen(3, `<p class="mock__label">終わったもの</p><ul class="mock__list">
          ${row(sampleAt(samples, 0).text, "自分", "昨日", "完了")}</ul>`),
      tabs: tabs(["自分", "みんな", "完了"]),
    };
  },

  /* 機械の下書きを、人が採用する */
  queue(samples, topic) {
    const bars = [["今週", 72], ["先週", 45], ["先々週", 28]]
      .map(([label, width]) => `<div class="mock__bar"><span>${label}</span><i style="width:${width}%"></i></div>`).join("");
    return {
      body: screen(1, `
        <p class="mock__label">機械の下書き</p>
        <div class="mock__draft" data-mock-draft>
          <p class="mock__text">「${escapeHtml(sampleAt(samples, 0).text)}」と「${escapeHtml(sampleAt(samples, 1).text)}」は同じ話。${escapeHtml(topic)}のまとめとして1件にできます。</p>
          <p class="mock__meta"><span class="mock__tag">タグ案：${escapeHtml(topic)}</span></p>
          <div class="mock__acts">
            <button class="mock__btn" type="button" data-mock="adopt">採用</button>
            <button class="mock__btn mock__btn--quiet" type="button" data-mock="edit">直す</button>
            <button class="mock__btn mock__btn--quiet" type="button" data-mock="drop">捨てる</button>
          </div>
        </div>
        <p class="mock__label">採用したもの</p>
        <ul class="mock__list" data-mock-adopted><li class="mock__empty">まだありません</li></ul>`)
        + screen(2, `<p class="mock__label">ためた数</p><div class="mock__bars">${bars}</div>
          <p class="mock__note">今月の生成 12回・目安 30円</p>`),
      tabs: tabs(["下書き", "ふりかえり"]),
    };
  },

  /* 引いて、開いて読む */
  detail(samples, topic) {
    const item = (text, count, index) => `
      <li class="mock__card mock__card--open" data-mock-open-item>
        <p class="mock__text">${escapeHtml(text)}</p>
        <p class="mock__meta"><span>${count}回きかれた</span>
          <button class="mock__chip" type="button" data-mock="open" data-target="ans${index}">答えを見る</button></p>
        <p class="mock__answer" id="ans${index}" hidden>ここに答えが入ります。窓口で読み上げられる長さで区切って書きます。</p>
      </li>`;
    return {
      body: screen(1, `
        <div class="mock__field mock__field--search"><span class="mock__placeholder">${escapeHtml(topic)}をさがす</span></div>
        <p class="mock__label">よくきかれる順</p>
        <ul class="mock__list">${item(sampleAt(samples, 0).text, 12, 1)}${item(sampleAt(samples, 1).text, 7, 2)}</ul>`)
        + screen(2, `
        <p class="mock__label">足す</p>
        <div class="mock__field"><span class="mock__placeholder">きかれたこと</span></div>
        <div class="mock__field"><span class="mock__placeholder">答えたこと</span></div>
        <button class="mock__btn mock__btn--wide" type="button" data-mock="add">登録する</button>
        <ul class="mock__list" data-mock-list></ul>`),
      tabs: tabs(["引く", "足す"]),
    };
  },

  /* 写真が主役 */
  gallery(samples) {
    const shot = (item, when) => `
      <li class="mock__shot">
        <span class="mock__thumb" aria-hidden="true"></span>
        <p class="mock__text">${escapeHtml(item.text)}</p>
        <p class="mock__meta"><span>${when}</span></p>
      </li>`;
    return {
      body: screen(1, `
        <div class="mock__field"><span class="mock__placeholder">今日 3枚</span>
          <button class="mock__btn" type="button" data-mock="add">撮る</button></div>
        <ul class="mock__grid" data-mock-list>
          ${shot(sampleAt(samples, 0), "たった今")}${shot(sampleAt(samples, 1), "9:40")}
          ${shot(sampleAt(samples, 2), "昨日")}${shot(sampleAt(samples, 3), "昨日")}
        </ul>`)
        + screen(2, `
        <p class="mock__label">場所の近い順</p>
        <ul class="mock__list">
          ${card(sampleAt(samples, 0).text, "<span>ここから 120m</span>")}
          ${card(sampleAt(samples, 1).text, "<span>ここから 1.4km</span>")}
        </ul>`),
      tabs: tabs(["日付順", "場所順"]),
    };
  },

  /* 日付の側から見る */
  calendar(samples, topic) {
    const days = Array.from({ length: 28 }, (_, i) => {
      const day = i + 1;
      const dots = [8, 15, 16, 22, 25].includes(day) ? '<i></i>' : "";
      const today = day === 15;
      return `<button class="mock__day${today ? " is-on" : ""}" type="button" data-mock="day">${day}${dots}</button>`;
    }).join("");
    return {
      body: screen(1, `
        <p class="mock__label">9月</p>
        <div class="mock__cal">${days}</div>
        <p class="mock__label">15日の${escapeHtml(topic)}</p>
        <ul class="mock__list">
          ${card(sampleAt(samples, 0).text, "<span>当番：自分</span><span>今日まで</span>")}
          ${card(sampleAt(samples, 1).text, "<span>当番：Aさん</span><span>あと3日</span>")}
        </ul>`)
        + screen(2, `
        <p class="mock__label">繰り返しの型</p>
        <ul class="mock__list">
          ${card("毎月末：" + sampleAt(samples, 0).text, "<span>月末3日前から出す</span>")}
          ${card("毎週金：" + sampleAt(samples, 1).text, "<span>当番はA→B→C</span>")}
        </ul>`),
      tabs: tabs(["こよみ", "型"]),
    };
  },

  /* 手順を上から潰す */
  checklist(samples, topic) {
    const line = (text, done) => `
      <li class="mock__check${done ? " is-done" : ""}">
        <button class="mock__box" type="button" data-mock="check" aria-pressed="${done}"></button>
        <span>${escapeHtml(text)}</span>
      </li>`;
    return {
      body: screen(1, `
        <p class="mock__label">${escapeHtml(topic)}の作業　3/6 完了</p>
        <ul class="mock__checks">
          ${line(sampleAt(samples, 0).text, false)}
          ${line(sampleAt(samples, 1).text, false)}
          ${line(sampleAt(samples, 2).text, false)}
          ${line("前回からの引き継ぎを確認する", true)}
        </ul>`)
        + screen(2, `
        <p class="mock__label">型（3つ）</p>
        <ul class="mock__list">
          ${card("月末の作業（8項目）", "<span>先月 使用</span>")}
          ${card("引き継ぎ前の確認（5項目）", "<span>3回 使用</span>")}
        </ul>`),
      tabs: tabs(["今日の作業", "型の管理"]),
    };
  },

  /* 前回を下敷きにして書く */
  form(samples, topic) {
    const field = (label, value, filled) => `
      <div class="mock__row">
        <span class="mock__rowlabel">${escapeHtml(label)}</span>
        <button class="mock__value${filled ? " is-filled" : ""}" type="button" data-mock="fill">${escapeHtml(value)}</button>
      </div>`;
    return {
      body: screen(1, `
        <p class="mock__label">${escapeHtml(topic)}のひな形（前回の値）</p>
        ${field("件名", sampleAt(samples, 0).text, false)}
        ${field("担当", "自分", true)}
        ${field("日付", "9月15日", false)}
        ${field("内容", sampleAt(samples, 1).text, false)}
        <p class="mock__note">薄い文字は前回の値。押すと確定します。</p>`)
        + screen(2, `
        <p class="mock__label">型（4つ）</p>
        <ul class="mock__list">
          ${card(sampleAt(samples, 0).text, "<span>12回 使用</span>")}
          ${card(sampleAt(samples, 1).text, "<span>5回 使用</span>")}
        </ul>`),
      tabs: tabs(["書く", "型の管理"]),
    };
  },

  /* 数で見る */
  dashboard(samples, topic) {
    const bars = [["今週", 82], ["先週", 54], ["2週前", 61], ["3週前", 30]]
      .map(([label, width]) => `<div class="mock__bar"><span>${label}</span><i style="width:${width}%"></i></div>`).join("");
    return {
      body: screen(1, `
        <div class="mock__stats">
          <div class="mock__stat"><b>14</b><span>今週</span></div>
          <div class="mock__stat"><b>+5</b><span>先週比</span></div>
          <div class="mock__stat"><b>6日</b><span>続いた</span></div>
        </div>
        <p class="mock__label">週ごと</p>
        <div class="mock__bars">${bars}</div>
        <p class="mock__label">よく出た言葉</p>
        <p class="mock__meta"><span class="mock__tag">${escapeHtml(topic)}</span><span class="mock__tag">${escapeHtml(sampleAt(samples, 1).tag || "共有")}</span></p>`)
        + screen(2, `<p class="mock__label">今週の中身</p><ul class="mock__list">
          ${card(sampleAt(samples, 0).text, "<span>月曜</span>")}
          ${card(sampleAt(samples, 1).text, "<span>水曜</span>")}</ul>`),
      tabs: tabs(["ふりかえり", "一覧"]),
    };
  },

  /* 1日1回だけ押す */
  streak(samples, topic) {
    const dots = ["月", "火", "水", "木", "金", "土", "日"]
      .map((label, i) => `<span class="mock__dot${i < 4 ? " is-on" : ""}">${label}</span>`).join("");
    return {
      body: screen(1, `
        <div class="mock__big"><b>4</b><span>日つづいた</span></div>
        <button class="mock__press" type="button" data-mock="press">今日の${escapeHtml(topic)}</button>
        <div class="mock__dots">${dots}</div>
        <p class="mock__note">ひとことは、書かなくてかまいません</p>`)
        + screen(2, `<p class="mock__label">先月</p>
        <div class="mock__bars">
          <div class="mock__bar"><span>1週</span><i style="width:70%"></i></div>
          <div class="mock__bar"><span>2週</span><i style="width:100%"></i></div>
          <div class="mock__bar"><span>3週</span><i style="width:40%"></i></div>
        </div>
        <p class="mock__note">途切れた週があっても、記録は残ります</p>`),
      tabs: tabs(["今日", "ふりかえり"]),
    };
  },
};

/* --- 入口 ---------------------------------------------------------------- */

export function renderMockup(plan, samples, topic) {
  const list = Array.isArray(samples) && samples.length ? samples : FALLBACK_SAMPLES;
  const word = topic || "思いつき";
  const color = paletteOf(plan);
  const layout = LAYOUTS[plan.design?.mock] ?? LAYOUTS.list;
  const screens = layout(list, word);

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
    for (const item of root.querySelectorAll("[data-mock-screen]")) {
      const on = item.dataset.mockScreen === button.dataset.target;
      item.hidden = !on;
      item.classList.toggle("is-on", on);
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

  if (kind === "check") {
    const line = button.closest(".mock__check");
    const done = !line.classList.contains("is-done");
    line.classList.toggle("is-done", done);
    button.setAttribute("aria-pressed", String(done));
    return;
  }

  if (kind === "fill") {
    button.classList.add("is-filled");
    return;
  }

  if (kind === "open") {
    const answer = root.querySelector(`#${CSS.escape(button.dataset.target)}`);
    if (!answer) return;
    answer.hidden = !answer.hidden;
    button.textContent = answer.hidden ? "答えを見る" : "閉じる";
    return;
  }

  if (kind === "day") {
    for (const day of root.querySelectorAll(".mock__day")) day.classList.toggle("is-on", day === button);
    const label = root.querySelector('[data-mock-screen="1"] .mock__label + .mock__cal + .mock__label');
    if (label) label.textContent = label.textContent.replace(/^\d+日/, `${button.textContent.replace(/\D/g, "")}日`);
    return;
  }

  if (kind === "press") {
    const big = root.querySelector(".mock__big b");
    const dots = [...root.querySelectorAll(".mock__dot")];
    const next = dots.find((dot) => !dot.classList.contains("is-on"));
    if (next) {
      next.classList.add("is-on");
      if (big) big.textContent = String(Number(big.textContent) + 1);
      button.classList.add("is-pressed");
      setTimeout(() => button.classList.remove("is-pressed"), 400);
    }
    return;
  }

  if (kind === "add") {
    const list = root.querySelector('[data-mock-screen].is-on [data-mock-list]') ?? root.querySelector("[data-mock-list]");
    if (!list) return;
    let texts = [];
    try { texts = JSON.parse(root.dataset.mockSamples || "[]"); } catch { texts = []; }
    const at = Number(root.dataset.mockAt || "0");
    root.dataset.mockAt = String(at + 1);
    const text = texts[at % Math.max(1, texts.length)] ?? "いま話した内容";
    const item = document.createElement("li");
    if (list.classList.contains("mock__grid")) {
      item.className = "mock__shot is-new";
      item.innerHTML = '<span class="mock__thumb" aria-hidden="true"></span><p class="mock__text"></p><p class="mock__meta"><span>たった今</span></p>';
    } else {
      item.className = "mock__card is-new";
      item.innerHTML = '<p class="mock__text"></p><p class="mock__meta"><span>たった今</span></p>';
    }
    item.querySelector(".mock__text").textContent = text;
    list.prepend(item);
    while (list.children.length > 4) list.lastElementChild.remove();
    return;
  }

  if (kind === "edit") {
    // 「直す」は、人の手が入ったことが見た目で分かるところまで
    const draft = button.closest("[data-mock-draft]");
    if (!draft) return;
    draft.classList.add("is-edited");
    const tag = draft.querySelector(".mock__tag");
    if (tag) tag.textContent = "自分で直したもの";
    button.textContent = "直した";
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
      item.innerHTML = '<p class="mock__text"></p><p class="mock__meta"><span>採用済み</span></p>';
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
