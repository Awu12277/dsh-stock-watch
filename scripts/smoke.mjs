/**
 * dsh-stock-watch — Host 端冒烟测试
 *
 * 不启动 dsh web，用 stub 的 ctx.webServer 捕获 /dsh-stock-watch/* 路由，
 * 直接调用 4 个接口验证：注册、腾讯数据拉取、解析、触发标记。
 *
 * 用法：
 *   node scripts/smoke.mjs
 */
import { pathToFileURL } from "node:url";

const { apply } = await import(pathToFileURL(process.argv[2] ?? "D:/projects/github/dsh-stock-watch/index.js").href);

const routes = {};
const ctx = {
  effect: (fn) => fn(),
  webServer: { register: (route) => { routes[route.path] = route.handler; return () => {}; } },
};
apply(ctx);
console.log("registered routes:", Object.keys(routes).join(", "));

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

const groups = JSON.stringify([
  { name: "调试组", symbols: [{ code: "sh000001" }, { code: "sh601899" }, { code: "sz000001", buyPrice: 11, sellPrice: 12 }] },
]);

const q = await call("/dsh-stock-watch/quotes", "group=0&minutes=1&groups=" + encodeURIComponent(groups));
const qj = JSON.parse(q.body);
console.log("\n[QUOTES] status=" + q.status + " live=" + qj.live + " groups=" + JSON.stringify(qj.groups));
for (const r of qj.rows) {
  console.log("  row:", r.code, r.name, "price=" + r.price, "chg=" + r.changePercent + "%",
    "minutes=" + (r.minutes ? r.minutes.length : 0), "trigger=" + r.trigger,
    "buy=" + r.buyPrice, "sell=" + r.sellPrice);
}

const k = await call("/dsh-stock-watch/kline", "code=sh601899&period=day&refPrice=33");
const kj = JSON.parse(k.body);
console.log("\n[KLINE] status=" + k.status + " error=" + kj.error + " candles=" + (kj.candles ? kj.candles.length : 0));
if (kj.candles && kj.candles.length) console.log("  last:", JSON.stringify(kj.candles[kj.candles.length - 1]));

const m = await call("/dsh-stock-watch/minute", "code=sh000001");
const mj = JSON.parse(m.body);
console.log("\n[MINUTE] status=" + m.status + " error=" + mj.error + " points=" + (mj.points ? mj.points.length : 0) + " prevClose=" + mj.prevClose);
if (mj.points && mj.points.length) {
  console.log("  first:", JSON.stringify(mj.points[0]), "last:", JSON.stringify(mj.points[mj.points.length - 1]));
}

const c = await call("/dsh-stock-watch/config", "");
const cj = JSON.parse(c.body);
console.log("\n[CONFIG] status=" + c.status + " source=" + cj.source + " groups=" + (cj.groups ? cj.groups.length : 0) + " path=" + cj.path);

for (const q of ["平安", "000001", "茅台", "zzzz"]) {
  const s = await call("/dsh-stock-watch/stocks", "q=" + encodeURIComponent(q));
  const sj = JSON.parse(s.body);
  console.log("\n[STOCKS q=" + q + "] status=" + s.status + " total=" + sj.total + " sample=" + JSON.stringify(sj.rows.slice(0, 3)));
}

// 港股：本地池搜索 + 行情 + K 线（与 A 股同源接口）
const hks = await call("/dsh-stock-watch/stocks", "q=" + encodeURIComponent("小米"));
const hksj = JSON.parse(hks.body);
console.log("\n[HK STOCKS q=小米] total=" + hksj.total + " sample=" + JSON.stringify(hksj.rows.slice(0, 3)));
const xm = hksj.rows.find((r) => r.code === "hk01810");
console.log("[HK STOCKS] 找到 hk01810:", !!xm, xm ? xm.name : "");

const hkg = JSON.stringify([{ name: "港", symbols: [{ code: "hk01810" }] }]);
const hkq = JSON.parse((await call("/dsh-stock-watch/quotes", "group=0&minutes=0&groups=" + encodeURIComponent(hkg))).body);
const hkRow = hkq.rows && hkq.rows[0];
console.log("[HK QUOTES] live=" + (hkRow && hkRow.live) + " name=" + (hkRow && hkRow.name) + " price=" + (hkRow && hkRow.price) + " chg=" + (hkRow && hkRow.changePercent) + "%");

const hkk = JSON.parse((await call("/dsh-stock-watch/kline", "code=hk01810&period=day")).body);
console.log("[HK KLINE] candles=" + (hkk.candles ? hkk.candles.length : 0) + " error=" + hkk.error + " last=" + JSON.stringify(hkk.candles && hkk.candles[hkk.candles.length - 1]));
