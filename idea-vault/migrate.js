/* アイデア貯蔵庫 — 端末をまたいでデータを移すところ
   サーバーがないので、移す手段は「ファイル」か「文字（移行コード）」の2つだけ。
   コードは、圧縮したものを英数字に直したもの。メールやメモに貼っても壊れにくい。 */

const PREFIX_PACKED = "IVAULT1:";  // 圧縮あり
const PREFIX_PLAIN = "IVAULT0:";   // 圧縮できない端末むけ

/* --- 文字と中身の行き来 -------------------------------------------------- */

function bytesToBase64(bytes) {
  let binary = "";
  const CHUNK = 0x8000; // 一度に渡しすぎると引数の数で落ちる
  for (let at = 0; at < bytes.length; at += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(at, at + CHUNK));
  }
  return btoa(binary);
}

function base64ToBytes(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let at = 0; at < binary.length; at += 1) bytes[at] = binary.charCodeAt(at);
  return bytes;
}

async function pack(text) {
  if (typeof CompressionStream !== "function") return null;
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unpack(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Response(stream).text();
}

/* --- 入口 ---------------------------------------------------------------- */

/** 移行コードを作る */
export async function toCode(backup) {
  const json = JSON.stringify(backup);
  const packed = await pack(json);
  if (!packed) return PREFIX_PLAIN + bytesToBase64(new TextEncoder().encode(json));
  return PREFIX_PACKED + bytesToBase64(packed);
}

/** 移行コード（または JSON そのもの）から中身に戻す */
export async function fromCode(input) {
  const raw = String(input ?? "").trim();
  if (!raw) throw new Error("コードが空です");

  // JSON をそのまま貼られることもある
  if (raw.startsWith("{")) {
    try {
      return JSON.parse(raw);
    } catch {
      throw new Error("読み取れませんでした。途中で切れているかもしれません");
    }
  }

  // メールやメモを経由すると改行や空白が混ざるので落としてから読む
  const cleaned = raw.replace(/\s+/g, "");
  const packed = cleaned.startsWith(PREFIX_PACKED);
  const plain = cleaned.startsWith(PREFIX_PLAIN);
  if (!packed && !plain) throw new Error("これは移行コードではないようです");

  const body = cleaned.slice((packed ? PREFIX_PACKED : PREFIX_PLAIN).length);
  let json;
  try {
    const bytes = base64ToBytes(body);
    json = packed ? await unpack(bytes) : new TextDecoder().decode(bytes);
  } catch {
    throw new Error("読み取れませんでした。コードの一部が欠けているかもしれません");
  }

  try {
    return JSON.parse(json);
  } catch {
    throw new Error("中身が壊れています。もう一度作り直してください");
  }
}

/** コードの長さから、貼り付けで移すのが現実的かどうかを言う */
export function codeAdvice(code) {
  const length = code.length;
  if (length > 40000) return `長さ ${length.toLocaleString()} 文字。貼り付けでは途中で切れやすいので、ファイルで移すほうが確実です。`;
  if (length > 12000) return `長さ ${length.toLocaleString()} 文字。少し長いので、コピーのときは全部選べているか確かめてください。`;
  return `長さ ${length.toLocaleString()} 文字。このままコピーして、移したい端末で貼り付けてください。`;
}

/** ファイルとして他アプリへ渡せるかどうか（iPhone の共有シートなど） */
export function canShareFile() {
  if (typeof navigator === "undefined" || !navigator.canShare || !navigator.share) return false;
  try {
    return navigator.canShare({ files: [new File(["{}"], "test.json", { type: "application/json" })] });
  } catch {
    return false;
  }
}

/** ほかのアプリに送る。断られたときは false を返す */
export async function shareBackupFile(backup, filename) {
  const file = new File([JSON.stringify(backup, null, 2)], filename, { type: "application/json" });
  try {
    await navigator.share({ files: [file], title: "アイデア貯蔵庫のデータ" });
    return true;
  } catch (error) {
    if (error?.name === "AbortError") return false; // 利用者がやめただけ
    throw new Error("送れませんでした");
  }
}
