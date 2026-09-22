/**
 * Cleaner test suite — zero dependencies, pure logic.
 *
 *   node test/cleaner.test.ts        (Node >= 22.19 strips the TS types)
 *   npm run test:cleaner
 */
import { DEFAULT_CONFIG, cleanThinkingText, normalizeConfig, type FilterConfig } from "../extensions/pi-no-hemming/cleaner.ts";

const cfg: FilterConfig = { ...DEFAULT_CONFIG };

// ---------------------------------------------------------------------------
// filler interjections (hmm family)
// ---------------------------------------------------------------------------
const fillerCases: [string, string][] = [
  ["Hmm, the user wants to clean the thinking. Hmm, the file is at X.", "The user wants to clean the thinking. The file is at X."],
  ["Wait — hmm, maybe the config is wrong.", "Wait — maybe the config is wrong."],
  ["Hmm, hmm, hmm. The file is huge.", "The file is huge."],
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
  ["Let me check.\nHmm\nhmm\nlowercase next line.", "Lowercase next line."],
  ["Emm, and emmm too.", "And too."],
  ["See https://example.com/a/hmm/b and hmm.txt but not aHmm.", "See https://example.com/a/hmm/b and hmm.txt but not aHmm."],
  ["Hmm,Hmm.But no space after the period.", "Hmm.But no space after the period."],
  ["Line one.\n\n\n\nHmm\n\n\n\nLine two.", "Line one.\n\nLine two."],
  ["Hmm, the `code hmm` inline and 嗯嗯 double CJK.", "The `code hmm` inline and double CJK."],
  // punctuation / symbol variants after the filler
  ["Hmm！让我看看这个文件。", "让我看看这个文件。"],
  ["Hmm，这个文件很大。", "这个文件很大。"],
  ["Hmm。", ""],
  ["Hmm... the file is huge.", "The file is huge."],
  ["Hmm‼️ the file is huge.", "The file is huge."],
  ["Hmm🤔 the file is huge.", "The file is huge."],
  ["Hmm——the file is huge.", "The file is huge."],
  ["Hmm》next section.", "Next section."],
  ["Hmm：the file path.", "The file path."],
  ["Blah. Hmm！next word needs capital.", "Blah. Next word needs capital."],
  ["HMM！all caps filler.", "All caps filler."],
  ["Hmm ??? !!! next.", "Next."],
  ["Double  space。 Hmm　 ideographic gap。", "Double  space。 Ideographic gap。"],
  ["1. Hmm, first\n2. hmm, second", "1. First\n2. Second"],
];

// ---------------------------------------------------------------------------
// "Let me run." narration lines (the reason this package exists)
// ---------------------------------------------------------------------------
const narrationCases: [string, string][] = [
  // the exact pattern from the issue report
  [
    "Let me do that.\n\n Let me run.\n\n Let me be careful: the game is currently vanilla (all restored). Good.\n\n Let me run.\n\n Let me first double-check hits has ebxSize for all 71 ✓ (used earlier).\n\n Let me run.",
    "The game is currently vanilla (all restored). Good.\n\n Let me first double-check hits has ebxSize for all 71 ✓ (used earlier).",
  ],
  ["Let me run.\n\nLet me run.\n\nLet me run.", ""],
  ["Let me do it.", ""],
  ["Now, let me verify that.", ""],
  ["OK, let me verify that.", ""],
  ["I'll check that.", ""],
  ["Let me check:\nthe next line stays.", "The next line stays."],
  ["Let me write:\n- first\n- second", "- first\n- second"],
  ["Let me think.", ""],
  ["Let me look at the code.\n\nHmm. Actually no.\n\nLet me try the other path.", "Actually no."],
  ["Let me check.\nHmm\nhmm\nlowercase next line.", "Lowercase next line."],
  // content after the narration is kept
  ["Let me check: the config is wrong.", "The config is wrong."],
  ["Let me check the file. The config is wrong.", "The config is wrong."],
  ["Let me think. The launcher is more reliable.", "The launcher is more reliable."],
  ["I'll go with the launcher. The user will be happy.", "The user will be happy."],
  // chained narration collapses completely (the pass iterates until stable)
  ["First, let me decompress it. I'll dump the section to understand the format.", ""],
  ["Let me think. I'll go with the launcher.", ""],
  ["Let me think. I\u2019ll go with the launcher.", ""],
  ["But I should mention: this stays.", "This stays."],
  // things that must NOT be touched
  ["Let me check the file. the config is wrong.", "Let me check the file. the config is wrong."],
  ["- Let me run.", "- Let me run."],
  ["**Let me run.**", "**Let me run.**"],
  ["So we should tell the user. Let me run the tests and see.", "So we should tell the user. Let me run the tests and see."],
  ["Let me first double-check hits has ebxSize for all 71 items in the table.", "Let me first double-check hits has ebxSize for all 71 items in the table."],
  ["Let me test write permissions on various D: paths.", "Let me test write permissions on various D: paths."],
  ["Let me open C: drive settings.", "Let me open C: drive settings."],
  ["Let me verify https://example.com works.", "Let me verify https://example.com works."],
  ["让我看看：内容在这里。", "让我看看：内容在这里。"],
  ["Let me run.\n```bash\nnpm test\n```\nLet me check.", "```bash\nnpm test\n```"],
];

