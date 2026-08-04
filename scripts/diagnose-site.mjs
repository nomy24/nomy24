#!/usr/bin/env node
/**
 * 一時的な検証スクリプト。実際のRSSに対して取得と分類を通し、内訳を表示する。
 * 取り込みが安定したら削除する。
 */

import { readFile } from 'node:fs/promises';
import { loadFeed } from './lib/feed.mjs';
import { classifyItem, minamiRelevance } from './lib/classify.mjs';

const config = JSON.parse(await readFile(new URL('../config/sources.json', import.meta.url), 'utf8'));

for (const feed of config.feeds) {
  const result = await loadFeed(feed.url);
  console.log(`\n${feed.url}`);
  console.log(`取得: ${result.ok ? 'OK' : `NG (${result.error})`} / ${result.items.length}件`);
  if (!result.ok) continue;

  const byCategory = new Map();
  const byScope = new Map();
  const minami = [];

  for (const item of result.items) {
    const meta = classifyItem(item, config);
    const scope = minamiRelevance(meta.areas);
    byCategory.set(meta.categoryLabel, (byCategory.get(meta.categoryLabel) || 0) + 1);
    byScope.set(scope, (byScope.get(scope) || 0) + 1);
    if (scope === 'minami') minami.push({ ...item, ...meta });
  }

  console.log('\n--- 地域の内訳 ---');
  for (const [scope, n] of [...byScope].sort((a, b) => b[1] - a[1])) console.log(`${String(n).padStart(4)}  ${scope}`);

  console.log('\n--- カテゴリの内訳 ---');
  for (const [label, n] of [...byCategory].sort((a, b) => b[1] - a[1])) console.log(`${String(n).padStart(4)}  ${label}`);

  console.log(`\n--- 南区と判定された記事（最大25件）---`);
  for (const item of minami.slice(0, 25)) {
    console.log(`[${item.categoryLabel}] ${item.title}`);
    console.log(`      手がかり: ${item.areaHits.join('・') || '(なし)'} / ${item.url}`);
  }

  console.log(`\n--- 全市と判定された記事の例（先頭15件）---`);
  for (const item of result.items.slice(0, 15)) {
    const meta = classifyItem(item, config);
    if (minamiRelevance(meta.areas) !== 'citywide') continue;
    console.log(`[${meta.categoryLabel}]${meta.important ? '[重要]' : ''} ${item.title}`);
  }
}
