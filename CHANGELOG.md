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
