/**
 * 胶囊悬浮扇形菜单验证：
 * 1. 悬浮胶囊 → 扇形打开（3 个选项：行情分析/每日复盘/涨停分析，GSAP 已加载）
 * 2. 默认右上角 → 扇形向左下展开且不越出屏幕
 * 3. 吸附右边缘 → 扇形向左展开（朝屏内）
 * 4. 吸附下边缘 → 扇形向上展开
 * 5. 移开鼠标 → 扇形收回
 */
import { createRequire } from "node:module";
const require = createRequire("D:/projects/github/deepseek-harness/apps/web/package.json");
const { chromium } = require("playwright");

const browser = await chromium.launch({
  headless: true,
  executablePath: "C:\\Users\\24974\\AppData\\Local\\ms-playwright\\chromium_headless_shell-1223\\chrome-headless-shell-win64\\chrome-headless-shell.exe",
});
const results = { errors: [] };
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("pageerror", (e) => results.errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") results.errors.push("console: " + m.text()); });

  await page.goto("http://127.0.0.1:3080", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".sk-pill", { timeout: 20000 });

  // 拦截 session.create / session.prompt（伪造响应，避免真实建会话/消耗模型），记录请求体文本
  await page.evaluate(() => {
    const calls = [];
    window.__rpcCalls = calls;
    window.__rpcDelay = 300;
    const orig = window.fetch.bind(window);
    window.fetch = async (url, opts) => {
      const u = String(url);
      if (u.indexOf("/api/session.create") >= 0 || u.indexOf("/api/session.prompt") >= 0) {
        let body = null;
        try { body = typeof opts.body === "string" ? JSON.parse(opts.body) : null; } catch { /* ignore */ }
        const rpcId = (body && body.rpcId) || "unknown";
        const textParts = (body && Array.isArray(body.payload && body.payload.content))
          ? body.payload.content.map((c) => c && c.text).filter(Boolean)
          : [];
        calls.push({ url: u, rpcId, text: textParts.join(" | ") });
        await new Promise((r) => setTimeout(r, window.__rpcDelay || 0));
        const value = u.indexOf("session.create") >= 0
          ? { sessionId: "probe-fake-session-fan" }
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

  const snap = async () => page.evaluate(() => {
    const vw = window.innerWidth, vh = window.innerHeight;
    const pill = document.querySelector(".sk-pill").getBoundingClientRect();
    const items = [...document.querySelectorAll(".sk-fan-item")].map((el) => {
      const r = el.getBoundingClientRect();
      return {
        text: el.textContent,
        l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom),
        cx: Math.round(r.left + r.width / 2), cy: Math.round(r.top + r.height / 2),
        onScreen: r.left >= 0 && r.right <= vw && r.top >= 0 && r.bottom <= vh,
      };
    });
    return {
      vw, vh,
      pill: { l: Math.round(pill.left), t: Math.round(pill.top), cx: Math.round(pill.left + pill.width / 2), cy: Math.round(pill.top + pill.height / 2) },
      fanVisible: getComputedStyle(document.querySelector(".sk-fan")).visibility !== "hidden",
      gsapLoaded: typeof window.gsap === "object" && typeof window.gsap.to === "function",
      items,
    };
  });

  const hoverPill = async () => {
    const b = await page.$eval(".sk-pill", (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await page.mouse.move(b.x, b.y);
  };
  const waitFan = async (wantVisible, timeout = 2500) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const v = await page.evaluate(() => getComputedStyle(document.querySelector(".sk-fan")).visibility);
      const vis = v !== "hidden";
      if (vis === wantVisible) return true;
      await page.waitForTimeout(100);
    }
    return false;
  };

  // —— 1) 默认（右上角）：悬浮打开 ——
  await hoverPill();
  const opened1 = await waitFan(true);
  await page.waitForTimeout(700); // 等 GSAP 动画落位
  results.default = await snap();
  results.default.opened = opened1;

  // —— 1.5) 空隙停留不收起：鼠标移到胶囊与选项之间的空隙（扇形区域内），停留后扇形应保持打开 ——
  const gapPoint = await page.evaluate(() => {
    const pill = document.querySelector(".sk-pill").getBoundingClientRect();
    const item = document.querySelector(".sk-fan-item").getBoundingClientRect();
    return {
      x: Math.round((pill.left + pill.width / 2 + item.left + item.width / 2) / 2),
      y: Math.round((pill.top + pill.height / 2 + item.top + item.height / 2) / 2),
    };
  });
  await page.mouse.move(gapPoint.x, gapPoint.y);
  await page.waitForTimeout(900); // 超过 280ms 关闭延迟
  results.staysOpenInGap = await page.evaluate(() => getComputedStyle(document.querySelector(".sk-fan")).visibility !== "hidden");

  // —— 2) 移出扇形区域 → 收回 ——
  await page.mouse.move(720, 450);
  results.closedAfterLeave = await waitFan(false);

  // —— 2.5) 每日复盘时段控制：交易时段（9:00–15:00）置灰 + 提示；此时段外可点 ——
  const reviewBtn = await page.evaluate(() => {
    const items = [...document.querySelectorAll(".sk-fan-item")];
    const review = items.find((el) => el.textContent.includes("每日复盘"));
    const quote = items.find((el) => el.textContent.includes("行情分析"));
    const now = new Date();
    const mins = now.getHours() * 60 + now.getMinutes();
    const inTrading = mins >= 540 && mins < 900;
    return {
      now: now.toLocaleTimeString("zh-CN", { hour12: false }),
      inTrading,
      reviewDisabled: review ? review.classList.contains("sk-fan-item-disabled") : null,
      reviewTitle: review ? review.getAttribute("title") : null,
      quoteDisabled: quote ? quote.classList.contains("sk-fan-item-disabled") : null,
      expectedDisabled: inTrading,
    };
  });
  results.reviewGate = reviewBtn;
  results.reviewGate.consistent = reviewBtn.reviewDisabled === reviewBtn.expectedDisabled;

  // —— 3) 吸附右边缘 → 扇形朝屏内（左）——
  const pillBox = await page.$eval(".sk-pill", (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await page.mouse.move(pillBox.x, pillBox.y);
  await page.mouse.down();
  await page.mouse.move(1432, 300, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  await page.mouse.move(720, 450); // 移开，确保下次悬浮是全新 mouseenter
  await page.waitForTimeout(700); // 等关闭动画完全结束再重新悬浮
  await hoverPill();
  await waitFan(true);
  await page.waitForTimeout(800);
  results.dockRight = await snap();

  // —— 4) 吸附下边缘 → 扇形朝上 ——
  await page.mouse.move(720, 450); // 先移开（关闭扇形）
  await page.waitForTimeout(700);
  await page.mouse.move(1414, 307); // 悬停胶囊
  await page.mouse.down();
  await page.mouse.move(700, 896, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  await page.mouse.move(720, 450);
  await page.waitForTimeout(700);
  await hoverPill();
  await waitFan(true);
  await page.waitForTimeout(800);
  results.dockBottom = await snap();

  await page.mouse.move(720, 450);
  await waitFan(false);
  results.finalClosed = await page.evaluate(() => getComputedStyle(document.querySelector(".sk-fan")).visibility !== "hidden") === false;

  // —— 5) 点击扇形选项：行情分析 → 新开对话发送「行情分析」；置灰的每日复盘点击无效 ——
  // （伪造 open(fake session) 会导致页面跳转到不存在会话，因此放在最后执行）
  const clickItem = async (text) => {
    const box = await page.evaluate((t) => {
      const el = [...document.querySelectorAll(".sk-fan-item")].find((x) => x.textContent.includes(t));
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, text);
    if (!box) return "missing";
    await page.mouse.click(box.x, box.y);
    await page.waitForTimeout(900);
    return "ok";
  };
  // 每日复盘（交易时段置灰）点击 → 不应发出任何建会话请求
  await hoverPill();
  await waitFan(true);
  await page.waitForTimeout(400);
  await page.evaluate(() => { window.__rpcCalls.length = 0; });
  results.fanReviewClick = await clickItem("每日复盘");
  results.fanReviewBlocked = await page.evaluate(() => {
    const calls = window.__rpcCalls || [];
    return calls.filter((c) => typeof c === "object" && c.url && c.url.indexOf("session.create") >= 0).length;
  });
  results.fanReviewBlockedInfo = {
    count: results.fanReviewBlocked,
    expected: results.reviewGate.reviewDisabled ? 0 : 1,
    ok: results.fanReviewBlocked === (results.reviewGate.reviewDisabled ? 0 : 1),
  };
  // 行情分析 → 新开对话发送简短关键词
  await page.evaluate(() => { window.__rpcCalls.length = 0; });
  results.fanQuoteClick = await clickItem("行情分析");
  results.fanQuoteRpc = await page.evaluate(() => {
    const calls = window.__rpcCalls || [];
    const p = calls.find((c) => typeof c === "object" && c.url && c.url.indexOf("session.prompt") >= 0);
    return {
      creates: calls.filter((c) => typeof c === "object" && c.url && c.url.indexOf("session.create") >= 0).length,
      prompts: calls.filter((c) => typeof c === "object" && c.url && c.url.indexOf("session.prompt") >= 0).length,
      sentText: p ? p.text : null,
    };
  });
  results.fanQuoteToast = await page.evaluate(() => {
    const el = document.querySelector(".sk-toast");
    return el ? el.textContent : null;
  });
} finally {
  await browser.close();
}

console.log("RESULT " + JSON.stringify(results, null, 2));
