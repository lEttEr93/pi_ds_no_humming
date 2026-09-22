/**
 * pi-hmm-filter / cleaner.ts
 *
 * Pure text helpers that strip filler interjections ("Hmm", "hmm...", "嗯")
 * out of LLM thinking text.
 *
 * This module has no imports on purpose: it is used by the pi extension
 * (`index.ts`, loaded through jiti) and by the offline session scrubber
 * (`scrub-sessions.ts`, run with plain `node`).
 */

export interface FilterConfig {
  /** master switch */
  enabled: boolean;
  /** also strip a bare "hm" (not only "hmm"/"hmmm") */
  matchHm: boolean;
  /** also strip "emm"/"emmm" */
  emmFillers: boolean;
  /** also strip CJK fillers: 嗯 / 唔 / 呃 */
  cjkFillers: boolean;
  /** never touch fenced code blocks or inline code spans */
  preserveCode: boolean;
  /**
   * Rewrite thinking blocks even when they carry an unknown provider signature.
   * Only enable this for providers that do not verify thinking payloads.
   */
  cleanSignedThinking: boolean;
  /**
   * `thinkingSignature` values that are mere provider field-name markers
   * (they tell pi which request field the thinking came from: `reasoning_content`
   * for DeepSeek/NVIDIA NIM, `reasoning` for llama.cpp, ...) and are therefore
   * safe to rewrite. Any other non-empty signature is an opaque provider payload
   * (Anthropic / Bedrock / pi-messages) and is kept byte-identical.
   */
  safeSignatures: string[];
  /** capitalize the word right after a removed sentence-initial filler */
  capitalizeSentences: boolean;
  /** extra filler regex sources, e.g. "\\bmm+\\b" */
  extraTokens: string[];
  /** show a footer counter */
  showStatus: boolean;
  /**
   * Also scrub thinking of already-stored history right before each LLM call.
   * The first request after enabling this rewrites that payload once, which
   * invalidates the provider prefix cache once; afterwards the bytes are stable.
   * Set to false for a hard guarantee that the sent prefix never changes.
   */
  contextScrub: boolean;
}

export const DEFAULT_CONFIG: FilterConfig = {
  enabled: true,
  matchHm: true,
  emmFillers: true,
  cjkFillers: true,
  preserveCode: true,
  cleanSignedThinking: false,
  safeSignatures: [
    "reasoning_content",
    "reasoning",
    "reasoning_text",
    "reasoning_details",
    "thinking",
    "thinking_content",
    "analysis",
    "commentary",
    "final_answer",
    "summary",
  ],
  capitalizeSentences: true,
  extraTokens: [],
  showStatus: true,
  contextScrub: true,
};

/** May this thinking block be rewritten without breaking provider continuity? */
export function isRewritableThinking(
  block: { thinkingSignature?: string; redacted?: boolean } | null | undefined,
  cfg: FilterConfig,
): boolean {
  if (!block) return false;
  if (block.redacted) return false;
  if (cfg.cleanSignedThinking) return true;
  const signature = block.thinkingSignature;
  if (!signature) return true;
  return (cfg.safeSignatures ?? []).includes(signature);
}

export interface CleanResult {
  text: string;
  removed: number;
  byToken: Record<string, number>;
}

/**
 * Anything a filler may drag along: `Hmm,` `Hmm！` `Hmm，` `Hmm...` `Hmm。`
 * `Hmm——` `Hmm🤔` `Hmm》` ... i.e. every Unicode punctuation or symbol, plus
 * the invisible glue of emoji sequences (variation selectors, ZWJ, keycap).
 */
const SYMBOL = "[\\p{P}\\p{S}\\uFE0E\\uFE0F\\u200D\\u20E3]";

/** Spaces a model may put after a filler (incl. NBSP and the CJK ideographic space). */
const SPACE = "[ \\t\\u00a0\\u3000]";

/** Sentence terminators: a word right after them gets re-capitalized. */
const SENTENCE_END = "[.!?…。！？]";

/** A token may not sit inside a longer word / path / filename. */
const LATIN_GUARD = "(?![mM\\w/\\\\]|\\.\\w)";

export function buildTokenSource(cfg: FilterConfig): string {
  const parts: string[] = [
    cfg.matchHm ? `(?<![\\w])[hH][mM]+${LATIN_GUARD}` : `(?<![\\w])[hH][mM]{2,}${LATIN_GUARD}`,
  ];
  if (cfg.emmFillers) parts.push(`(?<![\\w])[eE][mM]+${LATIN_GUARD}`);
  if (cfg.cjkFillers) parts.push("嗯+", "唔+", "呃+");
  for (const extra of cfg.extraTokens ?? []) {
    const src = String(extra ?? "").trim();
    if (!src) continue;
    try {
      // eslint-disable-next-line no-new
      new RegExp(src);
      parts.push(`(?:${src})`);
    } catch {
      // ignore invalid user-supplied patterns instead of breaking the filter
    }
  }
  return parts.join("|");
}

