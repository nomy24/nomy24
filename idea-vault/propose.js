/* アイデア貯蔵庫 — 3案をつくるところ
   ためたメモを読んで、方向性の違う案を3つ組み立てる。通信はしない。
   よい点だけを並べても判断できないので、欠点・長期の負担・やめどきを必ず一緒に出す。 */

/* --------------------------------------------------------------------------
   1. ことばを拾う
   -------------------------------------------------------------------------- */

// 数が多いだけで中身のない語。拾っても案の役に立たない。
const STOP_WORDS = new Set([
  "自分", "今回", "場合", "感じ", "部分", "内容", "必要", "可能", "利用", "使用", "作成", "確認",
  "何度", "一度", "今日", "明日", "昨日", "今週", "来週", "時間", "最近", "普通", "結構", "本当",
  "以上", "以下", "程度", "全部", "一番", "問題", "状態", "方法", "感覚", "予定", "things", "the",
  "and", "for", "with", "that", "this", "app", "アプリ", "こと", "もの", "とき", "ため", "よう",
]);

/** 漢字・カタカナ・英数の連なりを語として拾う。日本語の解析器は積まない（端末だけで動かすため）。 */
function extractWords(text) {
  const words = [];
  const push = (word, weight) => {
    if (word.length < 2 || STOP_WORDS.has(word)) return;
    words.push({ word, weight });
  };

  const re = /[一-龥々〆ヶ]{2,}|[ァ-ヴー]{2,}|[A-Za-z][A-Za-z0-9+#._-]{1,}/g;
  for (const match of text.matchAll(re)) {
    const run = match[0].slice(0, 12);
    push(run, 1);
    // 「会議録音」のような複合語は、2文字ずつに割っても意味が残ることが多い
    if (/^[一-龥々〆ヶ]{4,}$/.test(run)) {
      for (let i = 0; i + 2 <= run.length; i += 1) push(run.slice(i, i + 2), 0.45);
    }
  }
  return words;
}

function countKeywords(ideas) {
  const scores = new Map();
  const docs = new Map();
  for (const idea of ideas) {
    const seen = new Set();
    for (const { word, weight } of extractWords(idea.text)) {
      scores.set(word, (scores.get(word) ?? 0) + weight);
      if (!seen.has(word)) {
        seen.add(word);
        docs.set(word, (docs.get(word) ?? 0) + 1);
      }
    }
    for (const tag of idea.tags) {
      scores.set(tag, (scores.get(tag) ?? 0) + 2);
      docs.set(tag, (docs.get(tag) ?? 0) + 1);
    }
  }
  return [...scores.entries()]
    .map(([word, score]) => ({ word, score, docs: docs.get(word) ?? 1 }))
    // 何件のメモにまたがって出てくるかを重く見る（1件で連呼しただけの語を上げない）
    .sort((a, b) => (b.score + b.docs * 1.5) - (a.score + a.docs * 1.5))
    .slice(0, 14);
}

/* --------------------------------------------------------------------------
   2. 何をしたい話なのかを見分ける
   -------------------------------------------------------------------------- */

const THEMES = [
  {
    id: "capture", label: "記録する",
    words: ["メモ", "記録", "ログ", "残す", "残し", "書き留", "日誌", "議事", "録音", "文字起こし", "ノート"],
    feature: "1タップで書き始められる入力欄と、あとから直せる一覧",
    watch: "入力にかかる時間。3秒を超えると書かなくなる",
  },
  {
    id: "share", label: "人と分ける",
    words: ["共有", "チーム", "職員", "みんな", "連携", "引き継", "同僚", "部署", "配布", "全員", "上司", "報告"],
    feature: "だれが・いつ触ったかが残る共有一覧と、見せる範囲の切り替え",
    watch: "書ける内容が薄まること。人の目が入ると本音のメモは止まる",
  },
  {
    id: "search", label: "あとで探す",
    words: ["探す", "検索", "見つ", "一覧", "整理", "分類", "タグ", "あとで", "振り返", "まとめ"],
    feature: "全文検索とタグ、期間での絞り込み",
    watch: "分類のルール。手で分類させると3か月で止まる",
  },
  {
    id: "remind", label: "忘れない",
    words: ["通知", "リマインド", "忘れ", "期限", "締切", "アラート", "期日", "催促", "提出"],
    feature: "期日と通知、放置しているものの浮き上がり",
    watch: "通知の量。多いと全部無視されるようになる",
  },
  {
    id: "schedule", label: "予定を扱う",
    words: ["予定", "カレンダー", "日程", "スケジュール", "シフト", "当番", "月末", "月初", "毎週", "毎月"],
    feature: "カレンダー表示と繰り返しの型",
    watch: "既存のカレンダーとの二重管理。片方しか見なくなる",
  },
  {
    id: "auto", label: "手間を減らす",
    words: ["自動", "効率", "手間", "省く", "繰り返し", "定型", "転記", "入力し直", "コピー", "面倒", "楽に"],
    feature: "定型の入力を型として持たせ、前回の内容を引き継ぐ",
    watch: "自動化した部分の検算。間違いに気づけない仕組みは危ない",
  },
  {
    id: "analyze", label: "数で見る",
    words: ["集計", "分析", "グラフ", "可視化", "推移", "件数", "傾向", "統計", "ダッシュボード", "比較"],
    feature: "件数の推移と内訳を出す画面",
    watch: "見て終わりになること。数字から動く先がないと開かなくなる",
  },
  {
    id: "ai", label: "AIに考えさせる",
    words: ["AI", "ＡＩ", "要約", "生成", "自動で書", "文字起こし", "chatgpt", "claude", "提案してくれ", "分類してくれ"],
    feature: "たまった内容の要約と下書きの生成（人が採用ボタンを押す形）",
    watch: "出力のブレと費用。毎回同じ答えは返らない",
  },
  {
    id: "form", label: "書類を通す",
    words: ["申請", "様式", "書類", "フォーム", "提出", "押印", "決裁", "回覧", "起案", "台帳"],
    feature: "入力フォームと、決裁・回覧の状態表示",
    watch: "紙と印鑑が残っていると、電子化は二重作業になるだけ",
  },
  {
    id: "customer", label: "相手に対応する",
    words: ["住民", "市民", "顧客", "お客", "窓口", "問い合わせ", "受付", "来庁", "電話", "相談", "苦情"],
    feature: "対応履歴と、同じ相手の過去のやりとりの引き当て",
    watch: "個人情報。端末に置くのか、どこまで残すのかを先に決める",
  },
  {
    id: "money", label: "お金を扱う",
    words: ["家計", "金額", "支出", "経費", "予算", "請求", "料金", "会計", "収支", "円"],
    feature: "金額の入力と、月ごとの合計",
    watch: "1円でも合わないと信用されない。既存の会計と役割を分ける",
  },
  {
    id: "habit", label: "続ける・体をみる",
    words: ["習慣", "健康", "運動", "睡眠", "体重", "食事", "毎日", "続け", "トレーニング", "記録し続"],
    feature: "その日の記録と、続いている日数の表示",
    watch: "途切れたときに開きたくなくなる作り（連続日数の見せ方）",
  },
  {
    id: "learn", label: "覚える",
    words: ["学習", "勉強", "覚え", "復習", "単語", "読書", "資格", "教材", "問題集"],
    feature: "出題と、間違えたものの再出題",
    watch: "教材づくりの手間。作る側が続かないと中身が増えない",
  },
  {
    id: "place", label: "場所に紐づける",
    words: ["地図", "場所", "位置", "現地", "近く", "ルート", "訪問", "巡回", "住所"],
    feature: "地図表示と、現在地から近い順の並べ替え",
    watch: "位置情報の許可。断られた場合の画面を先に決める",
  },
  {
    id: "media", label: "写真で残す",
    words: ["写真", "画像", "動画", "カメラ", "撮影", "スクショ", "現場写真"],
    feature: "撮ってすぐ紐づけられる添付と、あとから見返す一覧",
    watch: "容量。端末の中だけだと数百枚で頭打ちになる",
  },
  {
    id: "field", label: "外で使う",
    words: ["現場", "外出", "オフライン", "電波", "持ち歩", "移動中", "出先", "車内"],
    feature: "電波がなくても書けて、つながったら送る仕組み",
    watch: "同期の衝突。あとから直したものが消える事故が起きやすい",
  },
];

const AUDIENCE_WORDS = {
  team: ["職員", "チーム", "同僚", "部署", "上司", "共有", "引き継", "みんな", "全員", "課内", "係"],
  public: ["住民", "市民", "顧客", "お客", "利用者", "来庁", "一般", "公開"],
};

function detectThemes(ideas) {
  const found = [];
  for (const theme of THEMES) {
    let hits = 0;
    const examples = [];
    for (const idea of ideas) {
      const text = idea.text + " " + idea.tags.join(" ");
      if (theme.words.some((word) => text.includes(word))) {
        hits += 1;
        if (examples.length < 2) examples.push(idea);
      }
    }
    if (hits > 0) found.push({ ...theme, hits, examples, ratio: hits / Math.max(1, ideas.length) });
  }
  return found.sort((a, b) => b.hits - a.hits);
}

function detectAudience(ideas) {
  const text = ideas.map((idea) => idea.text + " " + idea.tags.join(" ")).join("\n");
  const team = AUDIENCE_WORDS.team.filter((word) => text.includes(word)).length;
  const open = AUDIENCE_WORDS.public.filter((word) => text.includes(word)).length;
  if (open > team && open > 0) return { id: "public", label: "住民・お客さん", who: "使う相手" };
  if (team > 0) return { id: "team", label: "職場の人", who: "同じ職場の人" };
  return { id: "self", label: "自分ひとり", who: "自分" };
}

/** 「面倒」「忘れる」など、困りごとが書かれている一文を抜き出す */
function detectPains(ideas) {
  const marks = ["面倒", "手間", "困", "忘れ", "分からな", "わからな", "探す", "見つからな", "時間がかか", "大変", "つらい", "ミス", "抜け", "漏れ", "できな"];
  const pains = [];
  for (const idea of ideas) {
    for (const sentence of idea.text.split(/[。\n！？!?]/)) {
      const trimmed = sentence.trim();
      if (trimmed.length < 4) continue;
      if (marks.some((mark) => trimmed.includes(mark))) {
        pains.push({ text: trimmed.slice(0, 60), id: idea.id });
        break;
      }
    }
    if (pains.length >= 4) break;
  }
  return pains;
}

/* --------------------------------------------------------------------------
   3. 全体の見立て
   -------------------------------------------------------------------------- */

const DAY = 24 * 60 * 60 * 1000;

function summarize(ideas, keywords, themes, audience, topic) {
  const times = ideas.map((idea) => idea.createdAt);
  const spanDays = Math.max(1, Math.round((Math.max(...times) - Math.min(...times)) / DAY));
  const perWeek = Math.max(0.5, (ideas.length / spanDays) * 7);
  const voice = ideas.filter((idea) => idea.source === "voice").length;
  const spread = themes[0] ? themes[0].ratio : 0;

  let note;
  if (ideas.length < 5) {
    note = `まだ${ideas.length}件。ここから出す案は、当てずっぽうに近い。10件くらいためてからもう一度つくり直すと、はっきり変わる。`;
  } else if (spread >= 0.5) {
    note = `${Math.round(spread * 100)}%のメモが「${themes[0].label}」の話。関心はもう1つに寄っている。あとは作るかどうかだけ。`;
  } else if (themes.length >= 4) {
    note = `話題が${themes.length}方向に散っている。1つのアプリに全部入れると、どれも中途半端になる。下の3案は、あえて別々の方向に振ってある。`;
  } else {
    note = `${spanDays}日で${ideas.length}件、週${perWeek.toFixed(1)}件のペース。この量なら、まず1つ作って捨てる前提で試すのが早い。`;
  }

  return {
    headline: `${ideas.length}件のメモ・主題は「${topic}」・${audience.label}向け`,
    note,
    topic,
    spanDays,
    perWeek,
    voiceRatio: ideas.length ? voice / ideas.length : 0,
    keywords: keywords.slice(0, 8).map((item) => item.word),
    themes: themes.slice(0, 4).map((theme) => theme.label),
  };
}

/* --------------------------------------------------------------------------
   4. 3つの案を組み立てる
   -------------------------------------------------------------------------- */

const AXES = [
  {
    id: "a", key: "minimum", label: "いちばん小さく",
    suffix: ["メモ", "ノート", "箱"],
    palette: [
      { hex: "#1c1b22", role: "文字。背景はほぼ白のまま、色は1つだけに絞る" },
      { hex: "#2f6bff", role: "押せるものだけに使う青" },
      { hex: "#f5f5f7", role: "余白としての薄いグレー" },
    ],
    pattern: "1画面主義",
    layout: "上に入力欄、下に一覧。タブもメニューも作らない。",
    interaction: "開いた瞬間に入力欄へカーソルが入る。保存ボタンは押さなくても消えない。",
    typography: "本文16px・行間1.8。装飾は使わず、太さの差だけで見出しを作る。",
    motion: "追加したカードが上から差し込まれる0.2秒だけ。ほかは動かさない。",
  },
  {
    id: "b", key: "workflow", label: "仕事に組み込む",
    suffix: ["ボード", "台帳", "共有帳"],
    palette: [
      { hex: "#0f3d5c", role: "見出しと枠。事務で浮かない濃い藍" },
      { hex: "#2f9e7c", role: "終わった・処理済みの緑" },
      { hex: "#d97706", role: "期限切れ・要対応だけの橙" },
    ],
    pattern: "タブ＋状態つきカード",
    layout: "「自分の分」「みんなの分」「終わったもの」の3タブ。カードに担当と期限を必ず出す。",
    interaction: "状態は1タップで進む（未着手→対応中→完了）。だれがいつ変えたかがカードの下に残る。",
    typography: "一覧は14px・詰め気味。件数と日付は等幅寄りの数字書体で揃える。",
    motion: "状態を変えたカードが一覧の中で移動していく様子を0.25秒で見せる。",
  },
  {
    id: "c", key: "leverage", label: "機械にやらせる",
    suffix: ["オート", "アシスト", "工房"],
    palette: [
      { hex: "#14121f", role: "背景を暗くして、生成物を前に出す" },
      { hex: "#8b5cf6", role: "AIが作ったものにだけ付ける紫" },
      { hex: "#22d3ee", role: "人が確認済みにしたものの水色" },
    ],
    pattern: "下書きの列＋確認待ち",
    layout: "上に「機械の下書き」、下に「採用したもの」。下書きは人が押すまで本採用にしない。",
    interaction: "生成物には必ず「採用」「直す」「捨てる」の3つを並べる。黙って確定させない。",
    typography: "生成文と自分の文で書体を変え、どちらが機械の言葉かを見た目で分ける。",
    motion: "生成中だけ薄い明滅。出たあとは静止させ、読ませることに集中する。",
  },
];

const NUM = (value) => (value >= 10 ? Math.round(value) : Math.round(value * 10) / 10);

// 案の名前に使うと「メモメモ」のように重なる語。名前の頭には使わない。
const NAME_SUFFIXES = new Set(["メモ", "ノート", "箱", "ボード", "台帳", "共有帳", "オート", "アシスト", "工房"]);

/** 名前の頭に使う語を選ぶ。上位の語から、語尾と重ならないものを取る。 */
function pickNameBase(keywords, topic) {
  const found = keywords.find((item) => !NAME_SUFFIXES.has(item.word) && item.word.length <= 6);
  return (found?.word ?? topic ?? "思いつき").slice(0, 6);
}

function pickName(base, axis) {
  const suffix = axis.suffix.find((word) => !base.includes(word)) ?? axis.suffix[0];
  return `${base}${suffix}`;
}

function baseFeatures(axis, themes, audience) {
  const top = themes.slice(0, 3);
  if (axis.id === "a") {
    return [
      top[0] ? top[0].feature : "1タップで書き始められる入力欄",
      "音声とキーボードの両方から、同じ1件として入る",
      "全文検索だけ。フォルダも階層も作らない",
      "書き出し（テキスト・JSON）。閉じ込めない",
    ];
  }
  if (axis.id === "b") {
    return [
      top[0] ? top[0].feature : "共有の一覧",
      `${audience.who}が見られる共有ビューと、見せる範囲の切り替え`,
      "状態（未着手・対応中・完了）と担当・期限",
      top[1] ? top[1].feature : "期日の通知と、放置されているものの浮き上がり",
      "だれがいつ何を変えたかの履歴",
    ];
  }
  return [
    "たまった内容の自動まとめ（週1回、下書きとして提示）",
    top[0] ? `${top[0].label}の下ごしらえを機械にやらせる：${top[0].feature}` : "分類とタグ付けの自動化",
    "似ている過去の記録の引き当て",
    top[2] ? top[2].feature : "件数と傾向の一枚絵",
    "生成物は必ず人の採用操作を通す",
  ];
}

function buildWire(axis, topic, audience) {
  if (axis.id === "a") {
    return [
      { tag: "上", text: `入力欄（${topic}のことを書く）。常に開いている` },
      { tag: "中", text: "検索1行。押すまで出さない" },
      { tag: "下", text: "新しい順のカード。1件＝1枚、罫線なし" },
      { tag: "右下", text: "マイク。親指の位置に固定" },
    ];
  }
  if (axis.id === "b") {
    return [
      { tag: "上", text: "3タブ（自分・みんな・完了）と件数バッジ" },
      { tag: "中", text: `カード：${topic}／担当／期限／状態の4点だけ` },
      { tag: "下", text: "期限切れを最上段に固定。赤は本当の期限切れにだけ" },
      { tag: "右下", text: "追加ボタン。作成画面は1画面で終わらせる" },
    ];
  }
  return [
    { tag: "上", text: `機械の下書き（${topic}のまとめ・分類案）。紫の枠で人の文と区別` },
    { tag: "中", text: "採用／直す／捨てる の3ボタン" },
    { tag: "下", text: "採用済みの一覧。元メモへ1タップで戻れる" },
    { tag: "右上", text: "今月の生成回数と費用の目安" },
  ];
}

function buildPros(axis, ctx) {
  const { topic, audience, themes, summary } = ctx;
  if (axis.id === "a") {
    return [
      `作る量が少ない。土日2日で動く形まで行ける（画面1つ・保存はブラウザの中だけ）`,
      `${topic}のことを書くまでの手数が最短になる。思いつきは3秒以内に書けないと消える`,
      "使われなかったときの損が小さい。捨てても惜しくない",
      themes[0] ? `いま一番多い「${themes[0].label}」だけに絞れば、迷う設計判断がほとんど出てこない` : "設計判断がほとんど出てこない",
    ];
  }
  if (axis.id === "b") {
    return [
      `${audience.who}の頭の中にしかない情報が、形として残る。休んだ日でも他の人が拾える`,
      "「だれが持っているか」が見えるので、催促と抜けの確認が会話なしで終わる",
      `${summary.spanDays}日で${ctx.count}件のペースなら、3年で約${NUM(summary.perWeek * 52 * 3)}件の履歴になる。過去の判断を引ける資産になる`,
      "属人化した手順が文章になる。異動・引き継ぎのときに効く",
    ];
  }
  return [
    "人がやるとサボる工程（分類・要約・見返し）が、放っておいても進む",
    `${topic}まわりの記録が増えるほど価値が上がる。手作業と逆の性質`,
    "自分では思いつかない切り口が出てくることがある（当たりは2〜3割）",
    "下書きまで機械にやらせて、人は判断だけに集中できる",
  ];
}

function buildCons(axis, ctx, harsh) {
  const { topic, audience, themes, count, summary } = ctx;
  const soft = [];
  if (axis.id === "a") {
    soft.push(
      "機能が1つしかないぶん、既存のメモアプリや紙で足りると気づいた瞬間に開かなくなる",
      `検索しか用意しないので、${NUM(summary.perWeek * 52)}件を超えたあたりから目的のものにたどり着けなくなる`,
      "端末の中にしか残らない。機種変更・ブラウザのデータ削除で全部消える",
    );
    if (harsh) {
      soft.push(
        `率直に言うと、この案の価値は「作ったこと」ではなく「毎日書くこと」にしかない。3日書かなければ、それは作らなくてよかったということ`,
        "1機能アプリは、代わりが世の中に何十個もある。自作する理由は「自分の手に合うこと」だけで、それは作ってみないと分からない",
      );
    }
    return soft;
  }
  if (axis.id === "b") {
    soft.push(
      `${audience.who}に使ってもらう前提のものは、自分ひとりの熱では回らない。合意・権限・入力ルールを決める作業のほうが、アプリ本体より重い`,
      "共有した瞬間に、書ける内容が薄くなる。人の目があるところに本音の記録は残らない",
      "ログイン・権限・個人情報の置き場所を決める必要が出る。ここを飛ばすと、動いても業務では使えない",
      "作った人が異動・退職したら止まる。引き継げる形（手順書・アカウント）を最初から用意しないと、その日に死ぬ",
    );
    if (harsh) {
      soft.push(
        `${themes.some((t) => t.id === "form") ? "紙と押印が1か所でも残っていると、電子化は二重入力になるだけで、現場の手間は増える。" : ""}導入の合意が取れる見込みがないなら、この案は今つくるべきではない。動くものができても、使われないまま置かれる`,
        "「みんなが入力してくれる」前提は、ほぼ外れる。入力しない人がいても回る設計になっていないなら、半年で形骸化する",
      );
    }
    return soft;
  }
  soft.push(
    "生成の結果は毎回ブレる。同じ入力でも違う答えが返る前提でしか使えない",
    "1回ごとに費用がかかる。無料の感覚で作ると、請求を見てから使わなくなる",
    "精度が9割でも、残り1割を見つけるために全部読み直すことになり、結局手間が減らない用途がある",
    "APIやモデルの仕様が変われば作り直し。1〜2年ごとに手入れが必要な前提で持つもの",
  );
  if (harsh) {
    soft.push(
      `いまのメモは${count}件。この量では、機械にまとめさせても「メモをそのまま並べ直しただけ」の結果になる。効いてくるのは数百件からで、今つくると期待外れになる`,
      "個人情報や職務上の内容を外部のAPIに送れるかどうかは、作る前に確認すること。ここを曖昧にしたまま作ると、動いても使えない",
    );
  }
  return soft;
}

function buildLongTerm(axis, ctx) {
  const { summary, audience, count } = ctx;
  const threeYear = NUM(summary.perWeek * 52 * 3);
  if (axis.id === "a") {
    return {
      works: [
        `記録そのものが資産になる。3年で約${threeYear}件。過去の自分の判断を引けるのは、市販のアプリでは代えがきかない`,
        "作りが小さいので、3年経っても直せる。自分で全部読める量のコードは強い",
      ],
      breaks: [
        `分類の仕組みがないまま${threeYear}件になると、探せない山になる。2年目あたりで「検索では足りない」と必ず言い出す`,
        "端末の中だけの保存は、いつか必ず飛ぶ。3年のうちに1回は事故が起きる前提で書き出しを習慣にすること",
      ],
      cost: ["維持はほぼ無料。ただし年1回の書き出しと、端末更改のときの移行だけは人の手が要る"],
    };
  }
  if (axis.id === "b") {
    return {
      works: [
        `${audience.who}の動きが記録として残るので、2年目から「前はどうしたか」が調べられる。引き継ぎの時間が目に見えて減る`,
        "手順が画面の形で固定されるため、新しく入った人の立ち上がりが早くなる",
        "同じ問い合わせ・同じ手戻りの数を数えられるようになる。改善の議論が印象論から数字に変わる",
      ],
      breaks: [
        "運用ルールを更新しないと、半年で「だれも入力しない項目」が出てくる。項目は増やすより減らすほうが難しい",
        "組織変更・様式変更のたびに直しが要る。年に数回は手を入れる前提で、直せる人を2人以上にしておくこと",
        "管理者が1人だけの状態が続くと、その人の異動でアプリごと消える。3年続ける気があるなら、これがいちばん大きな危険",
      ],
      cost: [
        `管理の手間は月1〜2時間（アカウント、問い合わせ、直し）。3年で60時間ほど。それに見合う効果が出る規模かどうかは、いまの${count}件からは判断できない`,
      ],
    };
  }
  return {
    works: [
      "記録が増えるほど、まとめ・分類の価値が上がる。人の手作業と逆に、年を追うほど楽になる",
      "定型の下書きが自動で出るようになると、判断だけに時間を使える。3年続けば、思考の時間そのものが増える",
    ],
    breaks: [
      "モデルやAPIの仕様変更で、出力の質が突然変わる。動いていたものが、ある日から使えなくなることがある",
      "機械の下書きに慣れると、自分で考えなくなる。3年経つと「自分の言葉で書けなくなる」のがいちばん高い代償",
      "費用は使った分だけ増える。使わなければ無駄、使えば費用。どちらでも心理的な抵抗が残る",
    ],
    cost: ["従量の費用に加えて、出力を点検する時間。自動化した工程ほど、点検を人が続けられるかが要になる"],
  };
}

function buildExit(axis, ctx) {
  if (axis.id === "a") return `2週間使って、書いた数が週${Math.max(3, Math.round(ctx.summary.perWeek))}件を下回ったらやめる。足りないのは機能ではなく、書く習慣のほうなので、作り足しても直らない。`;
  if (axis.id === "b") return `声をかけた人のうち半分が1か月使わなかったらやめる。「忙しいから」と言われたら、それは「必要ではない」という意味で、機能追加では覆らない。`;
  return `3回まとめさせて、そのまま使えた下書きが1回もなければやめる。費用がいくら安くても、直す手間のほうが高い。`;
}

function buildFirstStep(axis, ctx) {
  const pain = ctx.pains[0]?.text;
  if (axis.id === "a") return `紙かメモ帳で1週間、同じ運用をやってみる。${pain ? `とくに「${pain}」が本当に減るかどうかを見る。` : ""}減らないなら作らない。`;
  if (axis.id === "b") return `いちばん困っていそうな1人に、いまの${ctx.count}件を見せて「これがあったら使うか」を聞く。使うと言われてから作る。`;
  return `いまの${ctx.count}件をそのまま生成AIの画面に貼って、手で1回まとめさせてみる。結果に価値がなければ、アプリにしても価値は出ない。`;
}

function buildEffort(axis, count) {
  if (axis.id === "a") return "動く形まで 1〜2日（画面1つ・保存はブラウザの中）";
  if (axis.id === "b") return `動く形まで 1〜2週間（ログイン・権限・共有）＋合意を取る時間が同じくらい`;
  return `動く形まで 3〜5日（生成の呼び出しと確認画面）＋精度を確かめる時間。件数が${count}件では判断がつかないので、ためる期間も要る`;
}

function buildScores(axis, ctx) {
  const { count, themes } = ctx;
  const hasShare = themes.some((theme) => theme.id === "share");
  const hasAi = themes.some((theme) => theme.id === "ai" || theme.id === "auto");
  if (axis.id === "a") {
    return { build: 5, keep: count >= 10 ? 4 : 3, effect: themes.length <= 2 ? 3 : 2 };
  }
  if (axis.id === "b") {
    return { build: 2, keep: hasShare ? 3 : 2, effect: hasShare ? 4 : 2 };
  }
  return { build: 3, keep: 3, effect: hasAi && count >= 20 ? 4 : 2 };
}

function buildVerdict(axis, ctx, harsh) {
  const { count, themes, audience } = ctx;
  const hasShare = themes.some((theme) => theme.id === "share") || audience.id !== "self";
  const hasAi = themes.some((theme) => theme.id === "ai" || theme.id === "auto");

  if (axis.id === "a") {
    if (count < 8) return { tone: "ok", text: `いまの段階ではこれ一択。${count}件しかない状態で凝ったものを作っても、何が要るかは分からない。まずこれを作って、書き続けられるかを見る。` };
    return { tone: "ok", text: "小さく作って捨てられるので、迷うならここから。ただし2週間で習慣にならなければ、この方向自体が向いていない。" };
  }
  if (axis.id === "b") {
    if (!hasShare) return { tone: "bad", text: `メモの中に、人と分けたい話がほとんど出てきていない。いま作れば、だれも使わない共有画面の管理だけが残る。この案は当面いらない。` };
    if (count < 15) return { tone: "bad", text: `方向は合っているが早い。${count}件では、他人に見せる形が決められない。20件たまってから、この案に戻ること。` };
    return { tone: "ok", text: "効き目はいちばん大きいが、作る前に合意を取ること。技術ではなく、そこで決まる。" };
  }
  if (!hasAi) return { tone: "bad", text: "自動化したい話がメモにほとんど出ていない。手間の話が出てきていない段階での自動化は、作る側が楽しいだけで、使う場面がない。" };
  if (count < 20) return { tone: "bad", text: `やりたい気持ちは書かれているが、材料が${count}件では機械に渡す意味がない。まず量をためること。この案は3か月後に読み返す。` };
  return { tone: "ok", text: "材料は足りている。ただし費用と、外に出してよい内容かの確認を先にすること。" };
}

function buildAlternative(ctx, harsh) {
  const { themes, count, topic } = ctx;
  const tool = themes.some((theme) => theme.id === "share")
    ? "共有の表計算ファイル1枚"
    : themes.some((theme) => theme.id === "schedule" || theme.id === "remind")
      ? "端末のカレンダーとリマインダー"
      : "標準のメモアプリ";
  if (!harsh) return `作らずに ${tool} で代用する手もあります。`;
  return `作らない案：${tool}で足ります。${topic}まわりのメモが${count}件のうちは、道具ではなく続ける習慣のほうが不足しています。それでも作りたいなら理由は「自分の手に合わせたいから」であって、「効率のため」ではありません。そこを取り違えると、完成した日から開かなくなります。`;
}

function buildPlan(axis, ctx, harsh) {
  return {
    axis: axis.id,
    axisLabel: axis.label,
    name: pickName(ctx.nameBase, axis),
    lead: axis.id === "a"
      ? `${ctx.topic}まわりの思いつきを書き留めることだけに絞った、画面1つのアプリ。ほかは何もしない。`
      : axis.id === "b"
        ? `${ctx.topic}まわりの記録を${ctx.audience.who}と同じ画面で見て、状態と期限で回すためのアプリ。`
        : `ためた${ctx.topic}まわりのメモを機械にまとめさせ、人は採用するかどうかだけを決めるアプリ。`,
    scores: buildScores(axis, ctx),
    features: baseFeatures(axis, ctx.themes, ctx.audience),
    design: {
      pattern: axis.pattern,
      layout: axis.layout,
      wire: buildWire(axis, ctx.topic, ctx.audience),
      interaction: axis.interaction,
      palette: axis.palette,
      typography: axis.typography,
      motion: axis.motion,
    },
    pros: buildPros(axis, ctx),
    cons: buildCons(axis, ctx, harsh),
    longTerm: buildLongTerm(axis, ctx),
    exit: buildExit(axis, ctx),
    firstStep: buildFirstStep(axis, ctx),
    effort: buildEffort(axis, ctx.count),
    verdict: buildVerdict(axis, ctx, harsh),
    watch: ctx.themes.slice(0, 2).map((theme) => `${theme.label}：${theme.watch}`),
  };
}

/* --------------------------------------------------------------------------
   5. 入口
   -------------------------------------------------------------------------- */

export function analyze(ideas) {
  const keywords = countKeywords(ideas);
  const themes = detectThemes(ideas);
  const audience = detectAudience(ideas);
  const pains = detectPains(ideas);
  // 主題は、案の名前にも本文にも同じ語を使う（「共有メモ」なのに本文は「メモ」では読みにくい）
  const topic = pickNameBase(keywords, keywords[0]?.word ?? "思いつき");
  const summary = summarize(ideas, keywords, themes, audience, topic);
  return { keywords, themes, audience, pains, summary, count: ideas.length, topic, nameBase: topic };
}

export function proposeLocally(ideas, { harsh = true } = {}) {
  const ctx = analyze(ideas);
  return {
    id: `plan-${Date.now().toString(36)}`,
    createdAt: Date.now(),
    engine: "local",
    harsh,
    sourceCount: ideas.length,
    sourceIds: ideas.map((idea) => idea.id),
    quotes: ideas.slice(0, 3).map((idea) => idea.text.slice(0, 48)),
    summary: {
      headline: ctx.summary.headline,
      note: ctx.summary.note,
      keywords: ctx.summary.keywords,
      themes: ctx.summary.themes,
    },
    plans: AXES.map((axis) => buildPlan(axis, ctx, harsh)),
    alternative: buildAlternative(ctx, harsh),
  };
}

/* AI に書かせた結果も、この形にそろえてから画面に渡す。
   欠けている項目は、その場では埋めずに空にする（作り話を混ぜないため）。 */
export function normalizePlanSet(raw, { ideas, harsh }) {
  const asList = (value, max = 8) =>
    (Array.isArray(value) ? value : [])
      .map((item) => String(item ?? "").trim())
      .filter(Boolean)
      .slice(0, max);
  const asText = (value) => String(value ?? "").trim();

  const plans = (Array.isArray(raw?.plans) ? raw.plans : []).slice(0, 3).map((plan, index) => {
    const axis = AXES[index] ?? AXES[0];
    const design = plan?.design ?? {};
    const palette = (Array.isArray(design.palette) ? design.palette : [])
      .map((entry) => ({
        hex: /^#[0-9a-fA-F]{3,8}$/.test(String(entry?.hex ?? "")) ? entry.hex : null,
        role: asText(entry?.role),
      }))
      .filter((entry) => entry.hex)
      .slice(0, 4);
    const long = plan?.longTerm ?? {};
    return {
      axis: axis.id,
      axisLabel: asText(plan?.axisLabel) || axis.label,
      name: asText(plan?.name) || `案${index + 1}`,
      lead: asText(plan?.lead),
      scores: {
        build: Number(plan?.scores?.build) || 3,
        keep: Number(plan?.scores?.keep) || 3,
        effect: Number(plan?.scores?.effect) || 3,
      },
      features: asList(plan?.features),
      design: {
        pattern: asText(design.pattern) || axis.pattern,
        layout: asText(design.layout) || axis.layout,
        wire: (Array.isArray(design.wire) ? design.wire : []).slice(0, 6).map((row) => ({
          tag: asText(row?.tag).slice(0, 6) || "画面",
          text: asText(row?.text),
        })),
        interaction: asText(design.interaction) || axis.interaction,
        palette: palette.length ? palette : axis.palette,
        typography: asText(design.typography) || axis.typography,
        motion: asText(design.motion) || axis.motion,
      },
      pros: asList(plan?.pros),
      cons: asList(plan?.cons),
      longTerm: {
        works: asList(long.works),
        breaks: asList(long.breaks),
        cost: asList(long.cost, 4),
      },
      exit: asText(plan?.exit),
      firstStep: asText(plan?.firstStep),
      effort: asText(plan?.effort),
      verdict: {
        tone: plan?.verdict?.tone === "ok" ? "ok" : "bad",
        text: asText(plan?.verdict?.text),
      },
      watch: asList(plan?.watch, 3),
    };
  });

  if (plans.length < 3) throw new Error("案が3つそろいませんでした");

  return {
    id: `plan-${Date.now().toString(36)}`,
    createdAt: Date.now(),
    engine: "ai",
    harsh,
    sourceCount: ideas.length,
    sourceIds: ideas.map((idea) => idea.id),
    quotes: ideas.slice(0, 3).map((idea) => idea.text.slice(0, 48)),
    summary: {
      headline: asText(raw?.summary?.headline) || `${ideas.length}件のメモから`,
      note: asText(raw?.summary?.note),
      keywords: asList(raw?.summary?.keywords, 8),
      themes: asList(raw?.summary?.themes, 5),
    },
    plans,
    alternative: asText(raw?.alternative),
  };
}
