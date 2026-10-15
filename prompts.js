/**
 * dsh-stock-watch — 提示词文本（host 侧唯一来源）
 *
 * 这些文本 **只** 注入到采纳 stock-analyst 预设的会话里（见 preset.js 与
 * presets/stock-analyst.patch.yml）；普通会话的系统提示完全不包含它们。
 * 客户端发送的仍是「每日复盘」这类短消息，完整提示词不暴露在消息里。
 */

/** 换行符：避免在本文件里写转义序列，便于逐字比对文本。 */
const NL = String.fromCharCode(10);

/** 一键分析上市公司的路由指令（客户端首条消息形如「分析贵州茅台（sh600519）」）。 */
const ANALYSIS_SECTION = "当用户消息以「分析」开头、且意图是分析某家上市公司（而非代码、思路等其他对象）时：依次使用技能 investment-research 完成投资研究分析，再使用技能 frontend-design 生成一个介绍该公司的网站。";

/** 悬浮菜单三个动作的完整提示词（客户端只发送其关键词）。 */
const FAN_PROMPTS = {
  每日复盘: `请作为专业的A股短线复盘分析师，帮我完成今天的盘后复盘。请基于以下框架：

1. 市场概览：指数表现、成交量变化、涨跌家数分布。不要只报数据，要点出"这说明什么"。

2. 涨停梯队：今日涨停多少家？炸板多少家？连板高度到几板了？首板、二板、三板各多少？晋级率如何？

3. 主线与轮动：今天市场围绕哪些方向在交易？哪些是主线、哪些只是轮动？哪些方向冲高回落？

4. 情绪判断：今天的情绪是在加强、分化、修复还是退潮？赚钱效应如何？

5. 核心个股反馈：龙头股、中军股的表现如何？从它们的走势能看出什么？

6. 明日关键观察：明天最需要盯住的变量是什么？不要只说"关注市场变化"，要说具体看什么指标。

输出格式用7个板块，每个板块一句话结论。要有明确判断，不要模棱两可。`,
  行情分析: `获取A股实时行情数据，给出整体分析：

市场温度：当前是进攻还是防守格局？一句话定性。

量价关系：放量还是缩量？量价是否配合？说明什么？

结构分化：大小盘风格如何？哪些板块在领涨/领跌？

操作基调：此刻适合积极、谨慎还是观望？给明确结论。
输出要求：每项不超过两行，总字数控制在200字以内。`,
  涨停分析: `基于今日涨停数据（涨停家数、连板高度、炸板率、涨停板块分布），分析：

情绪热度（亢奋/正常/冰点）

主线板块（涨停最集中方向）

龙头高度及晋级情况

明天接力风险或机会
每项一句话，总字数控制在150字以内。`,
};

/** 悬浮菜单动作 → 客户端发送的关键词。 */
const FAN_ACTIONS = [
  { key: "行情分析", label: "行情分析" },
  { key: "每日复盘", label: "每日复盘" },
  { key: "涨停分析", label: "涨停分析" },
];

/** 单个关键词的任务行（关键词命中时执行该任务）。 */
function fanTaskText(key) {
  return "当用户消息为「" + key + "」或以「" + key + "」开头时，执行以下" + key + "任务：" + NL + FAN_PROMPTS[key];
}

/** 关键词命中时执行任务的路由段落（段落文本 + 关键词一一对应）。 */
const FAN_SECTION = FAN_ACTIONS.map((a) => fanTaskText(a.key)).join(NL);

/** 预设里注册的提示词段落。order 决定拼接顺序，name 为唯一标识。 */
const SECTIONS = [
  { name: "dsh-stock-watch.analysis", order: 200, text: ANALYSIS_SECTION },
  { name: "dsh-stock-watch.fan-prompts", order: 201, text: FAN_SECTION },
];

/**
 * 预设未生效时的兜底文本：把对应框架直接放进消息。
 * 仅在会话没能采纳预设时使用（例如运行在没有 agentPreset 支持的旧版 DSH 上）。
 */
function promptForMessage(text) {
  if (Object.prototype.hasOwnProperty.call(FAN_PROMPTS, text)) {
    return "当用户消息为「" + text + "」时，执行以下" + text + "任务：" + NL + FAN_PROMPTS[text];
  }
  if (text.indexOf("分析") === 0) return ANALYSIS_SECTION + NL + NL + "用户消息：" + text;
  return text;
}

export { ANALYSIS_SECTION, FAN_PROMPTS, FAN_ACTIONS, FAN_SECTION, SECTIONS, NL, promptForMessage };
