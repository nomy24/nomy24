/* 提供票チェック — 登録した曜日パターンから「その月の利用日」をつくり、読み取り結果と照らす。 */

export const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

export const WEEK_PATTERNS = [
  { value: 'every', label: '毎週' },
  { value: '1,3', label: '第1・第3' },
  { value: '2,4', label: '第2・第4' },
  { value: '1,3,5', label: '第1・第3・第5' },
  { value: '1', label: '第1のみ' },
  { value: '2', label: '第2のみ' },
  { value: '3', label: '第3のみ' },
  { value: '4', label: '第4のみ' },
];

export const PART_LABELS = { am: '午前', pm: '午後' };

/** 空の曜日パターン（日〜土）。 */
export function emptyPattern() {
  return WEEKDAY_LABELS.map(() => ({ am: false, pm: false, weeks: 'every' }));
}

export function currentMonth(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export function daysInMonth(ym) {
  const [year, month] = ym.split('-').map(Number);
  return new Date(year, month, 0).getDate();
}

export function weekdayOf(ym, day) {
  const [year, month] = ym.split('-').map(Number);
  return new Date(year, month - 1, day).getDay();
}

/** その月で何回目の同じ曜日か（1〜5）。 */
export function nthWeek(day) {
  return Math.floor((day - 1) / 7) + 1;
}

export function dateKey(ym, day) {
  return `${ym}-${String(day).padStart(2, '0')}`;
}

export function formatMonth(ym) {
  const [year, month] = ym.split('-').map(Number);
  return `${year}年${month}月`;
}

function matchesWeeks(weeks, day) {
  if (weeks === 'every') return true;
  return weeks.split(',').includes(String(nthWeek(day)));
}

/**
 * その月に「利用するはず」の日を返す。
 * key は日（数値）、値は { am, pm, overridden }。
 * overrides（その月だけの追加・休み）はパターンより優先する。
 */
export function expectedDays(user, ym) {
  const pattern = user?.pattern ?? emptyPattern();
  const overrides = user?.overrides ?? {};
  const total = daysInMonth(ym);
  const result = new Map();

  for (let day = 1; day <= total; day++) {
    const override = overrides[dateKey(ym, day)];
    if (override) {
      result.set(day, { am: !!override.am, pm: !!override.pm, overridden: true });
      continue;
    }
    const slot = pattern[weekdayOf(ym, day)] ?? { am: false, pm: false, weeks: 'every' };
    const active = matchesWeeks(slot.weeks ?? 'every', day);
    result.set(day, { am: active && !!slot.am, pm: active && !!slot.pm, overridden: false });
  }
  return result;
}

const same = (a, b) => a.am === b.am && a.pm === b.pm;
const empty = (a) => !a.am && !a.pm;

/**
 * 予定表（登録）と提供票（読み取り）を1日ずつ照らす。
 *
 * marks は { actual: Map<day, {am,pm}>, plan: Map<day, {am,pm}>|null }。
 * 実績の行を読んでいればそれを、予定の行しか読んでいなければ予定を、登録と比べる。
 */
export function compare(user, ym, marks) {
  const expected = expectedDays(user, ym);
  const total = daysInMonth(ym);
  const sheet = marks.actual ?? marks.plan;
  const hasBoth = !!(marks.actual && marks.plan);
  const rows = [];

  for (let day = 1; day <= total; day++) {
    const want = expected.get(day) ?? { am: false, pm: false, overridden: false };
    const got = sheet?.get(day) ?? { am: false, pm: false };

    let status = 'ok';
    if (!same(want, got)) {
      if (empty(want)) status = 'unplanned';       // 登録にない日にマークがある
      else if (empty(got)) status = 'missing';     // 登録した日にマークがない
      else status = 'part';                        // 日は合っているが午前・午後がちがう
    } else if (empty(want)) {
      status = 'blank';                            // 利用のない日。表には出さない
    }

    const planGap = hasBoth && !same(marks.plan.get(day) ?? { am: false, pm: false }, marks.actual.get(day) ?? { am: false, pm: false });

    rows.push({
      day,
      weekday: weekdayOf(ym, day),
      expected: want,
      marked: got,
      plan: hasBoth ? (marks.plan.get(day) ?? { am: false, pm: false }) : null,
      status,
      planGap,
    });
  }

  const alerts = rows.filter((row) => row.status !== 'ok' && row.status !== 'blank');
  const planGaps = rows.filter((row) => row.planGap);

  return {
    rows,
    alerts,
    planGaps,
    summary: {
      matched: rows.filter((row) => row.status === 'ok').length,
      unplanned: rows.filter((row) => row.status === 'unplanned').length,
      missing: rows.filter((row) => row.status === 'missing').length,
      part: rows.filter((row) => row.status === 'part').length,
      planGap: planGaps.length,
      usedDays: rows.filter((row) => row.marked.am || row.marked.pm).length,
      comparedWith: marks.actual ? 'actual' : 'plan',
    },
  };
}

/** 「午前・午後」を短い文にする。 */
export function partsText(slot) {
  if (!slot) return 'なし';
  if (slot.am && slot.pm) return '午前・午後';
  if (slot.am) return '午前';
  if (slot.pm) return '午後';
  return 'なし';
}

/** 曜日パターンを「毎週 月・木（午前）」のような文にする。 */
export function patternText(pattern) {
  const parts = [];
  (pattern ?? []).forEach((slot, weekday) => {
    if (!slot?.am && !slot?.pm) return;
    const weeks = WEEK_PATTERNS.find((w) => w.value === (slot.weeks ?? 'every'))?.label ?? '毎週';
    parts.push(`${weeks} ${WEEKDAY_LABELS[weekday]}（${partsText(slot)}）`);
  });
  return parts.length ? parts.join('、') : '曜日が未登録';
}
