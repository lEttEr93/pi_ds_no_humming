#!/usr/bin/env node
/**
 * Offline scrubber for existing pi session files.
 *
 * The 你别哼唧了 (pi-no-hemming) extension only cleans thinking text from the
 * moment it is loaded: it rewrites finished messages and scrubs history on the
 * way to the model, but it never edits the `*.jsonl` files on disk. This script
 * does the one-time cleanup of old sessions (which is what usually broke the
 * camel's back after a long DeepSeek session full of "Hmm, ...").
 *
 * Usage (run it while pi is NOT running):
 *   node extensions/pi-no-hemming/scrub-sessions.ts               # dry run
 *   node extensions/pi-no-hemming/scrub-sessions.ts --apply       # rewrite files
 *   node extensions/pi-no-hemming/scrub-sessions.ts <file|dir> --apply
 *   node extensions/pi-no-hemming/scrub-sessions.ts --config ~/.pi/agent/hmm-filter.json --apply
 *
 * A sibling `<session>.jsonl.bak` is created before the first rewrite.
 */
import { copyFileSync, existsSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  DEFAULT_CONFIG,
  cleanThinkingText,
  isRewritableThinking,
  normalizeConfig,
  type FilterConfig,
} from "./cleaner.ts";

interface CliOptions {
  apply: boolean;
  verbose: boolean;
  help: boolean;
  configPath: string | undefined;
  targets: string[];
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { apply: false, verbose: false, help: false, configPath: undefined, targets: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--apply" || arg === "-a") opts.apply = true;
    else if (arg === "--verbose" || arg === "-v") opts.verbose = true;
    else if (arg === "--help" || arg === "-h") opts.help = true;
    else if (arg === "--config" || arg === "-c") opts.configPath = argv[++i];
    else if (arg.startsWith("-")) console.error(`unknown option: ${arg}`);
    else opts.targets.push(arg);
  }
  return opts;
}

function agentDir(): string {
  const envDir = process.env.PI_CODING_AGENT_DIR;
  if (envDir) return resolve(envDir.replace(/^~(?=$|[/\\])/, homedir()));
  return join(homedir(), ".pi", "agent");
}

function sessionsDir(): string {
  const envDir = process.env.PI_CODING_AGENT_SESSION_DIR;
  if (envDir) return resolve(envDir.replace(/^~(?=$|[/\\])/, homedir()));
  return join(agentDir(), "sessions");
}

function loadConfig(path: string): FilterConfig {
  try {
    return normalizeConfig(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return { ...DEFAULT_CONFIG, enabled: true };
  }
}

const USAGE = `你别哼唧了 — pi session scrubber

  node scrub-sessions.ts [options] [session.jsonl | session-dir ...]

Options:
  -a, --apply          rewrite files (default: dry run)
  -c, --config <path>  config file to use (default: ~/.pi/agent/hmm-filter.json)
  -v, --verbose        list every file, even unchanged ones
  -h, --help           show this help

Without positional arguments every session under ${sessionsDir()} is scanned.
Run it while pi is closed; a .bak copy is kept next to the first rewrite.`;

function* walkJsonl(dir: string): Generator<string> {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const full = join(dir, name);
    let stat: ReturnType<typeof statSync>;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) yield* walkJsonl(full);
    else if (name.endsWith(".jsonl")) yield full;
  }
}

interface FileResult {
  file: string;
  removed: number;
  messages: number;
  bytes: number;
  bytesAfter: number;
  written: boolean;
  skipped?: string;
}

