/**
 * dsh-stock-watch — node 端
 *
 * cordis 插件：在 dsh web 服务器上注册 /dsh-stock-watch/* 路由：
 *   - /dsh-stock-watch/config   读取 ~/.stocking/settings.json（客户端首次迁移用）
 *   - /dsh-stock-watch/quotes   按分组拉取实时行情（腾讯分钟接口，快照 + 分时）
 *   - /dsh-stock-watch/kline    日/周/月 K 线（fqkline 接口，前复权）
 *   - /dsh-stock-watch/minute   分时详情（分钟点 + 昨收）
 *
 * 浏览器端（client.js）通过 fetch 消费这些路由。
 * 数据源与原 stocking CLI 的 market.ts 同源：腾讯财经 web.ifzq.gtimg.cn。
 */
import { homedir } from "node:os";
import { readFile } from "node:fs/promises";
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const name = "dsh-stock-watch";
/** Required services: webServer（HTTP 路由）。 */
const inject = ["webServer"];

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const STOCKS_PATH = join(MODULE_DIR, "data", "a_stocks.json");
const SKILLS_SRC_DIR = join(MODULE_DIR, "skills");
/** 安装时注入到用户技能目录的技能（与「一键分析」提示词引用的技能保持一致）。 */
const BUNDLED_SKILLS = ["investment-research", "frontend-design"];

// ---------------------------------------------------------------------------
// 技能注入：安装插件（首次启动 dsh web）时把自带技能复制到用户技能目录
// ~/.agents/skills/<name>/，让「一键分析」引用的技能真正可用（此前只是随包文件）。
// - 目标已存在 SKILL.md 则跳过，尊重用户已有/自定义版本（删除后重启可重新注入）
// - 可用环境变量覆盖：DSH_STOCK_WATCH_SKILLS_DIR（目标目录）、DSH_STOCK_WATCH_NO_SKILLS=1（禁用）
// ---------------------------------------------------------------------------
function copyDirSync(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const s = join(src, entry.name);
    const d = join(dest, entry.name);
    if (entry.isDirectory()) copyDirSync(s, d);
    else copyFileSync(s, d);
  }
}

function ensureUserSkills() {
  if (process.env.DSH_STOCK_WATCH_NO_SKILLS === "1") return;
  const skillsRoot = process.env.DSH_STOCK_WATCH_SKILLS_DIR || join(homedir(), ".agents", "skills");
  for (const skill of BUNDLED_SKILLS) {
    const src = join(SKILLS_SRC_DIR, skill);
    const dest = join(skillsRoot, skill);
    try {
      if (existsSync(join(dest, "SKILL.md"))) continue; // 已存在：尊重用户版本，不覆盖
      if (!existsSync(join(src, "SKILL.md"))) continue; // 包内缺失（本地开发可能没拷）：跳过
      copyDirSync(src, dest);
      writeFileSync(
        join(dest, "_user_meta.json"),
        JSON.stringify({ name: skill, installedAt: Date.now(), source: "dsh-stock-watch" }, null, 2),
      );
      console.log(`[dsh-stock-watch] 已注入技能 ${skill} -> ${dest}`);
    } catch (e) {
      console.error(`[dsh-stock-watch] 技能 ${skill} 注入失败:`, e && e.message ? e.message : e);
    }
  }
}

let stocksCache = null;

// ---------------------------------------------------------------------------
// 扇形菜单注入提示词（不直接暴露：客户端只发送「每日复盘/行情分析/涨停分析」几个字，
// 完整提示词由系统提示条件式注入——仅当用户消息匹配对应关键词时生效）
// ---------------------------------------------------------------------------
const FAN_PROMPTS = {
  每日复盘: `请作为专业的A股短线复盘分析师，帮我完成今天的盘后复盘。请基于以下框架：

1. 市场概览：指数表现、成交量变化、涨跌家数分布。不要只报数据，要点出"这说明什么"。

2. 涨停梯队：今日涨停多少家？炸板多少家？连板高度到几板了？首板、二板、三板各多少？晋级率如何？

3. 主线与轮动：今天市场围绕哪些方向在交易？哪些是主线、哪些只是轮动？哪些方向冲高回落？

4. 情绪判断：今天的情绪是在加强、分化、修复还是退潮？赚钱效应如何？

5. 核心个股反馈：龙头股、中军股的表现如何？从它们的走势能看出什么？

6. 明日关键观察：明天最需要盯住的变量是什么？不要只说"关注市场变化"，要说具体看什么指标。

输出格式用7个板块，每个板块一句话结论。要有明确判断，不要模棱两可。`,
  行情分析: `获取A股实时行情数据，给出整体分析：

市场温度：当前是进攻还是防守格局？一句话定性。

量价关系：放量还是缩量？量价是否配合？说明什么？

结构分化：大小盘风格如何？哪些板块在领涨/领跌？

操作基调：此刻适合积极、谨慎还是观望？给明确结论。
输出要求：每项不超过两行，总字数控制在200字以内。`,
  涨停分析: `基于今日涨停数据（涨停家数、连板高度、炸板率、涨停板块分布），分析：

情绪热度（亢奋/正常/冰点）

主线板块（涨停最集中方向）

龙头高度及晋级情况

明天接力风险或机会
每项一句话，总字数控制在150字以内。`,
};

