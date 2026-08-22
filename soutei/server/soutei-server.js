#!/usr/bin/env node
/*
 * デイサービス送迎表 保存サーバー
 *
 * 事業所の PC 1台で動かし、同じネットワークの端末から使う。
 * データはこの PC の中（data フォルダ）にだけ置かれ、外には出ない。
 *
 * 使い方:  node soutei-server.js
 * 停止   :  この黒い画面で Ctrl + C
 *
 * 追加のインストールは不要（Node.js に最初から入っている機能だけで動く）。
 * データベースも使わない。1日ぶんの送迎表が1個のファイルになるだけ。
 */

"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || process.argv[2] || 8080);
const HERE = __dirname;
const DATA = path.join(HERE, "data");

/* 送迎表の本体。サーバーと同じ場所か、1つ上の場所を見る */
const APP_CANDIDATES = [
  path.join(HERE, "index.html"),
  path.join(HERE, "..", "index.html"),
  path.join(HERE, "送迎表.html")
];

function appFile() {
  for (const p of APP_CANDIDATES) { if (fs.existsSync(p)) return p; }
  return null;
}

/* ── 保存 ─────────────────────────────────
   鍵1つにつきファイル1つ。中身は { rev, updatedAt, data }。
   rev は書き換えるたびに1つ増える番号で、
   「他の端末が先に直していないか」の判定に使う。 */

const KEY_OK = /^[A-Za-z0-9_.\-]{1,120}$/;
const fileOf = (key) => path.join(DATA, key + ".json");

function readDoc(key) {
  try {
    const raw = fs.readFileSync(fileOf(key), "utf8");
    const doc = JSON.parse(raw);
    if (!doc || typeof doc !== "object") return null;
    return { rev: Number(doc.rev) || 0, updatedAt: doc.updatedAt || "", data: doc.data };
  } catch (e) { return null; }
}

/* 書きかけのファイルが残らないよう、別名で書いてから置き換える */
function writeDoc(key, doc) {
  const target = fileOf(key);
  const tmp = target + ".tmp-" + process.pid + "-" + Date.now();
  fs.writeFileSync(tmp, JSON.stringify(doc), "utf8");
  fs.renameSync(tmp, target);
}

function listDocs() {
  const out = { docs: {}, days: [] };
  let names = [];
  try { names = fs.readdirSync(DATA); } catch (e) { return out; }
  names.forEach((n) => {
    if (!n.endsWith(".json")) return;
    const key = n.slice(0, -5);
    if (!KEY_OK.test(key)) return;
    const doc = readDoc(key);
    if (!doc) return;
    out.docs[key] = doc.rev;
    if (key.startsWith("day.")) out.days.push(key.slice(4));
  });
  out.days.sort();
  return out;
}

/* ── 合言葉 ───────────────────────────────
   同じネットワークに入れる人なら誰でも読めてしまう状態を避ける。
   初回に1つ作ってファイルに置き、端末ごとに1度だけ入れてもらう。
   紛らわしい字（0 O 1 I l）は外して、読み上げても間違えないようにする。 */

const KEYFILE = path.join(DATA, "合言葉.txt");
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function makePass() {
  const pick = () => ALPHABET[crypto.randomInt(ALPHABET.length)];
  const group = () => Array.from({ length: 4 }, pick).join("");
  return group() + "-" + group() + "-" + group();
}

function loadPass() {
  try {
    const v = fs.readFileSync(KEYFILE, "utf8").trim();
    if (v) return { pass: v, fresh: false };
  } catch (e) { /* まだ無い */ }
  /* 合言葉は起動のいちばん初めに要るので、置き場所もここで作る */
  try { fs.mkdirSync(DATA, { recursive: true }); }
  catch (e) {
    console.error("data フォルダを作れませんでした:", e.message);
    process.exit(1);
  }
  const pass = makePass();
  /* 中身は本人だけが読めるようにする（Windows では効かないので、
     フォルダごと人目に付かない場所に置いてください） */
  fs.writeFileSync(KEYFILE, pass + "\n", { encoding: "utf8", mode: 0o600 });
  return { pass: pass, fresh: true };
}

const AUTH = loadPass();

/* 長さの違いや前半一致から絞り込まれないよう、
   一定時間で比べる（ハッシュにしてから突き合わせる） */
const digest = (s) => crypto.createHash("sha256").update(String(s), "utf8").digest();
const PASS_HASH = digest(AUTH.pass);

function passOK(given) {
  if (!given) return false;
  return crypto.timingSafeEqual(digest(given), PASS_HASH);
}

