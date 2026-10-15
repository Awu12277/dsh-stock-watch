import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

/**
 * 生成 presets/stock-analyst.patch.yml：
 * 以 DSH 自带的 standard 预设组合为底本，追加本插件的提示词子插件。
 * 预设的 config.plugins 是「该预设会话的完整 agent 组合」，DSH 自带的
 * standard/ptc/minimal 也是各自完整列一份，因此这里同样整份复制；
 * DSH 升级后可用本脚本一键重新同步。
 *
 *   node scripts/make-preset.mjs [--standard <path>] [--out <path>]
 */

const args = process.argv.slice(2);
function argOf(flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

/** 版本比较：0.2.0-rc.2 > 0.1.7-rc.2；正式版优先于同号预发布版。 */
function cmpVersion(a, b) {
  const parse = (v) => {
    const [core, pre = ""] = String(v).split("-");
    return { nums: core.split(".").map((n) => parseInt(n, 10) || 0), pre };
  };
  const A = parse(a);
  const B = parse(b);
  for (let i = 0; i < 3; i++) {
    const d = (A.nums[i] || 0) - (B.nums[i] || 0);
    if (d) return d;
  }
  if (A.pre === B.pre) return 0;
  if (!A.pre) return 1;
  if (!B.pre) return -1;
  const an = A.pre.match(/\d+/g) || [];
  const bn = B.pre.match(/\d+/g) || [];
  for (let i = 0; i < Math.max(an.length, bn.length); i++) {
    const d = (parseInt(an[i], 10) || 0) - (parseInt(bn[i], 10) || 0);
    if (d) return d;
  }
  return A.pre < B.pre ? -1 : 1;
}

function findStandard() {
  const explicit = argOf("--standard");
  if (explicit) return explicit;
  const instances = join(homedir(), ".local", "share", "hdsl", "instances");
  if (!existsSync(instances)) return undefined;
  const found = [];
  for (const inst of readdirSync(instances)) {
    const pnpm = join(instances, inst, "dsh", "node_modules", ".pnpm");
    if (!existsSync(pnpm)) continue;
    for (const dir of readdirSync(pnpm)) {
      if (!dir.startsWith("@deepseek-ai+dsh-web-app@")) continue;
      const version = dir.slice("@deepseek-ai+dsh-web-app@".length).split("_")[0];
      const p = join(pnpm, dir, "node_modules", "@deepseek-ai", "dsh-web-app", "presets", "standard.patch.yml");
      if (existsSync(p)) found.push({ version, path: p });
    }
  }
  if (!found.length) return undefined;
  found.sort((a, b) => cmpVersion(b.version, a.version));
  return found[0].path;
}

const src = findStandard();
if (!src) throw new Error("未找到 DSH 自带的 standard.patch.yml，请用 --standard 指定");
let text = readFileSync(src, "utf8");

const HEADER = [
  "# Agent preset stock-analyst — dsh-stock-watch 自带预设。",
  "#",
  "# 目的：把「行情分析 / 每日复盘 / 涨停分析」框架与「分析某家公司」的技能路由",
  "# 注入到本插件新建的会话里，**不改写其它会话的系统提示**。",
  "#",
  "# config.plugins 是采纳本预设会话的完整 agent 组合：DSH 自带的 standard/ptc/minimal",
  "# 预设同样各自整份列出，因此这里以 standard 为底本整份复制，只追加本插件的提示词行。",
  "# DSH 升级后同步：node scripts/make-preset.mjs",
  "#",
  "# 底本：" + src,
].join(String.fromCharCode(10)) + String.fromCharCode(10);

// 1) 替换原有头部注释
const body = text.slice(text.indexOf("- insert:"));
// 2) 预设身份
let out = body
  .replace("- id: preset-standard", "- id: preset-stock-analyst")
  .replace("        id: standard", "        id: stock-analyst" + String.fromCharCode(10) + "        name: 股票分析" + String.fromCharCode(10) + "        description: 自选股盯盘的新会话：带行情分析 / 每日复盘 / 涨停分析框架，以及投资研究与落地页技能路由")
  .replace("        order: 1", "        order: 50");

// 3) 追加本插件的提示词子插件（与同组行同缩进）
const ROW = [
  "          - id: dsh-stock-watch-prompts",
  "            name: dsh-stock-watch/preset",
  "",
].join(String.fromCharCode(10));
const marker = "          - id: persona";
if (out.indexOf(marker) < 0) throw new Error("未找到 plugins 列表起始行");
if (out.indexOf("dsh-stock-watch-prompts") >= 0) throw new Error("已包含本插件的提示词行");
if (!out.endsWith(String.fromCharCode(10))) out += String.fromCharCode(10);
out = out + ROW;

// 4) 把提示词行放在最前，便于阅读（第二个插件行之前）
const lines = out.split(String.fromCharCode(10));
const rowStart = lines.findIndex((l) => l.trim() === "- id: dsh-stock-watch-prompts");
const rowEnd = rowStart + 2;
const rowBlock = lines.splice(rowStart, rowEnd - rowStart);
const personaIdx = lines.findIndex((l) => l.trim() === "- id: persona");
if (personaIdx < 0) throw new Error("未找到 persona 行");
lines.splice(personaIdx, 0, ...rowBlock);

const target = argOf("--out") || "presets/stock-analyst.patch.yml";
writeFileSync(target, HEADER + lines.join(String.fromCharCode(10)));
console.log("已生成 " + target + "（底本 " + src + "）");
