// 本地验证：K线缩放按钮是否已加载到 GUI，并模拟点击 + / − / 重置
import { createRequire } from "node:module";

// playwright 解析：环境变量 → 直接 import → 常见开发项目路径 → 脚本自身 node_modules
let chromium = null;
try {
  ({ chromium } = await import("playwright"));
} catch { /* 继续尝试其它来源 */ }
if (!chromium) {
  for (const base of [
    process.env.PROBE_PLAYWRIGHT_REQ,
    "D:/projects/github/deepseek-harness/apps/web/package.json",
  ].filter(Boolean)) {
    try {
      const require = createRequire(base);
      ({ chromium } = require("playwright"));
      break;
    } catch { /* 尝试下一个来源 */ }
  }
}
if (!chromium) {
  try {
    const require = createRequire(import.meta.url);
    ({ chromium } = require("playwright"));
  } catch { /* ignore */ }
}
if (!chromium) throw new Error("playwright 不可用：请先 npm i -D playwright 或设置 PROBE_PLAYWRIGHT_REQ");

const URL = process.env.PROBE_URL || "http://127.0.0.1:3080";
const results = {};

// 已安装的 chromium 可执行文件（可被 PROBE_CHROME 覆盖；未指定时用 playwright 自带浏览器）
const CHROME_CANDIDATES = [
  process.env.PROBE_CHROME,
  "C:\\Users\\24974\\AppData\\Local\\ms-playwright\\chromium_headless_shell-1223\\chrome-headless-shell-win64\\chrome-headless-shell.exe",
].filter(Boolean);