/* 総当たりを鈍らせる。合言葉は 31^12 通りあるので、
   1秒に1回まで落とせば現実的な時間では当たらない */
const misses = new Map();

function tooManyMisses(ip) {
  const m = misses.get(ip);
  if (!m) return false;
  if (Date.now() - m.at > 60 * 1000) { misses.delete(ip); return false; }
  return m.n >= 10;
}

function noteMiss(ip) {
  const m = misses.get(ip);
  if (m && Date.now() - m.at <= 60 * 1000) { m.n += 1; m.at = Date.now(); }
  else misses.set(ip, { n: 1, at: Date.now() });
}

/* ── 受ける相手を絞る ──────────────────────
   1. 同じ建物の中（私設アドレス）からだけ受ける。
   2. Host が知らない名前なら断る。
      これを見ないと、職員が外の悪意あるサイトを開いたときに、
      そのサイトの名前をこのサーバーの住所に差し替えられて
      「同じサイト」扱いで中身を読み出されてしまう（DNS リバインディング）。 */

const OPEN = process.env.SOUTEI_OPEN === "1";   /* 特殊な網でどうしても必要なとき */

function isPrivateAddr(ip) {
  if (!ip) return false;
  const v = ip.replace(/^::ffff:/, "");
  if (v === "::1" || v === "127.0.0.1") return true;
  if (/^127\./.test(v)) return true;
  if (/^10\./.test(v)) return true;
  if (/^192\.168\./.test(v)) return true;
  if (/^169\.254\./.test(v)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(v)) return true;
  if (/^f[cd]/i.test(v)) return true;           /* IPv6 の私設 */
  if (/^fe80:/i.test(v)) return true;           /* IPv6 のリンクローカル */
  return false;
}

function ownNames() {
  const out = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
  const ifs = os.networkInterfaces();
  Object.keys(ifs).forEach((n) => {
    (ifs[n] || []).forEach((a) => { if (a.address) out.add(a.address); });
  });
  (process.env.SOUTEI_HOSTS || "").split(",").forEach((h) => {
    const t = h.trim();
    if (t) out.add(t);
  });
  return out;
}

const OWN = ownNames();

function hostOK(req) {
  const raw = req.headers.host || "";
  if (!raw) return false;
  /* 末尾の :ポート を落とす。[::1]:8080 の形もある */
  const name = raw.replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
  return OWN.has(name) || OWN.has("[" + name + "]");
}

/* ── HTTP ─────────────────────────────────── */

function sendJSON(res, code, body) {
  const s = JSON.stringify(body);
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(s),
    "cache-control": "no-store"
  });
  res.end(s);
}

