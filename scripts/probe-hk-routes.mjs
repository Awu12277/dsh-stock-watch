import { pathToFileURL } from "node:url";
const { apply } = await import(pathToFileURL("D:/projects/github/dsh-stock-watch/index.js").href);
const routes = {};
const ctx = {
  effect: (fn) => fn(),
  webServer: { register: (route) => { routes[route.path] = route.handler; return () => {}; } },
};
apply(ctx);
function call(path, query) {
  return new Promise((resolve) => {
    let status = 0;
    const res = {
      writeHead: (s) => { status = s; },
      end: (body) => resolve({ status, body: typeof body === "string" ? body : JSON.stringify(body) }),
    };
    routes[path]({ url: path + (query ? "?" + query : "") }, res);
  });
}

// 1) 搜索「小米」→ 应含 hk01810 小米集团
const s1 = JSON.parse((await call("/dsh-stock-watch/stocks", "q=" + encodeURIComponent("小米"))).body);
console.log("[SEARCH 小米] total:", s1.total);
console.log("  hk rows:", s1.rows.filter((r) => r.code.startsWith("hk")).slice(0, 5));
console.log("  us rows:", s1.rows.filter((r) => r.code.startsWith("us")).slice(0, 3));

// 2) 搜索代码 01810
const s2 = JSON.parse((await call("/dsh-stock-watch/stocks", "q=01810")).body);
console.log("[SEARCH 01810] total:", s2.total, "rows:", s2.rows.slice(0, 5));

// 3) 港股 quotes（含分时）
const groups = JSON.stringify([{ name: "港", symbols: [{ code: "hk01810" }, { code: "sh000001" }] }]);
const q = JSON.parse((await call("/dsh-stock-watch/quotes", "group=0&minutes=1&groups=" + encodeURIComponent(groups))).body);
console.log("[QUOTES] live:", q.live);
for (const r of q.rows) {
  console.log("  row:", r.code, r.name, "price:", r.price, "chg:", r.changePercent + "%", "minutes:", r.minutes ? r.minutes.length : 0, "live:", r.live);
}

// 4) 港股 K 线
const k = JSON.parse((await call("/dsh-stock-watch/kline", "code=hk01810&period=day&refPrice=")).body);
console.log("[KLINE hk01810] candles:", k.candles ? k.candles.length : 0, "error:", k.error, "last:", k.candles && k.candles[k.candles.length - 1]);

// 5) 港股分时详情
const m = JSON.parse((await call("/dsh-stock-watch/minute", "code=hk01810")).body);
console.log("[MINUTE hk01810] points:", m.points ? m.points.length : 0, "prevClose:", m.prevClose, "first:", m.points && m.points[0], "last:", m.points && m.points[m.points.length - 1]);
