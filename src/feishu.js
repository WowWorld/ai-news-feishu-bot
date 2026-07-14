// src/feishu.js
// 飞书自定义机器人 Webhook 推送模块
// 文档：https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot
//
// 支持签名校验（可选）：当配置了 FEISHU_WEBHOOK_SECRET 时自动启用

/**
 * 发送互动卡片消息到飞书群
 * @param {string} webhookUrl  飞书自定义机器人 webhook 地址
 * @param {string|null} secret  签名校验密钥（可为空）
 * @param {Array} items  新闻条目列表
 * @param {number} summaryMaxLen  摘要最大长度
 * @returns {Promise<object>} 飞书返回的 JSON
 */
export async function sendNewsToFeishu(webhookUrl, secret, items, summaryMaxLen) {
  const card = buildCard(items, summaryMaxLen);
  const payload = {
    msg_type: "interactive",
    card,
  };

  if (secret) {
    const { timestamp, sign } = await signWithSecret(secret);
    payload.timestamp = timestamp;
    payload.sign = sign;
  }

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  // 飞书成功响应：HTTP 200 且 code=0 或 StatusCode=0
  // 不同版本接口字段略有差异，统一判断
  const code = json.code;
  const statusCode = json.StatusCode;
  const bizOk =
    (code === undefined && statusCode === undefined) || // 无业务码字段，按 HTTP 状态为准
    code === 0 ||
    statusCode === 0;
  if (!res.ok || !bizOk) {
    throw new Error(`飞书推送失败 (HTTP ${res.status}): ${text}`);
  }
  return json;
}

/**
 * 构造互动卡片
 */
function buildCard(items, summaryMaxLen) {
  const now = new Date();
  const dateStr = formatDateCN(now);

  const elements = [];

  // 头部说明
  elements.push({
    tag: "div",
    text: {
      tag: "lark_md",
      content: `**今日 AI 资讯速递** · 共 ${items.length} 条\n今天是 ${dateStr}，以下为近期值得关注的 AI 动态：`,
    },
  });

  elements.push({ tag: "hr" });

  // 每条新闻一个 div
  items.forEach((item, idx) => {
    const title = escapeMd(item.title || "无标题");
    const summary = truncate(item.summary || "暂无摘要", summaryMaxLen);
    const source = escapeMd(item.source || "未知来源");
    const time = item.publishedAt ? formatDateCN(new Date(item.publishedAt)) : "";
    const link = item.link || "";
    const origTitle = item.originalTitle && item.originalTitle !== item.title
      ? escapeMd(item.originalTitle)
      : "";

    let content = `**${idx + 1}. ${title}**\n`;
    if (origTitle) content += `<font color="grey">${origTitle}</font>\n`;
    content += `${escapeMd(summary)}\n`;
    const meta = [];
    meta.push(`来源: ${source}`);
    if (time) meta.push(time);
    if (link) meta.push(`[阅读原文](${link})`);
    content += `<font color="grey">${meta.join(" · ")}</font>`;

    elements.push({
      tag: "div",
      text: { tag: "lark_md", content },
    });

    // 条目之间加分割线（最后一条不加）
    if (idx < items.length - 1) {
      elements.push({ tag: "hr" });
    }
  });

  // 底部备注
  elements.push({ tag: "hr" });
  elements.push({
    tag: "note",
    elements: [
      {
        tag: "plain_text",
        content: "由 Cloudflare Workers · AI News Bot 自动采集并推送",
      },
    ],
  });

  return {
    header: {
      template: "blue",
      title: {
        tag: "plain_text",
        content: "🤖 AI 新闻日报",
      },
    },
    elements,
  };
}

/**
 * 飞书签名算法
 * 文档：https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/bot-v2/add-custom-bot
 * sign = HmacSHA256(timestamp + "\n" + secret, "")  再 base64
 */
async function signWithSecret(secret) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const stringToSign = `${timestamp}\n${secret}`;
  const data = new TextEncoder().encode(stringToSign);

  // 飞书要求：用 stringToSign 作为 key 对空串做 HMAC-SHA256
  const key = await crypto.subtle.importKey(
    "raw",
    data,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, new Uint8Array(0));
  const sign = base64Encode(new Uint8Array(sigBuf));
  return { timestamp, sign };
}

function base64Encode(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** 截断字符串 */
function truncate(str, maxLen) {
  if (!str) return "";
  const s = str.replace(/\s+/g, " ").trim();
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen) + "…";
}

/** 转义飞书 lark_md 中的特殊字符 */
function escapeMd(str) {
  if (!str) return "";
  return str.replace(/[*_`~\[\]]/g, (c) => `\\${c}`);
}

/** 格式化为中文日期时间 */
function formatDateCN(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d} ${hh}:${mm}`;
}
