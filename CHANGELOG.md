# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与
[语义化版本](https://semver.org/lang/zh-CN/)。

## [1.0.0] - 2026-09-22

首个版本。

### Added

- `message_end` 钩子：assistant 消息落库前重写 thinking，会话文件 / TUI / 后续请求全程干净。
- `context` 钩子：每次请求前兜底清理历史 thinking（深拷贝，不改磁盘），幂等。
- `/hmm` 命令：`count`（默认，本轮对话去除统计）/ `status` / `on` / `off` / `test` / `reset` / `help`。
- 分轮统计：`agent_start` 归零，显示本轮处数、回复条数、省下字符数、词形分布（`hmm×12 嗯×3`）。
- 底栏状态 `hmm-filter 本轮−N`；`--no-hmm-filter` 启动参数。
- 清理规则：`hmm/Hmm/HMM/hm/hmmm`、`emm/emmm`、`嗯/唔/呃`；
  `hmm` 后接任意 Unicode 标点/符号（半角/全角/引号括号/破折号省略号/emoji 及变体选择符）
  与中间空格一并清除；整行纯语气词连行删除；纯语气括号插入语整体删除；
  句首填充删除后自动大写下一句首字母。
- 安全护栏：代码块与行内代码不动；`hmm.txt` / `a/hmm/b` / `aHmm` 不误伤；
  带不透明签名的 thinking（Anthropic / Bedrock / pi-messages）默认不改，只重写
  `safeSignatures` 里的字段名标记（`reasoning_content` 等）。
- 缓存友好：落库前清洗 + 幂等改写，前缀字节稳定；`/hmm status` 暴露
  「请求时改写」计数器用于验证；`contextScrub: false` 可硬保证前缀永不变。
- 性能：免开销预扫描 + 正则记忆化，已干净文本 0.2ms/360KB。
- `scrub-sessions.ts`：离线清理历史会话，dry-run 默认、`.bak` 备份、
  幂等、写入前校验未被追加、临时文件 + rename 原子替换。
- 测试：`test/cleaner.test.ts`（48 组清理用例）与 `test/extension.test.cjs`
  （20 项钩子/命令断言，jiti 加载真实扩展 + mock ExtensionAPI）。

## [1.1.0] - 2026-09-22

### Added

- `letMeLines`：删除独占一行的旁白句（`Let me run.` / `Let me do it.` / `Now, let me
  verify that.` / `I'll check that.` 等），并支持「保留内容、只掉旁白头」：
  `Let me be careful: <内容>` → `<内容>`、`Let me check the file. The config is wrong.`
  → `The config is wrong.`。链式旁白（`First, let me X. I'll Y.`）会反复迭代到稳定，
  保证幂等。
- `dedupeLines`：同一段思考里重复出现的短行只保留第一处（`Let me do it.` ×69 这类）。
- 安全护栏（都有对应回归用例）：冒号后紧跟盘符/URL 不动、第二句小写开头视为同一句、
  旁白后超过 52 字符视为有效信息、markdown 列表/加粗/代码块不动。
- 三道性能保障：清理结果按内容记忆化（历史未变时最坏会话从 46 ms 降到 2.4 ms）、
  带边界的 token 正则做门控（4.6 ms/MB）、旁白扫描门。

### Changed

- 门控正则从无边界 `[hH][mM]` 快筛改为带边界 token：更便宜的快筛在真实历史上
  2706 次命中里只有 5 次真需要清洗，反而把完整流水线白跑 2706 遍。
- 清理计数现在把旁白行、去重行也计入 `/hmm` 统计（`[hmm×12 let-me×8 dup-line×2]`）。
- 历史会话已用新规则重跑：额外清掉 13,032 处（共 79 个会话），幂等复跑 0 改动。
