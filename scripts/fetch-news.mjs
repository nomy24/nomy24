#!/usr/bin/env node
/**
 * 相模原市南区インフォ — 情報更新スクリプト
 *
 * 1. config/sources.json の feeds を読みに行く
 * 2. feeds が空／全滅したら RSS を自動探索して sources.json を書き戻す（自己修復）
 * 3. RSS がまったく取れなければ新着一覧ページのHTMLから拾う
 * 4. 既存の news.json とマージし、初回検知時刻を保ったまま出力する
 *
 *   node scripts/fetch-news.mjs            通常の更新
 *   node scripts/fetch-news.mjs --dry-run  ファイルを書かずに結果だけ表示
 *   node scripts/fetch-news.mjs --offline  ネットワークを使わず既存データを再生成
 */

import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { fetchText } from './lib/http.mjs';
import { extractLinkedItems, findFeedLinks, loadFeed } from './lib/feed.mjs';
import { classifyItem, minamiRelevance } from './lib/classify.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_PATH = resolve(ROOT, 'config/sources.json');
const OUTPUT_PATH = resolve(ROOT, 'sagamihara-minami/data/news.json');

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');
const OFFLINE = args.has('--offline');

const log = (...parts) => console.log('[fetch-news]', ...parts);

function itemId(url) {
  return createHash('sha1').update(url).digest('hex').slice(0, 12);
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') log(`WARN ${path} を読めませんでした: ${err.message}`);
    return fallback;
  }
}

/** 設定済みフィードを取得する。 */
async function collectFromFeeds(feeds) {
  const collected = [];
  const report = [];
  for (const feed of feeds) {
    const result = await loadFeed(feed.url);
    report.push({
      id: feed.id,
      title: feed.title || result.title || feed.id,
      url: feed.url,
      ok: result.ok,
      itemCount: result.items.length,
      ...(result.ok ? {} : { error: result.error }),
    });
    if (!result.ok) {
      log(`NG  feed ${feed.url} — ${result.error}`);
      continue;
    }
    log(`OK  feed ${feed.url} — ${result.items.length}件`);
    for (const item of result.items) {
      collected.push({ ...item, sourceId: feed.id, sourceTitle: feed.title || result.title || feed.id });
    }
  }
  return { collected, report };
}

/** サイトを走査して使えるフィードURLを探す。 */
async function discoverFeeds(discovery, origin) {
  if (!discovery || discovery.enabled === false) return [];
  const candidates = new Set();

  for (const page of discovery.pages || []) {
    const res = await fetchText(page);
    if (!res.ok) {
      log(`探索: ${page} を取得できません — ${res.error || res.status}`);
      continue;
    }
    for (const link of findFeedLinks(res.body, res.url)) candidates.add(link);
  }
  for (const path of discovery.commonPaths || []) {
    try {
      candidates.add(new URL(path, origin).toString());
    } catch {
      /* 無効なパスは無視 */
    }
  }

  log(`探索: ${candidates.size}件の候補を検証します`);
  const verified = [];
  for (const url of candidates) {
    const result = await loadFeed(url);
    if (!result.ok) continue;
    log(`探索: 有効なフィードを発見 ${url}（${result.items.length}件）`);
    verified.push({
      id: itemId(url),
      title: result.title || 'フィード',
      url,
    });
  }
  return verified;
}

/** RSS が使えないときのHTML一覧フォールバック。 */
async function collectFromHtml(htmlFallback) {
  if (!htmlFallback || htmlFallback.enabled === false) return { collected: [], report: [] };
  const collected = [];
  const report = [];
  for (const page of htmlFallback.pages || []) {
    const res = await fetchText(page.url);
    if (!res.ok) {
      report.push({ id: page.id, title: page.title, url: page.url, ok: false, itemCount: 0, error: res.error || `HTTP ${res.status}` });
      log(`NG  html ${page.url} — ${res.error || res.status}`);
      continue;
    }
    const items = extractLinkedItems(res.body, res.url);
    report.push({ id: page.id, title: page.title, url: page.url, ok: items.length > 0, itemCount: items.length, ...(items.length ? {} : { error: 'no dated links found' }) });
    log(`${items.length ? 'OK ' : 'NG '} html ${page.url} — ${items.length}件`);
    for (const item of items) {
      collected.push({ ...item, sourceId: page.id, sourceTitle: page.title });
    }
  }
  return { collected, report };
}

function buildItems(collected, previousById, config, now) {
  const byId = new Map();

  for (const raw of collected) {
    if (!raw.url || !raw.title) continue;
    const id = itemId(raw.url);
    const meta = classifyItem(raw, config);
    const relevance = minamiRelevance(meta.areas);
    if (relevance === 'other') continue;

    const previous = previousById.get(id);
    const existing = byId.get(id);
    // 同一URLが複数ソースから来た場合は情報量の多い方を残す
    if (existing && (existing.summary || '').length >= (raw.summary || '').length) continue;

    byId.set(id, {
      id,
      title: raw.title,
      url: raw.url,
      summary: raw.summary || '',
      category: meta.category,
      categoryLabel: meta.categoryLabel,
      scope: relevance, // 'minami' | 'citywide'
      areaHits: meta.areaHits,
      important: meta.important,
      source: raw.sourceTitle || raw.sourceId,
      publishedAt: raw.publishedAt || (previous && previous.publishedAt) || now,
      firstSeenAt: (previous && previous.firstSeenAt) || now,
    });
  }

  return byId;
}

