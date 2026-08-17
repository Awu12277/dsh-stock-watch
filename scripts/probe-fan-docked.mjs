/**
 * 吸附态扇形可用性验证：吸附到右/下边缘后，悬浮胶囊 → 扇形展开 → 点击选项可触发 RPC、面板不误展开。
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
  await page.waitForTimeout(1500);

  // 拦截 RPC
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
          ? body.payload.content.map((c) => c && c.text).filter(Boolean) : [];
        calls.push({ url: u, rpcId, text: textParts.join(" | ") });
        await new Promise((r) => setTimeout(r, window.__rpcDelay || 0));
        const value = u.indexOf("session.create") >= 0 ? { sessionId: "probe-fake-dock" } : { accepted: true };
        return new Response(JSON.stringify({ type: "server-response", rpcId, result: { ok: true, value } }),
          { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return orig(url, opts);
    };
  });

  const pillCenter = () => page.$eval(".sk-pill", (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  const itemCenter = (text) => page.evaluate((t) => {
    const el = [...document.querySelectorAll(".sk-fan-item")].find((x) => x.textContent.includes(t));
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, text);
  const fanVisible = () => page.evaluate(() => getComputedStyle(document.querySelector(".sk-fan")).visibility !== "hidden");
  const waitFan = async (want, ms = 2500) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if ((await fanVisible()) === want) return true;
      await page.waitForTimeout(100);
    }
    return false;
  };
  const hoverPill = async () => { const p = await pillCenter(); await page.mouse.move(p.x, p.y); };
  const dragTo = async (tx, ty) => {
    const p = await pillCenter();
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.move(tx, ty, { steps: 12 });
    await page.mouse.up();
  };

  // —— 吸附右边缘 ——
  await dragTo(1432, 300);
  await page.waitForTimeout(350);
  await page.mouse.move(720, 450); // 移开
  await page.waitForTimeout(700);
  await hoverPill();
  const openedRight = await waitFan(true);
  await page.waitForTimeout(900);
  results.dockRight = {
    opened: openedRight,
    pill: await pillCenter(),
    itemPos: await itemCenter("涨停分析"),
    itemClickable: await page.evaluate(() => {
      const el = [...document.querySelectorAll(".sk-fan-item")].find((x) => x.textContent.includes("涨停分析"));
      const cs = getComputedStyle(el);
      return { pointerEvents: cs.pointerEvents, visibility: cs.visibility };
    }),
  };
  // 点击「涨停分析」前：模拟真实用户慢速移动（从胶囊中心逐步挪到选项），全程应保持打开
  const ic = await itemCenter("涨停分析");
  const pp = await pillCenter();
  await page.mouse.move(pp.x, pp.y, { steps: 1 });
  await page.waitForTimeout(200);
  let fanDuringMove = true;
  if (ic) {
    await page.mouse.move(ic.x, ic.y, { steps: 24, delay: 30 }); // 慢速路径
    fanDuringMove = await fanVisible();
    await page.waitForTimeout(200);
  }
  results.dockRightSlowPathOpen = fanDuringMove;
  await page.evaluate(() => { window.__rpcCalls.length = 0; });
  if (ic) await page.mouse.click(ic.x, ic.y);
  await page.waitForTimeout(900);
  results.dockRightClick = {
    rpc: await page.evaluate(() => {
      const c = window.__rpcCalls || [];
      const p = c.find((x) => typeof x === "object" && x.url && x.url.indexOf("session.prompt") >= 0);
      return { creates: c.filter((x) => typeof x === "object" && x.url && x.url.indexOf("session.create") >= 0).length, sent: p ? p.text : null };
    }),
    stillPill: await page.evaluate(() => !!document.querySelector(".sk-pill") && !document.querySelector(".sk-detail-header") && !document.querySelector(".sk-header")),
  };

  // —— 吸附下边缘 ——
  await page.mouse.move(720, 450);
  await page.waitForTimeout(700);
  const p = await pillCenter();
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(700, 896, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(350);
  await page.mouse.move(720, 450);
  await page.waitForTimeout(700);
  await hoverPill();
  const openedBottom = await waitFan(true);
  await page.waitForTimeout(900);
  results.dockBottom = { opened: openedBottom, pill: await pillCenter(), itemPos: await itemCenter("行情分析") };
  await page.evaluate(() => { window.__rpcCalls.length = 0; });
  const ic2 = await itemCenter("行情分析");
  if (ic2) await page.mouse.click(ic2.x, ic2.y);
  await page.waitForTimeout(900);
  results.dockBottomClick = {
    rpc: await page.evaluate(() => {
      const c = window.__rpcCalls || [];
      const p = c.find((x) => typeof x === "object" && x.url && x.url.indexOf("session.prompt") >= 0);
      return { creates: c.filter((x) => typeof x === "object" && x.url && x.url.indexOf("session.create") >= 0).length, sent: p ? p.text : null };
    }),
  };
} finally {
  await browser.close();
}
console.log("RESULT " + JSON.stringify(results, null, 2));
