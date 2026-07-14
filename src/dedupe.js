// src/dedupe.js
// 基于 Workers KV 的新闻去重模块
// 使用 SHA-256(title+link) 作为唯一标识，KV 中仅保留最近 N 条 hash

const KV_KEY = "seen_hashes";
// 防止 KV 无限膨胀，只保留最近这么多条
const MAX_STORED_HASHES = 1000;

/**
 * 计算字符串的 SHA-256 哈希（Workers 原生 crypto.subtle）
 * @param {string} str
 * @returns {Promise<string>}
 */
export async function sha256(str) {
  const data = new TextEncoder().encode(str);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * 为每个新闻条目计算并填充 hash 字段
 * @param {Array} items
 */
export async function fillHashes(items) {
  await Promise.all(
    items.map(async (item) => {
      // 优先用 guid，其次 link，最后 title 作为去重键
      const key = (item.guid || item.link || item.title || "").trim();
      item.hash = await sha256(key);
    })
  );
}

/**
 * 读取已推送过的 hash 集合
 * @param {Record<string, any>} env
 * @returns {Promise<Set<string>>}
 */
export async function getSeenHashes(env) {
  const seen = new Set();
  const kv = env.NEWS_KV;
  if (!kv) return seen;
  try {
    const data = await kv.get(KV_KEY);
    if (data) {
      const arr = JSON.parse(data);
      if (Array.isArray(arr)) arr.forEach((h) => seen.add(h));
    }
  } catch (e) {
    console.log("[dedupe] 读取 KV 失败:", e.message);
  }
  return seen;
}

/**
 * 过滤掉已推送过的条目
 * @param {Array} items
 * @param {Set<string>} seen
 * @returns {Array}
 */
export function filterUnseen(items, seen) {
  return items.filter((item) => item.hash && !seen.has(item.hash));
}

/**
 * 将本次推送的 hash 写回 KV
 * @param {Record<string, any>} env
 * @param {Array<string>} hashes
 */
export async function markAsSeen(env, hashes) {
  const kv = env.NEWS_KV;
  if (!kv || hashes.length === 0) return;
  try {
    const seen = await getSeenHashes(env);
    hashes.forEach((h) => seen.add(h));
    // 截断为最近 MAX_STORED_HASHES 条
    const arr = Array.from(seen).slice(-MAX_STORED_HASHES);
    // KV 写入有大小与频率限制，单 key 即可
    await kv.put(KV_KEY, JSON.stringify(arr));
  } catch (e) {
    console.log("[dedupe] 写入 KV 失败:", e.message);
  }
}
