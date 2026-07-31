# 写真の入れかた

このフォルダに写真を入れて、`../index.html` のプレースホルダーを置きかえてください。

## 1. 写真をこのフォルダに置く

```
baby-album/photos/01.jpg
baby-album/photos/02.jpg
...
```

推奨: **WebP または AVIF**（JPEG より 25〜50% 軽くなります）、長辺 1600px 程度。

## 2. `index.html` のプレースホルダーを置きかえる

`.card-photo` の中身（SVGアイコンと「写真をここに」）を、まるごとこの1行にします。

```html
<div class="card-photo">
  <img src="photos/01.jpg"
       alt="ベビーベッドで眠っている赤ちゃん"
       width="800" height="1000"
       loading="lazy" decoding="async">
</div>
```

`role="img"` と `aria-label` は `<img>` に置きかえたら不要なので消してください。

## 3. かならず守ること

| 項目 | 理由 |
|---|---|
| `alt` に写真の内容を書く | スクリーンリーダー利用者のため（`alt=""` は装飾画像だけ） |
| `width` / `height` を書く | 読み込み時のガタつき（CLS）を防ぐ |
| `loading="lazy"` を付ける | 画面外の写真を後回しにして初期表示を速く |
| 1枚目だけは `loading="eager"` | 最初に見える写真は遅延させない |

カードの `data-title` / `data-date` / `data-caption` を書きかえると、
一覧と拡大表示（ライトボックス）の両方に反映されます。
