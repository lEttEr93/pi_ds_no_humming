/**
 * 你别哼唧了 (pi-no-hemming)
 *
 * DeepSeek (and friends) love to open every thinking paragraph with "Hmm, ...".
 * Those fillers are re-serialized into `reasoning_content` on every later
 * request, so the model sees a wall of "Hmm" and happily produces even more of
 * them. This extension strips the filler out of thinking blocks:
 *
 *   - `message_end`  rewrites the thinking blocks of each finished assistant
 *                    message *before* it is stored in the session, so the
 *                    session file, the TUI and every later request stay clean.
 *   - `context`      scrubs thinking of already-stored history (resumed
 *                    sessions, other extensions' messages) right before each
 *                    LLM call, without touching the session file.
 *
 * Config:  ~/.pi/agent/hmm-filter.json (created on first toggle)
 * Command: /hmm [count|status|on|off|test <text>|reset|help]
 * Offline: node extensions/pi-no-hemming/scrub-sessions.ts --apply
 */
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  DEFAULT_CONFIG,
  cleanThinkingText,
  isRewritableThinking,
  normalizeConfig,
  type FilterConfig,
} from "./cleaner.ts";

interface ThinkingBlock {
  type: "thinking";
  thinking: string;
  thinkingSignature?: string;
  redacted?: boolean;
}

interface LooseMessage {
  role?: string;
  content?: unknown;
  [key: string]: unknown;
}

const STATUS_KEY = "hmm-filter";

function configPath(): string {
  return join(getAgentDir(), "hmm-filter.json");
}

