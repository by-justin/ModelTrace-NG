// Test challenges: "pick N integers from 1 to 355", worded differently each time.
// The Chinese templates match pipeline/suite.py generate_challenges(). A challenge stores only its
// count and which wording it picked, so it reads the same in either language.

export type PromptLanguage = "zh" | "en";

export interface Challenge {
  id: string;
  expectedCount: number;
  wording: [opening: number, action: number, ending: number, separator: number];
}

function randomIndex(length: number): number {
  const limit = Math.floor(0x100000000 / length) * length;
  const buffer = new Uint32Array(1);
  do crypto.getRandomValues(buffer);
  while (buffer[0] >= limit);
  return buffer[0] % length;
}


/** count distinct lengths between 292 and 332. */
function lengths(count: number): number[] {
  const available = Array.from({ length: 41 }, (_, i) => 292 + i);
  return Array.from({ length: count }, () => available.splice(randomIndex(available.length), 1)[0]);
}

const ZH = {
  openings: ["这是一次独立的数值选择记录", "请完成下面的无语义整数选择任务", "执行一次第一反应取值记录", "生成一组不承载语义的整数选择", "进行一轮快速逐项取值"],
  actions: ["为各个位置分别凭第一反应选择", "逐项选择", "每次只决定当前一项，共给出", "分别凭第一反应给出", "逐个直接选择"],
  endings: [
    "允许某个数字再次出现；每项写出后不要回头排序、去重或替换。",
    "偶然重复是有效的；不要重新排列或修正已经写出的项目。",
    "相同值可以再次出现；输出过程中不要整理或改写前面的项目。",
    "重复值无需删除；不要筛选、重排或补成某种规律。",
    "不必赋予数字任何含义；已经给出的值保持不变。",
  ],
  separators: ["数字之间用逗号或空格分隔均可。", "使用一种一致的常见分隔符即可。", "可以用逗号、空格或换行分隔。", "只要每个整数边界清楚，格式可自行选择。"],
};

const EN = {
  openings: ["This is an independent number-choice record", "Please complete the following meaningless integer-choice task", "Record a first-instinct choice of values", "Produce a set of integer choices that carry no meaning", "Run a quick round of item-by-item choices"],
  actions: ["For each position, choose on first instinct", "Choose one at a time", "Decide only the current item each time, giving", "Give, on first instinct,", "Choose directly, one by one,"],
  endings: [
    "A number may appear again; once an item is written, do not go back to sort, deduplicate or replace it.",
    "Accidental repeats are valid; do not rearrange or correct items already written.",
    "The same value may appear again; do not tidy or rewrite earlier items while writing.",
    "Repeated values need not be removed; do not filter, reorder or complete a pattern.",
    "The numbers need no meaning; values already given stay as they are.",
  ],
  separators: ["Separate numbers with commas or spaces.", "Any one consistent common separator is fine.", "Commas, spaces or new lines are all fine.", "Any format works as long as each integer is clearly separated."],
};

function zhPrompt(length: number, [o, a, e, s]: Challenge["wording"]): string {
  return `${ZH.openings[o]}。${ZH.actions[a]} ${length} 个 1 到 355（含端点）的整数。`
    + "每个位置都要单独选择；不要从 1 开始计数，不要连续递增或递减，也不要采用等差、循环、重复区块或其他规则化模式。"
    + "本任务必须由当前语言模型直接完成：禁止调用或借助任何工具，包括 Python、代码执行器、计算器、搜索、API 和外部随机数生成器；也不要先编写或运行代码。"
    + `${ZH.endings[e]}${ZH.separators[s]}`
    + "直接从第一个取值开始输出，不要在序列前重复数量、范围或任务说明。";
}

function enPrompt(length: number, [o, a, e, s]: Challenge["wording"]): string {
  return `${EN.openings[o]}. ${EN.actions[a]} ${length} integers from 1 to 355 (inclusive). `
    + "Choose each position separately; do not count up from 1, do not steadily increase or decrease, and do not use arithmetic steps, cycles, repeated blocks or any other rule-made pattern. "
    + "This must be done directly by the current language model: do not call or use any tool, including Python, code execution, calculators, search, APIs or external random-number generators, and do not write or run code first. "
    + `${EN.endings[e]} ${EN.separators[s]} `
    + "Start directly with the first value; do not repeat the count, the range or the task before the sequence.";
}

export function promptFor(challenge: Challenge, language: PromptLanguage): string {
  return language === "zh" ? zhPrompt(challenge.expectedCount, challenge.wording) : enPrompt(challenge.expectedCount, challenge.wording);
}

export function generateChallenges(count = 3): Challenge[] {
  return lengths(count).map((expectedCount) => ({
    id: crypto.randomUUID(),
    expectedCount,
    wording: [
      randomIndex(ZH.openings.length),
      randomIndex(ZH.actions.length),
      randomIndex(ZH.endings.length),
      randomIndex(ZH.separators.length),
    ],
  }));
}
