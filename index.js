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
import { join } from "node:path";

const name = "dsh-stock-watch";
/** Required services: webServer（HTTP 路由）。 */
const inject = ["webServer"];

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
  const register = (path, handler) =>
    ctx.effect(() => ctx.webServer.register({ kind: "exact", path, handler }), `dsh-stock-watch: ${path}`);

  register("/dsh-stock-watch/config", async (_req, res) => {
    const loaded = await loadGroups();
    sendJson(res, 200, { groups: loaded.groups, source: loaded.source, path: loaded.path });
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
}

export { apply, inject, name };
