// src/rss.js
// 新闻抓取与解析模块
// 支持 RSS 2.0 / Atom / Nitter HTML 页面三种格式
// 无第三方依赖，使用正则解析以兼容 Cloudflare Workers 运行时

/**
 * 并发抓取所有新闻源，返回去重前的全部条目（按发布时间倒序）
 */
export async function fetchNewsFromSources(sources, env) {
  const timeoutMs = getInt(env, "FETCH_TIMEOUT_MS", 20000);
  const limitPerSource = getInt(env, "MAX_ITEMS_PER_SOURCE", 30);

  const tasks = sources.map((source) =>
    fetchFromSource(source, timeoutMs, limitPerSource).catch((err) => {
      console.log(`[rss] 抓取失败 ${source.name}: ${err.message}`);
      return [];
    })
  );
  const results = await Promise.all(tasks);

  const all = results.flat();
  all.sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0));
  return all;
}

/** 抓取单个源 */
async function fetchFromSource(source, timeoutMs, limitPerSource) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(source.url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Accept: "text/html, application/rss+xml, application/xml, */*",
      },
      signal: controller.signal,
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const items = parseContent(text, source);
    console.log(`[rss] ${source.name}: 获取到 ${items.length} 条`);
    return items.slice(0, limitPerSource);
  } finally {
    clearTimeout(timer);
  }
}

/** 自动识别内容格式并解析：Nitter HTML / RSS 2.0 / Atom */
export function parseContent(text, source) {
  // Nitter/xcancel HTML 页面
  if (/<!DOCTYPE html|<html/i.test(text) && /timeline-item|tweet-content/i.test(text)) {
    return parseNitterHtml(text, source);
  }
  // Atom
  if (/<feed[\s>]/i.test(text) && /<entry[\s>]/i.test(text)) {
    return parseAtom(text, source);
  }
  // RSS 2.0
  return parseRss(text, source);
}

// ─────────────────── Nitter HTML ───────────────────
function parseNitterHtml(html, source) {
  const items = [];

  // 策略：独立提取所有推文内容和所有日期链接，按位置配对
  // 1. 提取所有 tweet-content 文本
  const contents = [];
  const contentRe = /<[^>]*class="[^"]*tweet-content[^"]*"[^>]*>([\s\S]*?)<\/(?:div|p)>/gi;
  let cm;
  while ((cm = contentRe.exec(html)) !== null) {
    const text = decodeHtml(stripTags(cm[1])).trim();
    if (text) contents.push(text);
  }

  // 2. 提取所有推文日期链接 (href="/user/status/ID#m" title="DATE")
  // 注意：xcancel 的 href 带 #m 后缀，用 [^"]+ 匹配
  const dates = [];
  const dateRe = /href="([^"]*\/status\/[^"]+)"[^>]*title="([^"]*)"/gi;
  let dm;
  while ((dm = dateRe.exec(html)) !== null) {
    dates.push({ link: dm[1], dateStr: dm[2] });
  }

  console.log(`[rss] Nitter HTML: ${contents.length} 条推文内容, ${dates.length} 个日期链接`);

  // 3. 配对组装
  const count = Math.min(contents.length, dates.length);
  for (let i = 0; i < count; i++) {
    const text = contents[i];
    const { link, dateStr } = dates[i];

    let fullLink = link;
    if (fullLink && !fullLink.startsWith("http")) {
      // 去掉 #m 后缀，补全为 x.com 链接
      fullLink = "https://x.com" + (fullLink.startsWith("/") ? "" : "/") + fullLink.replace(/#m$/, "");
    }

    items.push({
      title: text.split("\n")[0].slice(0, 200) || "(无标题)",
      link: fullLink,
      summary: text,
      publishedAt: parseDate(dateStr),
      source: source.name,
      guid: fullLink || text.slice(0, 50),
      hash: "",
    });
  }

  // 如果日期链接不够但内容有剩余，也加入（无日期）
  for (let i = count; i < contents.length; i++) {
    const text = contents[i];
    items.push({
      title: text.split("\n")[0].slice(0, 200) || "(无标题)",
      link: "",
      summary: text,
      publishedAt: null,
      source: source.name,
      guid: text.slice(0, 50),
      hash: "",
    });
  }

  return items;
}