function sendFile(res, file, type) {
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); res.end("not found"); return; }
    res.writeHead(200, {
      "content-type": type,
      "content-length": buf.length,
      "cache-control": "no-store"
    });
    res.end(buf);
  });
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) { reject(new Error("too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  let url;
  try { url = new URL(req.url, "http://localhost"); }
  catch (e) { res.writeHead(400); res.end("bad request"); return; }

  const route = url.pathname;
  const ip = req.socket.remoteAddress || "";

  /* 建物の外からは受けない */
  if (!OPEN && !isPrivateAddr(ip)) {
    res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
    res.end("この送迎表は事業所の中からだけ使えます。");
    return;
  }

  /* 知らない名前で呼ばれたら断る（DNS リバインディング除け） */
  if (!hostOK(req)) {
    res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
    res.end("この住所では使えません。起動時に出たアドレスで開いてください。");
    return;
  }

  /* 送迎表が生きているかの確認。合言葉はまだ要らない
     （つながっているかを先に知らせて、そのうえで合言葉を尋ねる） */
  if (route === "/api/ping") {
    sendJSON(res, 200, { ok: true, name: "soutei", auth: true, time: new Date().toISOString() });
    return;
  }

  /* ここから先は合言葉が要る */
  if (route.startsWith("/api/")) {
    if (tooManyMisses(ip)) {
      sendJSON(res, 429, { ok: false, error: "合言葉の間違いが続いています。1分ほど待ってからお試しください。" });
      return;
    }
    if (!passOK(req.headers["x-soutei-key"])) {
      noteMiss(ip);
      sendJSON(res, 401, { ok: false, error: "合言葉が要ります" });
      return;
    }
    misses.delete(ip);
  }

  /* 保存されているものの一覧と、それぞれの版番号 */
  if (route === "/api/index" && req.method === "GET") {
    const list = listDocs();
    sendJSON(res, 200, { ok: true, docs: list.docs, days: list.days });
    return;
  }

  if (route === "/api/doc") {
    const key = url.searchParams.get("key") || "";
    if (!KEY_OK.test(key)) { sendJSON(res, 400, { ok: false, error: "bad key" }); return; }

    if (req.method === "GET") {
      const doc = readDoc(key);
      if (!doc) { sendJSON(res, 404, { ok: false, error: "not found" }); return; }
      sendJSON(res, 200, { ok: true, key, rev: doc.rev, updatedAt: doc.updatedAt, data: doc.data });
      return;
    }

    if (req.method === "PUT") {
      let body;
      try { body = JSON.parse(await readBody(req, 8 * 1024 * 1024)); }
      catch (e) { sendJSON(res, 400, { ok: false, error: "bad body" }); return; }

      const current = readDoc(key);
      const currentRev = current ? current.rev : 0;
      const baseRev = Number(body.baseRev) || 0;

      /* 自分が知っている版と食い違う＝他の端末が先に直している。
         黙って上書きせず、向こうの中身を返して知らせる */
      if (currentRev !== baseRev) {
        sendJSON(res, 409, {
          ok: false, conflict: true, key,
          rev: currentRev,
          updatedAt: current ? current.updatedAt : "",
          data: current ? current.data : null
        });
        return;
      }

      const next = { rev: currentRev + 1, updatedAt: new Date().toISOString(), data: body.data };
      try { writeDoc(key, next); }
      catch (e) { sendJSON(res, 500, { ok: false, error: String(e && e.message) }); return; }
      sendJSON(res, 200, { ok: true, key, rev: next.rev, updatedAt: next.updatedAt });
      return;
    }

    sendJSON(res, 405, { ok: false, error: "method not allowed" });
    return;
  }

  /* 送迎表そのもの */
  if (req.method === "GET" && (route === "/" || route === "/index.html")) {
    const app = appFile();
    if (!app) { res.writeHead(500); res.end("index.html が見つかりません。送迎表のファイルをこのフォルダに置いてください。"); return; }
    sendFile(res, app, "text/html; charset=utf-8");
    return;
  }

  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("not found");
});

/* ── 起動 ─────────────────────────────────── */

function lanAddresses() {
  const out = [];
  const ifs = os.networkInterfaces();
  Object.keys(ifs).forEach((name) => {
    (ifs[name] || []).forEach((a) => {
      if (a.family === "IPv4" && !a.internal) out.push(a.address);
    });
  });
  return out;
}

try { fs.mkdirSync(DATA, { recursive: true }); }
catch (e) { console.error("data フォルダを作れませんでした:", e.message); process.exit(1); }

if (!appFile()) {
  console.log("── 注意 ────────────────────────────────");
  console.log("送迎表の index.html が見つかりません。");
  console.log("このフォルダに index.html（送迎表）を置いてください:");
  console.log("  " + HERE);
  console.log("───────────────────────────────────────");
  console.log("");
}

server.listen(PORT, "0.0.0.0", () => {
  const list = listDocs();
  console.log("");
  console.log("===========================================");
  console.log(" デイサービス送迎表　保存サーバー　起動しました");
  console.log("===========================================");
  console.log("");
  console.log(" この PC からは       : http://localhost:" + PORT + "/");
  lanAddresses().forEach((ip, i) => {
    console.log((i === 0 ? " 他の PC・タブレットは : " : "                        ") + "http://" + ip + ":" + PORT + "/");
  });
  console.log("");
  console.log(" データの置き場所      : " + DATA);
  console.log(" 保存済みの日          : " + (list.days.length ? list.days.length + " 日ぶん" : "まだありません"));
  console.log("");
  console.log("-------------------------------------------");
  console.log(" 合言葉 : " + AUTH.pass);
  console.log("-------------------------------------------");
  if (AUTH.fresh) {
    console.log(" 初めての起動なので、合言葉を新しく作りました。");
  }
  console.log(" 送迎表を開くと一度だけ聞かれます。端末ごとに1回入れれば、");
  console.log(" 次からは聞かれません。");
  console.log(" 控え : " + KEYFILE);
  console.log(" ※ この合言葉を知らない人は、名簿を見ることも書き換えることもできません。");
  console.log("");
  console.log(" 終わるときは、この画面で Ctrl + C を押してください。");
  console.log(" この画面を閉じるとサーバーも止まります。");
  console.log("");
});

server.on("error", (e) => {
  if (e.code === "EADDRINUSE") {
    console.error("");
    console.error("ポート " + PORT + " は他で使われています。");
    console.error("別の番号で起動してください:  node soutei-server.js 8081");
    console.error("");
  } else {
    console.error("起動できませんでした:", e.message);
  }
  process.exit(1);
});
