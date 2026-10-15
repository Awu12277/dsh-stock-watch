/**
 * dsh-stock-watch — 预设内提示词
 *
 * 作为 stock-analyst 预设的一个子插件运行：预设组内是隔离的 agent 上下文，
 * 因此这里注册的 systemPrompt 段落只对该预设的会话生效，不影响其它会话。
 * 预设声明见 presets/stock-analyst.patch.yml，文本见 prompts.js。
 */
import { SECTIONS } from "./prompts.js";

const name = "dsh-stock-watch-preset";
/** 预设组内一定有 systemPrompt（由 dsh-system-prompt 在根组合提供）。 */
const inject = ["systemPrompt"];

function apply(ctx) {
  const sp = ctx.get("systemPrompt");
  for (const section of SECTIONS) {
    ctx.effect(
      () => sp.section(section),
      "dsh-stock-watch: " + section.name,
    );
  }
}

export { apply, inject, name };
