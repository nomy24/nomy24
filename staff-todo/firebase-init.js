import { firebaseConfig } from "./firebase-config.js";

const isPlaceholder = Object.values(firebaseConfig).some((v) => String(v).includes("REPLACE_ME"));

export const isConfigured = !isPlaceholder;

let dbExports = null;

// 匿名サインインはせず、SDKの初期化だけ行う。
// ログイン（メール+パスワード）はアプリ側からの明示的な signIn() 呼び出しで行う。
async function boot() {
  if (isPlaceholder) return null;
  try {
    const [{ initializeApp }, firestore, authMod] = await Promise.all([
      import("https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js"),
      import("https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js"),
      import("https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js"),
    ]);
    const app = initializeApp(firebaseConfig);
    const db = firestore.getFirestore(app);
    try {
      await firestore.enableIndexedDbPersistence(db);
    } catch (e) {
      // 複数タブで開いている場合などは失敗することがあるが、致命的ではない
      console.warn("オフラインキャッシュを有効にできませんでした", e);
    }
    const auth = authMod.getAuth(app);
    dbExports = { db, firestore, auth, authMod };
    return dbExports;
  } catch (e) {
    console.error("Firebase の初期化に失敗しました", e);
    return null;
  }
}

export const ready = boot();

export async function signIn(email, password) {
  const fb = await ready;
  if (!fb) throw new Error("Firebase が初期化されていません");
  return fb.authMod.signInWithEmailAndPassword(fb.auth, email, password);
}

export async function signOutUser() {
  const fb = await ready;
  if (!fb) return;
  return fb.authMod.signOut(fb.auth);
}

// user引数はFirebaseのUserオブジェクト、未ログインならnull
export async function onAuthChange(cb) {
  const fb = await ready;
  if (!fb) { cb(null); return () => {}; }
  return fb.authMod.onAuthStateChanged(fb.auth, cb);
}
