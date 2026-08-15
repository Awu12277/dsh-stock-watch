# dsh-stock-watch
<p align="center">
  <a href="https://www.npmjs.com/package/dsh-stock-watch"><img src="https://img.shields.io/npm/v/dsh-stock-watch?style=flat-square&color=00ff41&labelColor=050607" alt="npm version"></a>
  <img src="https://img.shields.io/badge/license-MIT-ff1493?style=flat-square&labelColor=050607" alt="MIT">
</p>

[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)


A 股自选股实时行情**盯盘插件**：在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）Web 界面的**右上角**显示一个可折叠弹窗，实时监控自选股行情、切换分组、查看分时与 K 线、设置买卖目标价。

数据源与原终端 CLI 项目 [stocking](https://github.com/Awu12277/stocking) 同源（腾讯财经），配色沿用 A 股红涨绿跌惯例。

## 安装

已发布到 npm，一条命令安装到你的 web profile：

```bash
dsh plugin --profile web add dsh-stock-watch
```

- 本地开发安装：`dsh plugin --profile web add file:D:\projects\github\dsh-stock-watch`
- 或直接通过 git：`dsh plugin --profile web add github:Awu12277/dsh-stock-watch`
- 安装后**重启 `dsh web` 生效**；卸载：`dsh plugin --profile web remove dsh-stock-watch`

安装完成后，刷新页面，右上角出现「📈 自选股」药丸。

## 截图

| 折叠药丸（右上角实时涨跌家数） | 暗色列表（分组 + 分时迷你折线 + 目标价触发） |
|---|---|
| ![pill](screenshots/pill.png) | ![list-dark](screenshots/list-dark.png) |

| 暗色·分时（价格线 / 均价线 / 昨收基准） | 暗色·日 K（TradingView Lightweight Charts） |
|---|---|
| ![minute](screenshots/detail-minute-dark.png) | ![kline](screenshots/detail-kline-dark.png) |

| 浅色主题 |
|---|
| ![light](screenshots/light.png) |

## 功能特性

- **右上角可折叠弹窗**：折叠时显示自选股实时涨跌家数药丸；展开为完整列表，点击任意行进入详情
- **胶囊可拖动**：按住「📈 自选股」药丸可拖到屏幕任意位置，面板随之跟随（右边缘对齐）；展开后按住面板头部也可拖动；位置持久化到 localStorage
- **多分组自选股**：分组 tab 切换（分组名 + 股票数），配置存浏览器 `localStorage`（首次自动从 `~/.stocking/settings.json` 迁移）
- **实时行情列表**：名称 / 代码、现价、涨跌幅、分时迷你折线、目标价触发标记（买入 / 卖出 / 等待 / -），每 10s 自动刷新（带倒计时）
- **分时视图**：全天分钟价格线（红涨绿跌）+ 黄色均价线（VWAP）+ 昨收虚线基准，时间轴按 **A 股交易时段（北京时间 09:30–11:30 / 13:00–15:00）** 标注，午间休市留白
- **K 线视图**：日 K / 周 K / 月 K 前复权蜡烛图 + 成交量柱 + **MA 均线（MA5 白 / MA10 黄 / MA20 紫 / MA60 绿，A 股配色，右上角可自定义隐藏/显示，配置存 localStorage）**，基于 [TradingView Lightweight Charts](https://tradingview.github.io/lightweight-charts/docs)（CDN 懒加载，失败自动降级为自绘 SVG）
- **目标价可编辑**：详情页点击「买入目标 / 卖出目标」进入输入框（数字 + 两位小数、留空清除、回车确认 / Esc 取消），即时重算触发标记并持久化
- **暗色 / 浅色主题**：CSS 变量两套配色，默认暗色，☀️/🌙 一键切换（图表配色联动）

## 架构

```
┌─────────────── Web 浏览器 ───────────────┐
│  client.js（客户端插件模块）              │
│  · shell.overlay 槽位 → 右上角弹窗        │
│  · React + Lightweight Charts + SVG 降级  │
│  · 配置存 localStorage（stocking.config.v1）│
│          │ fetch（同源 /dsh-stock-watch/*）│
└──────────┼────────────────────────────────┘
           ▼
┌─────────────── DSH Host（index.js）───────┐
│  cordis 插件：webServer 注册 4 个路由      │
│  · /config   读取 ~/.stocking/settings.json│
│  · /quotes   实时行情（腾讯分钟接口）      │
│  · /kline    日/周/月 K 线（fqkline）      │
│  · /minute   分时详情（分钟点 + 昨收）     │
└───────────────────────────────────────────┘
```

### 数据源

- 行情快照 + 分时：`https://web.ifzq.gtimg.cn/appstock/app/minute/query?code={code}&r=0.1`
- 日/周/月 K 线：`https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param={code},{period},,,{count},qfq`

解析逻辑（字段索引、K 线 `[date, open, close, high, low, volume]` 列序、昨收由 `现价/(1+涨跌幅%)` 反推）与 [stocking 的 market.ts](https://github.com/Awu12277/stocking/blob/main/src/market.ts) 保持一致。Host 端使用 Node 原生 `fetch` 直连（部署即使未挂载 web fetch provider 或沙箱封锁网络，本插件也不受影响）。

## 目录结构

```
dsh-stock-watch/
├── index.js           # node 端 cordis 插件（webServer 路由）
├── client.js          # 浏览器端客户端模块（__ModuleLoader__ + shell.overlay 槽位）
├── cordis.patch.yml   # 组合补丁：插入 host 插件行（dsh.bundle.patch）
├── package.json       # dsh.bundle + dsh.client 声明
├── screenshots/       # 运行截图
└── README.md
```

`dsh plugin add` 即 profile 目录内的 `pnpm add`：安装后按 package.json 的 `dsh.bundle.patch` 自动并入 profile 层栈，`dsh.client` 声明自动挂载浏览器端模块。

## 交互说明

| 状态 | 操作 |
|---|---|
| 药丸 | 点击展开 |
| 列表 | 分组 tab 切换 · 点击行进详情 · ⟳ 手动刷新 · — 折叠 · ☀️/🌙 切主题 |
| 详情 | ← 返回 · 分时 / 日K / 周K / 月K 切换 · 点击买入/卖出目标编辑 |

## 配置与持久化

- 自选股配置（分组、代码、买卖目标价）存浏览器 `localStorage`（key：`stocking.config.v1`）
- 首次打开自动从 `~/.stocking/settings.json` 一次性迁移（失败则用默认分组），之后 localStorage 为唯一数据源
- 重置：`localStorage.removeItem('stocking.config.v1')` 后刷新页面

## License

MIT
