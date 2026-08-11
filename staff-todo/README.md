# 職員Todo（スマホ向け・4名共有）

スマートフォンのブラウザで開いて使う、職員4名共有のTodoアプリです。
LINEなどでURLを共有するだけで、全員が同じタスクリストをリアルタイムに見られます。

- タスクの追加・完了・削除
- 担当者の割り当て
- 期限日の設定（期限超過は赤色で表示）
- ステータス（すべて／未完了／完了）と担当者での絞り込み

データはFirebase（Firestore）の無料枠に保存され、サーバーの用意は不要です。

## セットアップ手順

### 1. Firebaseプロジェクトを作成する

1. https://console.firebase.google.com/ にアクセスし、Googleアカウントでログイン
2. 「プロジェクトを追加」→ プロジェクト名を入力（例: staff-todo）して作成
   （Googleアナリティクスは不要なので無効のままでOK）

### 2. Firestore Databaseを有効にする

1. 左メニューの「構築」→「Firestore Database」を開く
2. 「データベースの作成」をクリック
3. ロケーションを選択（asia-northeast1 = 東京 がおすすめ）
4. モードは「テストモードで開始」を選択（後述のルールに置き換えます）

### 3. セキュリティルールを設定する

「Firestore Database」→「ルール」タブを開き、以下に置き換えて公開します。

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /tasks/{taskId} {
      allow read, write: if true;
    }
  }
}
```

> **注意**: このルールはURLとプロジェクト情報を知っていれば誰でも読み書きできる、
> 4名程度の身内利用を想定した簡易設定です。URLは職員4名以外に共有しないでください。
> より厳格に守りたい場合はFirebase Authentication（メールリンク認証など）の追加を検討してください。

### 4. ウェブアプリを追加し、設定値を取得する

1. プロジェクトの概要画面 →「</> (ウェブ)」アイコンをクリックしてアプリを登録
2. アプリ名を入力して登録（Firebase Hostingの設定は不要、スキップでOK）
3. 表示される `firebaseConfig` の値をコピー

### 5. 設定ファイルを作成する

`staff-todo/firebase-config.example.js` を `staff-todo/firebase-config.js` という名前でコピーし、
手順4で取得した値を貼り付けてください。

```bash
cp firebase-config.example.js firebase-config.js
```

`firebase-config.js` は `.gitignore` 済みなのでリポジトリには含まれません。

### 6. 担当者名を設定する

`staff-todo/app-config.js` の `STAFF_NAMES` を実際の職員名（4名）に書き換えてください。

```js
export const STAFF_NAMES = ["山田", "佐藤", "鈴木", "田中"];
```

## 公開・共有方法

GitHub Pagesなどで `staff-todo/index.html` を配信すればスマホから開けるようになります。
発行されたURLをLINEのグループなどで共有してください。

ローカルで確認する場合は `firebase-config.js` 作成後、`staff-todo` フォルダで簡易サーバーを起動してください
（ESモジュールを使用しているため `file://` で直接開くと動作しません）。

```bash
npx serve .
# または
python3 -m http.server 8000
```
