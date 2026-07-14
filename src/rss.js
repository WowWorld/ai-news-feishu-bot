// src/rss.js
// RSS / Atom 抓取与解析模块
// 无第三方依赖，使用正则解析以兼容 Cloudflare Workers 运行时

/**
 * 并发抓取所有新闻源，返回去重前的全部条目（按发布时间倒序）
 * @param {Array<{name:string,url:string}>} sources
 * @param {Record<string, any>} env
 * @returns {Promise<import('./types.js').NewsItem[]>}
 */
export async function fetchNewsFromSources(sources, env) {
  const timeoutMs = getInt(env, "FETCH_TIMEOUT_MS", 15000);
  const limitPerSource = getInt(env, "MAX_ITEMS_PER_SOURCE", 20);
  // 代理 URL 模板（含 {url} 占位符），用于绕过 CF Workers 无法直连 CF 保护站点的问题
  // 默认使用 allorigins.win；留空则直连
  const proxyUrl = env.RSS_PROXY || "https://api.allorigins.win/raw?url={url}";

  console.log(`[rss] 代理: ${proxyUrl ? proxyUrl.split("?")[0] : "直连"}`);

  const tasks = sources.map((source) =>
    fetchFromSource(source, timeoutMs, limitPerSource, proxyUrl).catch((err) => {
      console.log(`[rss] 抓取失败 ${source.name}: ${err.message}`);
      // 代理失败时尝试直连作为最后回退
      if (proxyUrl) {
        console.log(`[rss] ${source.name} 代理失败，尝试直连...`);
        return fetchFromSource(source, timeoutMs, limitPerSource, null).catch(
          (e) => {
            console.log(`[rss] 直连也失败 ${source.name}: ${e.message}`);
            return [];
          }
        );
      }
      return [];
    })
  );
  const results = await Promise.all(tasks);

  const all = results.flat();
  // 按发布时间倒序，无时间的排到末尾
  all.sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0));
  return all;
}

/** 抓取单个源（支持代理回退，解决 CF Workers 无法直连 CF 保护的站点） */
async function fetchFromSource(source, timeoutMs, limitPerSource, proxyUrl) {
  // 构建请求 URL：如果配置了代理，走代理；否则直连
  const makeUrl = (target) =>
    proxyUrl
      ? proxyUrl.replace("{url}", encodeURIComponent(target))
      : target;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(makeUrl(source.url), {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
      },
      signal: controller.signal,
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    const items = parseFeed(xml, source);
    return items.slice(0, limitPerSource);
  } finally {
    clearTimeout(timer);
  }
}

/** 自动识别 RSS 2.0 / Atom 并解析 */
export function parseFeed(xml, source) {
  if (/<feed[\s>]/i.test(xml) && /<entry[\s>]/i.test(xml)) {
    return parseAtom(xml, source);
  }
  return parseRss(xml, source);
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
  const t = Date.parse(str);
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
