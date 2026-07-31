# すくすくアルバム — デザインシステム

`ui-ux-pro-max` の検索結果をもとに決めた内容と、その根拠を残しています。

## 元になった検索結果

| 項目 | 採用したもの | 出どころ |
|---|---|---|
| プロダクト種別 | Museum/Gallery（Minimalism + Motion-Driven, Storytelling） | `--domain product "photo gallery album memories"` |
| カラー | Parenting & Baby Tracker（ソフトピンク + トラストブルー） | `--domain color "soft pastel warm baby nursery"` |
| タイポグラフィ | Varela Round（見出し） / Nunito Sans（本文） | `--design-system` |
| スタイル | Claymorphism（角丸16-24px、やわらかい二重シャドウ） | `--design-system` |
| モーション | Stagger List / Standard（300-450ms, back.out） | `--motion 4` |
| 余白 | Standard（16-64px スケール） | `--density 4` |

## DBの推奨から変えたところ

### 1. プライマリを `#EC4899` → `#DB2777`

DB のプライマリ `#EC4899` は白背景でコントラスト **3.5:1** しかなく、
本文・ボタン文字に必要な 4.5:1 を満たしません。
操作系（ボタン・リンク・チップ）は `#DB2777`（**4.6:1**）に落とし、
`#EC4899` は装飾（グラデーション・ハート）専用の `--color-primary-soft` にしました。

> 優先度表で Accessibility(1) は Style/Color(4,6) より上位のため、DBの値よりコントラストを優先。

### 2. パターンは Hero + Testimonials + CTA を採用しない

`--design-system` の初回結果は LP 向けのパターンでしたが、
これは個人のアルバムであり、証言も CTA も存在しません。
Museum/Gallery の「コンテンツを主役にする」構成に差し替えました。

### 3. GSAP を使わず CSS + IntersectionObserver

モーション提案は GSAP の Stagger List でしたが、この repo はビルドなしの素の HTML/CSS です。
外部ライブラリを増やさず、同じ表現（`opacity/transform` + 60ms ずつの遅延）を
CSS トランジションと IntersectionObserver で実装しています。

## トークン

| 種類 | 値 |
|---|---|
| 背景 / 面 | `#FDF2F8` / `#FFFFFF` |
| 文字 / 補助文字 | `#0F172A` / `#64748B` |
| プライマリ（操作系） | `#DB2777` |
| 装飾ピンク | `#EC4899` |
| アクセント | `#0284C7` |
| 角丸 | 12 / 18 / 26 / 999px |
| 余白 | 8 / 16 / 24 / 40 / 64px |
| モーション | 220ms `cubic-bezier(.22,.61,.36,1)` |

ダークモードは `prefers-color-scheme` で全トークンを差し替えます。
写真プレースホルダーのタイル色（`--tile-1` / `--tile-2`）も、
ライト定義の**後ろ**にダーク定義を置いて上書きしています（順序を逆にすると効きません）。

## レイアウト

モバイルファースト。カラム数のみブレークポイントで切り替えます。

| 幅 | カラム |
|---|---|
| ～767px | 2 |
| 768px～ | 3 |
| 1024px～ | 4 |

## 検証済みチェックリスト

実機（Chromium）で計測して確認したもの。

- [x] タッチ領域 44×44px 以上（チップ 44px / ライトボックスのボタン 44×44 / カード 161×303）
- [x] 375 / 768 / 1024 / 1440px で横スクロールなし
- [x] キーボード操作：Tab の先頭がスキップリンク、フォーカスリング表示
- [x] ライトボックスは `<dialog>`：Esc で閉じる・フォーカストラップ・**閉じたら元のカードにフォーカスが戻る**
- [x] ← → キーで前後の写真へ（絞り込み中はその範囲内で循環）
- [x] 背景クリックで閉じる
- [x] 文字コントラスト 4.5:1 以上（ライト／ダーク両方）
- [x] `prefers-reduced-motion` でアニメーション無効化
- [x] 画像は `aspect-ratio` で場所を確保（CLS 対策）
- [x] アイコンは SVG（絵文字を使わない）
- [x] JS なしでも全カードが表示される（`.js` クラスが付いたときだけ遅延表示）

## つまずいた点（メモ）

`style.css` の先頭に Google Fonts の `@import` を書いていたところ、
**フォント取得が終わるまで `app.js` が実行されない**状態になっていました
（スクリプトは保留中のスタイルシートを待つため。`document.readyState` が `loading` のまま）。
`<link>` + `media="print"` → `onload` で `media='all'` に切り替える形にして、
描画も JS も止めないようにしています。