const MINUTE_API = "https://web.ifzq.gtimg.cn/appstock/app/minute/query?code={code}&r=0.1";
const KLINE_API = "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param={code},{period},,,{count},qfq";

const DEFAULT_GROUPS = [
  { name: "分组1", symbols: [{ code: "sh000001" }, { code: "sz399300" }, { code: "sh601899" }] },
  { name: "分组2", symbols: [] },
];

// ---------------------------------------------------------------------------
// 配置读取与容错清洗（与 stocking/src/settings.ts 语义一致）
// ---------------------------------------------------------------------------

/** 只接受正数价格，其余视为未配置 */
function normalizePrice(v) {
  const n = typeof v === "string" ? parseFloat(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return undefined;
  return n;
}

function normalizeSymbol(raw) {
  if (typeof raw === "string") return { code: raw };
  if (!raw || typeof raw !== "object") return null;
  const o = raw;
  if (typeof o.code !== "string" || o.code.length === 0) return null;
  const s = { code: o.code };
  if (typeof o.name === "string" && o.name.trim()) s.name = o.name.trim();
  const buy = normalizePrice(o.buyPrice);
  if (buy !== undefined) s.buyPrice = buy;
  const sell = normalizePrice(o.sellPrice);
  if (sell !== undefined) s.sellPrice = sell;
  return s;
}

function normalizeGroup(raw) {
  if (!raw || typeof raw !== "object") return null;
  const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim().slice(0, 32) : "未命名分组";
  const symbols = [];
  const seen = new Set();
  if (Array.isArray(raw.symbols)) {
    for (const item of raw.symbols) {
      const sym = normalizeSymbol(item);
      if (!sym || seen.has(sym.code)) continue;
      seen.add(sym.code);
      symbols.push(sym);
    }
  }
  return { name, symbols };
}

/** 客户端 localStorage 配置（清洗 + 跨组去重） */
function normalizeClientGroups(raw) {
  if (!Array.isArray(raw)) return null;
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    const g = normalizeGroup(item);
    if (!g) continue;
    g.symbols = g.symbols.filter((s) => {
      if (seen.has(s.code)) return false;
      seen.add(s.code);
      return true;
    });
    out.push(g);
  }
  return out.length > 0 ? out : null;
}

async function loadGroups() {
  const path = join(homedir(), ".stocking", "settings.json");
  try {
    const text = await readFile(path, "utf8");
    const parsed = JSON.parse(text);
    const groups = [];
    const seen = new Set();
    if (Array.isArray(parsed?.groups)) {
      for (const item of parsed.groups) {
        const group = normalizeGroup(item);
        if (!group) continue;
        group.symbols = group.symbols.filter((s) => {
          if (seen.has(s.code)) return false;
          seen.add(s.code);
          return true;
        });
        groups.push(group);
      }
    } else if (Array.isArray(parsed?.symbols)) {
      // v1 扁平结构 → 内存迁移为单分组
      const group = { name: "分组1", symbols: [] };
      const localSeen = new Set();
      for (const item of parsed.symbols) {
        const sym = normalizeSymbol(item);
        if (!sym || localSeen.has(sym.code)) continue;
        localSeen.add(sym.code);
        group.symbols.push(sym);
      }
      groups.push(group);
    }
    if (groups.length > 0) return { groups, source: "file", path };
  } catch {
    /* 读取/解析失败 → 兜底默认分组 */
  }
  return { groups: DEFAULT_GROUPS, source: "default", path: null };
}

// ---------------------------------------------------------------------------
// 腾讯财经接口（与 stocking/src/market.ts 同源）
// ---------------------------------------------------------------------------

function normalizeApiCode(code) {
  if (code.startsWith("sh") || code.startsWith("sz")) return code;
  if (/^(60|68|51)/.test(code)) return "sh" + code;
  if (/^(00|30|39)/.test(code)) return "sz" + code;
  return "sh" + code;
}

