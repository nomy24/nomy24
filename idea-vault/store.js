/* アイデア貯蔵庫 — 保存まわり
   置き場所は localStorage だけ。通信もサーバーもないので、端末を替えると消える。
   壊れた値が入っていても落ちないように、読むときは必ず形を検査してから返す。 */

const KEY_IDEAS = "idea-vault/ideas.v1";
const KEY_SETTINGS = "idea-vault/settings.v1";
const KEY_DRAFT = "idea-vault/draft.v1";

export const DEFAULT_SETTINGS = {
  continuous: true,   // ひと区切りごとに1件として保存する
  keepMic: true,      // 端末が勝手に切ったらつなぎ直す
  lang: "ja-JP",
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
  /** 書き込みに失敗した回数。UI から見て警告を出すのに使う */
  writeFailed: false,

  load() {
    const rawIdeas = readJson(KEY_IDEAS, []);
    this.ideas = (Array.isArray(rawIdeas) ? rawIdeas : []).map(normalizeIdea).filter(Boolean);

    const rawSettings = readJson(KEY_SETTINGS, {});
    this.settings = { ...DEFAULT_SETTINGS, ...(rawSettings && typeof rawSettings === "object" ? rawSettings : {}) };

    return this;
  },

  saveIdeas() {
    this.writeFailed = !writeJson(KEY_IDEAS, this.ideas);
    return !this.writeFailed;
  },

  saveSettings() {
    return writeJson(KEY_SETTINGS, this.settings);
  },

  /* --- 書きかけ ---------------------------------------------------------
     入力の途中で閉じても消えないように、1件だけ別に置いておく。
     ためた時点で捨てる。 */

  loadDraft() {
    const draft = readJson(KEY_DRAFT, null);
    if (!draft || typeof draft !== "object") return null;
    return { text: String(draft.text ?? ""), tags: String(draft.tags ?? "") };
  },

  saveDraft(draft) {
    if (!draft.text.trim() && !draft.tags.trim()) return this.clearDraft();
    return writeJson(KEY_DRAFT, { text: draft.text, tags: draft.tags, savedAt: Date.now() });
  },

  clearDraft() {
    try { localStorage.removeItem(KEY_DRAFT); } catch { /* 消せなくても困らない */ }
    return true;
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

  /** 選んだものを1件にまとめる。声で細切れになったものを直すため。
      いちばん古いものの日時を引き継ぎ、タグはまとめる。元の並び（古い順）でつなぐ。 */
  combine(ids) {
    const set = new Set(ids);
    const targets = this.ideas.filter((idea) => set.has(idea.id)).sort((a, b) => a.createdAt - b.createdAt);
    if (targets.length < 2) return null;

    const combined = {
      id: newId(),
      text: targets.map((idea) => idea.text.trim()).filter(Boolean).join("\n").slice(0, 4000),
      tags: normalizeTags(targets.flatMap((idea) => idea.tags)),
      source: targets.some((idea) => idea.source === "voice") ? "voice" : "text",
      createdAt: targets[0].createdAt,
      updatedAt: Date.now(),
      pinned: targets.some((idea) => idea.pinned),
    };

    this.ideas = this.ideas.filter((idea) => !set.has(idea.id));
    this.ideas.push(combined);
    this.saveIdeas();
    return { combined, before: targets };
  },

  /** combine のあとで「元に戻す」を押されたとき */
  splitBack(result) {
    this.ideas = this.ideas.filter((idea) => idea.id !== result.combined.id);
    for (const idea of result.before) this.ideas.push(idea);
    this.saveIdeas();
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
    this.saveIdeas();
  },

  tagCounts() {
    const counts = new Map();
    for (const idea of this.ideas) {
      for (const tag of idea.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ja"));
  },

  /** 書き出し用のかたまり */
  toBackup() {
    return {
      app: "idea-vault",
      version: 1,
      exportedAt: new Date().toISOString(),
      ideas: this.ideas,
    };
  },

  /** 取り込む前に、何がどう変わるかを数えておく（消える件数を見せてから決めてもらう） */
  inspect(backup) {
    if (!backup || !Array.isArray(backup.ideas)) throw new Error("形式がちがいます");
    const incoming = backup.ideas.map(normalizeIdea).filter(Boolean);
    const byId = new Map(this.ideas.map((idea) => [idea.id, idea]));
    let added = 0;
    let updated = 0;
    let same = 0;
    for (const idea of incoming) {
      const current = byId.get(idea.id);
      if (!current) added += 1;
      else if (idea.updatedAt > current.updatedAt) updated += 1;
      else same += 1;
    }
    return {
      incoming: incoming.length,
      added,
      updated,
      same,
      here: this.ideas.length,
      exportedAt: typeof backup.exportedAt === "string" ? backup.exportedAt : null,
    };
  },

  /** 入れ替え。戻せるように、消す前の中身をそのまま返す */
  replaceAll(backup) {
    if (!backup || !Array.isArray(backup.ideas)) throw new Error("形式がちがいます");
    const before = { ideas: this.ideas };
    this.ideas = backup.ideas.map(normalizeIdea).filter(Boolean);
    this.saveIdeas();
    return before;
  },

  /** replaceAll のあとで「元に戻す」を押されたとき */
  restoreAll(before) {
    this.ideas = before.ideas;
    this.saveIdeas();
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

    // 前の版の書き出しには提案の履歴が入っていることがあるが、いまは読み飛ばす
    return { added, updated };
  },
};
