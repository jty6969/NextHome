# NextHome · 房智罗盘

根目录为新版 NextHome：原生前端、Worker API、Drizzle 数据结构及 SQLite/D1 存储。包含房源录入与编辑、筛选、地图与详情、中英文切换、买卖双方工作台、AI 咨询、消息、议价、预约和双方确认的交易流程。

新版源码来自本地已发布版本 `4d7ab8948b5dbf666dca286a9e076118729c6140`。GitHub 原有 `2cff721` 版本的应用源码和房源资源完整保留在 `legacy/victor/`；本次提交基于原有远程历史，未覆盖或改写历史提交。

## 本地运行新版

安装 Node.js **22.13 或更高版本**，在仓库根目录执行：

```powershell
npm ci
npm run dev
```

打开 <http://127.0.0.1:3000>。首次运行会在 `.local/nexthome.sqlite` 创建数据库并应用 `drizzle/` 迁移，再从应用自带的房源快照导入数据。该数据库不提交到 Git。

买家和卖家可通过页面注册。示例管理员为 `管理员账号1`，示例密码为 `123456`，仅用于本地演示；部署到自己的生产环境前应配置并管理自己的账号。

AI 功能需要服务端环境变量；未配置时页面仍可运行，AI 请求会提示配置缺失：

```powershell
$env:DEEPSEEK_API_KEY = '填入自己的服务端密钥'
npm run dev
```

不要将真实密钥写入源码、提交记录或前端。AI 成功回答还需要上游账号有可用余额。地图的服务端配置和房源同步说明分别见 [MAP_SETUP.md](MAP_SETUP.md) 与 [LISTING_SYNC.md](LISTING_SYNC.md)。本地开发服务器仅监听 `127.0.0.1`。

## 验证与构建

```powershell
npm test
npm run build
npm run sync:listings -- --help
```

构建输出为 `dist/client/`、`dist/server/index.js` 和 `dist/.openai/drizzle/`。`dist/` 为生成目录，不入库。Worker 使用 `DB` 数据库绑定和 `ASSETS` 静态资源绑定；站点构建描述位于 `.openai/hosting.json`。GitHub 上传不等于部署网站，也不会迁移线上用户数据库。

## 目录

| 路径 | 用途 |
| --- | --- |
| `index.html`、`assets/` | 新版页面、样式、工作台脚本、图片与房源导入快照 |
| `worker/` | 鉴权、房源、地图代理、AI 和买卖业务 API |
| `db/`、`drizzle/` | 数据结构与增量数据库迁移 |
| `scripts/` | 构建、本地服务器、同步及可选旧数据迁移 |
| `tests/` | 隔离数据库和页面回归测试 |
| `legacy/victor/` | 同伴原有版本，保留原代码及资源 |

房源资源包括历史挂牌与演示数据，不代表实时成交价；运行时业务记录以数据库为准。

## 运行保留的旧版

```powershell
cd legacy/victor
node server.js
```

也可在该目录双击 `start.bat`。请先停止新版，避免两版同时占用 3000 端口。旧版使用独立的 CommonJS 包设置，保留原有语音输入、双语界面及 AI 咨询逻辑；详细说明见 [旧版 README](legacy/victor/README.md)。如需旧版 AI，将其 `ai-config.example.json` 复制为同目录 `ai-config.json`，自行填写密钥。

`scripts/import-victor.mjs` 与 `scripts/migrate-victor.mjs` 是可选的本地旧数据导入工具，默认读取未提交的 `NextHome-Victor/`。普通运行新版无需这些私有数据；迁移前自行备份数据库，并准备拥有访问权限的本地数据。旧会话和旧客户端交易快照不会转换为有效交易确认。

## 不入库的内容

真实密钥与 `.env` 文件、用户数据与会话、本地数据库、`listing-data/` 导出、日志、构建产物、`outputs/`、内部 Word 文档和内部合并报告均不提交。已有内部 Word 文档保留在本地及原 Git 历史中，从本次 `main` 文件树移除。