function mergeWithPrevious(currentById, previousItems, retention, now) {
  const merged = new Map(currentById);
  const maxAgeMs = (retention.maxAgeDays || 400) * 24 * 60 * 60 * 1000;
  const nowMs = Date.parse(now);

  // 取得できなかった記事も一定期間は残す（ソース側の一時的な不調で消さない）
  for (const item of previousItems) {
    if (merged.has(item.id)) continue;
    const stamp = Date.parse(item.publishedAt || item.firstSeenAt || now);
    if (Number.isFinite(stamp) && nowMs - stamp > maxAgeMs) continue;
    merged.set(item.id, item);
  }

  const list = [...merged.values()].sort((a, b) => {
    const bt = Date.parse(b.publishedAt || b.firstSeenAt || 0) || 0;
    const at = Date.parse(a.publishedAt || a.firstSeenAt || 0) || 0;
    if (bt !== at) return bt - at;
    return a.id.localeCompare(b.id);
  });

  return list.slice(0, retention.maxItems || 400);
}

async function main() {
  const config = await readJson(CONFIG_PATH, null);
  if (!config) {
    console.error('config/sources.json を読み込めませんでした。');
    process.exit(1);
  }

  const previous = await readJson(OUTPUT_PATH, { items: [] });
  const previousItems = Array.isArray(previous.items) ? previous.items : [];
  const previousById = new Map(previousItems.map((item) => [item.id, item]));
  const now = new Date().toISOString();

  let collected = [];
  let report = [];
  let feeds = Array.isArray(config.feeds) ? config.feeds : [];
  let configChanged = false;

  if (OFFLINE) {
    log('オフラインモード: 既存データから再生成します');
  } else {
    if (feeds.length > 0) {
      const fromFeeds = await collectFromFeeds(feeds);
      collected = fromFeeds.collected;
      report = fromFeeds.report;
    }

    if (collected.length === 0) {
      log('有効なフィードがないため自動探索を実行します');
      const discovered = await discoverFeeds(config.discovery, config.site && config.site.origin);
      if (discovered.length > 0) {
        feeds = discovered;
        config.feeds = discovered;
        configChanged = true;
        const fromDiscovered = await collectFromFeeds(discovered);
        collected = fromDiscovered.collected;
        report = fromDiscovered.report;
      }
    }

    if (collected.length === 0) {
      log('RSSから取得できなかったためHTML一覧にフォールバックします');
      const fromHtml = await collectFromHtml(config.htmlFallback);
      collected = fromHtml.collected;
      report = [...report, ...fromHtml.report];
    }
  }

  if (!OFFLINE && collected.length === 0) {
    console.error('どのソースからも取得できませんでした。既存データは変更しません。');
    process.exit(1);
  }

  const currentById = buildItems(collected, previousById, config, now);
  const items = mergeWithPrevious(currentById, previousItems, config.retention || {}, now);

  if (items.length === 0) {
    console.error('記事が1件もありません。既存ファイルは変更しません。');
    process.exit(1);
  }

  const freshIds = [...currentById.keys()];
  const newIds = freshIds.filter((id) => !previousById.has(id));

  const output = {
    generatedAt: now,
    source: (config.site && config.site.name) || '相模原市公式ホームページ',
    sourceUrl: (config.site && config.site.origin) || '',
    counts: {
      total: items.length,
      minami: items.filter((i) => i.scope === 'minami').length,
      citywide: items.filter((i) => i.scope === 'citywide').length,
      addedThisRun: newIds.length,
    },
    categories: config.categories.map(({ id, label, icon }) => ({ id, label, icon })),
    feeds: report,
    items,
  };
  // 内容が変わったときだけコミットしたいので、記事集合のハッシュを持たせる
  output.revision = createHash('sha1')
    .update(items.map((i) => `${i.id}:${i.title}:${i.publishedAt}`).join('\n'))
    .digest('hex')
    .slice(0, 12);

  log(`記事 ${items.length}件（南区 ${output.counts.minami} / 全市 ${output.counts.citywide}）、今回の新着 ${newIds.length}件`);

  if (DRY_RUN) {
    log('--dry-run のためファイルは書き込みません');
    console.log(JSON.stringify({ ...output, items: items.slice(0, 3) }, null, 2));
    return;
  }

  // 内容が同じなら書き換えない（毎回の実行で無意味なコミットが積み上がるのを防ぐ）
  if (previous.revision && previous.revision === output.revision && !configChanged) {
    log('内容に変更はありません。ファイルはそのままにします。');
    return;
  }

  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  log(`書き込み: ${OUTPUT_PATH}`);

  if (configChanged) {
    await writeFile(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    log(`フィードURLを自動更新: ${CONFIG_PATH}`);
  }
}

main().catch((err) => {
  console.error('[fetch-news] 予期しないエラー:', err);
  process.exit(1);
});