function loadConfig(path: string): FilterConfig {
  try {
    return normalizeConfig(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function saveConfig(path: string, cfg: FilterConfig): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(cfg, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
}

interface RoundStats {
  removed: number;
  chars: number;
  messages: number;
  byToken: Record<string, number>;
}

function emptyRound(): RoundStats {
  return { removed: 0, chars: 0, messages: 0, byToken: {} };
}

export default function hmmFilter(pi: ExtensionAPI) {
  const path = configPath();
  let cfg = loadConfig(path);
  const stats = {
    /** everything message_end has cleaned during this session */
    live: 0,
    liveChars: 0,
    blocks: 0,
    /** request-time (context hook) rewrites of already-stored history */
    history: 0,
    requestRewrites: 0,
    requestRemoved: 0,
    /** current dialogue round: reset on every new user prompt */
    round: emptyRound(),
    /** previous round, kept so /hmm count still shows something after a new prompt */
    lastRound: emptyRound(),
  };

  pi.registerFlag("no-hmm-filter", {
    description: "Disable the hmm/filler filter for this run",
    type: "boolean",
    default: false,
  });

  const updateStatus = (ctx: ExtensionContext): void => {
    if (ctx.mode !== "tui" && ctx.mode !== "rpc") return;
    if (!cfg.showStatus || !cfg.enabled) {
      ctx.ui.setStatus(STATUS_KEY, undefined);
      return;
    }
    // footer shows the current round: it resets with every new user prompt
    ctx.ui.setStatus(STATUS_KEY, stats.round.removed > 0 ? `hmm-filter 本轮−${stats.round.removed}` : "hmm-filter");
  };

  /** Strip fillers from every thinking block of an assistant message. */
  function cleanMessage(
    message: LooseMessage,
  ): { message: LooseMessage; removed: number; chars: number; byToken: Record<string, number> } | undefined {
    if (!cfg.enabled) return undefined;
    if (message?.role !== "assistant" || !Array.isArray(message.content)) return undefined;

    let removed = 0;
    let chars = 0;
    const byToken: Record<string, number> = {};
    let changed = false;
    const content = (message.content as (ThinkingBlock | unknown)[]).map((block) => {
      const thinking = block as ThinkingBlock | null;
      if (!thinking || thinking.type !== "thinking" || typeof thinking.thinking !== "string") return block;
      if (!isRewritableThinking(thinking, cfg)) return block;

      const res = cleanThinkingText(thinking.thinking, cfg);
      if (res.removed === 0) return block;
      removed += res.removed;
      chars += thinking.thinking.length - res.text.length;
      for (const [k, v] of Object.entries(res.byToken)) byToken[k] = (byToken[k] ?? 0) + v;
      changed = true;
      return { ...thinking, thinking: res.text };
    });

    if (!changed) return undefined;
    return { message: { ...message, content }, removed, chars, byToken };
  }

  pi.on("agent_start", async (_event, ctx) => {
    // a new user prompt starts a new round; keep the finished one around
    stats.lastRound = stats.round;
    stats.round = emptyRound();
    updateStatus(ctx);
  });

  pi.on("message_end", async (event, ctx) => {
    const result = cleanMessage(event.message as LooseMessage);
    if (!result) return;
    stats.live += result.removed;
    stats.liveChars += result.chars;
    stats.blocks += 1;
    stats.round.removed += result.removed;
    stats.round.chars += result.chars;
    stats.round.messages += 1;
    for (const [k, v] of Object.entries(result.byToken)) stats.round.byToken[k] = (stats.round.byToken[k] ?? 0) + v;
    updateStatus(ctx);
    return { message: result.message };
  });

  // Safety net: history written before this extension existed (or by another
  // extension) still gets scrubbed before it reaches the provider. The message
  // array handed to `context` is already a deep copy, so mutating is safe.
  //
  // Cache note: this runs before *every* provider request, but the rewrite is
  // idempotent, so the payload bytes are identical across requests. Only the
  // first request that changes something can cost one prefix-cache miss.
  let warnedAboutCache = false;
  pi.on("context", async (event, ctx) => {
    if (!cfg.enabled || !cfg.contextScrub) return;
    let removed = 0;
    for (const message of event.messages as LooseMessage[]) {
      if (message?.role !== "assistant" || !Array.isArray(message.content)) continue;
      const content = message.content as (ThinkingBlock | unknown)[];
      for (let i = 0; i < content.length; i += 1) {
        const block = content[i] as ThinkingBlock | null;
        if (!block || block.type !== "thinking" || typeof block.thinking !== "string") continue;
        if (!isRewritableThinking(block, cfg)) continue;
        const res = cleanThinkingText(block.thinking, cfg);
        if (res.removed === 0) continue;
        content[i] = { ...block, thinking: res.text };
        removed += res.removed;
      }
    }
    if (removed > 0) {
      stats.history += removed;
      stats.requestRewrites += 1;
      stats.requestRemoved += removed;
      updateStatus(ctx);
      if (!warnedAboutCache) {
        warnedAboutCache = true;
        ctx.ui.notify(
          `hmm-filter: 重写了历史 thinking（${removed} 处语气词）。prompt 前缀缓存会失效一次，之后保持稳定；` +
            `不想改动历史就把 contextScrub 设为 false。`,
          "warning",
        );
      }
    }
  });

  pi.on("session_start", async (_event, ctx) => {
    if (pi.getFlag("no-hmm-filter") === true) {
      cfg.enabled = false;
      ctx.ui.notify("hmm-filter: disabled by --no-hmm-filter", "warning");
    }
    updateStatus(ctx);
  });

  const formatRound = (label: string, r: RoundStats): string => {
    const tokens = Object.entries(r.byToken)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k}×${v}`)
      .join(" ");
    return (
      `${label}: ${r.removed} 处` +
      (r.messages > 0 ? `（${r.messages} 条回复，省下 ${r.chars} 字符）` : "") +
      (tokens ? `  [${tokens}]` : "")
    );
  };

  const statusLines = (): string => {
    const total = stats.live + stats.history;
    return [
      formatRound("本轮对话", stats.round),
      `本次会话: ${stats.live} 处（${stats.liveChars} 字符 / ${stats.blocks} 条回复）`,
      `历史兜底: ${stats.history} 处；请求时改写 ${stats.requestRewrites} 次 / ${stats.requestRemoved} 处（0 次 = 前缀缓存稳定）`,
      `enabled: ${cfg.enabled}`,
      `config:  ${path}`,
      `matchHm=${cfg.matchHm} emm=${cfg.emmFillers} cjk=${cfg.cjkFillers} code=${cfg.preserveCode}`,
      `contextScrub=${cfg.contextScrub} signed=${cfg.cleanSignedThinking}`,
      `safeSigs=${cfg.safeSignatures.join(",")}`,
      `capitalize=${cfg.capitalizeSentences} status=${cfg.showStatus}`,
      `extra: ${cfg.extraTokens.join(" ") || "-"}`,
      `合计: ${total} 处`,
    ].join("\n");
  };

  pi.registerCommand("hmm", {
    description: "hmm-filter: 你别哼唧了 — 清理思考里的语气词 (count|on|off|status|test <text>|reset)",
    getArgumentCompletions: (prefix: string) => {
      const items = ["count", "on", "off", "status", "test", "reset", "help"]
        .filter((v) => v.startsWith(prefix))
        .map((v) => ({ value: v, label: v }));
      return items.length > 0 ? items : null;
    },
    handler: async (args, ctx) => {
      const trimmed = (args ?? "").trim();
      const [rawSub = "", ...rest] = trimmed ? trimmed.split(/\s+/) : [];
      const sub = (rawSub || "count").toLowerCase();

      switch (sub) {
        case "count":
        case "turn":
        case "round": {
          const lines = [formatRound("本轮对话", stats.round)];
          if (stats.lastRound.removed > 0) lines.push(formatRound("上一轮", stats.lastRound));
          lines.push(
            `本次会话: ${stats.live} 处（${stats.liveChars} 字符 / ${stats.blocks} 条回复）` +
              (stats.history > 0 ? `，另兜底清理历史 ${stats.history} 处` : ""),
          );
          ctx.ui.notify(lines.join("\n"), "info");
          return;
        }
        case "on":
        case "off": {
          cfg.enabled = sub === "on";
          saveConfig(path, cfg);
          updateStatus(ctx);
          ctx.ui.notify(`hmm-filter: ${cfg.enabled ? "enabled" : "disabled"}`, cfg.enabled ? "info" : "warning");
          return;
        }
        case "reset": {
          stats.live = 0;
          stats.liveChars = 0;
          stats.history = 0;
          stats.blocks = 0;
          stats.requestRewrites = 0;
          stats.requestRemoved = 0;
          stats.round = emptyRound();
          stats.lastRound = emptyRound();
          updateStatus(ctx);
          ctx.ui.notify("hmm-filter: counters reset", "info");
          return;
        }
        case "test": {
          const sample = rest.join(" ");
          if (!sample) {
            ctx.ui.notify("usage: /hmm test <text with Hmm fillers>", "warning");
            return;
          }
          const res = cleanThinkingText(sample, { ...cfg, enabled: true });
          const lines = [
            `removed ${res.removed} filler(s)  ${JSON.stringify(res.byToken)}`,
            `in : ${sample.replace(/\n/g, "\\n").slice(0, 400)}`,
            `out: ${res.text.replace(/\n/g, "\\n").slice(0, 400)}`,
          ];
          ctx.ui.notify(lines.join("\n"), "info");
          return;
        }
        case "help": {
          ctx.ui.notify(
            [
              "/hmm            本轮 + 本次会话的去除统计",
              "/hmm count      同上（别名 turn / round）",
              "/hmm status     完整状态（配置、缓存计数器等）",
              "/hmm on|off     开关过滤（持久化）",
              "/hmm test <txt> 预览会删掉什么",
              "/hmm reset      清零计数器",
              `config file: ${path}`,
            ].join("\n"),
            "info",
          );
          return;
        }
        default: {
          ctx.ui.notify(statusLines(), "info");
        }
      }
    },
  });
}