/** 股票池：data/a_stocks.json（全 A 股 {code, name}，惰性加载并缓存；兼容 BOM） */
async function loadStocks() {
  if (stocksCache) return stocksCache;
  try {
    const text = await readFile(STOCKS_PATH, "utf8");
    const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    const parsed = JSON.parse(clean);
    stocksCache = Array.isArray(parsed) ? parsed : [];
  } catch {
    stocksCache = [];
  }
  return stocksCache;
}

async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** 解析单只股票的分钟接口响应（快照 + 可选分时价格） */
function parseMinuteJson(code, json, includeMinutes) {
  if (!json || json.code !== 0) return { quote: null, prices: [] };
  const apiCode = normalizeApiCode(code);
  const sd = json.data && json.data[apiCode];
  if (!sd) return { quote: null, prices: [] };
  let prices = [];
  if (includeMinutes) {
    const raw = sd.data && sd.data.data;
    if (Array.isArray(raw)) {
      for (const line of raw) {
        const parts = String(line).split(" ");
        if (parts.length >= 2) {
          const p = parseFloat(parts[1]);
          if (!Number.isNaN(p)) prices.push(p);
        }
      }
    }
  }
  const qt = sd.qt && sd.qt[apiCode];
  if (Array.isArray(qt) && qt.length >= 35) {
    return {
      quote: {
        code,
        name: String(qt[1] ?? ""),
        price: parseFloat(qt[3] ?? "0"),
        changeAmount: parseFloat(qt[31] ?? "0"),
        changePercent: parseFloat(qt[32] ?? "0"),
        high: parseFloat(qt[33] ?? "0"),
        low: parseFloat(qt[34] ?? "0"),
        volume: parseInt(qt[6] ?? "0", 10),
        amount: parseFloat(qt[37] ?? "0") * 10000,
      },
      prices,
    };
  }
  return { quote: null, prices };
}

async function fetchQuoteResult(symbol, includeMinutes) {
  try {
    const json = await fetchJson(MINUTE_API.replace("{code}", normalizeApiCode(symbol.code)));
    return parseMinuteJson(symbol.code, json, includeMinutes);
  } catch {
    return { quote: null, prices: [] };
  }
}

function computeTrigger(price, buyPrice, sellPrice) {
  if (buyPrice === undefined && sellPrice === undefined) return "none";
  if (sellPrice !== undefined && price >= sellPrice) return "sell";
  if (buyPrice !== undefined && price <= buyPrice) return "buy";
  return "wait";
}

async function fetchKline(code, period, refPrice) {
  const apiCode = normalizeApiCode(code);
  const count = period === "day" ? "160" : "120";
  const url = KLINE_API.replace("{code}", apiCode).replace("{period}", period).replace("{count}", count);
  try {
    const json = await fetchJson(url);
    if (!json || json.code !== 0) return { candles: [], error: "接口返回异常" };
    const sd = json.data && json.data[apiCode];
    if (!sd) return { candles: [], error: "无K线数据" };
    const keys = period === "day"
      ? ["qfqday", "day", "hfqday"]
      : period === "week" ? ["qfqweek", "week", "hfqweek"] : ["qfqmonth", "month", "hfqmonth"];
    let rows = null;
    for (const k of keys) {
      if (Array.isArray(sd[k])) { rows = sd[k]; break; }
    }
    if (!rows) return { candles: [], error: "无K线数据" };
    const candles = [];
    for (const row of rows) {
      if (!Array.isArray(row) || row.length < 5) continue;
      const time = String(row[0]);
      const open = parseFloat(row[1]);
      const close = parseFloat(row[2]);
      const high = parseFloat(row[3]);
      const low = parseFloat(row[4]);
      if (!time || Number.isNaN(open) || Number.isNaN(close) || Number.isNaN(high) || Number.isNaN(low)) continue;
      candles.push({ time, open, high, low, close, volume: parseFloat(row[5]) || 0 });
    }
    if (candles.length === 0) return { candles: [], error: "无K线数据" };
    // 自校正（实测列序 [date, open, close, high, low, volume] 正确，仅作保险）
    if (typeof refPrice === "number" && Number.isFinite(refPrice) && refPrice > 0) {
      const last = candles[candles.length - 1];
      if (last && Math.abs(last.low - refPrice) < Math.abs(last.close - refPrice)) {
        for (const c of candles) {
          const close = c.low;
          const high = c.close;
          const low = c.high;
          c.close = close;
          c.high = high;
          c.low = low;
        }
      }
    }
    return { candles, error: null };
  } catch {
    return { candles: [], error: "行情获取失败" };
  }
}

