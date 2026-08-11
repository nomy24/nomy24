import { firebaseConfig } from "./firebase-config.js";

const isPlaceholder = Object.values(firebaseConfig).some((v) => String(v).includes("REPLACE_ME"));

export const isConfigured = !isPlaceholder;

let dbExports = null;

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
    await new Promise((resolve, reject) => {
      const unsub = authMod.onAuthStateChanged(auth, (user) => {
        if (user) {
          unsub();
          resolve(user);
        }
      }, reject);
      authMod.signInAnonymously(auth).catch(reject);
    });
    dbExports = { db, firestore, auth };
    return dbExports;
  } catch (e) {
    console.error("Firebase の初期化に失敗しました", e);
    return null;
  }
}

export const ready = boot();
