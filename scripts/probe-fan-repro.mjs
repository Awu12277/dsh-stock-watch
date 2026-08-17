/**
 * 复现：扇形打开状态下拖动胶囊吸附 → 释放后鼠标仍在胶囊上 → 悬停不再触发扇形。
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
  const pillCenter = () => page.$eval(".sk-pill", (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  const fanVisible = () => page.evaluate(() => getComputedStyle(document.querySelector(".sk-fan")).visibility !== "hidden");

  const dump = () => page.evaluate(() => {
    const box = document.querySelector(".sk-fan");
    const items = [...document.querySelectorAll(".sk-fan-item")].map((el) => ({
      opacity: getComputedStyle(el).opacity,
      transform: el.style.transform.slice(0, 60),
    }));
    return {
      boxVisibility: getComputedStyle(box).visibility,
      boxPointerEvents: getComputedStyle(box).pointerEvents,
      boxInlineVis: box.style.visibility,
      items: items.slice(0, 1),
    };
  });

  // 1) 悬浮打开扇形
  const p0 = await pillCenter();
  await page.mouse.move(p0.x, p0.y);
  await page.waitForTimeout(900);
  results.openedInitially = await fanVisible();
  results.dumpOpen = await dump();

  // 2) 扇形打开状态下直接按住拖动到右边缘
  await page.mouse.down();
  await page.mouse.move(1432, 300, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  results.afterDrag = {
    pill: await pillCenter(),
    fan: await fanVisible(),
  };
  results.dumpAfterDrag = await dump();

  // 3) 鼠标仍在胶囊上（未移开），轻微移动模拟"悬停" → 期望扇形重新打开
  const p1 = await pillCenter();
  await page.mouse.move(p1.x + 8, p1.y + 4, { steps: 4 });
  await page.waitForTimeout(800);
  results.reHoverWithoutLeave = await fanVisible();
  results.dumpReHover = await dump();
} finally {
  await browser.close();
}
console.log("RESULT " + JSON.stringify(results, null, 2));
