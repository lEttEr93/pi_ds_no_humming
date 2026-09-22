/**
 * Integration test for 你别哼唧了 (pi-no-hemming).
 *
 * Loads the *real* `extensions/pi-no-hemming/index.ts` through jiti (the same
 * loader pi uses), drives it with a mocked ExtensionAPI and mocked UI, and
 * exercises message_end / context / session_start / agent_start + /hmm and the
 * offline scrubber.
 *
 *   npm run test:extension      (needs @earendil-works/pi-coding-agent installed)
 *
 * Everything runs against a throwaway PI_CODING_AGENT_DIR, so your real
 * ~/.pi/agent config and sessions are never touched.
 */
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { execFileSync } = require("node:child_process");

// ---------------------------------------------------------------------------
// hermetic environment: keep getAgentDir() inside a temp dir
// ---------------------------------------------------------------------------
const AGENT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "pi-no-hemming-agent-"));
process.env.PI_CODING_AGENT_DIR = AGENT_DIR;
const CONFIG_FILE = path.join(AGENT_DIR, "hmm-filter.json");

let failures = 0;
function assert(cond, label) {
  if (cond) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${label}`);
  }
}

/** Locate the installed pi-coding-agent package (same one pi loads). */
function findPiRoot() {
  const fromResolved = (resolved) => {
    const marker = path.join("@earendil-works", "pi-coding-agent");
    const idx = resolved.lastIndexOf(marker);
    return idx >= 0 ? resolved.slice(0, idx + marker.length) : undefined;
  };
  const candidates = [
    process.env.PI_NO_HEMMING_PI_ROOT,
    (() => {
      try {
        return fromResolved(require.resolve("@earendil-works/pi-coding-agent"));
      } catch {
        return undefined;
      }
    })(),
    (() => {
      try {
        const globalRoot = execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", ["root", "-g"], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        }).trim();
        return path.join(globalRoot, "@earendil-works/pi-coding-agent");
      } catch {
        return undefined;
      }
    })(),
    process.platform === "win32"
      ? path.join(os.homedir(), "AppData/Roaming/npm/node_modules/@earendil-works/pi-coding-agent")
      : undefined,
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, "dist/index.js"))) return candidate;
  }
  throw new Error("cannot find @earendil-works/pi-coding-agent (npm install, or set PI_NO_HEMMING_PI_ROOT)");
}

function loadJiti(piRoot) {
  const candidates = [
    () => require.resolve("jiti"),
    () => require.resolve("jiti", { paths: [piRoot] }),
    () => path.join(piRoot, "node_modules/jiti/lib/jiti.cjs"),
  ];
  for (const candidate of candidates) {
    try {
      return require(candidate()).createJiti;
    } catch {
      /* try next */
    }
  }
  throw new Error("cannot find jiti (npm install)");
}

const PI_ROOT = findPiRoot();
const createJiti = loadJiti(PI_ROOT);
const EXT = path.join(__dirname, "..", "extensions", "pi-no-hemming", "index.ts");
const SCRUBBER = path.join(__dirname, "..", "extensions", "pi-no-hemming", "scrub-sessions.ts");

function newJiti() {
  return createJiti(__filename, {
    alias: { "@earendil-works/pi-coding-agent": path.join(PI_ROOT, "dist/index.js") },
    interopDefault: true,
  });
}

/** Minimal ExtensionAPI mock that records handlers/commands/flags. */
function mockPi() {
  const handlers = new Map();
  const commands = new Map();
  const flags = new Map();
  return {
    handlers,
    commands,
    flags,
    api: {
      on: (event, handler) => {
        if (!handlers.has(event)) handlers.set(event, []);
        handlers.get(event).push(handler);
      },
      registerCommand: (name, options) => commands.set(name, options),
      registerFlag: (name, options) => flags.set(name, options),
      getFlag: (name) => flags.get(name)?.default,
    },
  };
}

function mockCtx(sink) {
  const statuses = new Map();
  return {
    statuses,
    ctx: {
      hasUI: true,
      mode: "tui",
      cwd: process.cwd(),
      ui: {
        notify: (message, type) => sink.push({ message, type }),
        setStatus: (key, value) => statuses.set(key, value),
      },
      sessionManager: { getEntries: () => [] },
    },
  };
}

(async () => {
  console.log(`pi root : ${PI_ROOT}`);
  console.log(`agent   : ${AGENT_DIR}`);

  const { handlers, commands, flags, api } = mockPi();
  const factory = await newJiti().import(EXT, { default: true });
  factory(api);

  const notifications = [];
  const { ctx, statuses } = mockCtx(notifications);
  const emit = async (event, payload) => {
    let result;
    for (const handler of handlers.get(event) ?? []) {
      const out = await handler(payload, ctx);
      if (out !== undefined) result = out;
    }
    return result;
  };

  console.log("\n[0] registration");
  assert([...handlers.keys()].join(",") === "agent_start,message_end,context,session_start", `events: ${[...handlers.keys()].join(",")}`);
  assert(commands.has("hmm"), "command /hmm registered");
  assert(flags.has("no-hmm-filter"), "flag --no-hmm-filter registered");

  console.log("\n[1] session_start");
  await emit("session_start", { type: "session_start" });
  assert(statuses.get("hmm-filter") === "hmm-filter", `status set (${statuses.get("hmm-filter")})`);

  console.log("\n[2] message_end cleans deepseek-style reasoning_content blocks");
  const message = {
    role: "assistant",
    content: [
      {
        type: "thinking",
        thinking: "Hmm, let me check the file. Hmm, the config is wrong.",
        thinkingSignature: "reasoning_content",
      },
      { type: "text", text: "Done. Hmm." },
      { type: "thinking", thinking: "Hmm, anthropic payload", thinkingSignature: "EqQBCgIYAhIM1gbcDa9GJwZA2b3hGRIhALP" },
      { type: "thinking", thinking: "Hmm, redacted", redacted: true },
    ],
    provider: "deepseek",
    model: "deepseek-v4-flash",
    usage: {},
    stopReason: "stop",
    timestamp: 0,
  };
  const res = await emit("message_end", { type: "message_end", message });
  const out = res?.message ?? message;
  assert(out.content[0].thinking === "The config is wrong.", `cleaned (narration dropped, content kept) -> ${JSON.stringify(out.content[0].thinking)}`);
  assert(out.content[0].thinkingSignature === "reasoning_content", "safe signature marker kept");
  assert(out.content[1].text === "Done. Hmm.", "text blocks untouched");
  assert(out.content[2].thinking === "Hmm, anthropic payload", "opaque signed thinking untouched");
  assert(out.content[3].thinking === "Hmm, redacted", "redacted thinking untouched");
  assert(statuses.get("hmm-filter") === "hmm-filter 本轮−3", `footer counter -> ${statuses.get("hmm-filter")}`);
  assert(message.content[0].thinking.startsWith("Hmm,"), "handler did not mutate the input message");

  console.log("\n[3] context scrubs stored history in place (deep copy)");
  const legacy = {
    messages: [
      { role: "user", content: "hi" },
      { role: "assistant", content: [{ type: "thinking", thinking: "Hmm, old session noise.", thinkingSignature: "reasoning_content" }] },
    ],
  };
  await emit("context", legacy);
  assert(legacy.messages[1].content[0].thinking === "Old session noise.", `history cleaned -> ${JSON.stringify(legacy.messages[1].content[0].thinking)}`);
  assert(notifications.some((n) => n.message.includes("前缀缓存")), "one-time cache warning emitted");

  const before = notifications.length;
  await emit("context", { messages: [{ role: "assistant", content: [{ type: "thinking", thinking: "Old session noise." }] }] });
  assert(notifications.length === before, "next request rewrites nothing (prefix stays stable)");

  const statusNotes = [];
  const { ctx: statusCtx } = mockCtx(statusNotes);
  await commands.get("hmm").handler("status", statusCtx);
  assert(statusNotes.some((n) => n.message.includes("请求时改写 1 次")), "status reports the request-time rewrite counter");

  console.log("\n[3b] /hmm count — per-round accounting");
  const roundNotes = [];
  const { ctx: roundCtx } = mockCtx(roundNotes);
  await commands.get("hmm").handler("count", roundCtx);
  assert(roundNotes.some((n) => n.message.includes("本轮对话: 3 处")), `round count -> ${roundNotes.at(-1)?.message.split("\n")[0]}`);
  await emit("agent_start", { type: "agent_start" });
  await commands.get("hmm").handler("", roundCtx);
  assert(roundNotes.at(-1).message.includes("本轮对话: 0 处"), `new round resets -> ${roundNotes.at(-1).message.split("\n")[0]}`);
  assert(roundNotes.at(-1).message.includes("上一轮: 3 处"), "previous round still reported");
  await emit("message_end", {
    type: "message_end",
    message: { ...message, content: [{ type: "thinking", thinking: "Hmm, three.", thinkingSignature: "reasoning_content" }] },
  });
  await commands.get("hmm").handler("count", roundCtx);
  assert(roundNotes.at(-1).message.includes("本轮对话: 1 处"), `round accumulates -> ${roundNotes.at(-1).message.split("\n")[0]}`);

  console.log("\n[4] /hmm test + on/off");
  await commands.get("hmm").handler("test Hmm！让我看看。hmm, world.", ctx);
  assert(notifications.some((n) => n.message.includes("out: 让我看看。World.")), "preview shows the cleaned text");
  await commands.get("hmm").handler("off", ctx);
  assert(JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")).enabled === false, "off persisted to config file");
  const disabled = await emit("message_end", {
    type: "message_end",
    message: { ...message, content: [{ type: "thinking", thinking: "Hmm, ignored." }] },
  });
  assert(disabled === undefined, "disabled filter leaves messages alone");
  await commands.get("hmm").handler("on", ctx);
  await commands.get("hmm").handler("reset", ctx);
  assert(JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")).enabled === true, "on persisted to config file");

  console.log("\n[5] /reload simulation (fresh module graph + edited config)");
  const originalConfig = fs.readFileSync(CONFIG_FILE, "utf8");
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ ...JSON.parse(originalConfig), matchHm: false }, null, 2));
  try {
    const reloaded = mockPi();
    const reloadedFactory = await newJiti().import(EXT, { default: true });
    reloadedFactory(reloaded.api);
    const target = { ...message, content: [{ type: "thinking", thinking: "Hm, keep this. Hmm, drop this." }] };
    let reloadedOut;
    for (const handler of reloaded.handlers.get("message_end") ?? []) {
      const r = await handler({ type: "message_end", message: target }, ctx);
      if (r?.message) reloadedOut = r.message;
    }
    assert(
      (reloadedOut ?? target).content[0].thinking === "Hm, keep this. Drop this.",
      `reloaded config honoured -> ${JSON.stringify((reloadedOut ?? target).content[0].thinking)}`,
    );
  } finally {
    fs.writeFileSync(CONFIG_FILE, originalConfig);
  }

  console.log("\n[6] offline scrubber on a synthetic session file");
  const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-no-hemming-session-"));
  const sessionFile = path.join(sessionDir, "session.jsonl");
  const sessionLines = [
    { type: "session", version: 3, id: "s1", timestamp: "2026-01-01T00:00:00.000Z", cwd: process.cwd() },
    {
      type: "message",
      id: "m1",
      parentId: null,
      timestamp: "2026-01-01T00:00:01.000Z",
      message: { role: "user", content: "hi" },
    },
    {
      type: "message",
      id: "m2",
      parentId: "m1",
      timestamp: "2026-01-01T00:00:02.000Z",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "Hmm！让我看看。Hmm, check the file.", thinkingSignature: "reasoning_content" },
          { type: "text", text: "Hmm, keep the answer text." },
          { type: "thinking", thinking: "Hmm, opaque", thinkingSignature: "c2lnbmF0dXJlLWJsb2I=" },
        ],
        stopReason: "stop",
      },
    },
  ];
  fs.writeFileSync(sessionFile, `${sessionLines.map((l) => JSON.stringify(l)).join("\n")}\n`);

  const scrubRun = (args) =>
    execFileSync(process.execPath, [SCRUBBER, "--config", CONFIG_FILE, ...args], { encoding: "utf8" });
  const dry = scrubRun([sessionFile]);
  assert(/scanned 1 file\(s\), 1 with fillers/.test(dry), `dry run reports fillers -> ${dry.trim().split("\n").at(-2)?.trim()}`);
  assert(!fs.existsSync(`${sessionFile}.bak`), "dry run writes nothing");

  scrubRun([sessionFile, "--apply"]);
  const scrubbed = fs.readFileSync(sessionFile, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
  assert(fs.existsSync(`${sessionFile}.bak`), "backup created");
  assert(scrubbed[2].message.content[0].thinking === "让我看看。Check the file.", `scrubbed -> ${JSON.stringify(scrubbed[2].message.content[0].thinking)}`);
  assert(scrubbed[2].message.content[1].text === "Hmm, keep the answer text.", "non-thinking blocks untouched");
  assert(scrubbed[2].message.content[2].thinking === "Hmm, opaque", "opaque signature untouched");
  assert(scrubbed[2].id === "m2" && scrubbed[2].parentId === "m1", "ids/parentIds preserved");
  assert(JSON.stringify(Object.keys(scrubbed[1])) === JSON.stringify(Object.keys(sessionLines[1])), "entry shape preserved");
  assert(/scanned 1 file\(s\), 0 with fillers/.test(scrubRun([sessionFile])), "second run is a no-op (idempotent)");

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`}`);
  fs.rmSync(AGENT_DIR, { recursive: true, force: true });
  fs.rmSync(sessionDir, { recursive: true, force: true });
  if (failures > 0) process.exit(1);
})().catch((err) => {
  console.error("harness error:", err);
  fs.rmSync(AGENT_DIR, { recursive: true, force: true });
  process.exit(1);
});
