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

/** 内置默认 AI 新闻源 */
const DEFAULT_SOURCES = [
  { name: "MIT Tech Review - AI", url: "https://www.technologyreview.com/topic/artificial-intelligence/feed" },
  { name: "TechCrunch - AI", url: "https://techcrunch.com/category/artificial-intelligence/feed/" },
  { name: "VentureBeat - AI", url: "https://venturebeat.com/category/ai/feed/" },
  { name: "The Verge - AI", url: "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml" },
  { name: "OpenAI Blog", url: "https://openai.com/news/rss.xml" },
  { name: "Google Research Blog", url: "https://research.google/blog/rss/" },
  { name: "Hugging Face Blog", url: "https://huggingface.co/blog/feed.xml" },
  { name: "Anthropic News", url: "https://www.anthropic.com/news/rss.xml" },
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
