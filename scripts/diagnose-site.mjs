#!/usr/bin/env node
/**
 * 一時的な調査スクリプト。相模原市サイトの構造を調べて標準出力に出す。
 * 取得元の場所が確定したら削除する。
 */

import { fetchText } from './lib/http.mjs';
import { absoluteUrl } from './lib/http.mjs';

const ORIGIN = 'https://www.city.sagamihara.kanagawa.jp';

function section(title) {
  console.log(`\n${'='.repeat(70)}\n${title}\n${'='.repeat(70)}`);
}

async function probe(paths) {
  for (const path of paths) {
    const url = absoluteUrl(path, ORIGIN);
    const res = await fetchText(url, { retries: 0, timeoutMs: 15000 });
    const head = res.body.slice(0, 120).replace(/\s+/g, ' ');
    console.log(`${String(res.status).padEnd(4)} ${(res.contentType || '-').padEnd(40)} ${url}`);
    if (res.ok) console.log(`      先頭: ${head}`);
  }
}

const top = await fetchText(ORIGIN);
section('トップページ');
console.log('status:', top.status, '| content-type:', top.contentType, '| 最終URL:', top.url, '| 文字数:', top.body.length);

section('<link rel="alternate"> など head 内のリンク');
for (const m of top.body.matchAll(/<link\b[^>]*>/gi)) {
  if (/alternate|rss|rdf|atom|feed/i.test(m[0])) console.log(m[0].replace(/\s+/g, ' '));
}

section('rss / rdf / feed / xml を含む href');
const feedish = new Set();
for (const m of top.body.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
  if (/(rss|rdf|feed|\.xml)/i.test(m[1])) feedish.add(m[1]);
}
console.log([...feedish].join('\n') || '(なし)');

section('「新着」「更新」を含むリンク');
for (const m of top.body.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]{0,80}?)<\/a>/gi)) {
  const text = m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  if (/新着|更新情報|お知らせ|報道|広報/.test(text)) console.log(`${text}  ->  ${m[1]}`);
}

section('日付らしき文字列の出現例（最初の12件）');
let shown = 0;
for (const m of top.body.matchAll(/\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日|\d{4}[-/]\d{1,2}[-/]\d{1,2}/g)) {
  const around = top.body.slice(Math.max(0, m.index - 160), m.index + 160).replace(/\s+/g, ' ');
  console.log(`--- ${m[0]}\n${around}`);
  if (++shown >= 12) break;
}

section('内部リンクの一覧（先頭60件）');
const links = new Set();
for (const m of top.body.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
  const abs = absoluteUrl(m[1], top.url);
  if (abs && abs.startsWith(ORIGIN)) links.add(abs);
}
console.log([...links].slice(0, 60).join('\n'));

section('候補パスの応答');
await probe([
  '/rss.xml', '/rss/index.xml', '/index.rdf', '/feed', '/atom.xml',
  '/sitemap.xml', '/whatsnew/index.html', '/shinchaku.html', '/site/rss.html',
  '/kurashi/index.html', '/minamiku/index.html', '/shisei/index.html',
]);

section('sitemap.xml の中身（あれば先頭2000文字）');
const sitemap = await fetchText(`${ORIGIN}/sitemap.xml`, { retries: 0 });
console.log(sitemap.ok ? sitemap.body.slice(0, 2000) : `取得できません: ${sitemap.error || sitemap.status}`);