async function fetchMinuteDetail(code) {
  const apiCode = normalizeApiCode(code);
  try {
    const json = await fetchJson(MINUTE_API.replace("{code}", apiCode));
    if (!json || json.code !== 0) return { date: null, prevClose: null, points: [], error: "接口返回异常" };
    const sd = json.data && json.data[apiCode];
    if (!sd || !sd.data) return { date: null, prevClose: null, points: [], error: "无分时数据" };
    const raw = sd.data.data;
    const date = typeof sd.data.date === "string" ? sd.data.date : "";
    const isoDate = date.length === 8 ? `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}` : "";
    const points = [];
    if (Array.isArray(raw)) {
      for (const line of raw) {
        const parts = String(line).split(" ");
        if (parts.length < 3) continue;
        const hm = parts[0];
        const p = parseFloat(parts[1]);
        const v = parseFloat(parts[2]) || 0;
        if (!/^\d{4}$/.test(hm) || Number.isNaN(p)) continue;
        let t = 0;
        if (isoDate) {
          const ms = Date.parse(`${isoDate}T${hm.slice(0, 2)}:${hm.slice(2, 4)}:00+08:00`);
          if (!Number.isNaN(ms)) t = Math.round(ms / 1000);
        }
        if (t <= 0) continue;
        points.push({ t, p, v });
      }
    }
    let prevClose = null;
    const qt = sd.qt && sd.qt[apiCode];
    if (Array.isArray(qt) && qt.length >= 35) {
      const price = parseFloat(qt[3] ?? "0");
      const chg = parseFloat(qt[32] ?? "0");
      if (price > 0 && Number.isFinite(chg)) prevClose = price / (1 + chg / 100);
    }
    if (points.length === 0) return { date, prevClose, points: [], error: "无分时数据" };
    return { date, prevClose, points, error: null };
  } catch {
    return { date: null, prevClose: null, points: [], error: "行情获取失败" };
  }
}

// ---------------------------------------------------------------------------
// HTTP 路由
// ---------------------------------------------------------------------------

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(body);
}

function queryOf(req) {
  return new URL(req.url ?? "/", "http://x").searchParams;
}

/**
 * 插件主体：注册 /dsh-stock-watch/* 路由。
 * @param {import("cordis").Context} ctx
 */