const browser = await chromium.launch({
  headless: true,
  ...(CHROME_CANDIDATES.length ? { executablePath: CHROME_CANDIDATES[0] } : {}),
});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 30000 });

  // 1) 抓取页面加载的插件 client bundle，检查是否包含新按钮代码
  results.bundleHasZoom = await page.evaluate(async () => {
    const res = performance.getEntriesByType("resource").map((r) => r.name);
    const cand = res.filter((u) => /dsh-stock-watch|client/i.test(u));
    for (const u of cand) {
      try {
        const t = await (await fetch(u)).text();
        if (t.includes("sk-zoom-btn")) return { ok: true, url: u };
        if (t.includes("sk-ma-row")) return { ok: false, url: u, note: "bundle served but zoom missing" };
      } catch { /* ignore */ }
    }
    return { ok: false, note: "no bundle found: " + cand.join(", ") };
  });
  console.log("bundleHasZoom:", JSON.stringify(results.bundleHasZoom));

  // 2) 等胶囊出现
  await page.waitForSelector(".sk-pill", { timeout: 20000 });
  results.pillVisible = true;

  // 3) 点开胶囊 → 详情（选第一行股票）
  await page.click(".sk-pill");
  await page.waitForSelector(".sk-row, .sk-detail-header, .sk-header", { timeout: 15000 });
  results.openedPanel = await page.evaluate(() => !!document.querySelector(".sk-detail-header") || !!document.querySelector(".sk-header"));

  // 等列表行渲染后点第一行进详情
  await page.waitForSelector(".sk-row", { timeout: 15000 });
  await page.click(".sk-row");
  await page.waitForSelector(".sk-detail-header", { timeout: 15000 });
  results.enteredDetail = true;

  // 4) 切到日K，检查缩放按钮
  await page.click(".sk-period:not(.sk-period-active)", { timeout: 5000 }).catch(() => {});
  const periodLabel = await page.evaluate(() => {
    const el = document.querySelector(".sk-period-active");
    return el ? el.textContent : null;
  });
  results.activePeriod = periodLabel;
  const zoomCount = await page.evaluate(() => document.querySelectorAll(".sk-zoom-btn").length);
  results.zoomBtnCount = zoomCount;
  const maRow = await page.evaluate(() => {
    const row = document.querySelector(".sk-ma-row");
    if (!row) return null;
    const zoom = row.querySelector(".sk-zoom");
    const chips = row.querySelector(".sk-ma-chips");
    const cs = getComputedStyle(row);
    return {
      hasZoom: !!zoom,
      hasChips: !!chips,
      justify: cs.justifyContent,
      zoomLeft: zoom ? zoom.getBoundingClientRect().left : null,
      chipsLeft: chips ? chips.getBoundingClientRect().left : null,
    };
  });
  results.maRow = maRow;

  // 5) 点击 + / − / 重置，确认不抛错、面板不塌
  const clicks = [];
  for (const [label, selector] of [["zoomIn", ".sk-zoom-btn:nth-child(2)"], ["zoomOut", ".sk-zoom-btn:nth-child(1)"], ["reset", ".sk-zoom-btn:nth-child(3)"]]) {
    try {
      await page.click(selector, { timeout: 5000 });
      clicks.push(label + ":ok");
    } catch (e) {
      clicks.push(label + ":FAIL " + e.message.split("\n")[0]);
    }
  }
  results.clicks = clicks;
  results.panelStillThere = await page.evaluate(() => !!document.querySelector(".sk-detail-header"));

  // —— 6) 贴边吸附 + 屏幕边缘半球 ——
  const pillBox = async () => {
    await page.waitForSelector(".sk-pill", { timeout: 10000 });
    return page.$eval(".sk-pill", (el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, cls: el.className, text: el.textContent };
    });
  };
  const dragPillTo = async (tx, ty) => {
    const b = await pillBox();
    await page.mouse.move(b.x + b.w / 2, b.y + b.h / 2);
    await page.mouse.down();
    await page.mouse.move(tx, ty, { steps: 14 });
    await page.mouse.up();
    await page.waitForTimeout(200);
  };
  const waitClass = async (needle, timeout = 3000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      if (await page.evaluate((n) => document.querySelector(".sk-pill").className.includes(n), needle)) return true;
      await page.waitForTimeout(100);
    }
    return false;
  };

  // 先最小化回胶囊
  try {
    await page.click('.sk-icon[title="最小化回胶囊"]', { timeout: 5000 });
    await page.waitForSelector(".sk-pill", { timeout: 5000 });
    results.minimized = true;
  } catch (e) {
    results.minimized = "FAIL " + e.message.split("\n")[0];
  }

  const vwvh = await page.evaluate(() => ({ vw: window.innerWidth, vh: window.innerHeight }));
  const docks = {};
  // 右边缘
  await dragPillTo(vwvh.vw - 8, 300);
  docks.right = { ok: await waitClass("sk-dock-right"), box: await pillBox() };
  // 左边缘
  await dragPillTo(10, 300);
  docks.left = { ok: await waitClass("sk-dock-left"), box: await pillBox() };
  // 上边缘
  await dragPillTo(600, 4);
  docks.top = { ok: await waitClass("sk-dock-top"), box: await pillBox() };
  // 下边缘
  await dragPillTo(600, vwvh.vh - 4);
  docks.bottom = { ok: await waitClass("sk-dock-bottom"), box: await pillBox() };
  // 拖回屏幕中央 → 恢复普通胶囊
  await dragPillTo(vwvh.vw / 2, vwvh.vh / 2);
  docks.center = { ok: await waitClass("sk-dock", 1500) === false, box: await pillBox() };
  results.docks = docks;
  // 贴边半球上点击 → 面板仍可展开
  await dragPillTo(vwvh.vw - 8, 300); // 回到右边缘
  await page.click(".sk-pill");
  await page.waitForSelector(".sk-detail-header, .sk-header", { timeout: 10000 });
  results.expandFromDock = true;

  // —— 7) 一键分析（新建会话发送）：拦截 /api/session.create 与 /api/session.prompt，
  //        伪造成功响应验证调用链（不真实建会话、不消耗模型）——
  await page.evaluate(() => {
    const calls = [];
    window.__rpcCalls = calls;
    window.__rpcDelay = 500; // 模拟慢响应，便于验证防抖
    const orig = window.fetch.bind(window);
    window.fetch = async (url, opts) => {
      const u = String(url);
      if (u.indexOf("/api/session.create") >= 0 || u.indexOf("/api/session.prompt") >= 0) {
        let body = null;
        try { body = typeof opts.body === "string" ? JSON.parse(opts.body) : null; } catch { /* ignore */ }
        const rpcId = (body && body.rpcId) || "unknown";
        // 记录请求体（含发送的文本），便于断言「分析xxx」简短消息
        const textParts = (body && Array.isArray(body.payload && body.payload.content))
          ? body.payload.content.map((c) => c && c.text).filter(Boolean)
          : [];
        calls.push({ url: u, rpcId, text: textParts.join(" | ") });
        await new Promise((r) => setTimeout(r, window.__rpcDelay || 0));
        const value = u.indexOf("session.create") >= 0
          ? { sessionId: "probe-fake-session-1" }
          : { accepted: true };
        return new Response(JSON.stringify({
          type: "server-response",
          rpcId,
          result: { ok: true, value },
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return orig(url, opts);
    };
  });
  const analyzeBtn = await page.$(".sk-analyze");
  results.analyzeBtnVisible = !!analyzeBtn;
  if (analyzeBtn) {
    await analyzeBtn.click();
    await page.waitForTimeout(1600); // 两次 500ms 伪延迟 + 缓冲，等流程完成再读 flash
    results.analyzeRpcCalls = await page.evaluate(() => window.__rpcCalls || []);
    results.analyzePromptText = await page.evaluate(() => {
      const calls = window.__rpcCalls || [];
      const p = calls.find((c) => typeof c === "object" && c.url && c.url.indexOf("session.prompt") >= 0);
      return p ? p.text : null;
    });
    results.analyzeFlash = await page.evaluate(() => {
      const el = document.querySelector(".sk-flash");
      return el ? el.textContent : null;
    });
    results.analyzeBtnStillThere = await page.evaluate(() => !!document.querySelector(".sk-analyze"));

    // —— 防抖验证：同步连点两次（el.click 模拟真实毫秒级连点），断言只发出一次 session.create ——
    await page.evaluate(() => {
      window.__rpcCalls.length = 0;
      const el = document.querySelector(".sk-analyze");
      el.click(); // 第一次：同步启动分析（analyzingRef 立即置位）
      el.click(); // 第二次：同一时刻的连点，应被防抖拦截
    });
    await page.waitForTimeout(1500);
    results.debounce = await page.evaluate(() => {
      const calls = window.__rpcCalls || [];
      return {
        createCount: calls.filter((c) => typeof c === "object" && c.url && c.url.indexOf("session.create") >= 0).length,
        promptCount: calls.filter((c) => typeof c === "object" && c.url && c.url.indexOf("session.prompt") >= 0).length,
      };
    });
    results.analyzeBtnEnabledAgain = await page.evaluate(() => {
      const el = document.querySelector(".sk-analyze");
      return el ? !el.disabled : null;
    });
  }

  results.pageErrors = errors.slice(0, 5);
} finally {
  await browser.close();
}

console.log("RESULT " + JSON.stringify(results, null, 2));
