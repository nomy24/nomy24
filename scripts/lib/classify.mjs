/** 記事にカテゴリ・エリア・重要度を付与する。 */

/** 全角英数・カタカナのゆらぎを吸収した比較用テキストを作る。 */
function normalize(text) {
  return String(text || '')
    .normalize('NFKC')
    .toLowerCase();
}

function countHits(haystack, keywords) {
  let hits = 0;
  const matched = [];
  for (const keyword of keywords) {
    const needle = normalize(keyword);
    if (needle && haystack.includes(needle)) {
      hits += 1;
      matched.push(keyword);
    }
  }
  return { hits, matched };
}

/**
 * 記事1件を分類する。
 * @returns {{category:string, categoryLabel:string, areas:string[], areaHits:string[], important:boolean}}
 */
export function classifyItem(item, config) {
  const haystack = normalize(`${item.title} ${item.summary || ''} ${item.url || ''}`);

  let best = { id: 'shisei', label: 'お知らせ', score: 0 };
  for (const category of config.categories) {
    const { hits } = countHits(haystack, category.keywords);
    if (hits > best.score) best = { id: category.id, label: category.label, score: hits };
  }
  if (best.score === 0) {
    const fallback = config.categories.find((c) => c.id === 'shisei');
    best = { id: fallback ? fallback.id : 'shisei', label: fallback ? fallback.label : 'お知らせ', score: 0 };
  }

  const areas = [];
  const areaHits = [];
  for (const [areaId, area] of Object.entries(config.areas || {})) {
    const { hits, matched } = countHits(haystack, area.keywords);
    if (hits > 0) {
      areas.push(areaId);
      if (areaId === 'minami') areaHits.push(...matched);
    }
  }

  const { hits: importantHits } = countHits(haystack, config.importantKeywords || []);

  return {
    category: best.id,
    categoryLabel: best.label,
    areas,
    areaHits: [...new Set(areaHits)].slice(0, 4),
    important: importantHits > 0,
  };
}

/**
 * 南区の記事かどうか。
 * - 南区キーワードを含む → 南区
 * - どの区のキーワードも含まない（＝全市向け）→ 南区でも表示
 * - 他区のみに言及 → 除外対象
 */
export function minamiRelevance(areas) {
  if (areas.includes('minami')) return 'minami';
  if (areas.length === 0) return 'citywide';
  return 'other';
}