function buildQuickSource(cfg: FilterConfig, token: string): string {
  // User-supplied patterns must be tested for real, they are not covered by the
  // cheap character-pair scan below.
  if ((cfg.extraTokens ?? []).some((extra) => String(extra ?? "").trim())) return `(?:${token})`;
  const parts = [cfg.matchHm ? "[hH][mM]" : "[hH][mM][mM]"];
  if (cfg.emmFillers) parts.push("[eE][mM]");
  if (cfg.cjkFillers) parts.push("嗯|唔|呃");
  return parts.join("|");
}

interface Patterns {
  quick: RegExp;
  paren: RegExp;
  lineOnly: RegExp;
  lineOnlyPlain: RegExp;
  lastLine: RegExp;
  cap: RegExp;
  plain: RegExp;
  tokenCount: RegExp;
}

function buildPatterns(cfg: FilterConfig): Patterns {
  const token = buildTokenSource(cfg);
  // A filler run may drag punctuation along: `Hmm, ` / `Hmm！` / `Hmm... `.
  // Both quantifiers stay bounded: unbounded ones backtrack badly on noise.
  const P = `(?:${SPACE}{0,2}${SYMBOL}){0,8}`;
  const S = `${SPACE}{0,8}`;
  /** one or more fillers in a row: `hmm, hmm hmmm` */
  const run = `(?:${token})(?:${P}${S}(?:${token}))*${P}${S}`;
  const runBare = `(?:${token})(?:${P}${S}(?:${token}))*`;
  /** never let a run stop early while another filler follows */
  const noMoreTokens = `(?!${SPACE}*(?:${token}))`;

  return {
    // Cheap pre-check with no lookarounds: already-clean text (the steady state,
    // i.e. almost every request) skips all the passes below.
    quick: new RegExp(buildQuickSource(cfg, token), "u"),
    // "(hmm)" / "（嗯）": pure-filler parenthesised asides disappear completely
    paren: new RegExp(`[(（]${SPACE}*${runBare}${SPACE}*[)）]${SPACE}*`, "gu"),
    // a line that contains nothing but filler + optional punctuation
    lineOnly: new RegExp(`^${SPACE}*${runBare}${noMoreTokens}${SPACE}*\\r?\\n([a-z])?`, "gmu"),
    // the same without re-capitalizing (used when capitalizeSentences is off)
    lineOnlyPlain: new RegExp(`^${SPACE}*${runBare}${noMoreTokens}${SPACE}*\\r?\\n?`, "gmu"),
    // the same, for the last line of a block (no trailing newline)
    lastLine: new RegExp(`^${SPACE}*${runBare}${SPACE}*$`, "gmu"),
    // sentence-initial filler: `Blah. Hmm, next` -> `Blah. Next`
    cap: new RegExp(
      `(^|\\n|${SENTENCE_END}${SPACE}*\\n?${SPACE}*|${SENTENCE_END}${SPACE}+)${run}${noMoreTokens}([a-z])`,
      "gmu",
    ),
    // everything else
    plain: new RegExp(run, "gu"),
    tokenCount: new RegExp(token, "gu"),
  };
}

// Compiling these regexes is not free and the config rarely changes, so the
// pattern set is memoized: the per-request context hook calls into this module
// once per thinking block, i.e. potentially hundreds of times per request.
let cached: { key: string; patterns: Patterns } | undefined;

function patternsFor(cfg: FilterConfig): Patterns {
  const key = `${cfg.matchHm}|${cfg.emmFillers}|${cfg.cjkFillers}|${cfg.capitalizeSentences}|${(cfg.extraTokens ?? []).join("\u0000")}`;
  if (!cached || cached.key !== key) cached = { key, patterns: buildPatterns(cfg) };
  return cached.patterns;
}

function countTokens(match: string, byToken: Record<string, number>, p: Patterns): number {
  const found = match.match(p.tokenCount);
  if (!found || found.length === 0) {
    const key = match.trim().toLowerCase();
    if (key) byToken[key] = (byToken[key] ?? 0) + 1;
    return 1;
  }
  for (const raw of found) {
    const key = raw.toLowerCase();
    byToken[key] = (byToken[key] ?? 0) + 1;
  }
  return found.length;
}

