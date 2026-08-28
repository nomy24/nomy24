/* アイデア貯蔵庫 — AIに考えさせるとき（任意）
   使うと決めたときだけ動く。キーはこの端末の localStorage にだけ置き、
   送り先は api.anthropic.com 以外にない。ふだんの提案は propose.js が端末内で作る。 */

import { normalizePlanSet } from "./propose.js";

const ENDPOINT = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";

const SCHEMA_HINT = `{
  "summary": { "headline": "20字程度の見立て", "note": "偏りや不足を指摘する2〜3文", "keywords": ["語"], "themes": ["やりたいことの分類"] },
  "plans": [
    {
      "axisLabel": "案の方向（例：いちばん小さく）",
      "name": "アプリ名",
      "lead": "1〜2文の説明",
      "scores": { "build": 1, "keep": 1, "effect": 1 },
      "features": ["主な機能"],
      "design": {
        "pattern": "画面の型",
        "layout": "情報の並べ方",
        "wire": [{ "tag": "上", "text": "そこに置くもの" }],
        "interaction": "操作の核",
        "palette": [{ "hex": "#123456", "role": "何に使う色か" }],
        "typography": "文字の扱い",
        "motion": "動きの扱い"
      },
      "pros": ["よい点"],
      "cons": ["悪い点"],
      "longTerm": { "works": ["長く使うほど効く点"], "breaks": ["時間とともに壊れる点"], "cost": ["維持にかかるもの"] },
      "exit": "やめる条件",
      "firstStep": "作る前に試すこと",
      "effort": "ざっくりの作業量",
      "verdict": { "tone": "ok または bad", "text": "率直な判定" },
      "watch": ["設計上の注意"]
    }
  ],
  "alternative": "そもそも作らずに済ませる案"
}`;

function buildPrompt(ideas, harsh) {
  const list = ideas
    .map((idea, index) => `${index + 1}. ${idea.text}${idea.tags.length ? `（タグ: ${idea.tags.join(", ")}）` : ""}`)
    .join("\n");

  return `あなたは、個人開発と業務システムの両方を見てきた設計者です。
下は、ある人が思いつくままにためたメモです。メモは断片で、文章として整っていません。

<メモ>
${list}
</メモ>

このメモをもとに、方向性がはっきり違うアプリ案を3つ立ててください。3つは必ず次の順で、性格を分けます。
1つめ「いちばん小さく」= 機能を1つに絞って、数日で作れるもの
2つめ「仕事に組み込む」= 人と共有し、業務の流れに乗せるもの
3つめ「機械にやらせる」= 自動化や生成AIで、人がやらない領域に踏み込むもの

書き方の決まり:
- メモに実際に出てきた言葉を使うこと。一般論だけの案は書かない。
- デザイン案は、配色（実際の16進数）、画面の並び、操作の核まで具体的に書く。
- ${harsh
    ? "欠点は容赦なく書く。おだてない。作るべきでないと思う案には、はっきり「作るべきでない」と書き、その理由を数字か事実で示す。"
    : "欠点も、事実として淡々と書く。"}
- 業務で使う場合の長期（3年）の視点を必ず入れる。効いてくる点、時間とともに壊れる点、維持にかかる手間の3つを分けて書く。
- 「やめる条件」は、感想ではなく数えられる条件で書く。
- 日本語で書く。専門用語には短い言い換えを添える。

出力はJSONだけ。説明文やコードブロックの記号は付けない。形は次のとおり:
${SCHEMA_HINT}`;
}

function parseJson(text) {
  const trimmed = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // 前後に文章が付いてしまったとき用に、いちばん外側の { } だけ取り出す
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start === -1 || end <= start) throw new Error("返ってきた内容を読み取れませんでした");
    return JSON.parse(trimmed.slice(start, end + 1));
  }
}

export async function proposeWithAi(ideas, { apiKey, model, harsh, signal }) {
  if (!apiKey) throw new Error("APIキーが設定されていません");

  let response;
  try {
    response = await fetch(ENDPOINT, {
      method: "POST",
      signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": API_VERSION,
        // ブラウザから直に呼ぶための指定。キーはこの端末から出ない。
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model,
        max_tokens: 8000,
        messages: [
          { role: "user", content: buildPrompt(ideas, harsh) },
          // 出だしを固定して、前置きなしでJSONを書かせる
          { role: "assistant", content: "{" },
        ],
      }),
    });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw new Error("つながりませんでした。通信を確かめてください");
  }

  if (!response.ok) {
    if (response.status === 401) throw new Error("APIキーが違うようです");
    if (response.status === 429) throw new Error("回数の上限に当たりました。少し待ってからもう一度");
    if (response.status >= 500) throw new Error("相手側が混んでいます。少し待ってからもう一度");
    throw new Error(`うまくいきませんでした（${response.status}）`);
  }

  const payload = await response.json();
  const text = (payload?.content ?? [])
    .filter((block) => block?.type === "text")
    .map((block) => block.text)
    .join("");

  const raw = parseJson("{" + text);
  return normalizePlanSet(raw, { ideas, harsh });
}
