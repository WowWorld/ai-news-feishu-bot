# 🤖 AI News → Feishu Bot (Cloudflare Workers)

一个部署在 **Cloudflare Workers** 上的轻量服务，自动抓取主流 AI 媒体的 RSS 资讯，去重后通过**飞书自定义机器人 Webhook** 把每日摘要推送到你的群聊。

## ✨ 特性

- 📡 **多源聚合**：内置 8 个高质量 AI 新闻源（MIT Tech Review、TechCrunch、VentureBeat、The Verge、OpenAI、Google Research、Hugging Face、Anthropic），可自由增删
- 🔁 **自动去重**：基于 Workers KV 存储 SHA-256 哈希，跨源、跨天去重，绝不重复推送
- 📨 **飞书卡片**：互动卡片消息，标题/摘要/来源/时间/原文链接一目了然，支持签名校验
- ⏰ **定时触发**：Cloudflare Cron Triggers，默认每天北京时间 09:00 自动执行
- ⚙️ **零代码配置**：所有参数走环境变量，部署后改配置无需重新发版
- 🧪 **手动触发**：提供 `/trigger` HTTP 端点，随时手动跑一次，方便调试
- 💰 **免费运行**：纯 Workers + KV，免费额度完全够用

## 📁 项目结构

```
ai-news-feishu-bot/
├── wrangler.toml        # Cloudflare Workers 配置（Cron / KV / 环境变量）
├── package.json
├── .gitignore
├── README.md
└── src/
    ├── index.js         # 主入口：Cron 触发 + HTTP 路由
    ├── config.js        # 环境变量读取与默认配置
    ├── rss.js           # RSS 2.0 / Atom 抓取与解析（无第三方依赖）
    ├── feishu.js        # 飞书卡片消息构建与 Webhook 推送（含签名）
    └── dedupe.js        # 基于 KV 的 SHA-256 去重
```

## 🚀 部署步骤

### 1. 前置准备

- 注册 [Cloudflare](https://dash.cloudflare.com/) 账号
- 安装 Node.js 18+ 和 Wrangler CLI：
  ```bash
  npm install -g wrangler
  wrangler login   # 浏览器授权
  ```
- 在飞书群里添加「自定义机器人」，拿到 Webhook 地址（形如 `https://open.feishu.cn/open-apis/bot/v2/hook/xxxx`）。如开启了签名校验，记下 secret。

### 2. 克隆 & 安装

```bash
git clone https://github.com/WowWorld/ai-news-feishu-bot.git
cd ai-news-feishu-bot
npm install
```

### 3. 创建 KV 命名空间（用于去重）

```bash
wrangler kv:namespace create NEWS_KV
```

把返回的 `id` 填到 `wrangler.toml` 里：

```toml
[[kv_namespaces]]
binding = "NEWS_KV"
id = "上一步返回的 id"
```

### 4. 配置飞书 Webhook（敏感信息用 secret，别写进 toml）

```bash
wrangler secret put FEISHU_WEBHOOK_URL
# 粘贴你的飞书 webhook 地址

wrangler secret put FEISHU_WEBHOOK_SECRET   # 可选，仅当开启了签名校验
```

### 5. （可选）修改推送频率 / 新闻源

编辑 `wrangler.toml`：

```toml
[triggers]
# Cron 表达式（UTC 时间）。下例为每天 UTC 01:00 = 北京时间 09:00
crons = ["0 1 * * *"]

# 如需每天早晚各推一次：
# crons = ["0 1,12 * * *"]
```

新闻源在 `[vars]` 的 `RSS_SOURCES` 中以 JSON 数组配置，直接增删即可，无需改代码。

### 6. 本地调试

```bash
wrangler dev
# 然后访问 http://localhost:8787/trigger 手动触发一次
```

本地调试时可在项目根目录创建 `.dev.vars` 文件存放 secret：

```
FEISHU_WEBHOOK_URL=https://open.feishu.cn/open-apis/bot/v2/hook/xxxx
FEISHU_WEBHOOK_SECRET=你的签名密钥
```

### 7. 部署到 Cloudflare

```bash
wrangler deploy
```

部署完成后，Worker 会获得一个 `https://ai-news-feishu-bot.<你的子域>.workers.dev` 地址，Cron 会按设定时间自动执行。

## 🔌 HTTP 端点

| 路径 | 方法 | 说明 |
|------|------|------|
| `/` | GET | 健康检查 |
| `/trigger` | GET | 手动触发一次抓取+推送，返回执行结果 JSON |
| `/sources` | GET | 查看当前生效的新闻源列表 |

## ⚙️ 环境变量参考

| 变量名 | 类型 | 必填 | 默认值 | 说明 |
|--------|------|------|--------|------|
| `FEISHU_WEBHOOK_URL` | secret | ✅ | — | 飞书自定义机器人 Webhook 地址 |
| `FEISHU_WEBHOOK_SECRET` | secret | ❌ | — | 签名校验密钥（开启签名时填写） |
| `RSS_SOURCES` | var | ❌ | 内置 8 源 | JSON 数组，`[{name,url}]` |
| `MAX_ITEMS` | var | ❌ | `10` | 每次推送最多条数 |
| `SUMMARY_MAX_LENGTH` | var | ❌ | `200` | 摘要最大字符数 |
| `MAX_ITEMS_PER_SOURCE` | var | ❌ | `20` | 单个源最多抓取条数 |
| `FETCH_TIMEOUT_MS` | var | ❌ | `15000` | 单源抓取超时（毫秒） |

## 🛠️ 常见问题

**Q: Cron 没有按时执行？**
A: Cloudflare Cron 最小精度为 1 分钟，且可能有几十秒延迟。在 Dashboard → Workers → 你的 Worker → Triggers 标签页可查看执行记录与日志。

**Q: 想换个推送时间？**
A: 改 `wrangler.toml` 里的 `crons` 后重新 `wrangler deploy` 即可。注意 Cron 使用 UTC 时间，北京时间需 -8 小时。

**Q: 没有新新闻时不推送？**
A: 是的，去重后若没有新增内容会跳过推送（日志可见）。这样避免每天收到重复内容刷屏。

**Q: KV 写入会不会超限？**
A: 免费版 KV 每天有 1000 次写入限制，本服务每天最多写 1 次（单 key 存全部 hash），完全够用。

## 📄 License

MIT
