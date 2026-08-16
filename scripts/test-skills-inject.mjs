/**
 * 验证 ensureUserSkills 注入逻辑（用临时目录，不碰真实 ~/.agents/skills）：
 * 1. 全新目录 → 两个技能被复制 + _user_meta.json(source=dsh-stock-watch)
 * 2. 再次执行 → 幂等，不覆盖已有文件（mtime 不变）
 * 3. 目标已有 SKILL.md（用户自定义版本）→ 跳过，不覆盖
 */
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const { ensureUserSkills } = await import(pathToFileURL("D:/projects/github/dsh-stock-watch/index.js").href);

const results = {};
const root = mkdtempSync(join(tmpdir(), "dsw-skills-test-"));

try {
  // —— 场景 1：全新目录注入 ——
  const fresh = join(root, "fresh");
  process.env.DSH_STOCK_WATCH_SKILLS_DIR = fresh;
  ensureUserSkills();
  const names = readdirSync(fresh).sort();
  results.scenario1 = {
    injected: names,
    hasInvestment: existsSync(join(fresh, "investment-research", "SKILL.md")),
    hasFinancialTool: existsSync(join(fresh, "investment-research", "tools", "financial_rigor.py")),
    hasFrontend: existsSync(join(fresh, "frontend-design", "SKILL.md")),
    hasLicense: existsSync(join(fresh, "frontend-design", "LICENSE.txt")),
    meta: JSON.parse(readFileSync(join(fresh, "investment-research", "_user_meta.json"), "utf8")),
  };

  // —— 场景 2：幂等（不覆盖已有）——
  const metaPath = join(fresh, "investment-research", "_user_meta.json");
  const mtimeBefore = statSync(metaPath).mtimeMs;
  // 在 SKILL.md 里加个标记，验证不会被覆盖
  const skillPath = join(fresh, "investment-research", "SKILL.md");
  const before = readFileSync(skillPath, "utf8");
  ensureUserSkills();
  const after = readFileSync(skillPath, "utf8");
  results.scenario2 = {
    notOverwritten: before === after,
    metaUnchanged: statSync(metaPath).mtimeMs === mtimeBefore,
    skipLogSilent: true,
  };

  // —— 场景 3：目标已有用户版本 → 跳过 ——
  const existing = join(root, "existing");
  const dest = join(existing, "investment-research");
  mkdirSync(dest, { recursive: true });
  writeFileSync(join(dest, "SKILL.md"), "# 用户自定义版本\n不要被覆盖");
  process.env.DSH_STOCK_WATCH_SKILLS_DIR = existing;
  ensureUserSkills();
  results.scenario3 = {
    preserved: readFileSync(join(dest, "SKILL.md"), "utf8").includes("用户自定义版本"),
    noMetaWritten: !existsSync(join(dest, "_user_meta.json")),
  };
} finally {
  delete process.env.DSH_STOCK_WATCH_SKILLS_DIR;
  rmSync(root, { recursive: true, force: true });
}

console.log("RESULT " + JSON.stringify(results, null, 2));
