// src/index.js
// Cloudflare Worker 主入口
// - Cron Trigger 定时触发：自动抓取 AI 新闻并推送飞书
// - HTTP /trigger：手动触发，方便调试
// - HTTP /：健康检查

import { getSources, getInt, getStr } from "./config.js";
import { fetchNewsFromSources } from "./rss.js";
import {
  fillHashes,
  getSeenHashes,
  filterUnseen,
  markAsSeen,
} from "./dedupe.js";
import { sendNewsToFeishu } from "./feishu.js";

export default {
  /**
   * 定时触发
   * @param {ScheduledEvent} event
   * @param {Record<string, any>} env
   * @param {ExecutionContext} ctx
   */
  async scheduled(event, env, ctx) {
    ctx.waitUntil(handleScheduled(env));
  },

  /**
   * HTTP 请求处理（手动触发 / 健康检查）
   */
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "") {
      return jsonResponse({
        status: "ok",
        service: "ai-news-feishu-bot",
        time: new Date().toISOString(),
        endpoints: {
          "/": "健康检查",
          "/trigger": "手动触发一次新闻抓取与推送（GET）",
          "/sources": "查看当前配置的新闻源（GET）",
        },
      });
    }

    if (url.pathname === "/sources") {
      return jsonResponse({ sources: getSources(env) });
    }

    if (url.pathname === "/trigger") {
      try {
        const result = await handleScheduled(env);
        return jsonResponse({ ok: true, ...result });
      } catch (e) {
        return jsonResponse({ ok: false, error: e.message, stack: e.stack }, 500);
      }
    }

    return jsonResponse({ error: "Not Found" }, 404);
  },
};

/**
 * 核心逻辑：抓取 -> 去重 -> 推送
 * @param {Record<string, any>} env
 * @returns {Promise<object>}
 */
async function handleScheduled(env) {
  const webhookUrl = getStr(env, "FEISHU_WEBHOOK_URL", "");
  if (!webhookUrl) {
    throw new Error("未配置 FEISHU_WEBHOOK_URL，请用 `wrangler secret put FEISHU_WEBHOOK_URL` 设置");
  }
  const webhookSecret = env.FEISHU_WEBHOOK_SECRET || null;
  const maxItems = getInt(env, "MAX_ITEMS", 10);
  const summaryMaxLen = getInt(env, "SUMMARY_MAX_LENGTH", 200);

  console.log(`[worker] 开始抓取，配置源 ${getSources(env).length} 个`);

  // 1. 抓取全部源
  const allItems = await fetchNewsFromSources(getSources(env), env);
  console.log(`[worker] 抓取到 ${allItems.length} 条原始新闻`);

  if (allItems.length === 0) {
    return { message: "未抓取到任何新闻", total: 0, pushed: 0 };
  }

  // 2. 计算哈希
  await fillHashes(allItems);

  // 3. 全局去重（同一条可能被多个源转载）
  const byKey = new Map();
  for (const item of allItems) {
    const key = (item.guid || item.link || item.title || "").trim().toLowerCase();
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, item);
  }
  const dedupedGlobal = Array.from(byKey.values());
  // 保持时间倒序
  dedupedGlobal.sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0));
  console.log(`[worker] 全局去重后 ${dedupedGlobal.length} 条`);

  // 4. 与 KV 已推送集合比对
  const seen = await getSeenHashes(env);
  const fresh = filterUnseen(dedupedGlobal, seen);
  console.log(`[worker] 去除已推送后新增 ${fresh.length} 条`);

  if (fresh.length === 0) {
    console.log("[worker] 没有新内容，跳过推送");
    return { message: "无新增新闻，跳过推送", total: allItems.length, pushed: 0 };
  }

  // 5. 取前 N 条推送
  const toSend = fresh.slice(0, maxItems);

  // 6. 推送飞书
  await sendNewsToFeishu(webhookUrl, webhookSecret, toSend, summaryMaxLen);
  console.log(`[worker] 已推送 ${toSend.length} 条到飞书`);

  // 7. 写回 KV 去重集合
  await markAsSeen(env, toSend.map((i) => i.hash));

  return {
    total: allItems.length,
    afterGlobalDedupe: dedupedGlobal.length,
    pushed: toSend.length,
    skippedSeen: fresh.length - toSend.length,
  };
}

/** JSON 响应工具函数 */
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
