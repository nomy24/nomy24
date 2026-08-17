// Firestore セキュリティルールのテスト。
//
// 実行するとエミュレータ（ローカルの偽 Firestore）が立ち上がり、
// 「他人になりすませるか」「自分を管理者にできるか」を実際に試して確かめる。
//
//   npm run test:rules
//
// 本番の Firebase には一切つながらないので、何度実行しても安全。

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, deleteDoc } from "firebase/firestore";

const here = dirname(fileURLToPath(import.meta.url));

const HANAKO = "hanako@example.com"; // 職員A（ログイン済み）
const TARO = "taro@example.com";     // 職員B（ログイン済み）

let testEnv;

/** 指定したメールアドレスでログインした状態の Firestore を返す */
function as(email) {
  return testEnv.authenticatedContext(email, { email, email_verified: true }).firestore();
}

/** 未ログイン状態の Firestore を返す */
function asGuest() {
  return testEnv.unauthenticatedContext().firestore();
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "staff-todo-rules-test",
    firestore: {
      rules: readFileSync(join(here, "..", "firestore.rules"), "utf8"),
      host: "127.0.0.1",
      port: 8080,
    },
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  // 前提データはルールを迂回して入れる（セットアップ自体はテスト対象ではない）
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "staff", "s-hanako"), { name: "花子", email: HANAKO, color: "#0d9488", order: 1 });
    await setDoc(doc(db, "staff", "s-taro"), { name: "太郎", email: TARO, color: "#ea580c", order: 2 });
    await setDoc(doc(db, "staff", "s-unlinked"), { name: "未登録", email: null, color: "#2563eb", order: 3 });
    await setDoc(doc(db, "staff", "s-admin"), { name: "管理者", email: "kanri@example.com", isAdmin: true, order: 0 });
    await setDoc(doc(db, "todos", "t-1"), { title: "申し送りを書く", done: false });
  });
});

describe("アカウントを持たない第三者", () => {
  test("職員一覧を読めない", async () => {
    await assertFails(getDoc(doc(asGuest(), "staff", "s-taro")));
  });

  test("Todo を書き込めない", async () => {
    await assertFails(setDoc(doc(asGuest(), "todos", "t-2"), { title: "侵入" }));
  });
});

describe("ログイン済みの職員どうしの境界", () => {
  test("【本題】他人の職員データを削除できない", async () => {
    await assertFails(deleteDoc(doc(as(HANAKO), "staff", "s-taro")));
  });

  test("【本題】他人の doc のメールを自分のものに書き換えて、なりすませない", async () => {
    await assertFails(updateDoc(doc(as(HANAKO), "staff", "s-taro"), { email: HANAKO }));
  });

  test("【本題】自分を管理者に昇格できない", async () => {
    await assertFails(updateDoc(doc(as(HANAKO), "staff", "s-hanako"), { isAdmin: true }));
  });

  test("他人を管理者に昇格させることもできない", async () => {
    await assertFails(updateDoc(doc(as(HANAKO), "staff", "s-taro"), { isAdmin: true }));
  });

  test("既存の管理者から管理者フラグを剥がせない", async () => {
    await assertFails(updateDoc(doc(as(HANAKO), "staff", "s-admin"), { isAdmin: false }));
  });

  test("管理者フラグを立てた状態で職員を新規作成できない", async () => {
    await assertFails(
      setDoc(doc(as(HANAKO), "staff", "s-new"), { name: "偽管理者", email: HANAKO, isAdmin: true })
    );
  });

  test("自分のメールも、一度紐付いた後は変更できない", async () => {
    await assertFails(updateDoc(doc(as(HANAKO), "staff", "s-hanako"), { email: "another@example.com" }));
  });
});

describe("今までどおりできること（塞ぎすぎていないか）", () => {
  test("自分の職員データは削除できる", async () => {
    await assertSucceeds(deleteDoc(doc(as(HANAKO), "staff", "s-hanako")));
  });

  test("未リンクの職員は誰でも削除できる", async () => {
    await assertSucceeds(deleteDoc(doc(as(HANAKO), "staff", "s-unlinked")));
  });

  test("他人の名前・色・職種グループは直せる", async () => {
    await assertSucceeds(
      updateDoc(doc(as(HANAKO), "staff", "s-taro"), { name: "太郎（訂正）", color: "#7c3aed" })
    );
  });

  test("同僚を新規登録できる（メール付き・管理者フラグなし）", async () => {
    await assertSucceeds(
      setDoc(doc(as(HANAKO), "staff", "s-new"), { name: "次郎", email: "jiro@example.com", order: 4 })
    );
  });

  test("未リンクの職員に後からメールを紐付けられる", async () => {
    await assertSucceeds(
      updateDoc(doc(as(HANAKO), "staff", "s-unlinked"), { email: "shin@example.com" })
    );
  });

  test("Todo は全員で読み書きできる", async () => {
    await assertSucceeds(getDoc(doc(as(TARO), "todos", "t-1")));
    await assertSucceeds(setDoc(doc(as(TARO), "todos", "t-2"), { title: "体操の準備", done: false }));
  });

  test("電話メモ・資料・定型タスクも全員で読み書きできる", async () => {
    await assertSucceeds(setDoc(doc(as(TARO), "phoneMemos", "m-1"), { body: "ご家族から連絡" }));
    await assertSucceeds(setDoc(doc(as(TARO), "photos", "p-1"), { name: "献立表" }));
    await assertSucceeds(setDoc(doc(as(TARO), "routineTasks", "r-1"), { title: "水分チェック" }));
  });

  test("合言葉は読める（起動時に全端末が読むため）", async () => {
    await assertSucceeds(getDoc(doc(as(TARO), "appConfig", "main")));
  });
});

describe("ルールに書いていないコレクション", () => {
  test("拒否される", async () => {
    await assertFails(setDoc(doc(as(HANAKO), "secrets", "x"), { a: 1 }));
  });
});
