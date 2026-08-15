/**
 * dsh-stock-watch — 浏览器端（client.js）
 *
 * dsh 客户端插件：在 shell.overlay 槽位注册右上角可折叠盯盘弹窗。
 * 数据来自 node 端插件注册的 /dsh-stock-watch/* 路由（同源 fetch）。
 * 自选股配置（分组/代码/买卖目标价）存 localStorage，首次从 settings.json 迁移。
 * 图表：TradingView Lightweight Charts（CDN 懒加载，失败降级自绘 SVG）。
 * 配色沿用 A 股红涨绿跌惯例（涨 #ff1493 / 跌 #00ff41）。
 */
window.__ModuleLoader__.load({
  id: "dsh-stock-watch",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    let react = require("react");
    const { useState, useEffect, useCallback, useRef } = react;

    // ------------------------------------------------------------------ CSS
    const styleTag = document.createElement("style");
    styleTag.textContent = `
.sk-theme-dark{--sk-panel-bg:rgba(13,17,26,.96);--sk-pill-bg:rgba(13,17,26,.93);--sk-border:rgba(255,255,255,.16);--sk-border-soft:rgba(255,255,255,.08);--sk-text:#e5e7eb;--sk-dim:#9ca3af;--sk-muted:#6b7280;--sk-muted-strong:#4b5563;--sk-hover:rgba(255,255,255,.06);--sk-cyan:#22d3ee;--sk-cyan-soft:rgba(34,211,238,.16);--sk-cyan-border:rgba(34,211,238,.5);--sk-shadow:0 8px 32px rgba(0,0,0,.5)}
.sk-theme-light{--sk-panel-bg:rgba(255,255,255,.97);--sk-pill-bg:rgba(255,255,255,.95);--sk-border:rgba(15,23,42,.14);--sk-border-soft:rgba(15,23,42,.08);--sk-text:#1f2937;--sk-dim:#4b5563;--sk-muted:#6b7280;--sk-muted-strong:#9ca3af;--sk-hover:rgba(15,23,42,.06);--sk-cyan:#0891b2;--sk-cyan-soft:rgba(8,145,178,.12);--sk-cyan-border:rgba(8,145,178,.5);--sk-shadow:0 8px 32px rgba(15,23,42,.18)}
.sk-pill{position:fixed;top:14px;right:16px;z-index:9999;display:flex;align-items:center;gap:8px;padding:6px 12px;border-radius:999px;background:var(--sk-pill-bg);border:1px solid var(--sk-border);color:var(--sk-text);cursor:pointer;user-select:none;font:12px/1.4 ui-monospace,SFMono-Regular,Consolas,'Courier New',monospace;box-shadow:0 4px 18px rgba(0,0,0,.35);backdrop-filter:blur(8px);pointer-events:auto}
.sk-pill:hover{border-color:var(--sk-cyan-border)}
.sk-pill-title{font-weight:700;color:var(--sk-cyan);white-space:nowrap}
.sk-pill-summary{display:inline-flex;gap:6px;font-weight:600}
.sk-pill-loading{color:var(--sk-muted)}
.sk-panel{position:fixed;top:14px;right:16px;z-index:9999;width:400px;max-height:78vh;display:flex;flex-direction:column;border-radius:12px;overflow:hidden;background:var(--sk-panel-bg);border:1px solid var(--sk-border);color:var(--sk-text);box-shadow:var(--sk-shadow);backdrop-filter:blur(10px);font:12px/1.5 ui-monospace,SFMono-Regular,Consolas,'Courier New',monospace;pointer-events:auto}
.sk-header{display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid var(--sk-border-soft)}
.sk-title{font-weight:700;color:var(--sk-cyan);white-space:nowrap}
.sk-tabs{display:flex;gap:4px;flex:1;min-width:0;overflow-x:auto;scrollbar-width:none}
.sk-tabs::-webkit-scrollbar{display:none}
.sk-tab{flex:none;padding:2px 9px;border-radius:999px;border:1px solid transparent;background:transparent;color:var(--sk-muted);cursor:pointer;font:inherit;white-space:nowrap}
.sk-tab:hover{color:var(--sk-text)}
.sk-tab-active{background:var(--sk-cyan-soft);color:var(--sk-cyan);border-color:var(--sk-cyan-border)}
.sk-tab-wrap{display:flex;align-items:center;gap:2px;flex:none}
.sk-tab-del{background:transparent;border:none;color:var(--sk-muted);cursor:pointer;font-size:10px;font-weight:700;line-height:1;padding:0 2px;opacity:0;pointer-events:none}
.sk-tab-wrap:hover .sk-tab-del{opacity:1;pointer-events:auto}
.sk-tab-del:hover{color:#ff5555}
.sk-del{background:transparent;border:none;color:var(--sk-muted);cursor:pointer;font-size:11px;padding:0 2px;width:18px;flex:none;border-radius:4px}
.sk-resize{position:absolute;width:14px;height:14px;z-index:6;opacity:.55}
.sk-resize:hover{opacity:1}
.sk-resize-br{bottom:0;right:0;cursor:nwse-resize;border-bottom-right-radius:10px;background:linear-gradient(315deg,transparent 62%,var(--sk-muted) 62%,var(--sk-muted) 75%,transparent 75%)}
.sk-del:hover{color:#ff5555;background:var(--sk-hover)}
.sk-right{display:flex;align-items:center;gap:4px;flex:none}
.sk-countdown{color:var(--sk-muted);white-space:nowrap}
.sk-icon{background:transparent;border:none;color:var(--sk-muted);cursor:pointer;font-size:13px;padding:2px 6px;border-radius:6px;font-family:inherit}
.sk-icon:hover{color:var(--sk-text);background:var(--sk-hover)}
.sk-rows{overflow-y:auto;padding:4px 6px 8px;flex:1 1 auto}
.sk-row{display:flex;align-items:center;gap:8px;padding:5px 6px;border-radius:8px;cursor:pointer}
.sk-row:hover{background:var(--sk-hover)}
.sk-name{display:flex;flex-direction:column;flex:1 1 auto;min-width:88px}
.sk-name-text{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sk-code{color:var(--sk-muted);font-size:11px}
.sk-spark{flex:none;display:block}
.sk-price{width:60px;text-align:right;font-weight:700}
.sk-chg{width:62px;text-align:right}
.sk-trigger{min-width:34px;text-align:center;border:1px solid;border-radius:999px;padding:0 6px;font-weight:700}
.sk-trigger-none{color:var(--sk-muted-strong);border-color:var(--sk-border)}
.sk-empty{padding:18px 10px;text-align:center;color:var(--sk-muted)}
.sk-footer{display:flex;justify-content:space-between;gap:8px;padding:6px 10px;border-top:1px solid var(--sk-border-soft);color:var(--sk-muted);font-size:11px}
.sk-foot-left{max-width:190px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sk-foot-right{max-width:150px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sk-detail-header{display:flex;flex-direction:column;gap:6px;padding:8px 10px;border-bottom:1px solid var(--sk-border-soft)}
.sk-detail-top{display:flex;justify-content:space-between;align-items:center;gap:8px}
.sk-back{align-self:flex-start;background:transparent;border:1px solid var(--sk-border);color:var(--sk-muted);border-radius:6px;padding:2px 8px;cursor:pointer;font:inherit}
.sk-back:hover{color:var(--sk-text);border-color:var(--sk-cyan-border)}
.sk-detail-info{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.sk-detail-name{font-weight:700;font-size:13px}
.sk-detail-price{font-weight:700;font-size:16px}
.sk-detail-chg{font-size:12px}
.sk-detail-trigger{font-size:11px;border:1px solid;border-radius:999px;padding:0 7px;font-weight:700}
.sk-detail-targets{display:flex;gap:10px;flex-wrap:wrap}
.sk-target{font-size:11px;white-space:nowrap}
.sk-target-btn{background:transparent;border:1px dashed var(--sk-border);color:var(--sk-dim);border-radius:6px;padding:1px 8px;cursor:pointer;font:inherit;white-space:nowrap}
.sk-target-btn:hover{border-color:var(--sk-cyan-border);color:var(--sk-text)}
.sk-target-input{width:120px;background:var(--sk-hover);border:1px solid var(--sk-cyan-border);color:var(--sk-text);border-radius:6px;padding:1px 6px;font:inherit;outline:none}
.sk-flash{font-size:11px}
.sk-periods{display:flex;gap:4px;flex-wrap:wrap}
.sk-period{background:transparent;border:1px solid transparent;color:var(--sk-muted);border-radius:6px;padding:1px 8px;cursor:pointer;font:inherit}
.sk-period:hover{color:var(--sk-text)}
.sk-period-active{color:var(--sk-cyan);border-color:var(--sk-cyan-border);background:var(--sk-cyan-soft)}
.sk-chart-box{width:100%;position:relative}
.sk-candles{display:block;margin:0 auto}
.sk-chart-empty{padding:30px 10px;text-align:center;color:var(--sk-muted)}
.sk-detail-foot{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 10px;border-top:1px solid var(--sk-border-soft);color:var(--sk-muted);font-size:11px}
.sk-pill{cursor:grab}
.sk-pill:active{cursor:grabbing}
.sk-header,.sk-detail-header{user-select:none;-webkit-user-select:none}
.sk-ma-row{display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap}
.sk-ma-chips{display:inline-flex;gap:6px;flex-wrap:wrap}
.sk-zoom{display:inline-flex;gap:4px;align-items:center}
.sk-zoom-btn{background:transparent;border:1px solid var(--sk-border);color:var(--sk-dim);border-radius:6px;min-width:22px;height:20px;padding:0 6px;cursor:pointer;font:inherit;font-size:11px;line-height:1;white-space:nowrap}
.sk-zoom-btn:hover{border-color:var(--sk-cyan-border);color:var(--sk-text)}
.sk-ma-chip{display:inline-flex;align-items:center;gap:4px;background:transparent;border:1px solid var(--sk-border);color:var(--sk-dim);border-radius:999px;padding:1px 8px;cursor:pointer;font:inherit;font-size:11px;white-space:nowrap}
.sk-ma-chip:hover{border-color:var(--sk-cyan-border);color:var(--sk-text)}
.sk-ma-chip-off{opacity:.35;text-decoration:line-through}
.sk-ma-dot{width:8px;height:8px;border-radius:50%;display:inline-block}
.sk-add-mask{position:absolute;inset:0;z-index:20;background:var(--sk-panel-bg);display:flex;flex-direction:column;padding:10px}
.sk-add-bar{display:flex;gap:8px;padding:6px 10px;border-top:1px solid var(--sk-border-soft)}
.sk-add-bar-btn{flex:1;background:transparent;border:1px dashed var(--sk-border);color:var(--sk-dim);border-radius:8px;padding:6px;cursor:pointer;font:inherit}
.sk-add-bar-btn:hover{border-color:var(--sk-cyan-border);color:var(--sk-text)}
.sk-add-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
.sk-add-title{font-weight:700;color:var(--sk-cyan)}
.sk-add-menu{display:flex;flex-direction:column;gap:6px}
.sk-add-menu-item{background:var(--sk-hover);border:1px solid var(--sk-border);color:var(--sk-text);border-radius:8px;padding:8px 10px;cursor:pointer;font:inherit;text-align:left}
.sk-add-menu-item:hover{border-color:var(--sk-cyan-border)}
.sk-add-stock{display:flex;flex-direction:column;gap:8px;flex:1;min-height:0}
.sk-add-input{background:var(--sk-hover);border:1px solid var(--sk-cyan-border);color:var(--sk-text);border-radius:6px;padding:5px 8px;font:inherit;outline:none}
.sk-rename-input{width:120px;background:var(--sk-hover);border:1px solid var(--sk-cyan-border);color:var(--sk-text);border-radius:6px;padding:1px 6px;font:inherit;outline:none}
.sk-add-result-added .sk-add-result-name{color:var(--sk-muted)}
.sk-add-result-badge{color:var(--sk-muted);font-size:10px;border:1px solid var(--sk-border);border-radius:999px;padding:0 5px;white-space:nowrap}
.sk-add-results{flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:2px}
.sk-add-result{display:flex;gap:10px;align-items:center;background:transparent;border:none;color:var(--sk-text);border-radius:6px;padding:4px 8px;cursor:pointer;font:inherit;text-align:left}
.sk-add-result:hover{background:var(--sk-hover)}
.sk-add-result-code{color:var(--sk-muted);font-size:11px;width:52px}
.sk-add-result-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sk-add-empty{color:var(--sk-muted);text-align:center;padding:14px 0;font-size:11px}
.sk-add-group{display:flex;flex-direction:column;gap:8px}
.sk-add-confirm{background:var(--sk-cyan-soft);border:1px solid var(--sk-cyan-border);color:var(--sk-cyan);border-radius:6px;padding:5px 10px;cursor:pointer;font:inherit;font-weight:600}
`;
    document.head.appendChild(styleTag);

    // ------------------------------------------------------------------ 常量
    const UP = "#ff1493";
    const DOWN = "#00ff41";
    const FLAT = "#8b93a7";
    const YELLOW = "#ffcc00";
    const STORAGE_KEY = "stocking.config.v1";
    const BASE = "/dsh-stock-watch";
    const DEFAULT_GROUPS = [
      { name: "分组1", symbols: [{ code: "sh000001" }, { code: "sz399300" }, { code: "sh601899" }] },
      { name: "分组2", symbols: [] },
    ];
    const POS_KEY = "stocking.pos.v1";
    const SIZE_KEY = "stocking.size.v1";
    const PANEL_MIN_W = 320;
    const PANEL_MAX_W = 640;
    const PANEL_MIN_H = 240;
    const PANEL_MAX_H = 820;
    const PILL_W = 132;
    const PANEL_W = 400;
    const MA_PERIODS = [5, 10, 20, 60];
    const MA_COLOR = { 10: "#ffcc00", 20: "#ff5cd2", 60: "#00ff41" };
    const MA_STORAGE_KEY = "stocking.ma.v1";
    function maColor(p, dark) {
      return p === 5 ? (dark ? "#e5e7eb" : "#374151") : MA_COLOR[p] || "#ffcc00";
    }

    // ------------------------------------------------------------------ 工具
    async function api(path, params) {
      const qs = new URLSearchParams();
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          if (v === undefined || v === null) continue;
          qs.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
        }
      }
      const q = qs.toString();
      const res = await fetch(BASE + path + (q ? "?" + q : ""), { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    }

    function formatPrice(p) {
      const n = Number(p);
      if (!Number.isFinite(n)) return "--";
      return n >= 100 ? n.toFixed(2) : n.toFixed(3);
    }

    function triggerMeta(t) {
      if (t === "sell") return { t: "卖出", c: UP };
      if (t === "buy") return { t: "买入", c: DOWN };
      if (t === "wait") return { t: "等待", c: YELLOW };
      return null;
    }

    function computeTrigger(price, buyPrice, sellPrice) {
      if (buyPrice === undefined && sellPrice === undefined) return "none";
      if (sellPrice !== undefined && price >= sellPrice) return "sell";
      if (buyPrice !== undefined && price <= buyPrice) return "buy";
      return "wait";
    }

    // ----------------------------------------------- TradingView Lightweight Charts 懒加载
    let lwcPromise = null;
    function loadLightweightCharts() {
      if (lwcPromise) return lwcPromise;
      const p = new Promise((resolve) => {
        let settled = false;
        const finish = (lib) => {
          if (settled) return;
          settled = true;
          if (!lib) lwcPromise = null;
          resolve(lib);
        };
        try {
          const existing = window.LightweightCharts;
          if (existing) { finish(existing); return; }
          const sources = [
            "https://unpkg.com/lightweight-charts@4.2.3/dist/lightweight-charts.standalone.production.js",
            "https://cdn.jsdelivr.net/npm/lightweight-charts@4.2.3/dist/lightweight-charts.standalone.production.js",
          ];
          let idx = 0;
          const inject = () => {
            if (idx >= sources.length) { finish(null); return; }
            const s = document.createElement("script");
            s.src = sources[idx];
            s.async = true;
            s.onload = () => {
              if (window.LightweightCharts) finish(window.LightweightCharts);
              else { idx += 1; inject(); }
            };
            s.onerror = () => { idx += 1; inject(); };
            document.head.appendChild(s);
          };
          inject();
          setTimeout(() => finish(null), 9000);
        } catch {
          finish(null);
        }
      });
      lwcPromise = p;
      return p;
    }

    // -------------------------------------------------------------- 分时迷你折线（列表行）
    function Sparkline(props) {
      const prices = props.prices;
      const color = props.color;
      const width = 72;
      const height = 20;
      if (!Array.isArray(prices) || prices.length < 2) {
        return react.createElement("svg", { className: "sk-spark", width, height, viewBox: "0 0 " + width + " " + height });
      }
      const pts = prices.length > 60 ? prices.slice(prices.length - 60) : prices;
      let min = Infinity;
      let max = -Infinity;
      for (const p of pts) { if (p < min) min = p; if (p > max) max = p; }
      const span = (max - min) || 1;
      const coords = pts.map((p, i) => {
        const x = (i / (pts.length - 1)) * (width - 2) + 1;
        const y = height - 2 - ((p - min) / span) * (height - 4);
        return x.toFixed(1) + "," + y.toFixed(1);
      });
      return react.createElement("svg", { className: "sk-spark", width, height, viewBox: "0 0 " + width + " " + height },
        react.createElement("polyline", { points: coords.join(" "), fill: "none", stroke: color, strokeWidth: 1.4 }));
    }

    // -------------------------------------------------------------- K线 SVG 兜底
    function SvgCandles(props) {
      const candles = props.candles || [];
      const width = props.width || 380;
      const height = props.height || 228;
      const fill = props.fill === true;
      if (!Array.isArray(candles) || candles.length === 0) {
        return react.createElement("div", { className: "sk-chart-empty" }, "暂无K线数据");
      }
      const pad = 6;
      let min = Infinity;
      let max = -Infinity;
      for (const c of candles) {
        if (c.low < min) min = c.low;
        if (c.high > max) max = c.high;
      }
      const span = (max - min) || 1;
      const innerH = height - pad * 2;
      const yOf = (v) => pad + innerH - ((v - min) / span) * innerH;
      const n = candles.length;
      const step = (width - pad * 2) / n;
      const bodyW = Math.max(2, step * 0.62);
      const els = [];
      for (let i = 0; i < n; i++) {
        const c = candles[i];
        const x = pad + step * i + step / 2;
        const up = c.close >= c.open;
        const color = up ? UP : DOWN;
        const openY = yOf(c.open);
        const closeY = yOf(c.close);
        const top = Math.min(openY, closeY);
        const bodyH = Math.max(1, Math.abs(closeY - openY));
        els.push(react.createElement("line", { key: "w" + i, x1: x, y1: yOf(c.high), x2: x, y2: yOf(c.low), stroke: color, strokeWidth: 1 }));
        els.push(react.createElement("rect", { key: "b" + i, x: x - bodyW / 2, y: top, width: bodyW, height: bodyH, fill: color }));
      }
      const svgEl = react.createElement("svg", { className: "sk-candles", width, height, viewBox: "0 0 " + width + " " + height, style: fill ? { width: "100%", height: "100%", display: "block" } : undefined }, els);
      return fill
        ? react.createElement("div", { style: { flex: "1 1 0", minHeight: 0, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" } }, svgEl)
        : svgEl;
    }

    // ------------------------------------------------------ 分时时间轴：按 A 股交易时段（北京时间 UTC+8）标注
    const SHANGHAI_OFFSET = 8 * 3600;
    function beijingOf(ts) {
      return new Date((Number(ts) + SHANGHAI_OFFSET) * 1000);
    }
    function fmtBeijingClock(ts) {
      const d = beijingOf(ts);
      return String(d.getUTCHours()).padStart(2, "0") + ":" + String(d.getUTCMinutes()).padStart(2, "0");
    }
    // lightweight-charts v4 tick/time formatter：无论浏览器时区，一律按北京时间显示
    function beijingTickFormatter(time, tickMarkType) {
      let ts;
      if (typeof time === "object" && time !== null) {
        ts = Date.UTC(time.year, (time.month || 1) - 1, time.day || 1) / 1000;
      } else {
        ts = Number(time);
      }
      const d = beijingOf(ts);
      const isTime = tickMarkType >= 3 || tickMarkType === "Time" || tickMarkType === "TimeWithSeconds";
      const clock = fmtBeijingClock(ts);
      if (isTime) return clock;
      return String(d.getUTCMonth() + 1) + "-" + String(d.getUTCDate()) + " " + clock;
    }

    // -------------------------------------------------------------- 分时 SVG 兜底
    function SvgMinute(props) {
      const points = props.points || [];
      const prevClose = props.prevClose;
      const width = props.width || 380;
      const height = props.height || 228;
      const dark = props.dark;
      const fill = props.fill === true;
      if (!Array.isArray(points) || points.length < 2) {
        return react.createElement("div", { className: "sk-chart-empty" }, "暂无分时数据");
      }
      const pad = 8;
      const all = points.map((pt) => pt.p).concat((typeof prevClose === "number" && Number.isFinite(prevClose)) ? [prevClose] : []);
      let min = Infinity;
      let max = -Infinity;
      for (const p of all) { if (p < min) min = p; if (p > max) max = p; }
      const span = (max - min) || 1;
      const innerW = width - pad * 2;
      const innerH = height - pad * 2;
      const xOf = (i) => pad + (i / (points.length - 1)) * innerW;
      const yOf = (v) => pad + innerH - ((v - min) / span) * innerH;
      const pricePts = points.map((pt, i) => xOf(i).toFixed(1) + "," + yOf(pt.p).toFixed(1)).join(" ");
      let cumV = 0;
      let cumA = 0;
      const avgPts = points.map((pt, i) => {
        cumV += pt.v;
        cumA += pt.p * pt.v;
        const v = cumV > 0 ? cumA / cumV : pt.p;
        return xOf(i).toFixed(1) + "," + yOf(v).toFixed(1);
      }).join(" ");
      const up = (typeof prevClose === "number" && Number.isFinite(prevClose) && prevClose > 0)
        ? points[points.length - 1].p >= prevClose
        : true;
      const els = [];
      els.push(react.createElement("polyline", { key: "price", points: pricePts, fill: "none", stroke: up ? UP : DOWN, strokeWidth: 1.6 }));
      els.push(react.createElement("polyline", { key: "avg", points: avgPts, fill: "none", stroke: YELLOW, strokeWidth: 1 }));
      if (typeof prevClose === "number" && Number.isFinite(prevClose) && prevClose > 0) {
        const y = yOf(prevClose);
        els.push(react.createElement("line", { key: "base", x1: pad, y1: y, x2: width - pad, y2: y, stroke: dark ? "rgba(255,255,255,0.45)" : "rgba(15,23,42,0.4)", strokeWidth: 1, strokeDasharray: "4 3" }));
      }
      // 交易时段标签（北京时间）：开盘 09:30 · 午后开盘 13:00 · 收盘 15:00
      const labelFill = dark ? "rgba(255,255,255,0.5)" : "rgba(15,23,42,0.5)";
      const secOfDay = (ts) => ((ts % 86400) + 86400) % 86400;
      let gapIdx = -1;
      for (let i = 1; i < points.length; i++) {
        const step = secOfDay(points[i].t) - secOfDay(points[i - 1].t);
        if (step > 1800) { gapIdx = i; break; }
      }
      const midIdx = gapIdx > 0 ? gapIdx : Math.floor(points.length / 2);
      els.push(react.createElement("text", { key: "t0", x: 4, y: height - 6, fill: labelFill, fontSize: 9 }, fmtBeijingClock(points[0].t)));
      els.push(react.createElement("text", { key: "t1", x: xOf(midIdx) - 14, y: height - 6, fill: labelFill, fontSize: 9 }, fmtBeijingClock(points[midIdx].t)));
      els.push(react.createElement("text", { key: "t2", x: width - 34, y: height - 6, fill: labelFill, fontSize: 9 }, fmtBeijingClock(points[points.length - 1].t)));
      const svgEl = react.createElement("svg", { className: "sk-candles", width, height, viewBox: "0 0 " + width + " " + height, style: fill ? { width: "100%", height: "100%", display: "block" } : undefined }, els);
      return fill
        ? react.createElement("div", { style: { flex: "1 1 0", minHeight: 0, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" } }, svgEl)
        : svgEl;
    }

    // 简单移动平均：按收盘价计算，返回 [{time, value}]（前 period-1 根无值，线从有值处开始）
    function computeMa(candles, period) {
      const data = [];
      let sum = 0;
      for (let i = 0; i < candles.length; i++) {
        sum += candles[i].close;
        if (i >= period) sum -= candles[i - period].close;
        if (i >= period - 1) {
          data.push({ time: candles[i].time, value: sum / period });
        }
      }
      return data;
    }

    // -------------------------------------------------------------- Lightweight Charts K线
    function LwcChart(props) {
      const lwc = props.lwc;
      const candles = props.candles || [];
      const height = props.height || 240;
      const fitKey = props.fitKey || "";
      const dark = props.dark;
      const maVisible = props.maVisible || {};
      const fill = props.fill === true;
      const chartApiRef = props.chartApiRef || null;
      const boxRef = useRef(null);
      const chartRef = useRef(null);
      const seriesRef = useRef(null);
      const volRef = useRef(null);
      const maRefs = useRef([]);
      const lastFitKey = useRef(null);
      useEffect(() => {
        if (!lwc || !boxRef.current) return undefined;
        const el = boxRef.current;
        const chart = lwc.createChart(el, {
          ...(fill ? { autoSize: true } : { width: el.clientWidth || 380, height }),
          layout: { background: { type: "solid", color: "transparent" }, textColor: dark ? "#9ca3af" : "#6b7280", fontSize: 10 },
          grid: { vertLines: { color: dark ? "rgba(255,255,255,0.06)" : "rgba(15,23,42,0.08)" }, horzLines: { color: dark ? "rgba(255,255,255,0.06)" : "rgba(15,23,42,0.08)" } },
          rightPriceScale: { borderColor: dark ? "rgba(255,255,255,0.12)" : "rgba(15,23,42,0.14)" },
          timeScale: { borderColor: dark ? "rgba(255,255,255,0.12)" : "rgba(15,23,42,0.14)" },
          crosshair: {
            mode: 0,
            vertLine: { color: "rgba(34,211,238,0.4)", labelBackgroundColor: "#164e63" },
            horzLine: { color: "rgba(34,211,238,0.4)", labelBackgroundColor: "#164e63" },
          },
        });
        const series = chart.addCandlestickSeries({
          upColor: UP,
          downColor: DOWN,
          borderUpColor: UP,
          borderDownColor: DOWN,
          wickUpColor: UP,
          wickDownColor: DOWN,
          priceFormat: { type: "price", precision: 2, minMove: 0.01 },
        });
        const vol = chart.addHistogramSeries({
          priceScaleId: "",
          priceFormat: { type: "volume" },
          lastValueVisible: false,
          priceLineVisible: false,
          scaleMargins: { top: 0.82, bottom: 0 },
        });
        // MA 均线（A 股配色：MA5 白、MA10 黄、MA20 紫、MA60 绿；MA5 随主题取可读灰色）
        const MA_CONFIG = [
          { period: 5, color: maColor(5, dark) },
          { period: 10, color: maColor(10, dark) },
          { period: 20, color: maColor(20, dark) },
          { period: 60, color: maColor(60, dark) },
        ];
        maRefs.current = MA_CONFIG.map((cfg) => {
          const s = chart.addLineSeries({
            color: cfg.color,
            lineWidth: 1,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false,
            visible: !maVisible || maVisible[cfg.period] !== false,
            priceFormat: { type: "price", precision: 2, minMove: 0.01 },
          });
          return { period: cfg.period, series: s };
        });
        chartRef.current = chart;
        seriesRef.current = series;
        volRef.current = vol;
        if (chartApiRef) chartApiRef.current = chart;
        return () => {
          chart.remove();
          chartRef.current = null;
          seriesRef.current = null;
          volRef.current = null;
          maRefs.current = [];
          if (chartApiRef) chartApiRef.current = null;
        };
      }, [lwc, height, dark, fill]);
      // MA 显隐切换：applyOptions({ visible })，无需重建图表
      useEffect(() => {
        for (const ma of maRefs.current) {
          ma.series.applyOptions({ visible: !maVisible || maVisible[ma.period] !== false });
        }
      }, [maVisible]);
      useEffect(() => {
        const series = seriesRef.current;
        const vol = volRef.current;
        if (!series || !vol) return;
        series.setData(candles.map((c) => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close })));
        vol.setData(candles.map((c) => ({ time: c.time, value: c.volume, color: c.close >= c.open ? "rgba(255,20,147,0.35)" : "rgba(0,255,65,0.35)" })));
        for (const ma of maRefs.current || []) {
          ma.series.setData(computeMa(candles, ma.period));
        }
        if (lastFitKey.current !== fitKey && chartRef.current) {
          lastFitKey.current = fitKey;
          chartRef.current.timeScale().fitContent();
        }
      }, [candles, lwc, fitKey]);
      return react.createElement("div", { ref: boxRef, className: "sk-chart-box", style: fill ? { width: "100%", flex: "1 1 0", minHeight: 0 } : { width: "100%", height } });
    }

    // -------------------------------------------------------------- Lightweight Charts 分时
    function MinuteChart(props) {
      const lwc = props.lwc;
      const points = props.points || [];
      const prevClose = props.prevClose;
      const height = props.height || 240;
      const dark = props.dark;
      const fitKey = props.fitKey || "";
      const fill = props.fill === true;
      const boxRef = useRef(null);
      const chartRef = useRef(null);
      const lineRef = useRef(null);
      const avgRef = useRef(null);
      const baselineRef = useRef(null);
      const lastFitKey = useRef(null);
      useEffect(() => {
        if (!lwc || !boxRef.current) return undefined;
        const el = boxRef.current;
        const chart = lwc.createChart(el, {
          ...(fill ? { autoSize: true } : { width: el.clientWidth || 380, height }),
          layout: { background: { type: "solid", color: "transparent" }, textColor: dark ? "#9ca3af" : "#6b7280", fontSize: 10 },
          grid: { vertLines: { color: dark ? "rgba(255,255,255,0.06)" : "rgba(15,23,42,0.08)" }, horzLines: { color: dark ? "rgba(255,255,255,0.06)" : "rgba(15,23,42,0.08)" } },
          rightPriceScale: { borderColor: dark ? "rgba(255,255,255,0.12)" : "rgba(15,23,42,0.14)" },
          timeScale: {
            borderColor: dark ? "rgba(255,255,255,0.12)" : "rgba(15,23,42,0.14)",
            timeVisible: true,
            secondsVisible: false,
            // v4 中 tickMarkFormatter 属于 timeScale 选项（localization 里只有 timeFormatter）
            tickMarkFormatter: (time, tickMarkType) => beijingTickFormatter(time, tickMarkType),
          },
          crosshair: {
            mode: 0,
            vertLine: { color: "rgba(34,211,238,0.4)", labelBackgroundColor: "#164e63" },
            horzLine: { color: "rgba(34,211,238,0.4)", labelBackgroundColor: "#164e63" },
          },
          localization: {
            timeFormatter: (time) => beijingTickFormatter(time, 3),
          },
        });
        const line = chart.addLineSeries({
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: true,
          priceFormat: { type: "price", precision: 2, minMove: 0.01 },
        });
        const avg = chart.addLineSeries({
          color: YELLOW,
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
          priceFormat: { type: "price", precision: 2, minMove: 0.01 },
        });
        chartRef.current = chart;
        lineRef.current = line;
        avgRef.current = avg;
        return () => {
          chart.remove();
          chartRef.current = null;
          lineRef.current = null;
          avgRef.current = null;
          baselineRef.current = null;
        };
      }, [lwc, height, dark, fill]);
      useEffect(() => {
        const line = lineRef.current;
        const avg = avgRef.current;
        if (!line || !avg) return;
        if (!Array.isArray(points) || points.length === 0) {
          line.setData([]);
          avg.setData([]);
          return;
        }
        line.setData(points.map((pt) => ({ time: pt.t, value: pt.p })));
        let cumV = 0;
        let cumA = 0;
        avg.setData(points.map((pt) => {
          cumV += pt.v;
          cumA += pt.p * pt.v;
          return { time: pt.t, value: cumV > 0 ? cumA / cumV : pt.p };
        }));
        const lastP = points[points.length - 1].p;
        const up = (typeof prevClose === "number" && Number.isFinite(prevClose) && prevClose > 0)
          ? lastP >= prevClose
          : lastP >= points[0].p;
        line.applyOptions({ color: up ? UP : DOWN });
        if (lastFitKey.current !== fitKey && chartRef.current) {
          lastFitKey.current = fitKey;
          chartRef.current.timeScale().fitContent();
        }
      }, [points, prevClose, lwc, fitKey]);
      useEffect(() => {
        const line = lineRef.current;
        if (!line) return;
        if (baselineRef.current) {
          try { line.removePriceLine(baselineRef.current); } catch { /* ignore */ }
          baselineRef.current = null;
        }
        if (typeof prevClose === "number" && Number.isFinite(prevClose) && prevClose > 0) {
          try {
            baselineRef.current = line.createPriceLine({
              price: prevClose,
              color: dark ? "rgba(255,255,255,0.45)" : "rgba(15,23,42,0.4)",
              lineStyle: 2,
              lineWidth: 1,
              axisLabelVisible: true,
              title: "昨收",
            });
          } catch { /* ignore */ }
        }
      }, [prevClose, lwc, dark]);
      return react.createElement("div", { ref: boxRef, className: "sk-chart-box", style: fill ? { width: "100%", flex: "1 1 0", minHeight: 0 } : { width: "100%", height } });
    }

    // -------------------------------------------------------------- 主面板
    function WatchPanel() {
      const [expanded, setExpanded] = useState(false);
      const [groupIndex, setGroupIndex] = useState(0);
      const [view, setView] = useState(null);
      const [period, setPeriod] = useState("minute");
      const [theme, setTheme] = useState("dark");
      const [groupsCfg, setGroupsCfg] = useState(null);
      const [data, setData] = useState(null);
      const [kline, setKline] = useState(null);
      const [minute, setMinute] = useState(null);
      const [lwc, setLwc] = useState(null);
      const [error, setError] = useState(null);
      const [countdown, setCountdown] = useState(10);
      const [targetEdit, setTargetEdit] = useState(null);
      const [flashMsg, setFlashMsg] = useState(null);
      const dataRef = useRef(null);
      const flashTimerRef = useRef(null);
      const dragRef = useRef(null);
      const suppressClickRef = useRef(false);
      const pillRef = useRef(null);
      const pillWidthRef = useRef(PILL_W);
      // K线缩放控制：lightweight-charts timeScale 的 barSpacing 越大越放大，fitContent 还原
      const klineChartApiRef = useRef(null);
      const zoomKline = useCallback((factor) => {
        const chart = klineChartApiRef.current;
        if (!chart) return;
        try {
          const ts = chart.timeScale();
          const cur = typeof ts.options().barSpacing === "number" ? ts.options().barSpacing : 6;
          ts.applyOptions({ barSpacing: Math.min(60, Math.max(2, cur * factor)) });
        } catch { /* 图表实例暂不可用则忽略 */ }
      }, []);
      const resetKline = useCallback(() => {
        const chart = klineChartApiRef.current;
        if (!chart) return;
        try { chart.timeScale().fitContent(); } catch { /* 图表实例暂不可用则忽略 */ }
      }, []);
      const [pos, setPos] = useState(() => {
        try {
          const raw = window.localStorage.getItem(POS_KEY);
          if (raw) {
            const p = JSON.parse(raw);
            if (typeof p.x === "number" && typeof p.y === "number") return p;
          }
        } catch { /* ignore */ }
        return null;
      });
      // 面板尺寸（左下/右下角拉伸，localStorage 持久化；null = 默认 400px 宽 + 内容高）
      const [size, setSize] = useState(() => {
        try {
          const raw = window.localStorage.getItem(SIZE_KEY);
          if (raw) {
            const s = JSON.parse(raw);
            if (typeof s.w === "number" && typeof s.h === "number") return s;
          }
        } catch { /* ignore */ }
        return null;
      });
      // MA 均线显隐配置（localStorage 持久化）
      const [maVisible, setMaVisible] = useState(() => {
        const def = { 5: true, 10: true, 20: true, 60: true };
        try {
          const raw = window.localStorage.getItem(MA_STORAGE_KEY);
          if (raw) {
            const p = JSON.parse(raw);
            for (const k of MA_PERIODS) {
              if (typeof p[k] === "boolean") def[k] = p[k];
            }
          }
        } catch { /* ignore */ }
        return def;
      });
      // 添加面板状态（menu / stock / group）
      const [showAdd, setShowAdd] = useState(null);
      const [stockQuery, setStockQuery] = useState("");
      const [stockResults, setStockResults] = useState(null);
      const [groupName, setGroupName] = useState("");
      const [renameEdit, setRenameEdit] = useState(null);
      const [renameTarget, setRenameTarget] = useState(null);

      // 配置：localStorage 优先，首次从 Host /config 迁移 settings.json，兜底默认分组
      useEffect(() => {
        let alive = true;
        (async () => {
          let cfg = null;
          try {
            const raw = window.localStorage.getItem(STORAGE_KEY);
            if (raw) cfg = JSON.parse(raw);
          } catch { /* ignore */ }
          if (!cfg || !Array.isArray(cfg.groups) || cfg.groups.length === 0) {
            try {
              const res = await api("/config");
              if (alive && res && Array.isArray(res.groups) && res.groups.length > 0) cfg = { groups: res.groups };
            } catch { /* ignore */ }
          }
          if (!cfg || !Array.isArray(cfg.groups) || cfg.groups.length === 0) {
            cfg = { groups: DEFAULT_GROUPS };
          }
          if (alive) setGroupsCfg(cfg.groups);
        })();
        return () => { alive = false; };
      }, []);

      // 配置变化 → 写回 localStorage
      useEffect(() => {
        if (!groupsCfg) return;
        try {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ groups: groupsCfg, updatedAt: Date.now() }));
        } catch { /* ignore */ }
      }, [groupsCfg]);

      const load = useCallback(async (includeMinutes) => {
        if (!groupsCfg || groupsCfg.length === 0) return;
        try {
          const res = await api("/quotes", { group: groupIndex, minutes: includeMinutes ? 1 : 0, groups: groupsCfg });
          setData(res);
          setError(null);
        } catch {
          setError("行情服务不可用");
        }
      }, [groupIndex, groupsCfg]);

      const loadDetail = useCallback(async (code, per) => {
        let refPrice = null;
        const d = dataRef.current;
        if (d && Array.isArray(d.rows)) {
          const r = d.rows.find((x) => x.code === code);
          if (r && r.live && typeof r.price === "number") refPrice = r.price;
        }
        try {
          if (per === "minute") {
            const res = await api("/minute", { code });
            setMinute(res);
          } else {
            const res = await api("/kline", { code, period: per, refPrice });
            setKline(res);
          }
        } catch {
          if (per === "minute") setMinute({ code, points: [], prevClose: null, error: "分时获取失败" });
          else setKline({ code, period: per, candles: [], error: "K线获取失败" });
        }
      }, []);

      const flash = useCallback((text, color) => {
        setFlashMsg({ text, color: color || YELLOW });
        if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
        flashTimerRef.current = setTimeout(() => {
          setFlashMsg(null);
          flashTimerRef.current = null;
        }, 2600);
      }, []);

      // 目标价不可变更新 + 本地行同步（写入 localStorage 由持久化 effect 完成）
      const applyTarget = useCallback((code, type, price) => {
        const key = type === "buy" ? "buyPrice" : "sellPrice";
        setGroupsCfg((prev) => {
          if (!prev) return prev;
          return prev.map((g, gi) => {
            if (gi !== groupIndex) return g;
            const existing = g.symbols.find((s) => s.code === code);
            if (!existing && price === undefined) return g;
            const symbols = existing
              ? g.symbols.map((s) => {
                  if (s.code !== code) return s;
                  const copy = { ...s };
                  if (price === undefined) delete copy[key];
                  else copy[key] = price;
                  return copy;
                })
              : [...g.symbols, { code, [key]: price }];
            return { ...g, symbols };
          });
        });
        setData((d) => {
          if (!d || !Array.isArray(d.rows)) return d;
          return {
            ...d,
            rows: d.rows.map((r) => {
              if (r.code !== code) return r;
              const copy = { ...r };
              if (price === undefined) delete copy[key];
              else copy[key] = price;
              copy.trigger = copy.live ? computeTrigger(copy.price, copy.buyPrice, copy.sellPrice) : "none";
              return copy;
            }),
          };
        });
      }, [groupIndex]);

      const commitTargetEdit = useCallback((type) => {
        if (!targetEdit || targetEdit.type !== type || !view) return;
        const code = view.code;
        const value = targetEdit.value;
        setTargetEdit(null);
        const label = type === "buy" ? "买入" : "卖出";
        if (value.trim() === "") {
          applyTarget(code, type, undefined);
          flash("已清除" + label + "目标价", "#888888");
          return;
        }
        const price = parseFloat(value);
        if (!Number.isFinite(price) || price <= 0) {
          flash("✘ 价格无效，未保存", "#ff5555");
          return;
        }
        applyTarget(code, type, price);
        flash("✔ 已设置" + label + "目标价 " + formatPrice(price));
      }, [targetEdit, view, applyTarget, flash]);

      // 首次展开时预加载 Lightweight Charts
      useEffect(() => {
        if (!expanded || lwc) return undefined;
        let alive = true;
        loadLightweightCharts().then((lib) => { if (alive) setLwc(lib); });
        return () => { alive = false; };
      }, [expanded, lwc]);

      // 展开：每 10s 拉行情（含分时）；折叠：每 30s 轻量拉取
      useEffect(() => {
        if (expanded) {
          setCountdown(10);
          load(true);
          const id = setInterval(() => load(true), 10000);
          return () => clearInterval(id);
        }
        return undefined;
      }, [expanded, load]);

      useEffect(() => {
        if (!expanded) {
          load(false);
          const id = setInterval(() => load(false), 30000);
          return () => clearInterval(id);
        }
        return undefined;
      }, [expanded, load]);

      // 倒计时
      useEffect(() => {
        if (!expanded) return undefined;
        const id = setInterval(() => setCountdown((c) => (c <= 1 ? 10 : c - 1)), 1000);
        return () => clearInterval(id);
      }, [expanded]);

      // 详情视图：进入 / 切周期 / 每 10s 刷新
      useEffect(() => {
        if (!expanded || !view || !view.code) return undefined;
        loadDetail(view.code, period);
        const id = setInterval(() => loadDetail(view.code, period), 10000);
        return () => clearInterval(id);
      }, [expanded, view, period, loadDetail]);

      // 配置变化时钳制分组下标
      useEffect(() => {
        if (data && Array.isArray(data.groups) && data.groups.length > 0) {
          setGroupIndex((g) => Math.min(Math.max(g, 0), data.groups.length - 1));
        }
      }, [data]);

      // —— 拖拽：窗口级 mousemove/mouseup ——
      useEffect(() => {
        const onMove = (e) => {
          const d = dragRef.current;
          if (!d) return;
          const dx = e.clientX - d.startX;
          const dy = e.clientY - d.startY;
          if (d.mode === "resize") {
            // 右下角：向右/下拉伸；左下角：向左/下拉伸（宽高钳制）
            const dw = d.handle === "br" ? dx : -dx;
            const w = Math.min(PANEL_MAX_W, Math.max(PANEL_MIN_W, d.baseW + dw));
            const h = Math.min(PANEL_MAX_H, Math.max(PANEL_MIN_H, d.baseH + dy));
            setSize({ w, h });
            return;
          }
          if (!d.moved && Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
          if (d.moved) setPos({ x: d.baseX + dx, y: d.baseY + dy });
        };
        const onUp = () => {
          const d = dragRef.current;
          dragRef.current = null;
          // 只有真正拖动过（moved）才抑制随后的 click；普通点击不抑制 → 正常展开
          if (d && d.mode === "pill" && d.moved) suppressClickRef.current = true;
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
        return () => {
          window.removeEventListener("mousemove", onMove);
          window.removeEventListener("mouseup", onUp);
        };
      }, []);

      // 位置变化 → 持久化
      useEffect(() => {
        if (!pos) return;
        try {
          window.localStorage.setItem(POS_KEY, JSON.stringify(pos));
        } catch { /* ignore */ }
      }, [pos]);

      // 尺寸变化 → 持久化
      useEffect(() => {
        if (!size) return;
        try {
          window.localStorage.setItem(SIZE_KEY, JSON.stringify(size));
        } catch { /* ignore */ }
      }, [size]);

      // MA 显隐配置 → 持久化
      useEffect(() => {
        try {
          window.localStorage.setItem(MA_STORAGE_KEY, JSON.stringify(maVisible));
        } catch { /* ignore */ }
      }, [maVisible]);

      // 股票搜索（防抖 200ms，调 Host /stocks 全 A 股池）
      useEffect(() => {
        if (showAdd !== "stock") return undefined;
        const q = stockQuery.trim();
        if (!q) { setStockResults(null); return undefined; }
        const timer = setTimeout(async () => {
          try {
            const res = await api("/stocks", { q });
            setStockResults(res && Array.isArray(res.rows) ? res.rows : []);
          } catch {
            setStockResults([]);
          }
        }, 200);
        return () => clearTimeout(timer);
      }, [showAdd, stockQuery]);

      // 添加股票到当前分组（当前分组重复 → 提示；其他分组重复 → 阻止；均不写入）
      const addStock = useCallback((code, name) => {
        const cur = (groupsCfg && groupsCfg[groupIndex]) || null;
        const inCurrent = cur ? cur.symbols.some((s) => s.code === code) : false;
        if (inCurrent) { flash("该股票已添加", "#888888"); return; }
        const exists = (groupsCfg || []).some((g) => g.symbols.some((s) => s.code === code));
        if (exists) { flash("已在其他分组：" + name, "#888888"); return; }
        setGroupsCfg((prev) => (prev || []).map((g, gi) =>
          gi === groupIndex ? { ...g, symbols: [...g.symbols, { code }] } : g));
        const gname = (groupsCfg && groupsCfg[groupIndex]) ? groupsCfg[groupIndex].name : "";
        flash("✔ 已添加 " + name + (gname ? " 到「" + gname + "」" : ""));
        setStockQuery("");
        setStockResults(null);
        setShowAdd(null); // 添加完成 → 回到股票列表
      }, [groupsCfg, groupIndex, flash]);

      // 添加分组（空名拦截，创建后切到新分组）
      const addGroup = useCallback(() => {
        const name = groupName.trim();
        if (!name) { flash("分组名不能为空", "#ff5555"); return; }
        const newIndex = (groupsCfg || []).length;
        setGroupsCfg((prev) => [...(prev || []), { name, symbols: [] }]);
        setGroupIndex(newIndex);
        setShowAdd(null);
        flash("✔ 已创建分组「" + name + "」");
      }, [groupName, groupsCfg, flash]);

      // 重命名分组（renameTarget 指定哪个分组）
      const commitRename = useCallback(() => {
        if (renameTarget === null) return;
        const name = (renameEdit || "").trim();
        if (!name) { flash("分组名不能为空", "#ff5555"); return; }
        setGroupsCfg((prev) => (prev || []).map((g, gi) => (gi === renameTarget ? { ...g, name } : g)));
        setRenameEdit(null);
        setRenameTarget(null);
        flash("✔ 已重命名为「" + name + "」");
      }, [renameEdit, renameTarget, flash]);

      // 从当前分组删除股票（同步移除列表行）
      const removeStock = useCallback((code, name) => {
        setGroupsCfg((prev) => (prev || []).map((g, gi) =>
          gi === groupIndex ? { ...g, symbols: g.symbols.filter((s) => s.code !== code) } : g));
        setData((d) => (d && Array.isArray(d.rows)
          ? { ...d, rows: d.rows.filter((r) => r.code !== code) }
          : d));
        flash("已删除 " + name, "#888888");
      }, [groupIndex, flash]);

      // 删除分组（确认提示；至少保留一个分组；删除后修正当前分组下标）
      const deleteGroup = useCallback((idx) => {
        const g = groupsCfg && groupsCfg[idx];
        if (!g) return;
        if ((groupsCfg || []).length <= 1) { flash("至少保留一个分组", "#ff5555"); return; }
        if (!window.confirm("确定删除分组「" + g.name + "」吗？其包含 " + g.symbols.length + " 只股票")) return;
        setGroupsCfg((prev) => (prev || []).filter((_, gi) => gi !== idx));
        setGroupIndex((cur) => {
          if (idx < cur) return cur - 1;
          if (idx === cur) return 0;
          return cur;
        });
        setView(null);
        setShowAdd(null);
        flash("已删除分组「" + g.name + "」", "#888888");
      }, [groupsCfg, flash]);

      // 按住胶囊/面板头部拖动（按钮/输入框上不触发）
      const startDrag = useCallback((e, mode) => {
        if (e.button !== 0) return;
        const t = e.target;
        if (t && t.closest && t.closest("button, input, a")) return;
        // 新的交互开始：清掉上一次拖出后可能残留的点击抑制标记
        suppressClickRef.current = false;
        const base = pos || { x: window.innerWidth - PILL_W - 16, y: 14 };
        dragRef.current = { startX: e.clientX, startY: e.clientY, baseX: base.x, baseY: base.y, moved: false, mode };
        e.preventDefault();
      }, [pos]);

      // 按住面板左下/右下角拉伸尺寸
      const startResize = useCallback((e, handle) => {
        if (e.button !== 0) return;
        const base = size || { w: 400, h: 0 };
        dragRef.current = {
          startX: e.clientX,
          startY: e.clientY,
          baseW: base.w,
          baseH: base.h,
          moved: true,
          mode: "resize",
          handle,
        };
        e.preventDefault();
      }, [size]);

      // 面板位置：右边缘与胶囊右边缘对齐（跟随胶囊）；尺寸：拖拽拉伸后固定
      const panelStyle = (() => {
        const st = {};
        if (pos) {
          const pw = pillWidthRef.current || PILL_W;
          st.left = Math.max(8, Math.min(pos.x + pw - PANEL_W, window.innerWidth - PANEL_W - 8));
          st.top = Math.max(8, Math.min(pos.y, window.innerHeight - 320));
          st.right = "auto";
        }
        if (size) {
          st.width = size.w + "px";
          st.height = size.h + "px";
          st.maxHeight = "none"; // 固定尺寸时取消 78vh 上限，拉伸才生效
        }
        return Object.keys(st).length ? st : undefined;
      })();

      dataRef.current = data;

      const groups = (data && Array.isArray(data.groups)) ? data.groups : [];
      const rows = (data && Array.isArray(data.rows)) ? data.rows : [];
      const upCount = rows.filter((r) => r.live && r.changePercent > 0).length;
      const downCount = rows.filter((r) => r.live && r.changePercent < 0).length;
      const themeToggle = react.createElement("button", {
        className: "sk-icon",
        onClick: () => setTheme((t) => (t === "dark" ? "light" : "dark")),
        title: theme === "dark" ? "切换到浅色主题" : "切换到暗色主题",
      }, theme === "dark" ? "☀️" : "🌙");

      // 面板右下角拉伸手柄（列表页与详情页共用）
      const resizeHandles = react.createElement("div", { className: "sk-resize sk-resize-br", title: "拉伸面板", onMouseDown: (e) => startResize(e, "br") });

      // —— 折叠态：可拖动小药丸 ——
      if (!expanded) {
        const summary = (data && rows.length > 0)
          ? react.createElement("span", { className: "sk-pill-summary" },
              react.createElement("span", { style: { color: UP } }, upCount + "↑"),
              react.createElement("span", { style: { color: DOWN } }, downCount + "↓"))
          : react.createElement("span", { className: "sk-pill-loading" }, error ? "⚠" : "…");
        if (pillRef.current) pillWidthRef.current = pillRef.current.offsetWidth || PILL_W;
        return react.createElement("div", {
          className: "sk-pill sk-theme-" + theme,
          ref: pillRef,
          style: pos ? { left: pos.x, top: pos.y, right: "auto" } : undefined,
          onMouseDown: (e) => startDrag(e, "pill"),
          onClick: () => {
            if (suppressClickRef.current) { suppressClickRef.current = false; return; }
            setExpanded(true);
          },
          title: "展开自选股盯盘（按住可拖动）",
        },
          react.createElement("span", { className: "sk-pill-title" }, "📈 自选股"),
          summary);
      }

      // —— 详情视图 ——
      if (view && view.code) {
        const row = rows.find((r) => r.code === view.code);
        const isMinute = period === "minute";
        const m = (isMinute && minute && minute.code === view.code) ? minute : null;
        const k = (!isMinute && kline && kline.code === view.code && kline.period === period) ? kline : null;
        const candles = k && Array.isArray(k.candles) ? k.candles : [];
        const isUp = row ? (row.live ? row.changePercent >= 0 : false) : false;
        const color = row && row.live ? (isUp ? UP : DOWN) : FLAT;
        const trig = row ? triggerMeta(row.trigger) : null;
        const dark = theme === "dark";
        const chartEl = isMinute
          ? (lwc
              ? react.createElement(MinuteChart, { lwc, points: m && Array.isArray(m.points) ? m.points : [], prevClose: m ? m.prevClose : null, height: 240, dark, fitKey: view.code + ":minute", fill: !!size })
              : react.createElement(SvgMinute, { points: m && Array.isArray(m.points) ? m.points : [], prevClose: m ? m.prevClose : null, width: 380, height: 228, dark, fill: !!size }))
          : (lwc
              ? react.createElement(LwcChart, { lwc, candles, height: 240, dark, fitKey: view.code + ":" + period, maVisible, fill: !!size, chartApiRef: klineChartApiRef })
              : react.createElement(SvgCandles, { candles, width: 380, height: 228, fill: !!size }));
        const footText = isMinute
          ? (m === null ? "分时加载中…" : (m && m.error ? "分时：" + m.error : (m && Array.isArray(m.points) ? m.points.length + " 个分时点" : "")))
          : (k === null ? "K线加载中…" : (k && k.error ? "K线：" + k.error : (candles.length + " 根K线")));
        const targetChip = (type) => {
          const label = type === "buy" ? "买入目标" : "卖出目标";
          const key = type === "buy" ? "buyPrice" : "sellPrice";
          const value = row ? row[key] : undefined;
          if (targetEdit && targetEdit.type === type) {
            return react.createElement("span", { className: "sk-target" },
              react.createElement("span", null, label + " "),
              react.createElement("input", {
                className: "sk-target-input",
                value: targetEdit.value,
                autoFocus: true,
                placeholder: "留空=清除",
                onFocus: (e) => e.target.select(),
                onChange: (e) => {
                  const v = e.target.value;
                  if (v === "" || /^\d*\.?\d{0,2}$/.test(v)) setTargetEdit({ type, value: v });
                },
                onKeyDown: (e) => {
                  if (e.key === "Enter") commitTargetEdit(type);
                  else if (e.key === "Escape") setTargetEdit(null);
                },
                onBlur: () => commitTargetEdit(type),
              }));
          }
          return react.createElement("button", {
            className: "sk-target sk-target-btn",
            title: "点击编辑" + label + "（回车确认，留空清除，Esc 取消）",
            onClick: () => setTargetEdit({ type, value: value !== undefined ? String(value) : "" }),
          }, label + " " + (value !== undefined ? formatPrice(value) : "-"));
        };
        return react.createElement("div", { className: "sk-panel sk-theme-" + theme, style: panelStyle },
          react.createElement("div", { className: "sk-detail-header", onMouseDown: (e) => startDrag(e, "panel"), title: "按住此处可拖动面板" },
            react.createElement("div", { className: "sk-detail-top" },
              react.createElement("button", { className: "sk-back", onClick: () => setView(null) }, "← 返回列表"),
              react.createElement("button", { className: "sk-icon", onClick: () => setExpanded(false), title: "最小化回胶囊" }, "—")),
            react.createElement("div", { className: "sk-detail-info" },
              react.createElement("span", { className: "sk-detail-name" }, row ? row.name : view.code),
              react.createElement("span", { className: "sk-detail-price", style: { color } }, row && row.live ? formatPrice(row.price) : "--"),
              react.createElement("span", { className: "sk-detail-chg", style: { color } }, row && row.live ? ((row.changePercent >= 0 ? "+" : "") + row.changePercent.toFixed(2) + "%") : ""),
              trig ? react.createElement("span", { className: "sk-detail-trigger", style: { color: trig.c, borderColor: trig.c } }, trig.t) : null),
            react.createElement("div", { className: "sk-detail-targets" }, targetChip("buy"), targetChip("sell")),
            flashMsg ? react.createElement("div", { className: "sk-flash", style: { color: flashMsg.color } }, flashMsg.text) : null,
            react.createElement("div", { className: "sk-periods" },
              ["minute", "day", "week", "month"].map((p) =>
                react.createElement("button", {
                  key: p,
                  className: "sk-period" + (p === period ? " sk-period-active" : ""),
                  onClick: () => setPeriod(p),
                }, p === "minute" ? "分时" : p === "day" ? "日K" : p === "week" ? "周K" : "月K")))),
            !isMinute && react.createElement("div", { className: "sk-ma-row" },
              react.createElement("span", { className: "sk-zoom" },
                react.createElement("button", { className: "sk-zoom-btn", title: "缩小K线", onClick: () => zoomKline(1 / 1.35) }, "−"),
                react.createElement("button", { className: "sk-zoom-btn", title: "放大K线", onClick: () => zoomKline(1.35) }, "+"),
                react.createElement("button", { className: "sk-zoom-btn", title: "重置K线缩放", onClick: () => resetKline() }, "重置")),
              react.createElement("span", { className: "sk-ma-chips" },
                MA_PERIODS.map((p) => {
                  const on = !!maVisible[p];
                  return react.createElement("button", {
                    key: p,
                    className: "sk-ma-chip" + (on ? "" : " sk-ma-chip-off"),
                    title: (on ? "隐藏" : "显示") + " MA" + p,
                    onClick: () => setMaVisible((v) => ({ ...v, [p]: !v[p] })),
                  },
                    react.createElement("span", { className: "sk-ma-dot", style: { background: maColor(p, dark) } }),
                    "MA" + p);
                }))),
          chartEl,
          react.createElement("div", { className: "sk-detail-foot" },
            react.createElement("span", null, footText),
            react.createElement("span", { className: "sk-right" }, themeToggle,
              react.createElement("span", { className: "sk-countdown" }, "⏱" + countdown + "s"))),
          resizeHandles);
      }

      // —— 列表视图 ——
      const header = react.createElement("div", { className: "sk-header", onMouseDown: (e) => startDrag(e, "panel"), title: "按住此处可拖动面板" },
        react.createElement("span", { className: "sk-title" }, "📈 自选股盯盘"),
        react.createElement("span", { className: "sk-tabs" },
          groups.map((g, i) =>
            react.createElement("span", { key: i, className: "sk-tab-wrap" + (i === groupIndex ? " sk-tab-wrap-active" : "") },
              renameTarget === i
                ? react.createElement("input", {
                    className: "sk-rename-input",
                    value: renameEdit,
                    autoFocus: true,
                    placeholder: "分组名称…",
                    onChange: (e) => setRenameEdit(e.target.value),
                    onKeyDown: (e) => { if (e.key === "Enter") commitRename(); else if (e.key === "Escape") { setRenameEdit(null); setRenameTarget(null); } },
                    onBlur: () => commitRename(),
                  })
                : react.createElement("button", {
                    className: "sk-tab" + (i === groupIndex ? " sk-tab-active" : ""),
                    onClick: () => setGroupIndex(i),
                    onDoubleClick: (e) => { e.preventDefault(); setRenameTarget(i); setRenameEdit(g.name); },
                    title: "双击重命名「" + g.name + "」",
                  }, g.name + (g.count > 0 ? " (" + g.count + ")" : "")),
              react.createElement("button", {
                className: "sk-tab-del",
                title: "删除分组「" + g.name + "」",
                onClick: (e) => { e.stopPropagation(); deleteGroup(i); },
              }, "✕")))),
        react.createElement("span", { className: "sk-right" },
          react.createElement("span", { className: "sk-countdown" }, "⏱" + countdown + "s"),
          themeToggle,
          react.createElement("button", { className: "sk-icon", onClick: () => load(true), title: "立即刷新" }, "⟳"),
          react.createElement("button", { className: "sk-icon", onClick: () => setExpanded(false), title: "折叠" }, "—")));

      // 面板定高时列表区域 flex:1 1 0 强制填满并滚动
      const rowsFill = size ? { flex: "1 1 0", minHeight: 0 } : undefined;
      const body = rows.length === 0
        ? react.createElement("div", { className: "sk-empty", style: rowsFill }, error ? "行情获取失败，请稍后重试" : "（当前分组为空）")
        : react.createElement("div", { className: "sk-rows", style: rowsFill },
            rows.map((row) => {
              const isUp = row.live && row.changePercent >= 0;
              const color = row.live ? (isUp ? UP : DOWN) : FLAT;
              const trig = triggerMeta(row.trigger);
              const tip = "高 " + (row.live ? formatPrice(row.high) : "-") + " · 低 " + (row.live ? formatPrice(row.low) : "-") + " · 量 " + (row.live ? row.volume : "-");
              return react.createElement("div", { key: row.code, className: "sk-row", onClick: () => setView({ code: row.code }), title: tip },
                react.createElement("span", { className: "sk-name" },
                  react.createElement("span", { className: "sk-name-text", style: { color: row.live ? "var(--sk-text)" : FLAT } }, row.name),
                  react.createElement("span", { className: "sk-code" }, row.code.replace(/^(sh|sz)/, ""))),
                react.createElement(Sparkline, { prices: row.minutes, color }),
                react.createElement("span", { className: "sk-price", style: { color } }, row.live ? formatPrice(row.price) : "--"),
                react.createElement("span", { className: "sk-chg", style: { color } }, row.live ? ((row.changePercent >= 0 ? "+" : "") + row.changePercent.toFixed(2) + "%") : ""),
                trig
                  ? react.createElement("span", { className: "sk-trigger", style: { color: trig.c, borderColor: trig.c } }, trig.t)
                  : react.createElement("span", { className: "sk-trigger sk-trigger-none" }, "-"),
                react.createElement("button", {
                  className: "sk-del",
                  title: "从列表删除 " + row.name,
                  onClick: (e) => { e.stopPropagation(); removeStock(row.code, row.name); },
                }, "✕"));
            }));

      const footer = react.createElement("div", { className: "sk-footer" },
        react.createElement("span", { className: "sk-foot-left", title: data && data.diag && data.diag.firstError ? data.diag.firstError : "" },
          data && data.live ? "腾讯行情" : (error ? "行情获取失败" : (data ? (data.diag && data.diag.firstError ? "行情失败：" + data.diag.firstError : "无实时数据") : "—"))),
        react.createElement("span", { className: "sk-foot-mid" }, data ? "更新 " + new Date(data.updatedAt).toLocaleTimeString("zh-CN", { hour12: false }) : ""),
        react.createElement("span", { className: "sk-foot-right", title: data && data.config ? (data.config.path || "") : "" },
          data && data.config && data.config.source === "local"
            ? "配置：localStorage"
            : (data && data.config && data.config.source === "file" ? "~/.stocking/settings.json" : "默认分组")));

      // 添加面板（菜单 / 股票搜索 / 分组创建）
      const addPanel = showAdd ? react.createElement("div", { className: "sk-add-mask" },
        react.createElement("div", { className: "sk-add-panel" },
          react.createElement("div", { className: "sk-add-head" },
            react.createElement("span", { className: "sk-add-title" },
              showAdd === "stock" ? "添加股票" : "添加分组"),
            react.createElement("button", { className: "sk-icon", onClick: () => setShowAdd(null), title: "关闭" }, "✕")),
          showAdd === "stock" && react.createElement("div", { className: "sk-add-stock" },
            react.createElement("input", {
              className: "sk-add-input",
              value: stockQuery,
              autoFocus: true,
              placeholder: "输入代码或名称搜索…",
              onChange: (e) => setStockQuery(e.target.value),
              onKeyDown: (e) => { if (e.key === "Escape") setShowAdd(null); },
            }),
            stockResults === null
              ? react.createElement("div", { className: "sk-add-empty" }, "输入代码或名称开始搜索")
              : stockResults.length === 0
                ? react.createElement("div", { className: "sk-add-empty" }, "未找到匹配的股票")
                : react.createElement("div", { className: "sk-add-results" },
                    stockResults.map((s) => {
                      const inCurrent = (groupsCfg && groupsCfg[groupIndex] && groupsCfg[groupIndex].symbols.some((x) => x.code === s.code)) || false;
                      return react.createElement("button", {
                        key: s.code,
                        className: "sk-add-result" + (inCurrent ? " sk-add-result-added" : ""),
                        onClick: () => addStock(s.code, s.name),
                      },
                        react.createElement("span", { className: "sk-add-result-code" }, s.code.replace(/^(sh|sz)/, "")),
                        react.createElement("span", { className: "sk-add-result-name" }, s.name),
                        inCurrent ? react.createElement("span", { className: "sk-add-result-badge" }, "已添加") : null);
                    }))),
          showAdd === "group" && react.createElement("div", { className: "sk-add-group" },
            react.createElement("input", {
              className: "sk-add-input",
              value: groupName,
              autoFocus: true,
              placeholder: "分组名称…",
              onChange: (e) => setGroupName(e.target.value),
              onKeyDown: (e) => { if (e.key === "Enter") addGroup(); else if (e.key === "Escape") setShowAdd(null); },
            }),
            react.createElement("button", { className: "sk-add-confirm", onClick: addGroup }, "创建")))) : null;

      // 分组列表底部：添加股票 / 分组 按钮
      const addBar = react.createElement("div", { className: "sk-add-bar" },
        react.createElement("button", { className: "sk-add-bar-btn", onClick: () => setShowAdd("stock") }, "＋ 添加股票"),
        react.createElement("button", { className: "sk-add-bar-btn", onClick: () => setShowAdd("group") }, "🗂 添加分组"));

      return react.createElement("div", { className: "sk-panel sk-theme-" + theme, style: panelStyle }, header, body, addBar, footer, resizeHandles, addPanel);
    }

    // ------------------------------------------------------------------ 插件主体
    /** Required services: slots（布局挂载点）。 */
    const inject = ["slots"];

    /**
     * Client plugin body：在 shell.overlay 注册右上角盯盘弹窗。
     * @param ctx - client root context。
     */
    function apply(ctx) {
      ctx.slots.inject("shell.overlay", () => ctx.slots.register({
        name: "shell.overlay",
        id: "dsh-stock-watch",
      }, WatchPanel));
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
