// src/translate.js
// 英文 -> 中文翻译模块，适配 Cloudflare Workers 运行时
// 双引擎：优先 Google Translate 免费接口，失败时回退 MyMemory API
// 均无需 API Key，翻译失败时返回原文（保证不阻断推送流程）

const GOOGLE_API = "https://translate.googleapis.com/translate_a/single";
const MYMEMORY_API = "https://api.mymemory.translated.net/get";

/**
 * 翻译单段文本
 * @param {string} text  原文
 * @param {string} target  目标语言代码，默认 zh-CN
 * @returns {Promise<string>} 翻译结果；失败时返回原文
 */
export async function translateText(text, target = "zh-CN") {
  if (!text || !text.trim()) return text;

  // 引擎 1：Google Translate（免费 unofficial 接口）
  const googleResult = await tryGoogle(text, target);
  if (googleResult) return googleResult;

  // 引擎 2：MyMemory（回退）
  const myMemoryResult = await tryMyMemory(text, target);
  if (myMemoryResult) return myMemoryResult;

  // 两个引擎都失败，返回原文
  console.log("[translate] 所有翻译引擎均失败，返回原文");
  return text;
}

/** Google Translate 免费接口 */
async function tryGoogle(text, target) {
  try {
    const url =
      `${GOOGLE_API}?client=gtx&sl=auto&tl=${target}` +
      `&dt=t&q=${encodeURIComponent(text)}`;

    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Accept: "application/json, text/plain, */*",
      },
    });

    if (!res.ok) {
      console.log(`[translate] Google HTTP ${res.status}`);
      return null;
    }

    const data = await res.json();
    // 格式：[[["译文","原文",null,null,1],...], ...]
    if (!Array.isArray(data) || !Array.isArray(data[0])) return null;

    const translated = data[0]
      .map((seg) => (seg && typeof seg[0] === "string" ? seg[0] : ""))
      .join("");

    return translated.trim() || null;
  } catch (e) {
    console.log(`[translate] Google 失败: ${e.message}`);
    return null;
  }
}

/** MyMemory 翻译 API（回退引擎） */
async function tryMyMemory(text, target) {
  try {
    // MyMemory 需要 langpair=源语言|目标语言
    const langPair = `en|${target}`;
    const url =
      `${MYMEMORY_API}?q=${encodeURIComponent(text)}` +
      `&langpair=${encodeURIComponent(langPair)}`;

    const res = await fetch(url, {
      headers: { Accept: "application/json" },
    });

    if (!res.ok) {
      console.log(`[translate] MyMemory HTTP ${res.status}`);
      return null;
    }

    const data = await res.json();
    const translated = data?.responseData?.translatedText;
    // MyMemory 在超额时返回警告而非译文
    if (translated && !translated.includes("MYMEMORY WARNING")) {
      return translated.trim() || null;
    }
    return null;
  } catch (e) {
    console.log(`[translate] MyMemory 失败: ${e.message}`);
    return null;
  }
}

/**
 * 批量翻译新闻条目的标题和摘要（并发执行）
 * 翻译后保留原文字段 originalTitle / originalSummary 供参考
 * @param {Array} items  新闻条目数组
 * @param {boolean} enabled  是否启用翻译
 * @param {string} target  目标语言
 */
export async function translateItems(items, enabled = true, target = "zh-CN") {
  if (!enabled || items.length === 0) return;

  console.log(`[translate] 开始翻译 ${items.length} 条新闻 -> ${target}`);

  await Promise.all(
    items.map(async (item) => {
      const [tTitle, tSummary] = await Promise.all([
        translateText(item.title, target),
        translateText(item.summary, target),
      ]);
      // 保留原文以供参考
      item.originalTitle = item.title;
      item.originalSummary = item.summary;
      item.title = tTitle;
      item.summary = tSummary;
    })
  );

  console.log("[translate] 翻译完成");
}
