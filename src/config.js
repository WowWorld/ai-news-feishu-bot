// src/config.js
// 配置管理：统一从 env 读取参数，并提供默认值

/**
 * 读取 RSS 新闻源列表
 * 优先使用环境变量 RSS_SOURCES，否则返回内置默认列表
 * @param {Record<string, any>} env
 * @returns {Array<{name: string, url: string}>}
 */
export function getSources(env) {
  const raw = env.RSS_SOURCES;
  if (raw && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.filter(
          (s) => s && typeof s.url === "string" && typeof s.name === "string"
        );
      }
    } catch (e) {
      console.log("[config] RSS_SOURCES 解析失败，使用默认源:", e.message);
    }
  }
  return DEFAULT_SOURCES;
}

/** 内置默认新闻源（聚焦 OpenAI/ChatGPT 额度用量动态） */
const DEFAULT_SOURCES = [
  // Tibo Sottiaux (@thsottiaux) — OpenAI Codex 团队负责人
  // 专门在 X 上发布额度重置、用量限制调整等消息，最直接的实时源
  // 通过 xcancel.com（免费 Nitter 实例）获取 RSS
  { name: "Tibo (@thsottiaux)", url: "https://xcancel.com/thsottiaux/rss" },
  // 聚合时间线：覆盖模型发布 + 定价变化 + 政策（补充视角）
  { name: "LMTimeline", url: "https://lmtimeline.com/rss.xml" },
  // OpenAI 官方博客：正式公告
  { name: "OpenAI Blog", url: "https://openai.com/news/rss.xml" },
];

/** 默认关键词过滤（不区分大小写）。命中任一关键词才推送 */
const DEFAULT_KEYWORDS = [
  "reset", "usage", "limit", "quota", "banked",
  "codex", "5-hour", "5 hour", "rate limit",
  "credit", "billing", "capacity", "throttl",
  "额度", "重置", "用量", "限制",
];

/**
 * 读取关键词过滤列表
 * 优先使用环境变量 KEYWORDS（逗号分隔），否则返回内置默认
 * @param {Record<string, any>} env
 * @returns {string[]}
 */
export function getKeywords(env) {
  const raw = env.KEYWORDS;
  if (raw && raw.trim()) {
    const arr = raw.split(",").map((k) => k.trim()).filter(Boolean);
    if (arr.length > 0) return arr;
  }
  return DEFAULT_KEYWORDS;
}

/**
 * 判断新闻条目是否命中关键词过滤
 * @param {{title: string, summary: string}} item
 * @param {string[]} keywords
 * @returns {boolean}
 */
export function matchKeywords(item, keywords) {
  if (!keywords || keywords.length === 0) return true; // 无关键词则全部通过
  const text = `${item.title || ""} ${item.summary || ""}`.toLowerCase();
  return keywords.some((kw) => text.includes(kw.toLowerCase()));
}

/** 读取整型环境变量 */
export function getInt(env, key, fallback) {
  const v = parseInt(env[key], 10);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/** 读取字符串环境变量 */
export function getStr(env, key, fallback) {
  const v = env[key];
  return typeof v === "string" && v.trim() ? v : fallback;
}
