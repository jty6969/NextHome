# NextHome · 房智罗盘

AI 购房助手网站 —— 以上海浦东真实在售房源为数据基础，集 **AI 购房对话、房源浏览、买卖双方消息沟通、看房预约、议价受理、双方确认制交易流程** 于一体的全流程演示项目。

- 后端：Node.js **零依赖**原生 HTTP 服务器（[server.js](server.js)）
- 前端：纯原生 HTML / CSS / JavaScript（无框架、无构建工具，SPA 单页应用）
- AI：DeepSeek（`deepseek-chat`），服务端转发，API Key 不进前端

## 功能总览

### 买家侧
- **AI 购房助手**：对话式需求挖掘（预算/户型/板块偏好），基于买家画像与历史行为推荐房源
- **房源浏览**：35 套真实挂牌房源，列表筛选 + 详情页（价格走势、周边配套、卖点与短板分析）
- **消息与议价**：与卖家实时沟通，对房源发起议价，等待卖家受理（接受 / 还价 / 拒绝）
- **看房预约**：选择日期与时段提交申请，等待卖家确认
- **交易流程**：议价达成后自动生成六步交易，每个环节需**买卖双方共同确认**才能进入下一步

### 卖家侧
每套房源对应一个独立卖家账号，登录后进入**卖家中心**：
- 📢 我的房源：名下在售房源一览
- 💬 消息回复：查看买家会话（含未读角标），手动回复
- 📅 看房申请：确认或婉拒买家的预约（可附说明，买家收到系统通知）
- 💰 议价受理：接受出价（自动创建交易）/ 还价 / 拒绝
- 📋 交易推进：与买家逐环节双向确认，推进六步交易

### 交易流程（双方确认制）
```
达成意向 → 签约定金 → 网签备案 → 资金监管+贷款 → 过户 → 交房交接
```
从第二步起，每个环节必须买家与卖家**都点击确认**才会进入下一环节，页面实时显示双方确认状态（5 秒轮询自动刷新）。

## 快速开始

1. 安装 [Node.js](https://nodejs.org/)（任意较新版本，无需 npm install）
2. 配置 AI：复制 `ai-config.example.json` 改名为 `ai-config.json`，填入你的 DeepSeek API Key
3. 启动：双击 `start.bat`，或在项目根目录运行
   ```bash
   node server.js
   ```
4. 打开 http://127.0.0.1:3000

## 账号说明

- **买家**：在登录页自行注册
- **卖家**：服务器首次启动时自动播种，每套房源一个账号，统一密码 `seller123`

| 房源 | 卖家账号 | 数量 |
|---|---|---|
| 罗山花苑（明月路199弄） | `seller_lshy01` … `seller_lshy15` | 15 |
| 世茂湖滨花园（明月路188弄） | `seller_smhb01` … `seller_smhb15` | 15 |
| 汤臣一品 | `seller_tcyp01` … `seller_tcyp05` | 5 |

## 项目结构

```
Nexthome/
├── server.js                  # 后端总控：静态托管、注册登录、卖家接口、AI 转发
├── start.bat                  # Windows 一键启动
├── ai-config.example.json     # AI 配置模板（真实 ai-config.json 不入库）
├── public/                    # 前端（SPA）
│   ├── index.html             # 页面骨架
│   ├── css/style.css          # 全部样式
│   └── js/
│       ├── app.js             # 路由 / 本地存储 / 工具函数
│       ├── api.js             # 后端通信 + AI 调用
│       └── pages/             # 每个文件对应一个页面
│           ├── auth.js             登录注册
│           ├── home.js             首页
│           ├── properties.js       房源列表
│           ├── propertyDetail.js   房源详情
│           ├── chat.js             AI 购房助手
│           ├── messages.js         消息与议价（买家）
│           ├── viewing.js          看房预约（买家）
│           ├── transaction.js      交易流程（买家确认侧）
│           └── seller.js           卖家中心
├── data/
│   ├── properties/            # ★ 房源库：每套一个 JSON，共 35 套（含来源链接）
│   ├── properties.json        # 旧格式数据（兼容保留）
│   └── ai-summary/            # ★ 房源 AI 分析表（供其他 AI 读取）
│       ├── properties-ai-table.json   # 结构化 JSON（含字段说明）
│       ├── properties-ai-table.csv    # 表格（Excel 可开）
│       └── properties-ai-table.md     # Markdown 表（可直接贴给 LLM）
└── tools/                     # 数据生产线（手动运行，非网站运行依赖）
    ├── generate-properties.js     # 生成/覆盖 data/properties/ 全部房源
    └── generate-ai-summary.js     # 依据房源库重新生成 ai-summary 三张表
```

## 数据说明

- 房源数据采集自房天下公开在售挂牌（贝壳/链家存在登录墙），每套房源 JSON 的 `source` 字段记录了原始页面链接与采集日期
- 小区背景：罗山花苑为碧云板块 2000 年前后的多层板楼社区，世茂湖滨花园为 2003-2004 年高层湖景社区，两者均邻近 9 号线蓝天路站
- 运行时产生的用户数据写入 `data/users/` 与 `data/sessions.json`，**已通过 .gitignore 排除，不会上传**
- 更新房源后重新生成分析表：
  ```bash
  node tools/generate-properties.js     # 重写房源库
  node tools/generate-ai-summary.js     # 刷新 AI 分析表
  ```

## 目录约定

- 私有仓库，All rights reserved。
- ⚠️ 请勿将 `ai-config.json`（API Key）、`data/users/`、`data/sessions.json` 提交到任何公开仓库。
