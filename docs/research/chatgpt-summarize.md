# ChatGPT Summarize 发布包分析与能力重建

分析日期：2026-11-01。目标为 Chrome Web Store 扩展 `cbgecfllfhmmnknmamkejadjmnmpfjmp`，发布包版本 `1.9.6`。本次根据公开发布包确认功能的数据流，再在 `packages/summarizer-browser-extension` 独立实现适合本项目的能力。

## 目标、工具与证据

- [目标商店页面](https://chromewebstore.google.com/detail/chatgpt-summarize/cbgecfllfhmmnknmamkejadjmnmpfjmp)
- [REA 官方仓库](https://github.com/morluto/rea)
- 工具：`rea-agents@6.8.0`，独立 Node.js `24.22.1`，安装目录 `~/.local/share/rea-runtime`。
- Codex 注册：`rea setup --client codex --yes --json` 返回 `ready`；修改 `~/.codex/config.toml`，原配置备份为 `~/.codex/config.toml.rea.backup`；安装技能到 `~/.agents/skills/reverse-engineer-anything`。
- 安装后核验发现 npm 的 `.bin/rea` 使用 `env node`，会随启动环境选择 Node。已将 Codex 的 `[mcp_servers.rea]` 固定为 `command = "/Users/wuzhen/.local/share/rea-runtime/node_modules/node/bin/node"`，参数为 `["/Users/wuzhen/.local/share/rea-runtime/node_modules/rea-agents/scripts/rea.mjs", "mcp"]`，避免 GUI 启动时回到旧运行时。保留 `startup_timeout_sec = 30`、`tool_timeout_sec = 450`。
- 新增 `~/.local/bin/rea` 启动器，固定调用同一 Node 和 REA 脚本，转发原始参数；`~/.local/bin/rea --version` 已核验返回 `6.8.0`。命令是否可直接写成 `rea` 取决于当前终端的 PATH，以下使用绝对到主目录的路径。
- 当前会话使用 REA CLI 分析；MCP 注册成功不代表当前已启动的 Codex 会话自动加载了新工具，重启后才能使用新注册的 MCP。
- 下载来源为 Google 扩展更新服务；CRX 位于 `.local/research/chatgpt-summarize/extension.crx`，解包目录为其同级的 `extracted/`。
- CRX SHA-256：`bcf930e8db8b4628be15d8d4d733b28b4df8bb9b65944849821d4a2234a19c50`。
- 发布包、局部代码摘录 `snippets.txt` 和 REA 输出 `rea-analysis.json` 保存在已忽略的 `.local/` 下，不进入本项目发布产物。

以下为静态分析：读取发布文件及函数调用关系，没有运行原扩展，也没有调用原扩展的在线服务。提到端点、消息名或库名，仅表示发布包包含相应实现，不能据此证明在线请求成功或所有分支均可到达。

### REA 执行结果与覆盖范围

首次全树分析已结束，退出码为 `1`，错误码为 `provider_timeout`。这是 REA 单个源文件的 `300000 ms` 服务端分析期限，不是 MCP 连接失败，也不是整个应用仅耗时五分钟。原始输出共 `72,307,502` 字节，保存在 `rea-analysis.json`。

错误对象的 `details.partial_observation` 保留了完整结构的部分证据记录，其 Evidence ID 为：

`ev_15848925bc30ee872a7a8b75b3d9bf1d6568b6f034a58287b331b30722e9311e`

这里“完整结构”不表示分析范围完整。证据记录为 `authority: shipped-artifact`、`confidence: derived`，目录摘要为 `cccd1ca8e453208e9f84e14cc755615a9aa97fb42dc0ac194e0d529387a7c692`。该目录摘要与上文 CRX 文件摘要含义不同。

记录统计：清点相关文件 `74` 个，读取文本 `4,381,376` 字节，已解析 JavaScript `6` 个，跳过 JavaScript `8` 个，访问 AST 节点 `211291` 个，记录 findings `379` 个，语法解析失败 `0` 个。解析失败为零不等于所有文件都已分析。

- 在 `chunk-W7D2TEGV.js` 达到单文件期限后，中止了后续源文件分析。
- 部分报告的路由源覆盖将 `background/index.js`、`chunk-AO5PQB43.js`、`chunk-HKZE7CVR.js`、`chunk-JKDAPNFG.js`、`chunk-KZLOIFVB.js`、`chunk-TNAMNEMS.js` 标为 complete；这仅描述该字段的覆盖，不证明所有语义均已还原或在线行为可达。
- `content-script/index.js` 等后续文件在此次报告中标为 unavailable；上文涉及这些文件的功能证据来自对本地发布文件的定点人工静态检查，不能冒称已由首次 REA 全树分析验证。
- 报告明确记录图覆盖不完整、动态或混淆表达式可能无法解析、别名扩展最多增加 `512` 个选择状态，相关路径仍未知。
- JavaScript/HTML 始终作为静态文本解析，没有执行 bundle 启动代码。图中未出现的关系不能被解释为应用不存在该行为。

环境核验中，Codex 注册状态为 `aligned`、所选范围 `healthy: true`。`environment_healthy: false` 来源于未配置原生二进制分析引擎，不影响本任务的静态 JavaScript 分析，也不是此次超时原因。

为补上未进入首次解析的正文提取入口，随后只选择 `content-script/index.js` 运行聚焦分析，降低语义保留上限，没有重复全树分析。该调用退出码为 `0`：读取 `61,933` 字节，解析 JavaScript `1` 个，访问 AST 节点 `16130` 个，记录 findings `27` 个，语法失败 `0` 个。证据文件保存在：

- 完整证据包：`.local/research/chatgpt-summarize/rea-content-evidence.json`；父 Evidence ID：`ev_7cbe8c78b796fdbdeb16f2ca3b144709c24ca5e718ffe19fb3f9fc7489e00f88`。
- 摘要：`.local/research/chatgpt-summarize/rea-content-summary.json`；摘要投影 Evidence ID：`ev_c9335dd3718c31b9b6c2d3550ef637b0ab3bc57c8d1a774ea8a93034bdaf0f34`。
- 进度日志：`.local/research/chatgpt-summarize/rea-content-progress.log`。

聚焦调用仅确认所选文件语法解析完成。其语义图达到 `1200` 个节点与 `1000` 条 unknown 的保留上限，覆盖为 partial、truncated；另有 `73` 个清单文件未纳入此次分析，跨文件关系仍未知。摘要的 `complete-within-view` 只说明摘要投影已完整输出，不能解释为全文件语义或全应用分析完整。功能矩阵仍以具体发布代码位置的人工静态核查为主要依据，REA 输出作为补充证据。

### 关键文件身份

路径相对于 `extracted/`。偏移均为 UTF-8 解码后的 Python 字符串零基字符偏移，不是 UTF-8 字节偏移；同版本重新打包的文件也可能不同，应先核对摘要。

| 文件 | SHA-256 |
| --- | --- |
| `manifest.json` | `e2545d3e73d3eea0fe5785760323c71f5e85ed14fd592625eade475e7ebb88d6` |
| `content-script/index.js` | `1e6a41c7340aa7f3917863b09ddb2dd4b0084389a3ec7b1c7733f0a31f5bd32a` |
| `background/index.js` | `72b2ebdcbe662726c49cc0791636ed3165e836ceacc2e6bb23ab207bb51e5ade` |
| `popup/index.js` | `e9cba76a7d79d9b1fcce4c6ae9c6f7e7ac8d7a8ba6a9c042465b78278af5c7d2` |
| `options/index.js` | `45cc5a6f750438d376e569ac51779c464794a6ebdd8df908d405a335b1bf56e5` |
| `chunk-KZLOIFVB.js` | `8aa0ca3362736d689aca1478ae8d4ca9392abdf9fc9d60f2aacf962734bfd40d` |

## 功能证据与重建范围

下表的“重建范围”是本次设计目标；实际支持范围、运行与验收结果以子项目 README 为准，不表示已完成原扩展所有功能的等价复刻。

| 能力 | 发布包中观察到的证据 | 重建范围 |
| --- | --- | --- |
| 网页正文 | `content-script/index.js:60856` 附近复制文档后调用 Readability；异常路径使用 `main` 或 `body` 文本 | 使用官方 Readability 依赖提取正文，保留来源标题和 URL |
| 选区总结 | `content-script/index.js:58088` 读取选区并发送 `SUMMARIZE_SELECTED_TEXT`；`background/index.js:678036` 创建 selection 右键菜单 | 读取选中文本并进入总结工作流 |
| 页面入口 | `content-script/index.js:53285` 创建扩展 iframe 并嵌入网页 | 使用独立扩展界面；不复制原 iframe UI、品牌或资源 |
| YouTube 字幕 | `content-script/index.js:59477` 从视频页面解析播放器响应，`:59613` 读取字幕轨道并请求字幕 URL；`background/index.js:680842` 监听 timedtext 请求 | 获取可用字幕并用于总结；无字幕或受限时报告失败，不以视频标题冒充视频内容 |
| PDF 文本 | `popup/index.js:1403159` 设置本地 PDF worker，下载文档并逐页调用 `getTextContent` | PDF.js 本地与远程 PDF 文本提取；扫描件 OCR 不在此次范围 |
| API 模型 | `chunk-KZLOIFVB.js:26424`、`:27753` 分别含 DeepSeek 与 OpenAI Chat Completions 端点配置 | 可配置 OpenAI 兼容接口与模型，提供 DeepSeek 入口 |
| 流式输出 | `background/index.js:672649` 构造 `stream: true` 消息；`:672910` 拼接 `choices[0].delta.content` 并处理完成标记 | 流式回答、取消和错误反馈 |
| 内容问答 | `background/index.js:675317` 注册端口消息分发，区分 summarize、retry 与 answer；`:675152` 附近有基于文档的问答调用路径 | 对当前已提取内容连续追问 |
| 提示词模板 | `options/index.js:24800–26600` 附近有标题、内容、URL、语言占位符和本地提示词配置 | 内置总结模板与可编辑提示词 |
| 长文处理 | `popup/index.js:1405972` 根据模型预算判断内容长度，进入分段提示词构建分支；`:1060138` 附近拼接内容与模板 | 分段总结后合并；不宣称与原分词或预算算法一致 |
| Markdown | `popup/index.js:1510573` 附近出现 react-markdown 依赖及对应解析渲染实现 | 安全的 Markdown 显示和导出 |
| 深色外观 | 发布样式和组件包含 `dark:` 类，例如 `chunk-KZLOIFVB.js:43083`；仅凭样式不能确定所有主题切换路径 | 明暗主题支持 |
| 网页账户接入 | `background/index.js:676346` 附近有 `GET_ACCESS_TOKEN`、`GET_CHAT_REQUIREMENTS`；配置包含网页会话接口 | 不移植网页账户 token、验证码或私有网页接口逻辑，使用用户配置的 API |
| 遥测 | `background/index.js:424584` 附近包含 Google Analytics 收集端点，其后有客户端标识持久化、事件构造及发送实现 | 不移植遥测；静态证据不证明某次运行实际发送了什么 |

### 原扩展的数据流

1. Content script 从当前页面提取正文、选区或字幕，附带标题、来源 URL 和语言。
2. 扩展界面接收内容；PDF 走 PDF.js 提取流程；提示词按模板、内容和模型预算构建。
3. UI 通过扩展端口发送 summarize 或 answer 消息，由 service worker 按 provider 选择请求路径。
4. 流式返回内容逐步拼接，通过扩展消息返回 UI 展示。

这些关系来自上述具体函数与消息分发位置。发布包还捆绑了较多第三方库；仅仅在库代码里发现一个符号，不等于应用一定调用它，因此没有把所有依赖的能力计入功能清单。

## 许可证与实现边界

商店页面自称开源，但本次取得的发布包没有提供足以确认整个扩展源码可再分发的顶层许可证文件。库的 bundled license 注释仅覆盖各自依赖，不能自动扩展到整份应用。

本项目不复制原插件代码、图标、品牌、打包资源或私有服务实现。分析文档只记录可核查的事实与位置；重建代码由本项目独立编写，并直接依赖有明确许可证的通用库。原扩展内的网页登录、验证码相关分支和遥测均不作为集成目标。

## 可复现检查

在仓库根目录操作。更新服务返回的是执行时可用的版本，重新下载后应重新核验 Manifest 与 SHA-256，不能假定仍为 `1.9.6`。

```bash
mkdir -p .local/research/chatgpt-summarize
curl -fL 'https://clients2.google.com/service/update2/crx?response=redirect&prodversion=131.0.0.0&acceptformat=crx2,crx3&x=id%3Dcbgecfllfhmmnknmamkejadjmnmpfjmp%26uc' \
  -o .local/research/chatgpt-summarize/extension.crx
```

解出 CRX3 的 ZIP payload，并检查路径不越界：

```bash
python3 - <<'PY'
import hashlib, io, struct, zipfile
from pathlib import Path

artifact = Path('.local/research/chatgpt-summarize/extension.crx')
data = artifact.read_bytes()
assert data[:4] == b'Cr24'
assert struct.unpack_from('<I', data, 4)[0] == 3
offset = 12 + struct.unpack_from('<I', data, 8)[0]
with zipfile.ZipFile(io.BytesIO(data[offset:])) as archive:
    for name in archive.namelist():
        assert not name.startswith('/') and '..' not in Path(name).parts
    archive.extractall(artifact.parent / 'extracted')
print(hashlib.sha256(data).hexdigest())
print((artifact.parent / 'extracted/manifest.json').read_text())
PY
```

静态分析命令使用已安装并固定 Node 版本的启动器：

```bash
"$HOME/.local/bin/rea" \
  analyze-javascript-application \
  "$PWD/.local/research/chatgpt-summarize/extracted" --json \
  > .local/research/chatgpt-summarize/rea-analysis.json
```

该命令解析大体积压缩 JavaScript 可能较慢，应保留退出码及输出中的 limitations、unknowns。运行中的空文件不算成功分析；静态语义分析发生超时或资源限制时，也不能宣称完整恢复了源代码。不要仅为了重新显示报告而重复运行分析。

本次超时后实际采用的聚焦命令如下；`--evidence_output` 不覆盖已有文件，复跑时应更换输出文件名，并保留本次证据。`--detail summary` 只降低输出量，真正缩小分析工作的是明确的源文件选择与语义上限。

```bash
"$HOME/.local/bin/rea" analyze-javascript-application \
  "$PWD/.local/research/chatgpt-summarize/extracted" \
  --source-path content-script/index.js \
  --max-semantic-nodes 1200 --max-semantic-nodes-per-file 1200 \
  --max-semantic-unknowns 1000 --max-semantic-unknowns-per-file 1000 \
  --analysis-timeout-ms 60000 --detail summary \
  --evidence_output "$PWD/.local/research/chatgpt-summarize/rea-content-evidence.json" \
  --json > .local/research/chatgpt-summarize/rea-content-summary.json \
  2> .local/research/chatgpt-summarize/rea-content-progress.log
```

检查某个证据位置，无需执行发布包代码：

```bash
python3 - <<'PY'
from pathlib import Path
source = Path('.local/research/chatgpt-summarize/extracted/content-script/index.js').read_text()
offset = 60856
print(source[max(0, offset - 100):offset + 400])
PY
```

## 尚未由本次静态分析确认的事项

- 原扩展在当前 Chrome、YouTube、ChatGPT 和 DeepSeek 在线环境中的实际成功率。
- 原扩展所有私有网页接口、账户状态、验证码与地域相关分支的可用性。
- 受登录保护或受 DRM 限制内容、跨域 iframe、图片扫描 PDF 的完整内容读取能力。
- 模型回答的正确性、模型费用和上下文限制；这些依赖用户选择的服务与模型。
- 原扩展遥测在具体安装、设置和用户动作下是否执行，以及实际发出的请求内容。
- 应用级许可证授权范围；“可取得发布包”不等于“允许复制整份源码”。

新扩展的功能测试是独立实现的验收，不应被描述为原扩展的运行验证。
