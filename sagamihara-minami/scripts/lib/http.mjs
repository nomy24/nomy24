/** 文字コード判定つきの取得ユーティリティ（依存パッケージなし）。 */

const USER_AGENT =
  'sagamihara-minami-info/1.0 (+https://github.com/nomy24/nomy24; static site updater)';

function charsetFromContentType(contentType) {
  const m = /charset\s*=\s*"?([\w-]+)"?/i.exec(contentType || '');
  return m ? m[1].toLowerCase() : null;
}

function charsetFromBody(bytes) {
  // 先頭 2KB を ASCII 相当として読み、宣言を探す
  const head = Buffer.from(bytes.subarray(0, 2048)).toString('latin1');
  const xml = /<\?xml[^>]*encoding\s*=\s*["']([\w-]+)["']/i.exec(head);
  if (xml) return xml[1].toLowerCase();
  const html5 = /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(head);
  if (html5) return html5[1].toLowerCase();
  return null;
}

function normalizeCharset(name) {
  if (!name) return 'utf-8';
  const n = name.toLowerCase();
  if (n === 'shift_jis' || n === 'shift-jis' || n === 'sjis' || n === 'x-sjis') return 'shift_jis';
  if (n === 'euc-jp' || n === 'eucjp' || n === 'x-euc-jp') return 'euc-jp';
  if (n === 'iso-2022-jp') return 'iso-2022-jp';
  return n;
}

function decode(bytes, charset) {
  const target = normalizeCharset(charset);
  try {
    return new TextDecoder(target).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

/**
 * テキストを取得する。ネットワークエラーは指数バックオフで再試行する。
 * @returns {Promise<{ok:boolean, status:number, url:string, body:string, contentType:string, error?:string}>}
 */
export async function fetchText(url, { timeoutMs = 20000, retries = 2 } = {}) {
  let lastError = 'unknown error';

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1)));
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'user-agent': USER_AGENT,
          accept: 'application/rss+xml, application/rdf+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.8, */*;q=0.5',
          'accept-language': 'ja,en;q=0.8',
        },
      });
      const contentType = res.headers.get('content-type') || '';
      if (!res.ok) {
        clearTimeout(timer);
        // 4xx は再試行しても変わらないので即座に返す
        if (res.status >= 400 && res.status < 500) {
          return { ok: false, status: res.status, url: res.url || url, body: '', contentType, error: `HTTP ${res.status}` };
        }
        lastError = `HTTP ${res.status}`;
        continue;
      }
      const bytes = new Uint8Array(await res.arrayBuffer());
      clearTimeout(timer);
      const charset = charsetFromContentType(contentType) || charsetFromBody(bytes);
      return {
        ok: true,
        status: res.status,
        url: res.url || url,
        body: decode(bytes, charset),
        contentType,
      };
    } catch (err) {
      clearTimeout(timer);
      lastError = err && err.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : String((err && err.message) || err);
    }
  }

  return { ok: false, status: 0, url, body: '', contentType: '', error: lastError };
}

/** 相対URLを絶対URLへ解決する。解決できない場合は null。 */
export function absoluteUrl(href, base) {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}