function apply(ctx) {
  // 安装/启动时把自带技能注入用户技能目录（幂等：已有则跳过）
  try {
    ensureUserSkills();
  } catch (e) {
    console.error("[dsh-stock-watch] 技能注入异常:", e && e.message ? e.message : e);
  }

  const register = (path, handler) =>
    ctx.effect(() => ctx.webServer.register({ kind: "exact", path, handler }), `dsh-stock-watch: ${path}`);

  register("/dsh-stock-watch/config", async (_req, res) => {
    const loaded = await loadGroups();
    sendJson(res, 200, { groups: loaded.groups, source: loaded.source, path: loaded.path });
  });

  // 添加股票搜索：按代码或名称匹配全 A 股池，返回带市场前缀的代码
  register("/dsh-stock-watch/stocks", async (req, res) => {
    const needle = (queryOf(req).get("q") ?? "").trim();
    if (!needle) {
      sendJson(res, 200, { rows: [] });
      return;
    }
    const lower = needle.toLowerCase();
    const list = await loadStocks();
    const rows = [];
    for (const s of list) {
      if (s.code.includes(lower) || (s.name && s.name.toLowerCase().includes(lower))) {
        rows.push({ code: normalizeApiCode(s.code), name: s.name });
        if (rows.length >= 50) break;
      }
    }
    sendJson(res, 200, { rows, total: rows.length });
  });

  register("/dsh-stock-watch/quotes", async (req, res) => {
    try {
      const q = queryOf(req);
      const groupIndex = parseInt(q.get("group") ?? "0", 10) || 0;
      const includeMinutes = q.get("minutes") === "1";
      let loaded;
      const groupsParam = q.get("groups");
      if (groupsParam) {
        try {
          const clientGroups = normalizeClientGroups(JSON.parse(groupsParam));
          loaded = clientGroups ? { groups: clientGroups, source: "local", path: null } : await loadGroups();
        } catch {
          loaded = await loadGroups();
        }
      } else {
        loaded = await loadGroups();
      }
      const groups = loaded.groups;
      const safeIdx = groups.length > 0 ? Math.min(groupIndex, groups.length - 1) : 0;
      const group = groups[safeIdx] || groups[0] || null;
      const symbols = group ? group.symbols : [];
      const results = await Promise.all(symbols.map((s) => fetchQuoteResult(s, includeMinutes)));
      const rows = [];
      let live = 0;
      let firstError = null;
      for (let i = 0; i < symbols.length; i++) {
        const sym = symbols[i];
        const parsed = results[i] ?? { quote: null, prices: [] };
        if (!parsed.quote && !firstError) firstError = "拉取失败";
        const q2 = parsed.quote;
        const row = {
          code: sym.code,
          name: q2 ? q2.name : sym.name || sym.code,
          trigger: "none",
          live: false,
        };
        if (sym.buyPrice !== undefined) row.buyPrice = sym.buyPrice;
        if (sym.sellPrice !== undefined) row.sellPrice = sym.sellPrice;
        if (q2) {
          live += 1;
          row.live = true;
          row.price = q2.price;
          row.changePercent = q2.changePercent;
          row.changeAmount = q2.changeAmount;
          row.high = q2.high;
          row.low = q2.low;
          row.volume = q2.volume;
          row.amount = q2.amount;
          row.trigger = computeTrigger(q2.price, sym.buyPrice, sym.sellPrice);
          if (includeMinutes && parsed.prices && parsed.prices.length > 0) row.minutes = parsed.prices;
        }
        rows.push(row);
      }
      sendJson(res, 200, {
        groups: groups.map((g) => ({ name: g.name, count: g.symbols.length })),
        groupIndex: safeIdx,
        rows,
        live: live > 0,
        updatedAt: Date.now(),
        config: { source: loaded.source, path: loaded.path },
        diag: { firstError },
      });
    } catch (e) {
      sendJson(res, 500, { error: String(e?.message ?? e) });
    }
  });

  register("/dsh-stock-watch/kline", async (req, res) => {
    const q = queryOf(req);
    const code = q.get("code") ?? "";
    const period = q.get("period") === "week" || q.get("period") === "month" ? q.get("period") : "day";
    const refRaw = parseFloat(q.get("refPrice") ?? "");
    const refPrice = Number.isFinite(refRaw) && refRaw > 0 ? refRaw : null;
    if (!code) {
      sendJson(res, 400, { code, period, candles: [], error: "缺少股票代码", updatedAt: Date.now() });
      return;
    }
    const result = await fetchKline(code, period, refPrice);
    sendJson(res, 200, { code, period, candles: result.candles, error: result.error, updatedAt: Date.now() });
  });

  register("/dsh-stock-watch/minute", async (req, res) => {
    const q = queryOf(req);
    const code = q.get("code") ?? "";
    if (!code) {
      sendJson(res, 400, { code, date: null, prevClose: null, points: [], error: "缺少股票代码", updatedAt: Date.now() });
      return;
    }
    const result = await fetchMinuteDetail(code);
    sendJson(res, 200, {
      code,
      date: result.date,
      prevClose: result.prevClose,
      points: result.points,
      error: result.error,
      updatedAt: Date.now(),
    });
  });

  // 一键分析配套：客户端只发送简短消息「分析{公司名}（代码）」，这里注入一条条件式系统指令，
  // 保证任何会话中出现「分析某家公司」类请求时，依次使用 investment-research / frontend-design 两个技能。
  // 条件式措辞：仅对分析上市公司的请求生效，其它对话不受影响。
  const sp = typeof ctx.get === "function" ? ctx.get("systemPrompt") : undefined;
  if (sp) {
    ctx.effect(
      () => sp.section({
        name: "dsh-stock-watch.analysis",
        order: 200,
        text: "当用户消息以「分析」开头、且意图是分析某家上市公司（而非代码、思路等其他对象）时：依次使用技能 investment-research 完成投资研究分析，再使用技能 frontend-design 生成一个介绍该公司的网站。",
      }),
      "dsh-stock-watch: analysis prompt section",
    );

    // 扇形菜单注入：客户端只发送「每日复盘/行情分析/涨停分析」几个字，
    // 完整提示词在此条件式注入——仅当用户消息匹配对应关键词时按框架执行。
    ctx.effect(
      () => sp.section({
        name: "dsh-stock-watch.fan-prompts",
        order: 201,
        text: "当用户消息为「每日复盘」或以「每日复盘」开头时，执行以下每日复盘任务：\n"
          + FAN_PROMPTS.每日复盘
          + "\n当用户消息为「行情分析」或以「行情分析」开头时，执行以下行情分析任务：\n"
          + FAN_PROMPTS.行情分析
          + "\n当用户消息为「涨停分析」或以「涨停分析」开头时，执行以下涨停分析任务：\n"
          + FAN_PROMPTS.涨停分析,
      }),
      "dsh-stock-watch: fan prompt section",
    );
  }
}

export { apply, inject, name, ensureUserSkills };