// ─────────────────── RSS 2.0 ───────────────────
function parseRss(xml, source) {
  const items = [];
  const itemMatches = matchAll(xml, /<item\b[^>]*>([\s\S]*?)<\/item>/gi);
  for (const block of itemMatches) {
    const title = pickText(block, "title");
    const link =
      pickText(block, "link") || pickAttr(block, "link", "href") || "";
    const desc = pickCdataOrText(block, "description");
    const pubDate = pickText(block, "pubDate") || pickText(block, "dc:date");
    const guid = pickText(block, "guid") || link || title;
    if (!title) continue;
    items.push(buildItem(title, link, desc, pubDate, source.name, guid));
  }
  return items;
}

// ─────────────────── Atom ───────────────────
function parseAtom(xml, source) {
  const items = [];
  const entryMatches = matchAll(xml, /<entry\b[^>]*>([\s\S]*?)<\/entry>/gi);
  for (const block of entryMatches) {
    const title = pickText(block, "title");
    const link =
      pickAttr(block, "link", "href") || pickText(block, "link") || "";
    const desc =
      pickCdataOrText(block, "summary") || pickCdataOrText(block, "content");
    const pubDate =
      pickText(block, "published") || pickText(block, "updated");
    const guid = pickText(block, "id") || link || title;
    if (!title) continue;
    items.push(buildItem(title, link, desc, pubDate, source.name, guid));
  }
  return items;
}

// ─────────────────── 工具函数 ───────────────────
function getInt(env, key, fallback) {
  const v = parseInt(env[key], 10);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/** 全局正则匹配，返回每个匹配的捕获组数组 */
function matchAll(str, regex) {
  const out = [];
  let m;
  const re = new RegExp(regex.source, regex.flags);
  while ((m = re.exec(str)) !== null) {
    out.push(m[1] || m[0]);
  }
  return out;
}

/** 提取 <tag>...</tag> 的纯文本（去除内部标签与 CDATA 标记） */
function pickText(block, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const m = block.match(re);
  if (!m) return "";
  return decodeHtml(stripTags(m[1])).trim();
}

/** 优先取 CDATA 内容，否则取纯文本 */
function pickCdataOrText(block, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const m = block.match(re);
  if (!m) return "";
  const raw = m[1];
  // 先剥离 CDATA 包裹
  const cdata = raw.match(/<!\[CDATA\[([\s\S]*?)\]\]>/i);
  const text = cdata ? cdata[1] : stripTags(raw);
  return decodeHtml(text).trim();
}

/** 提取 <tag href="..."> 形式的属性 */
function pickAttr(block, tag, attr) {
  const re = new RegExp(`<${tag}\\b[^>]*\\b${attr}=["']([^"']+)["']`, "i");
  const m = block.match(re);
  return m ? m[1].trim() : "";
}

/** 去除 HTML 标签 */
function stripTags(html) {
  return html.replace(/<[^>]+>/g, "");
}

/** 解码常见 HTML 实体 */
function decodeHtml(str) {
  return str
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

/** 解析日期字符串为时间戳 */
function parseDate(str) {
  if (!str) return null;
  // 清理 Nitter 日期格式中的特殊字符 "Jul 15, 2026 · 2:01 AM UTC"
  const cleaned = str.replace(/·/g, "").replace(/\s+/g, " ").trim();
  const t = Date.parse(cleaned);
  return Number.isNaN(t) ? null : t;
}

/** 构造新闻条目（不含 hash，hash 在 dedupe 阶段统一计算） */
function buildItem(title, link, summary, pubDate, sourceName, guid) {
  return {
    title,
    link: link.trim(),
    summary,
    publishedAt: parseDate(pubDate),
    source: sourceName,
    guid,
    hash: "", // 由 index.js 在去重时填充
  };
}
