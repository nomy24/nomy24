/** フィード（RSS 2.0 / RDF / Atom）とHTML一覧から記事を抽出する。 */

import { parseXml, child, descendants, textOf, decodeEntities } from './xml.mjs';
import { absoluteUrl, fetchText } from './http.mjs';

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 「2026年8月4日」「2026/8/4」「2026-08-04」などを ISO 文字列へ。 */
export function parseJapaneseDate(input) {
  if (!input) return null;
  const text = String(input);
  const jp = /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/.exec(text);
  const sep = jp ? null : /(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(text);
  const m = jp || sep;
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  // 日付のみの表記は日本時間の 00:00 として扱う
  const ms = Date.UTC(y, mo - 1, d) - JST_OFFSET_MS;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** さまざまな日付表記を ISO 文字列へ正規化する。 */
export function normalizeDate(input) {
  if (!input) return null;
  const text = String(input).trim();
  if (text === '') return null;

  // 「2026年8月4日」形式は Date が解釈できないので先に処理する
  if (/\d{4}\s*年/.test(text)) {
    const jp = parseJapaneseDate(text);
    if (jp) return jp;
  }

  // RFC822 / ISO8601 は時刻まで保持したいので標準パーサに任せる
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    const year = parsed.getUTCFullYear();
    if (year >= 1990 && year <= 2100) return parsed.toISOString();
  }

  // 長い文中に埋もれた日付を最後の手段として拾う
  return parseJapaneseDate(text);
}

/** HTMLタグを落として本文だけにする。 */
export function stripHtml(input, maxLength = 160) {
  if (!input) return '';
  const text = decodeEntities(
    String(input)
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

function linkFromEntry(entry, baseUrl) {
  // Atom: <link rel="alternate" href="...">
  const links = entry.children.filter((c) => c.local === 'link');
  const alternate =
    links.find((l) => l.attrs.href && (!l.attrs.rel || l.attrs.rel === 'alternate')) ||
    links.find((l) => l.attrs.href);
  if (alternate && alternate.attrs.href) return absoluteUrl(alternate.attrs.href, baseUrl);
  // RSS/RDF: <link>URL</link>
  const plain = links.map((l) => textOf(l)).find((t) => t);
  if (plain) return absoluteUrl(plain, baseUrl);
  const guid = child(entry, 'guid');
  const guidText = textOf(guid);
  if (guidText && /^https?:\/\//i.test(guidText)) return guidText;
  return null;
}

function dateFromEntry(entry) {
  const candidates = ['pubdate', 'published', 'date', 'updated', 'modified', 'issued'];
  for (const name of candidates) {
    const found = entry.children.find((c) => c.local === name);
    const iso = normalizeDate(textOf(found));
    if (iso) return iso;
  }
  return null;
}

function summaryFromEntry(entry) {
  const candidates = ['description', 'summary', 'subtitle', 'encoded', 'content'];
  for (const name of candidates) {
    const found = entry.children.find((c) => c.local === name);
    const text = stripHtml(textOf(found));
    if (text) return text;
  }
  return '';
}

/**
 * フィード本文を解析する。
 * @returns {{title:string, items:Array<{title:string,url:string,summary:string,publishedAt:string|null}>}|null}
 */
export function parseFeed(body, baseUrl) {
  const root = parseXml(body);
  if (!root) return null;

  const isFeed = ['rss', 'rdf', 'feed'].includes(root.local);
  if (!isFeed) return null;

  const channel = child(root, 'channel') || root;
  const feedTitle = textOf(child(channel, 'title')) || textOf(child(root, 'title')) || '';

  // RSS/RDF は <item>、Atom は <entry>
  const entries = [...descendants(root, 'item'), ...descendants(root, 'entry')];
  const items = [];
  for (const entry of entries) {
    const title = stripHtml(textOf(child(entry, 'title')), 200);
    const url = linkFromEntry(entry, baseUrl);
    if (!title || !url) continue;
    items.push({
      title,
      url,
      summary: summaryFromEntry(entry),
      publishedAt: dateFromEntry(entry),
    });
  }
  return { title: feedTitle, items };
}

/** HTML から RSS/Atom フィードらしきURLを拾う。 */
export function findFeedLinks(html, baseUrl) {
  const found = new Set();

  const linkTag = /<link\b[^>]*>/gi;
  let m;
  while ((m = linkTag.exec(html)) !== null) {
    const tag = m[0];
    if (!/rel\s*=\s*["']?alternate/i.test(tag)) continue;
    if (!/type\s*=\s*["']?application\/(rss|rdf|atom)\+xml/i.test(tag)) continue;
    const href = /href\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(tag);
    if (!href) continue;
    const value = href[2] || href[3] || href[4];
    const abs = absoluteUrl(decodeEntities(value), baseUrl);
    if (abs) found.add(abs);
  }

  const anchor = /<a\b[^>]*href\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))[^>]*>/gi;
  while ((m = anchor.exec(html)) !== null) {
    const value = m[2] || m[3] || m[4] || '';
    if (!/\.(rdf|xml)(\?|$)/i.test(value) && !/\/(rss|feed|atom)(\/|\?|$)/i.test(value)) continue;
    if (/sitemap/i.test(value)) continue;
    const abs = absoluteUrl(decodeEntities(value), baseUrl);
    if (abs) found.add(abs);
  }

  return [...found];
}

/** 記事リンクの周辺だけから日付を拾う。他の記事の日付を巻き込まないようにする。 */
function dateNearAnchor(html, anchorStart, anchorEnd) {
  // 直前の文脈。ただし直前の </a> より前は「別の記事」なので切り捨てる
  let before = html.slice(Math.max(0, anchorStart - 300), anchorStart);
  const previousAnchorEnd = before.toLowerCase().lastIndexOf('</a>');
  if (previousAnchorEnd !== -1) before = before.slice(previousAnchorEnd + 4);
  const beforeDate = parseJapaneseDate(stripHtml(before, 400));
  if (beforeDate) return beforeDate;

  // 「タイトル（2026年8月1日）」のように後ろに日付が来る形にも対応する
  let after = html.slice(anchorEnd, anchorEnd + 200);
  const nextAnchorStart = after.toLowerCase().indexOf('<a ');
  if (nextAnchorStart !== -1) after = after.slice(0, nextAnchorStart);
  return parseJapaneseDate(stripHtml(after, 300));
}

/**
 * 新着一覧ページのHTMLから「日付 + リンク」の組を拾う（RSSが無い場合の保険）。
 */
export function extractLinkedItems(html, baseUrl, { limit = 60 } = {}) {
  const items = [];
  const seen = new Set();

  const anchor = /<a\b[^>]*href\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = anchor.exec(html)) !== null && items.length < limit) {
    const rawHref = m[2] || m[3] || m[4] || '';
    const title = stripHtml(m[5], 200);
    if (!title || title.length < 6) continue;
    if (/^(https?:)?\/\//i.test(rawHref) && !rawHref.includes(new URL(baseUrl).host)) continue;
    if (/\.(pdf|jpg|jpeg|png|gif|zip|xls[xm]?|docx?)(\?|$)/i.test(rawHref)) continue;
    if (/^(mailto:|tel:|javascript:|#)/i.test(rawHref)) continue;

    const url = absoluteUrl(decodeEntities(rawHref), baseUrl);
    if (!url || seen.has(url)) continue;

    const publishedAt = parseJapaneseDate(title) || dateNearAnchor(html, m.index, m.index + m[0].length);
    if (!publishedAt) continue;

    seen.add(url);
    items.push({ title, url, summary: '', publishedAt });
  }

  return items;
}

/** URLを取得し、フィードとして解析できれば記事を返す。 */
export async function loadFeed(url) {
  const res = await fetchText(url);
  if (!res.ok) return { ok: false, url, error: res.error || `HTTP ${res.status}`, items: [] };
  const parsed = parseFeed(res.body, res.url);
  if (!parsed) return { ok: false, url, error: 'not a feed', items: [] };
  if (parsed.items.length === 0) return { ok: false, url, error: 'no items', items: [] };
  return { ok: true, url, title: parsed.title, items: parsed.items };
}
