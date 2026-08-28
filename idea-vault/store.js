/* アイデア貯蔵庫 — 保存まわり
   置き場所は localStorage だけ。通信もサーバーもないので、端末を替えると消える。
   壊れた値が入っていても落ちないように、読むときは必ず形を検査してから返す。 */

const KEY_IDEAS = "idea-vault/ideas.v1";
const KEY_SETTINGS = "idea-vault/settings.v1";
const KEY_PLANS = "idea-vault/plans.v1";

const PLAN_HISTORY_MAX = 12;

export const DEFAULT_SETTINGS = {
  continuous: true,   // ひと区切りごとに1件として保存する
  keepMic: true,      // 端末が勝手に切ったらつなぎ直す
  lang: "ja-JP",
  aiEnabled: false,
  aiKey: "",
  aiModel: "claude-opus-5",
  harsh: true,        // 容赦なしモード
};

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const value = JSON.parse(raw);
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    // 容量いっぱい、またはプライベートブラウズで書けないとき
    return false;
  }
}

export function newId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 文字列の配列にそろえる（重複とからっぽを落とす） */
export function normalizeTags(input) {
  const list = Array.isArray(input) ? input : String(input ?? "").split(/[\s,、，#]+/);
  const seen = new Set();
  const tags = [];
  for (const raw of list) {
    const tag = String(raw ?? "").trim().replace(/^#/, "").slice(0, 24);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
    if (tags.length >= 6) break;
  }
  return tags;
}

function normalizeIdea(value) {
  if (!value || typeof value !== "object") return null;
  const text = typeof value.text === "string" ? value.text.trim() : "";
  if (!text) return null;
  const createdAt = Number.isFinite(value.createdAt) ? value.createdAt : Date.parse(value.createdAt) || Date.now();
  return {
    id: typeof value.id === "string" && value.id ? value.id : newId(),
    text: text.slice(0, 4000),
    tags: normalizeTags(value.tags),
    source: value.source === "voice" ? "voice" : "text",
    createdAt,
    updatedAt: Number.isFinite(value.updatedAt) ? value.updatedAt : createdAt,
    pinned: value.pinned === true,
  };
}

export const store = {
  ideas: [],
  settings: { ...DEFAULT_SETTINGS },
  plans: [],
  /** 書き込みに失敗した回数。UI から見て警告を出すのに使う */
  writeFailed: false,

  load() {
    const rawIdeas = readJson(KEY_IDEAS, []);
    this.ideas = (Array.isArray(rawIdeas) ? rawIdeas : []).map(normalizeIdea).filter(Boolean);

    const rawSettings = readJson(KEY_SETTINGS, {});
    this.settings = { ...DEFAULT_SETTINGS, ...(rawSettings && typeof rawSettings === "object" ? rawSettings : {}) };

    const rawPlans = readJson(KEY_PLANS, []);
    this.plans = (Array.isArray(rawPlans) ? rawPlans : []).filter((p) => p && Array.isArray(p.plans)).slice(0, PLAN_HISTORY_MAX);

    return this;
  },

  saveIdeas() {
    this.writeFailed = !writeJson(KEY_IDEAS, this.ideas);
    return !this.writeFailed;
  },

  saveSettings() {
    return writeJson(KEY_SETTINGS, this.settings);
  },

  savePlans() {
    return writeJson(KEY_PLANS, this.plans.slice(0, PLAN_HISTORY_MAX));
  },

  /** 新しい順に並べ替える（ピン留めは常に上） */
  sorted() {
    return [...this.ideas].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.createdAt - a.createdAt;
    });
  },

  add({ text, tags = [], source = "text" }) {
    const idea = normalizeIdea({ text, tags, source, createdAt: Date.now() });
    if (!idea) return null;
    this.ideas.push(idea);
    this.saveIdeas();
    return idea;
  },

  update(id, patch) {
    const idea = this.ideas.find((item) => item.id === id);
    if (!idea) return null;
    if (typeof patch.text === "string") idea.text = patch.text.trim().slice(0, 4000);
    if (patch.tags !== undefined) idea.tags = normalizeTags(patch.tags);
    if (patch.pinned !== undefined) idea.pinned = patch.pinned === true;
    idea.updatedAt = Date.now();
    if (!idea.text) return this.remove([id])[0] ?? null;
    this.saveIdeas();
    return idea;
  },

  /** 消したものを（元に戻す用に）そのまま返す */
  remove(ids) {
    const set = new Set(ids);
    const removed = this.ideas.filter((idea) => set.has(idea.id));
    this.ideas = this.ideas.filter((idea) => !set.has(idea.id));
    this.saveIdeas();
    return removed;
  },

  restore(ideas) {
    const known = new Set(this.ideas.map((idea) => idea.id));
    for (const idea of ideas) {
      if (!known.has(idea.id)) this.ideas.push(idea);
    }
    this.saveIdeas();
  },

  clearAll() {
    this.ideas = [];
    this.plans = [];
    this.saveIdeas();
    this.savePlans();
  },

  tagCounts() {
    const counts = new Map();
    for (const idea of this.ideas) {
      for (const tag of idea.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ja"));
  },

  addPlanSet(record) {
    this.plans.unshift(record);
    this.plans = this.plans.slice(0, PLAN_HISTORY_MAX);
    this.savePlans();
  },

  removePlanSet(id) {
    this.plans = this.plans.filter((record) => record.id !== id);
    this.savePlans();
  },

  /** 書き出し用のかたまり */
  toBackup() {
    return {
      app: "idea-vault",
      version: 1,
      exportedAt: new Date().toISOString(),
      ideas: this.ideas,
      plans: this.plans,
    };
  },

  /** 読み込み。既存は消さずに、同じ id のものだけ新しいほうを残す */
  merge(backup) {
    if (!backup || !Array.isArray(backup.ideas)) throw new Error("形式がちがいます");
    const incoming = backup.ideas.map(normalizeIdea).filter(Boolean);
    const byId = new Map(this.ideas.map((idea) => [idea.id, idea]));
    let added = 0;
    let updated = 0;
    for (const idea of incoming) {
      const current = byId.get(idea.id);
      if (!current) {
        byId.set(idea.id, idea);
        added += 1;
      } else if (idea.updatedAt > current.updatedAt) {
        byId.set(idea.id, idea);
        updated += 1;
      }
    }
    this.ideas = [...byId.values()];
    this.saveIdeas();

    if (Array.isArray(backup.plans)) {
      const known = new Set(this.plans.map((p) => p.id));
      for (const record of backup.plans) {
        if (record && Array.isArray(record.plans) && !known.has(record.id)) this.plans.push(record);
      }
      this.plans.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
      this.plans = this.plans.slice(0, PLAN_HISTORY_MAX);
      this.savePlans();
    }

    return { added, updated };
  },
};
