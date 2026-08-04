# 南区インフォ

相模原市南区の新着情報をスマートフォンでまとめて確認できる Web アプリです。
新しいお知らせが増えると、画面右上のベルにバッジが付きます。

## できること

| 要望 | この実装 |
| --- | --- |
| 爽やかで直感的なUI | 市の花「あじさい」に由来する淡い水色の配色。見出しは明朝、本文はゴシック。日付ごとの見出しで上から順に読める |
| スマートフォンで閲覧 | モバイル優先のレイアウト、親指で届く下部タブ、ホーム画面に追加できる PWA、オフライン表示、ダークモード対応 |
| 更新をお知らせマークで通知 | ベルのバッジに未読件数。押すと新着だけを表示。端末の通知もオン／オフできる |
| 定期的に更新 | GitHub Actions が1日2回（日本時間 7:00 / 19:00）に自動取得。アプリ側も一定間隔で更新を確認する |

そのほか、カテゴリでの絞り込み、キーワード検索、お知らせの保存、文字の拡大に対応しています。

## 公開する

GitHub Pages を有効にすると、そのまま公開できます。

1. リポジトリの **Settings › Pages** を開く
2. **Source** で `Deploy from a branch` を選び、ブランチ `main` / フォルダ `/ (root)` を指定
3. 数分後に `https://<ユーザー名>.github.io/<リポジトリ名>/sagamihara-minami/` で開けます

スマートフォンで開いて「ホーム画面に追加」すると、アプリとして起動します。

## 情報を更新する

### 自動更新

`.github/workflows/update-minami-news.yml` が定期的に `scripts/fetch-news.mjs` を実行し、
`sagamihara-minami/data/news.json` に変更があるときだけコミットします。
初回は **Actions › Update Sagamihara Minami news › Run workflow** から手動で実行してください。

### 手動で実行する

```sh
node scripts/fetch-news.mjs            # 取得して news.json を更新
node scripts/fetch-news.mjs --dry-run  # 書き込まずに結果だけ確認
node scripts/fetch-news.mjs --offline  # 通信せず既存データから作り直す
```

Node.js 20 以上が必要です。外部パッケージは使っていません。

### 取得のしくみ

取得元は相模原市公式ホームページの RSS **<https://www.city.sagamihara.kanagawa.jp/rss.rss>** です
（市の [RSS配信ページ](https://www.city.sagamihara.kanagawa.jp/about/rss.html) で案内されている唯一のフィードで、
市全体の更新情報が約250件入っています）。

1. `config/sources.json` の `feeds` を読みに行く
2. `feeds` が空、または全部失敗したら、市サイトを走査して RSS を自動的に探し、
   見つかった URL を `config/sources.json` に書き戻す（次回からはそれを使う）
3. RSS がまったく取れないときは、更新情報ページの HTML から「日付＋リンク」を拾う
4. 前回の `news.json` と突き合わせ、初回に見つけた時刻（`firstSeenAt`）を保ったまま出力する

このフィードは `description` が空で、判断材料がタイトルと URL しかありません。
そのため記事の URL のパス（`/minamiku/`、`/kosodate/`、`/kurashi/1026529/bousai/` など）も
地域・カテゴリの手がかりとして使っています（`config/sources.json` の `pathRules`）。

一時的にサイトへつながらなくても、既存のデータは消えません。
すべて失敗した実行は、ファイルを書き換えずに終了コード 1 で終わります。

### 南区の記事の選び方

`config/sources.json` の `areas` に地名のキーワードを並べてあります。

- 南区の地名を含む記事 → `scope: "minami"`（「南区」表示に出る）
- どの区の地名も含まない全市向けの記事 → `scope: "citywide"`（「市全体」表示に出る）
- 中央区・緑区だけに関わる記事 → 取り込まない

警報・避難など `importantKeywords` に当たる記事は、地域の絞り込みに関わらず必ず表示します。

地名やカテゴリを増やしたいときは `config/sources.json` を編集してください。次回の実行から反映されます。

## 通知について

- **アプリ内**: ベルのバッジは常に動きます。設定は不要です。
- **端末の通知**: 設定画面でオンにすると、アプリを開いている間の新着を端末の通知で知らせます。
- **アプリを閉じている間**: ホーム画面に追加した状態かつ対応ブラウザ（Android の Chrome など）では、
  バックグラウンドでも定期的に確認します。iOS では、アプリを開いたときに新着を確認します。

サーバーを持たない静的サイトのため、Web Push は使っていません。

## ファイル

```
sagamihara-minami/
  index.html            画面
  app.css               配色・レイアウト
  app.js                描画と新着チェック
  sw.js                 オフライン表示とバックグラウンド確認
  manifest.webmanifest  ホーム画面に追加するための設定
  data/news.json        取得したお知らせ（自動更新）
config/sources.json     取得元・地名・カテゴリの設定
scripts/fetch-news.mjs  更新スクリプト
scripts/lib/            XML・HTTP・分類の処理
```

## 注意

このアプリは相模原市が運営するものではありません。表示している内容は市公式ホームページの見出しです。
実際の手続きや日程は、必ずリンク先の公式ページでご確認ください。
