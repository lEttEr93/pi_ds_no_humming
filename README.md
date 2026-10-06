# 你别哼唧了

> `pi-no-hemming` — 把 pi 思考过程里的 "Hmm" 语气词清干净。

![pi-package](https://img.shields.io/badge/pi-package-blue)
![license](https://img.shields.io/badge/license-MIT-green)
![node](https://img.shields.io/badge/node-%3E%3D22.19-brightgreen)

```
Hmm, the user wants X. Hmm, the file is at Y. Hmm, let me check.
        ↓
The user wants X. The file is at Y. Let me check.
```

## 为什么

DeepSeek 喜欢每段思考开头来个 "Hmm, ..."。而 pi 在 OpenAI 兼容接口上会把历史
thinking 原样塞回下一次请求（`reasoning_content` 字段）：

```js
// pi-ai/dist/api/openai-completions.js
if (signature && signature.length > 0) assistantMsg[signature] = nonEmptyThinkingBlocks.map(b => b.thinking).join("\n");
```

于是模型看到的上下文里全是 "Hmm"，它就生成更多 "Hmm"——**越滚越多**，注意力被稀释。本扩展负责把它们清干净。


## 安装

```bash
# GitHub（推荐，可锁 tag）
# npm 包名 pi-no-hemming（GitHub 仓库名可以用中文）
pi install git:github.com/<你的用户名>/pi-no-hemming@v1.1.0

# 本地目录
pi install /absolute/path/to/pi-no-hemming

# 临时试用，不写入设置
pi -e git:github.com/<你的用户名>/pi-no-hemming
```

> 如果你之前把文件手动拷进过 `~/.pi/agent/extensions/`，**请删掉那份拷贝**，
> 否则会出现两个 `/hmm`（`/hmm:1`、`/hmm:2`）和两份状态栏。
>
> 装好后 `/reload` 即可生效（不用重启 pi）。

## 用法

| 命令 | 说明 |
|------|------|
| `/hmm` 或 `/hmm count` | 显示**本轮对话**去除多少（别名 `turn` / `round`），附带上一轮、本次会话合计 |
| `/hmm status` | 完整状态（配置、缓存计数器、各栏明细） |
| `/hmm on` / `/hmm off` | 开关过滤（写入配置文件，持久生效） |
| `/hmm test Hmm, hello. hmm, world.` | 预览会删掉什么 |
| `/hmm reset` | 重置计数 |
| `/hmm help` | 帮助 |

启动参数：`pi --no-hmm-filter` 本次运行关闭过滤。

统计口径：

* **本轮对话**：从你发出这条消息（`agent_start`）到 agent 停下之间真正删掉的数量，
  含回复条数、省下的字符数、按词形分布（如 `hmm×12 嗯×3`）；每发一条新消息自动归零，
  上轮数据变成「上一轮」；
* **本次会话**：本进程内累计；**历史兜底**与**请求时改写**单独统计（那是旧文本，不算本轮产出）；
* 底栏实时显示 `hmm-filter 本轮−N`。

```
/hmm
本轮对话: 37 处（12 条回复，省下 412 字符）  [hmm×30 嗯×7]
上一轮: 12 处（4 条回复，省下 96 字符）  [hmm×12]
本次会话: 128 处（1450 字符 / 41 条回复），另兜底清理历史 12 处
```

## 配置

`~/.pi/agent/hmm-filter.json`（首次 `/hmm off` 时自动生成；改完 `/reload` 生效）：

```json
{
  "enabled": true,
  "matchHm": true,             // 也删单独的 "hm"
  "emmFillers": true,          // 也删 "emm"/"emmm"
  "cjkFillers": true,          // 也删 "嗯"/"唔"/"呃"
  "preserveCode": true,        // 代码块 / 行内代码原样保留
  "cleanSignedThinking": false,// 见下方“签名安全”
  "safeSignatures": ["reasoning_content", "reasoning", "reasoning_text"],
  "capitalizeSentences": true, // 句首填充删掉后把首字母大写
  "letMeLines": true,          // 删掉独占一行的旁白句：`Let me run.`
  "dedupeLines": true,         // 折叠重复的短行（如 `Let me do it.` ×69）
  "extraTokens": [],           // 追加正则，例如 ["\\bmm+\\b"]
  "showStatus": true,          // 底栏显示 "hmm-filter 本轮−N"
  "contextScrub": true         // 每次拼上下文时都扫一遍历史（见下文“缓存”）
}
```

## 清理规则

### 1. 语气词（hmm 家族）

* `hmm` 后面**任何** Unicode 标点/符号都会一起吃掉（不是固定列表）：
  半角 `, . ! ? : ; ...`、全角 `，。！？：；、`、各种引号括号
  `“”‘’「」『』《》〈〉（）【】`、破折号省略号 `—— … ~`、emoji 及其组合符
  `🤔‼️✨`（含变体选择符 U+FE0F、ZWJ）等；
* 中间的空格也一起清：`Hmm ， next`、`Hmm　next`（全角空格）都能处理；
* 成串的语气词按一组处理：`Hmm！Hmm，hmmm.` → 整段删除；
* 整行只有语气词时连同该行一起删，并保留/恢复段落的换行；
* `(hmm)` / `（嗯）` 这类纯语气插入语整体删除；
* 句首填充删掉后把下一句首字母大写（`Blah. Hmm！next` → `Blah. Next`）；
* 大小写变体都算：`hmm / Hmm / HMM / hmmm`；
* 绝不误伤：`hmm.txt`、`a/hmm/b`、`aHmm`、`` `hmm` ``（代码）都原样保留。

### 2. 独占一行的旁白句（`letMeLines`）

推理模型很喜欢自问自答式旁白，还爱反复写同一句：

```
Let me do that.

Let me run.

Let me run.

Let me run.
```

这类整行只有旁白的句子会被整行删掉（首尾空白、`Now,`/`OK,`/`So` 等开头也算）：
`Let me run.` `Let me do it.` `Now, let me verify that.` `I'll check that.` `Let me write:`

**带内容的会保留内容，只掉旁白头：**

| 输入 | 输出 |
|------|------|
| `Let me be careful: the game is vanilla. Good.` | `The game is vanilla. Good.` |
| `Let me check the file. The config is wrong.` | `The config is wrong.` |
| `Let me check:` + 下一行 | 下一行（并自动首字母大写） |
| `First, let me decompress it. I'll dump the section to analyze it.` | *(整行都是旁白 → 删掉)* |

**明确不碰的：**

| 输入 | 原因 |
|------|------|
| `Let me first double-check hits has ebxSize for all 71 items in the table.` | 旁白后超过 52 字符，属于有效信息 |
| `Let me test write permissions on various D: paths.` | 冒号后面紧跟着盘符路径 |
| `Let me verify https://example.com works.` | URL |
| `Let me check the file. the config is wrong.` | 第二个句子小写开头 → 判断为同一句，整行保留 |
| `- Let me run.` / `**Let me run.**` | 列表项、加粗等 markdown 结构 |
| 代码块里的任何内容 | `preserveCode` 保护 |

### 3. 重复短行（`dedupeLines`）

同一段思考里重复出现的短句只留第一处（`Let me do it.` ×69、`Good.` ×3 这类）。
只对 4~80 字符、含字母/汉字、不含反引号、不是 `-` `#` `1.` `>` `|` 开头的行生效。

## 运行时机

共两个钩子，都在 pi 调用 LLM 的关键路径上：

| 钩子 | 触发点 | 频率 | 作用 |
|------|--------|------|------|
| `message_end` | assistant 消息定稿、**写入 session 之前** | 每条回复 1 次 | 重写 thinking → 会话文件/TUI/后续请求都是干净的 |
| `context` | `transformContext` → `runner.emitContext()`，位于 `streamAssistantResponse()` 里、构建 payload 之前 | **每次 LLM 请求 1 次** | 兜底：扫历史（含恢复的旧会话、其它扩展注入的消息） |

也就是「每次拼接上下文时都运行」是成立的：一次回复里如果有 5 轮工具调用，
就是 6 次请求 → `context` 钩子跑 6 次。它只改发给 provider 的那份深拷贝。

## 与 prompt 缓存的关系

DeepSeek / Anthropic 等是**前缀缓存**：请求前缀逐 token 匹配。

1. **首发出场就是干净的**。`message_end` 在消息落库前就重写好了，于是这条消息
   第一次被发出去时已经是清洗后的版本——不存在"先按原文建缓存、后面再改"的失效；
2. **`context` 是幂等的**。同一段历史每次算出完全相同的字节，第二次开始就是纯命中；
3. **缓存判定可观测**。`/hmm status` 会显示「请求时改写 N 次」——它统计
   「请求时真的改写了 payload」的次数，稳态应恒为 **0**；一旦非 0 会弹一次提示；
4. **开关不会打破缓存**。`/hmm off` 只停止清洗新消息，已清洗的旧文本不再变；
   只有修改 `matchHm / emmFillers / cjkFillers / capitalizeSentences / extraTokens`
   这类"影响输出字节"的配置，才会让历史重算一次（一次性失效，改完重新稳定）；
5. **想硬保证前缀永不变**：把 `contextScrub` 设为 `false`。这样**只有** `message_end`
   会在写入前清洗，发出去的 payload 永远不会被追溯修改；代价是本次开启之前
   就已落库的旧 hmm 不会被兜底清理（可用下面的 scrub 脚本一次性清掉）。

顺带一提，清洗后 token 变少，前缀更短，缓存本身只会更容易命中。

### 开销

实测（1.06 MB thinking / 480 块的**最坏**会话，`context` 钩子每次请求都要跑）：

| 场景 | 耗时 |
|------|------|
| 冷启动首次扫描（无缓存） | 46 ms |
| 之后每次请求（内容未变的记忆化命中） | **2.4 ms** |
| 手工关掉 `letMeLines`+`dedupeLines` | 5.3 ms/MB |


## 签名安全

不同 provider 给 thinking 块的 `thinkingSignature` 含义不同：

* DeepSeek / NVIDIA NIM 等 OpenAI 兼容接口存的是**字段名标记**
  （`"reasoning_content"`、`"reasoning"`），改文本是安全的，正好就是我们想清理的对象；
* Anthropic / Bedrock / pi-messages 存的是**不透明签名**，改了会导致多轮对话报错。

所以默认只重写 `safeSignatures` 里列出的标记，其余签名一概不碰
（`redacted` 的思考同样跳过）。真要强制清理，把 `cleanSignedThinking` 设成 `true`，
但要清楚对应 provider 可能会报签名错误。

## 清理历史会话

扩展不会改写磁盘上的旧 session。想一次性洗掉过去积累的 "Hmm"：

```bash
# 关掉 pi 之后运行
npm run scrub                                      # 试运行
node extensions/pi-no-hemming/scrub-sessions.ts --apply   # 真正写入
```

* 只改 `type:"message"` / `role:"assistant"` 的 `thinking` 文本，其它字段、
  id、parentId、时间戳一字不动；
* 改写前自动留一份 `<session>.jsonl.bak`；
* 幂等：跑第二遍不会再改动任何东西；
* 写入前校验文件未被追加、采用「临时文件 + rename」，不会覆盖正在运行的 pi 会话；
* 参数：`<file|dir>` 指定目标，`--config <path>` 指定配置，`-v` 显示全部文件。

## 开发 / 自测

```bash
npm install          # 只为跑扩展集成测试（装 @earendil-works/pi-coding-agent）
npm test             # 清理规则用例 + 事件钩子/命令集成测试
node test/cleaner.test.ts     # 只跑清理规则（零依赖）
node test/extension.test.cjs  # jiti 加载真实 index.ts，mock ExtensionAPI
```

集成测试会把 `PI_CODING_AGENT_DIR` 指到临时目录，不会碰你真实的 pi 配置。


## License

MIT
