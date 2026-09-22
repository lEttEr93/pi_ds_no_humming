/**
 * Cleaner test suite — zero dependencies, pure logic.
 *
 *   node test/cleaner.test.ts        (Node >= 22.19 strips the TS types)
 *   npm run test:cleaner
 */
import { DEFAULT_CONFIG, cleanThinkingText, normalizeConfig, type FilterConfig } from "../extensions/pi-no-hemming/cleaner.ts";

const cfg: FilterConfig = { ...DEFAULT_CONFIG };

/** [input, expected output | null = assert via contains] */
const cases: [string, string | null][] = [
  ["Hmm, the user wants to clean the thinking. Hmm, let me check the file.", "The user wants to clean the thinking. Let me check the file."],
  ["Let me look at the code.\n\nHmm. Actually no.\n\nHmm\n\nLet me try the other path.", "Let me look at the code.\n\nActually no.\n\nLet me try the other path."],
  ["Wait — hmm, maybe the config is wrong.", "Wait — maybe the config is wrong."],
  ["Hmm, hmm, hmm. Let me think.", "Let me think."],
  ["```ts\nconst hmm = 1; // hmm hmm\nhmm();\n```\nHmm, the code block must stay untouched.", "```ts\nconst hmm = 1; // hmm hmm\nhmm();\n```\nThe code block must stay untouched."],
  ["The value is `hmm` in code.\nHmm, ok.", "The value is `hmm` in code.\nOk."],
  ["嗯，让我看看。Hmm, the file is huge.", "让我看看。The file is huge."],
  ["So the file is at X. Hmm, the user wants Y.", "So the file is at X. The user wants Y."],
  ["I think hmm that's fine.", "I think that's fine."],
  ["This is fine. Hmm.", "This is fine."],
  ["Hmm", ""],
  ["No fillers here at all.", "No fillers here at all."],
  ["Hmm, the config has hmm in it (hmm) and that's it.", "The config has in it and that's it."],
  ["Use e.g. this. Hmm, or that.", "Use e.g. this. Or that."],
  ["Hmm, one. Hmm, two. Hmm, three.", "One. Two. Three."],
  ["  Hmm, indented line start.\nHmm, next line.", "indented line start.\nNext line."],
  ["Let me check.\nHmm\nhmm\nlowercase next line.", "Let me check.\nLowercase next line."],
  ["Emm, and emmm too.", "And too."],
  ["See https://example.com/a/hmm/b and hmm.txt but not aHmm.", "See https://example.com/a/hmm/b and hmm.txt but not aHmm."],
  ["Hmm,Hmm.But no space after the period.", "Hmm.But no space after the period."],
  ["Line one.\n\n\n\nHmm\n\n\n\nLine two.", "Line one.\n\nLine two."],
  ["Hmm, the `code hmm` inline and 嗯嗯 double CJK.", "The `code hmm` inline and double CJK."],
  // punctuation / symbol variants after the filler
  ["Hmm！让我看看这个文件。", "让我看看这个文件。"],
  ["Hmm，这个文件很大。", "这个文件很大。"],
  ["Hmm。", ""],
  ["Hmm... let me see.", "Let me see."],
  ["Hmm‼️ let me check.", "Let me check."],
  ["Hmm🤔 the file is huge.", "The file is huge."],
  ["Hmm——maybe not.", "Maybe not."],
  ["Hmm》next section.", "Next section."],
  ["Hmm：the file path.", "The file path."],
  ["Blah. Hmm！next word needs capital.", "Blah. Next word needs capital."],
  ["HMM！all caps filler.", "All caps filler."],
  ["Hmm ??? !!! next.", "Next."],
  ["Double  space。 Hmm　 ideographic gap。", "Double  space。 Ideographic gap。"],
  ["1. Hmm, first\n2. hmm, second", "1. First\n2. Second"],
];

let failures = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  if (actual === expected) {
    console.log(`  ok   ${label}`);
    return;
  }
  failures += 1;
  console.log(`  FAIL ${label}\n       expected: ${JSON.stringify(expected)}\n       actual:   ${JSON.stringify(actual)}`);
}

console.log("cleaner cases");
for (const [input, expected] of cases) {
  const res = cleanThinkingText(input, cfg);
  check(`${JSON.stringify(input).slice(0, 58)} -> ${JSON.stringify(expected).slice(0, 40)}`, res.text, expected);
}

console.log("\nconfig toggles");
check(
  "enabled:false leaves text untouched",
  cleanThinkingText("Hmm, hello.", { ...cfg, enabled: false }).text,
  "Hmm, hello.",
);
check("matchHm:false keeps bare hm", cleanThinkingText("Hm, hello hmm.", { ...cfg, matchHm: false }).text, "Hm, hello");
check("matchHm:true removes bare hm", cleanThinkingText("Hm, hello.", cfg).text, "Hello.");
check("capitalizeSentences:false", cleanThinkingText("Blah. Hmm, the next word.", { ...cfg, capitalizeSentences: false }).text, "Blah. the next word.");
check("cjkFillers:false keeps 嗯", cleanThinkingText("嗯，让我看看。", { ...cfg, cjkFillers: false }).text, "嗯，让我看看。");
check("emmFillers:false keeps emm", cleanThinkingText("Emm, no.", { ...cfg, emmFillers: false }).text, "Emm, no.");
check("preserveCode:false touches code", cleanThinkingText("```\nHmm, code\n```", { ...cfg, preserveCode: false }).text, "```\nCode\n```");
check(
  "extraTokens are honoured",
  cleanThinkingText("Mmm, tasty. Hmm, also.", { ...cfg, extraTokens: ["\\b[Mm]{3,}\\b"] }).text,
  "Tasty. Also.",
);
check("removed counter", cleanThinkingText("Hmm, a. Hmm, b.", cfg).removed, 2);
check(
  "byToken breakdown",
  JSON.stringify(cleanThinkingText("Hmm, a. 嗯，b.", cfg).byToken),
  JSON.stringify({ hmm: 1, 嗯: 1 }),
);

console.log("\nnormalizeConfig");
const normalized = normalizeConfig({ enabled: false, matchHm: "nope", extraTokens: ["x"], unknownKey: 1 });
check("explicit boolean wins", normalized.enabled, false);
check("wrong type ignored", normalized.matchHm, DEFAULT_CONFIG.matchHm);
check("string array accepted", JSON.stringify(normalized.extraTokens), JSON.stringify(["x"]));
check("unknown keys dropped", "unknownKey" in normalized, false);
check("garbage input falls back to defaults", normalizeConfig(null).contextScrub, true);

console.log("\nidempotency");
const noisy = "Hmm！让我看看。Hmm, then check `code hmm` here.\n\nhmm\n\nLet me see.";
const once = cleanThinkingText(noisy, cfg).text;
const twice = cleanThinkingText(once, cfg);
check("second pass is a no-op", twice.removed, 0);
check("second pass keeps text", twice.text, once);

console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — ${cases.length + 15} checks`);
if (failures > 0) process.exit(1);
