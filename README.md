# nomy24

相模原市南区で使うウェブアプリを置いているリポジトリです。
GitHub Pages で公開していて、入口は <https://nomy24.github.io/nomy24/> です。

## アプリ

| アプリ | 場所 | 内容 |
| --- | --- | --- |
| [南区インフォ](sagamihara-minami/) | `sagamihara-minami/` | 相模原市の新着情報をまとめて読むアプリ。だれでも見られます |
| [職員Todo](staff-todo/) | `staff-todo/` | Todo・カレンダー・定型タスク・資料・電話メモを職員で共有するアプリ。ログインが必要です |

どちらもスマートフォン向けの PWA で、ホーム画面に追加するとアプリとして起動します。
ビルドは不要で、HTML・CSS・JavaScript をそのまま置いています。
使い方や設定は、それぞれのフォルダの README を見てください。

## 構成

アプリごとにフォルダを分け、**そのアプリでしか使わないものは、そのフォルダの中に入れる**方針です。
新しいアプリを足すときも、フォルダを1つ増やして上の表に行を足してください。

```
index.html            入口（アプリ一覧）
sagamihara-minami/    南区インフォ
  config/             取得元・地名・カテゴリの設定
  scripts/            新着情報を取り込むスクリプト
  data/news.json      取り込んだお知らせ（自動更新）
staff-todo/           職員Todo
  firestore.rules     Firestore の権限設定（コンソールに貼るか firebase deploy で反映）
drill/                実装力カルテ（staff-todo を教材にした自習用。アプリではない）
.github/workflows/    自動実行の設定（リポジトリ全体で共有）
```

`drill/` は入口ページのアプリ一覧には載せていません。自習用なので、
`https://nomy24.github.io/nomy24/drill/` を直接開いて使います。

## 自動更新

`.github/workflows/update-minami-news.yml` が1日2回（日本時間 7:00 / 19:00）、
南区インフォの新着情報を取り込んで `sagamihara-minami/data/news.json` に書き込みます。
手元で試すときは次のように実行します。

```sh
node sagamihara-minami/scripts/fetch-news.mjs            # 取得して news.json を更新
node sagamihara-minami/scripts/fetch-news.mjs --dry-run  # 書き込まずに結果だけ確認
node sagamihara-minami/scripts/fetch-news.mjs --offline  # 通信せず既存データから作り直す
```

取り込みが動いているかどうかは、入口ページで確認できます。
南区インフォの行に最終更新の時刻と件数が出ていて、36時間を超えて更新がないと警告に変わります。

## 公開の設定

**Settings › Pages** で **Source** を `Deploy from a branch`、
ブランチ `main` / フォルダ `/ (root)` にしています。
`main` に入った内容がそのまま公開されます。

## 注意

このサイトは相模原市が運営するものではありません。
表示している内容は市公式ホームページの見出しです。
実際の手続きや日程は、必ずリンク先の公式ページでご確認ください。