function tidy(text: string): string {
  return text
    .replace(/[ \t\u00a0\u3000]+(?=\r?\n)/g, "")
    .replace(/[ \t]+([,.;:!?，。、；：！？…])/g, "$1")
    // a CJK/NBSP space next to ASCII spaces collapses into the CJK one, so a
    // removed filler does not leave `a　 b` behind
    .replace(/[\u00a0\u3000][ \t]+/g, (m) => m[0])
    .replace(/[ \t]+[\u00a0\u3000]/g, (m) => m[m.length - 1])
    .replace(/(?:\r?\n){3,}/g, "\n\n");
}

function cleanChunkWith(p: Patterns, input: string, cfg: FilterConfig, trim: boolean): CleanResult {
  if (!input) return { text: input, removed: 0, byToken: {} };
  if (!p.quick.test(input)) return { text: input, removed: 0, byToken: {} };

  const byToken: Record<string, number> = {};
  let removed = 0;

  let out = input.replace(p.paren, (match) => {
    removed += countTokens(match, byToken, p);
    return "";
  });

  // whole filler-only lines: drop the line *and* its newline, then capitalize
  // the first letter of whatever line follows.
  if (cfg.capitalizeSentences) {
    for (let i = 0; i < 12; i += 1) {
      let changed = false;
      out = out.replace(p.lineOnly, (match, next: string | undefined) => {
        removed += countTokens(match, byToken, p);
        changed = true;
        return next ? next.toUpperCase() : "";
      });
      if (!changed) break;
    }
  } else {
    out = out.replace(p.lineOnlyPlain, (match) => {
      removed += countTokens(match, byToken, p);
      return "";
    });
  }

  out = out.replace(p.lastLine, (match) => {
    removed += countTokens(match, byToken, p);
    return "";
  });

  if (cfg.capitalizeSentences) {
    out = out.replace(p.cap, (match, lead: string, next: string) => {
      removed += countTokens(match, byToken, p);
      return lead + next.toUpperCase();
    });
  }

  out = out.replace(p.plain, (match) => {
    removed += countTokens(match, byToken, p);
    return "";
  });

  if (removed === 0) return { text: input, removed: 0, byToken: {} };
  const cleaned = tidy(out);
  return { text: trim ? cleaned.trim() : cleaned, removed, byToken };
}

/** Strip filler interjections from a single chunk of prose. */
export function cleanText(input: string, cfg: FilterConfig): CleanResult {
  if (!input || !cfg.enabled) return { text: input, removed: 0, byToken: {} };
  return cleanChunkWith(patternsFor(cfg), input, cfg, true);
}

/** Regex that keeps fenced code blocks and inline code spans out of the filter. */
const CODE_SPLIT = /(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]*`)/g;

/** Strip fillers while protecting code spans (when `preserveCode` is on). */
export function cleanThinkingText(input: string, cfg: FilterConfig): CleanResult {
  if (!input || !cfg.enabled) return { text: input, removed: 0, byToken: {} };

  const p = patternsFor(cfg);
  // Steady state: history was already cleaned when it was written (message_end)
  // or by a previous request. One cheap scan and we are done.
  if (!p.quick.test(input)) return { text: input, removed: 0, byToken: {} };
  if (!cfg.preserveCode || !input.includes("`")) {
    return cleanChunkWith(p, input, cfg, true);
  }

  const parts = input.split(CODE_SPLIT);
  const byToken: Record<string, number> = {};
  let removed = 0;

  for (let i = 0; i < parts.length; i += 1) {
    if (i % 2 === 1) continue; // captured code segment: keep untouched
    const res = cleanChunkWith(p, parts[i], cfg, false);
    parts[i] = res.text;
    removed += res.removed;
    for (const [k, v] of Object.entries(res.byToken)) {
      byToken[k] = (byToken[k] ?? 0) + v;
    }
  }

  if (removed === 0) return { text: input, removed: 0, byToken: {} };
  return { text: tidy(parts.join("")).trim(), removed, byToken };
}

/** Merge a (partial, possibly hand-edited) config file with the defaults. */
export function normalizeConfig(raw: unknown): FilterConfig {
  const cfg = { ...DEFAULT_CONFIG };
  if (!raw || typeof raw !== "object") return cfg;
  const src = raw as Record<string, unknown>;
  for (const key of Object.keys(DEFAULT_CONFIG) as (keyof FilterConfig)[]) {
    const value = src[key];
    if (value === undefined) continue;
    if (key === "extraTokens" || key === "safeSignatures") {
      if (Array.isArray(value)) cfg[key] = value.map((v) => String(v));
    } else if (typeof value === typeof DEFAULT_CONFIG[key]) {
      // @ts-expect-error key/value pairing is guaranteed by the typeof guard
      cfg[key] = value;
    }
  }
  return cfg;
}