// ---------------------------------------------------------------------------
// repeated short lines
// ---------------------------------------------------------------------------
const dedupeCases: [string, string][] = [
  ["Good.\n\nGood.\n\nGood.", "Good."],
  ["Done.\n\nDone.", "Done."],
  ["A much longer repeated sentence that is still short enough.\n\nA much longer repeated sentence that is still short enough.", "A much longer repeated sentence that is still short enough."],
  ["- repeated list item\n\n- repeated list item", "- repeated list item\n\n- repeated list item"],
  ["```\nrepeated code\n\nrepeated code\n```", "```\nrepeated code\n\nrepeated code\n```"],
];

const groups: [string, [string, string][]][] = [
  ["filler interjections", fillerCases],
  ["narration lines", narrationCases],
  ["repeated short lines", dedupeCases],
];

let failures = 0;
let checks = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  checks += 1;
  if (actual === expected) {
    console.log(`  ok   ${label}`);
    return;
  }
  failures += 1;
  console.log(`  FAIL ${label}\n       expected: ${JSON.stringify(expected)}\n       actual:   ${JSON.stringify(actual)}`);
}

for (const [title, cases] of groups) {
  console.log(`\n${title}`);
  for (const [input, expected] of cases) {
    const res = cleanThinkingText(input, cfg);
    check(`${JSON.stringify(input).slice(0, 56)} -> ${JSON.stringify(expected).slice(0, 34)}`, res.text, expected);
  }
}

console.log("\nconfig toggles");
check("enabled:false leaves text untouched", cleanThinkingText("Hmm, hello.", { ...cfg, enabled: false }).text, "Hmm, hello.");
check("matchHm:false keeps bare hm", cleanThinkingText("Hm, hello hmm.", { ...cfg, matchHm: false }).text, "Hm, hello");
check("matchHm:true removes bare hm", cleanThinkingText("Hm, hello.", cfg).text, "Hello.");
check("capitalizeSentences:false", cleanThinkingText("Blah. Hmm, the next word.", { ...cfg, capitalizeSentences: false }).text, "Blah. the next word.");
check("cjkFillers:false keeps 嗯", cleanThinkingText("嗯，让我看看。", { ...cfg, cjkFillers: false }).text, "嗯，让我看看。");
check("emmFillers:false keeps emm", cleanThinkingText("Emm, no.", { ...cfg, emmFillers: false }).text, "Emm, no.");
check("preserveCode:false touches code", cleanThinkingText("```\nHmm, code\n```", { ...cfg, preserveCode: false }).text, "```\nCode\n```");
check("letMeLines:false keeps narration", cleanThinkingText("Let me run.", { ...cfg, letMeLines: false }).text, "Let me run.");
check("dedupeLines:false keeps repeats", cleanThinkingText("Good.\n\nGood.", { ...cfg, dedupeLines: false }).text, "Good.\n\nGood.");
check(
  "extraTokens are honoured",
  cleanThinkingText("Mmm, tasty. Hmm, also.", { ...cfg, extraTokens: ["\\b[Mm]{3,}\\b"] }).text,
  "Tasty. Also.",
);
check("removed counter counts every rule", cleanThinkingText("Hmm, a.\n\nLet me run.\n\nGood.\n\nGood.", cfg).removed, 3);
check("byToken breakdown", JSON.stringify(cleanThinkingText("Hmm, a. 嗯，b.", cfg).byToken), JSON.stringify({ hmm: 1, 嗯: 1 }));
check(
  "byToken reports narration and dedupe",
  JSON.stringify(cleanThinkingText("Let me run.\n\nLet me check: x.\n\nGood.\n\nGood.", cfg).byToken),
  JSON.stringify({ "let-me": 1, "let-me-prefix": 1, "dup-line": 1 }),
);

console.log("\nnormalizeConfig");
const normalized = normalizeConfig({ enabled: false, matchHm: "nope", extraTokens: ["x"], unknownKey: 1 });
check("explicit boolean wins", normalized.enabled, false);
check("wrong type ignored", normalized.matchHm, DEFAULT_CONFIG.matchHm);
check("string array accepted", JSON.stringify(normalized.extraTokens), JSON.stringify(["x"]));
check("unknown keys dropped", "unknownKey" in normalized, false);
check("garbage input falls back to defaults", normalizeConfig(null).contextScrub, true);
check("new flags default to true", normalizeConfig({}).letMeLines && normalizeConfig({}).dedupeLines, true);

console.log("\nidempotency");
const noisy =
  "Hmm！让我看看。Let me run.\n\nLet me check: the config is wrong.\n\nGood.\n\nGood.\n\nLet me write:\n```js\nconst hmm = 1;\n```";
const once = cleanThinkingText(noisy, cfg).text;
const twice = cleanThinkingText(once, cfg);
check("second pass is a no-op", twice.removed, 0);
check("second pass keeps text", twice.text, once);
check("code survived the narration cleanup", once.includes("const hmm = 1;"), true);

console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — ${checks} checks`);
if (failures > 0) process.exit(1);