function scrubFile(file: string, cfg: FilterConfig, apply: boolean): FileResult {
  const statBefore = statSync(file);
  const original = readFileSync(file, "utf8");
  const lines = original.split("\n");
  let removed = 0;
  let messages = 0;
  let changed = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      continue; // never touch lines we cannot parse
    }
    const record = entry as { type?: string; message?: { role?: string; content?: unknown } };
    if (record?.type !== "message") continue;
    const message = record.message;
    if (!message || message.role !== "assistant" || !Array.isArray(message.content)) continue;

    let messageRemoved = 0;
    const content = (message.content as Record<string, unknown>[]).map((block) => {
      if (!block || block.type !== "thinking" || typeof block.thinking !== "string") return block;
      if (!isRewritableThinking(block as { thinkingSignature?: string; redacted?: boolean }, cfg)) return block;
      const res = cleanThinkingText(block.thinking, cfg);
      if (res.removed === 0) return block;
      messageRemoved += res.removed;
      return { ...block, thinking: res.text };
    });
    if (messageRemoved === 0) continue;

    message.content = content;
    lines[i] = JSON.stringify(entry);
    removed += messageRemoved;
    messages += 1;
    changed = true;
  }

  const result: FileResult = {
    file,
    removed,
    messages,
    bytes: Buffer.byteLength(original),
    bytesAfter: 0,
    written: false,
  };

  if (changed && apply) {
    const next = lines.join("\n");
    result.bytesAfter = Buffer.byteLength(next);
    // Refuse to clobber a session that got appended to while we were scanning
    // (e.g. the session of a pi process that is still running).
    const statNow = statSync(file);
    if (statNow.size !== statBefore.size || statNow.mtimeMs !== statBefore.mtimeMs) {
      result.skipped = "changed while scanning";
      return result;
    }
    const backup = `${file}.bak`;
    if (!existsSync(backup)) copyFileSync(file, backup);
    // temp file + rename so a concurrent reader never sees a half-written file
    const tmp = `${file}.hmmtmp`;
    writeFileSync(tmp, next, "utf8");
    renameSync(tmp, file);
    result.written = true;
  } else if (changed) {
    result.bytesAfter = Buffer.byteLength(lines.join("\n"));
  } else {
    result.bytesAfter = result.bytes;
  }
  return result;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(USAGE);
    return;
  }

  const cfgPath = opts.configPath ?? join(agentDir(), "hmm-filter.json");
  const cfg = loadConfig(cfgPath);
  cfg.enabled = true; // the scrubber always runs with the filter on

  const targets = opts.targets.length > 0 ? opts.targets : [sessionsDir()];
  const files: string[] = [];
  for (const target of targets) {
    const full = resolve(target);
    let stat: ReturnType<typeof statSync> | undefined;
    try {
      stat = statSync(full);
    } catch {
      console.error(`skip (not found): ${full}`);
      continue;
    }
    if (stat.isDirectory()) files.push(...walkJsonl(full));
    else if (stat.isFile()) files.push(full);
  }

  if (files.length === 0) {
    console.log(`no .jsonl session files found in: ${targets.join(", ")}`);
    return;
  }

  console.log(`config : ${cfgPath}${existsSync(cfgPath) ? "" : " (defaults, file missing)"}`);
  console.log(`mode   : ${opts.apply ? "APPLY (files will be rewritten)" : "dry run (pass --apply to write)"}`);
  console.log("");

  let totalRemoved = 0;
  let totalMessages = 0;
  let totalBytesBefore = 0;
  let totalBytesAfter = 0;
  let changedFiles = 0;

  for (const file of files.sort()) {
    const res = scrubFile(file, cfg, opts.apply);
    if (res.removed === 0 && !opts.verbose) continue;
    totalRemoved += res.removed;
    totalMessages += res.messages;
    totalBytesBefore += res.bytes;
    totalBytesAfter += res.bytesAfter;
    if (res.removed > 0) changedFiles += 1;
    const arrow = res.skipped
      ? `→ skipped (${res.skipped})`
      : res.written
        ? "→ written"
        : res.removed > 0
          ? "→ pending"
          : "";
    console.log(
      `${res.removed.toString().padStart(6)} removed  ${res.messages.toString().padStart(4)} msg  ` +
        `${formatBytes(res.bytes).padStart(9)} → ${formatBytes(res.bytesAfter).padStart(9)}  ` +
        `${file}${arrow ? `  ${arrow}` : ""}`,
    );
  }

  console.log("");
  console.log(
    `scanned ${files.length} file(s), ${changedFiles} with fillers: ` +
      `${totalRemoved} filler(s) in ${totalMessages} message(s), ` +
      `${formatBytes(totalBytesBefore)} → ${formatBytes(totalBytesAfter)}`,
  );
  if (changedFiles > 0 && !opts.apply) {
    console.log("nothing was written (dry run). re-run with --apply to rewrite the files.");
  }
}

main();
