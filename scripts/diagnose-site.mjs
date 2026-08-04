#!/usr/bin/env node
/**
 * 一時的な調査スクリプト。相模原市サイトの構造を調べて標準出力に出す。
 * 取得元の場所が確定したら削除する。
 */

import { fetchText, absoluteUrl } from './lib/http.mjs';
import { parseFeed, extractLinkedItems, stripHtml } from './lib/feed.mjs';

const ORIGIN = 'https://www.city.sagamihara.kanagawa.jp';

function section(title) {
  console.log(`\n${'='.repeat(70)}\n${title}\n${'='.repeat(70)}`);
}

// --- 1. RSS 本体 -------------------------------------------------------
section('/rss.rss');
const rss = await fetchText(`${ORIGIN}/rss.rss`);
console.log('status:', rss.status, '| content-type:', rss.contentType, '| 文字数:', rss.body.length);
if (rss.ok) {
  console.log('--- 先頭1200文字 ---');
  console.log(rss.body.slice(0, 1200));
  const parsed = parseFeed(rss.body, rss.url);
  console.log('--- parseFeed の結果 ---');
  console.log('タイトル:', parsed && parsed.title, '| 件数:', parsed ? parsed.items.length : 0);
  if (parsed) console.log(JSON.stringify(parsed.items.slice(0, 5), null, 1));
}

// --- 2. RSS 配信一覧ページ ---------------------------------------------
section('/about/rss.html にあるフィード一覧');
const rssPage = await fetchText(`${ORIGIN}/about/rss.html`);
console.log('status:', rssPage.status, '| 文字数:', rssPage.body.length);
if (rssPage.ok) {
  for (const m of rssPage.body.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]{0,120}?)<\/a>/gi)) {
    if (!/\.(rss|rdf|xml)(\?|$)/i.test(m[1])) continue;
    console.log(`${stripHtml(m[2], 60).padEnd(30)} -> ${absoluteUrl(m[1], rssPage.url)}`);
  }
}

// --- 3. 更新情報ページ -------------------------------------------------
for (const path of ['/news.html', '/minamiku/index.html']) {
  section(`${path} からの記事抽出`);
  const res = await fetchText(`${ORIGIN}${path}`);
  console.log('status:', res.status, '| 文字数:', res.body.length);
  if (!res.ok) continue;
  const items = extractLinkedItems(res.body, res.url);
  console.log('抽出件数:', items.length);
  console.log(JSON.stringify(items.slice(0, 8), null, 1));

  const marker = res.body.search(/新着|更新情報|お知らせ/);
  if (marker !== -1) {
    console.log('--- 「新着/更新情報」付近の生HTML（1500文字）---');
    console.log(res.body.slice(marker - 200, marker + 1300));
  }
}
