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

/** 内置默认 AI 新闻源（聚焦模型发布、定价变化、API 更新） */
const DEFAULT_SOURCES = [
  // 聚合时间线：模型发布 + 定价 + 政策 + 产品，一条源覆盖最广
  { name: "LMTimeline", url: "https://lmtimeline.com/rss.xml" },
  // 官方博客：第一手模型发布公告
  { name: "OpenAI Blog", url: "https://openai.com/news/rss.xml" },
  { name: "Anthropic News", url: "https://www.anthropic.com/news/rss.xml" },
  { name: "Google Research Blog", url: "https://research.google/blog/rss/" },
  { name: "Hugging Face Blog", url: "https://huggingface.co/blog/feed.xml" },
];

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
