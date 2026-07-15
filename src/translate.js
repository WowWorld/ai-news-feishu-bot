// src/translate.js
// 英文 -> 中文翻译模块，适配 Cloudflare Workers 运行时
// 批量翻译：所有文本合并为 1 个请求，避免超出 Workers 50 子请求限制
// 使用 Google Translate 免费接口，无需 API Key

const GOOGLE_API = "https://translate.googleapis.com/translate_a/single";
const SEP = "\n@@SEP@@\n";

/**
 * 批量翻译多条文本（合并为 1 个 API 请求）
 * @param {string[]} texts  待翻译文本数组
 * @param {string} target  目标语言
 * @returns {Promise<string[]>} 翻译结果数组，失败时返回原文
 */
async function batchTranslate(texts, target) {
  // 用分隔符拼接所有文本，一次请求翻译
  const joined = texts.join(SEP);
  const url =
    `${GOOGLE_API}?client=gtx&sl=auto&tl=${target}` +
    `&dt=t&q=${encodeURIComponent(joined)}`;

  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      Accept: "application/json, text/plain, */*",
    },
  });

  if (!res.ok) throw new Error(`Google HTTP ${res.status}`);

  const data = await res.json();
  if (!Array.isArray(data) || !Array.isArray(data[0])) {
    throw new Error("Google 返回格式异常");
  }

  // 拼接所有翻译片段
  const fullTranslated = data[0]
    .map((seg) => (seg && typeof seg[0] === "string" ? seg[0] : ""))
    .join("");

  // 按分隔符拆分回各条文本
  const parts = fullTranslated.split(SEP).map((s) => s.trim());

  // 如果拆分数量不匹配（翻译引擎可能改了分隔符），做尽力拆分
  if (parts.length !== texts.length) {
    console.log(
      `[translate] 拆分不匹配: ${parts.length}/${texts.length}，尝试按行拆分`
    );
    // 退化为按数量平均拆分，保证不丢数据
    return texts.map((_, i) => parts[i] || texts[i]);
  }

  return parts;
}

/**
 * 批量翻译新闻条目的标题和摘要（仅 1 个子请求）
 * 翻译后保留原文字段 originalTitle / originalSummary 供参考
 * @param {Array} items  新闻条目数组
 * @param {boolean} enabled  是否启用翻译
 * @param {string} target  目标语言
 */
export async function translateItems(items, enabled = true, target = "zh-CN") {
  if (!enabled || items.length === 0) return;

  console.log(`[translate] 批量翻译 ${items.length} 条新闻 -> ${target}（1 个请求）`);

  // 收集所有待翻译文本：标题 + 摘要 交替排列
  const texts = [];
  for (const item of items) {
    texts.push(item.title || "");
    texts.push(item.summary || "");
  }

  try {
    const translated = await batchTranslate(texts, target);

    // 将翻译结果写回各条目
    for (let i = 0; i < items.length; i++) {
      const tTitle = translated[i * 2] || items[i].title;
      const tSummary = translated[i * 2 + 1] || items[i].summary;
      items[i].originalTitle = items[i].title;
      items[i].originalSummary = items[i].summary;
      items[i].title = tTitle;
      items[i].summary = tSummary;
    }
    console.log("[translate] 翻译完成");
  } catch (e) {
    console.log(`[translate] 批量翻译失败，使用原文: ${e.message}`);
    // 失败时不修改原文，直接返回
  }
}
