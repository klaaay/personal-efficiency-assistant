# Yuki 阅读助手

独立的 Chrome Manifest V3 扩展，用于总结网页、YouTube 字幕与 PDF，并围绕材料继续问答。支持自定义模型接口、独立主备配置和提示词管理。

[返回仓库概览](../../README.md)

## 功能与边界

| 功能 | 行为与限制 |
| --- | --- |
| 网页 / 选区 | 优先读取当前选区，否则用 Readability 提取正文；工具栏、网页按钮和选区右键入口均可打开浮窗并自动总结 |
| YouTube | 读取当前视频的已展开文字稿或公开字幕轨；兼容新版文字稿节点，字幕接口失败时尝试自动展开“内容转文字”，保留时间戳 |
| PDF | 使用 PDF.js 本地 worker 解析本地文件或 HTTPS 在线 PDF，保留页码；上限 30 MB / 500 页，不支持扫描件 OCR |
| 长文 | 按 Unicode 字符分段并多层归并；可关闭全文处理，仅总结第一段 |
| 问答 | 短文使用原文，长文使用压缩摘要；历史保留最近完整轮次，长文可能省略细节 |
| 模型 | OpenAI / DeepSeek 预设、OpenAI Chat Completions 兼容接口、Anthropic Messages；支持 Bearer Token 和 x-api-key |
| 输出 | 流式回答、停止生成、复制、重试、Markdown 导出和明暗主题 |
| 提示词 | 新增、复制、编辑、删除与启用模板，独立系统提示词和变量展开 |
| 配置 | 多接口管理、主备切换、JSON 备份与旧配置迁移 |

YouTube 读取依赖视频是否有可用字幕及页面结构，不保证所有视频可读取；不会使用评论代替字幕。跨域重定向的在线 PDF 请下载后导入。Chrome 内部页不可提取，内置 PDF 查看器请使用 PDF 导入或在线 PDF 入口。

## 安装

需要 Node.js、pnpm 和 Chrome。以下命令在仓库根目录运行：

```sh
pnpm install
pnpm build:yuki
```

1. 打开 `chrome://extensions/`，开启“开发者模式”。
2. 点击“加载已解压的扩展程序”，选择 `packages/yuki-browser-extension/dist`。
3. 打开 Yuki 的设置页，填写模型接口、模型与 API Key，保存并完成来源授权。
4. 在普通网页点击工具栏 Yuki 图标，浮窗会自动抓取材料并开始总结。

更新后重新构建，在扩展管理页重新加载 Yuki，再刷新目标网页。Haruhi 是单独的扩展；根目录 `pnpm build` 仍构建 Haruhi。

## 使用

### 阅读与问答

工具栏图标、已启用的网页阅读按钮或选区右键入口会在网页右上角打开浮窗。无法注入浮窗的页面使用 Chrome 侧栏回退；浏览器内部页本身仍不可读取。

浮窗中可继续提问、停止生成、重试最后回答、粘贴或编辑材料、导入 PDF。修改材料或重新总结会清空旧会话。原始材料折叠在总结下方，可展开核对。

总结会按回答语言生成标题并保留项目名等专有名称。复制输出为 `### [处理后的标题](原页面链接)` 与总结正文；无链接材料使用普通三级标题。链接来自原始页面，模型未返回标题时保留原页面标题。Markdown 导出用于保存阅读结果。

### 设置页与阅读偏好

浮窗中的设置按钮打开独立标签页。设置分为“模型与阅读偏好”“提示词管理”“备份与迁移”三个 Tab；切换保留未保存的输入，Tab 聚焦后可用左右方向键切换。

| 选项 | 开启 | 关闭 |
| --- | --- | --- |
| 网页显示阅读按钮 | 在普通网页显示阅读入口 | 移除普通网页按钮 |
| YouTube 显示阅读按钮 | 在 YouTube 显示阅读入口 | 移除 YouTube 按钮 |
| 处理全文 | 处理所有分段后归并总结 | 只处理第一段，并提示未覆盖全文 |

保存后按钮注册随偏好更新，浮窗后续请求使用新配置。两个按钮开关仅控制页面按钮；工具栏和选区右键仍可作为阅读入口。分段长度按 Unicode 字符计算，界面显示字符数，不是精确 token 用量。

## 模型配置

### 接口与鉴权

在“模型与阅读偏好”Tab 选择服务与协议，填写模型、密钥和**完整请求地址**。地址不会自动拼接路径：

| 协议 | 常见地址路径 | 鉴权 |
| --- | --- | --- |
| OpenAI Chat Completions | `/v1/chat/completions` | 通常为 Bearer Token |
| Anthropic Messages | `/v1/messages` | API Key 使用 x-api-key；网关 Token 可使用 Bearer Token |

实际路径和模型名以服务或网关为准。`ANTHROPIC_BASE_URL` 需要换成完整 Messages 地址；`ANTHROPIC_AUTH_TOKEN` 对应 Bearer Token。仅发送文本 Messages，不支持工具调用，截断或非正常结束会提示失败。最大输出 token 默认 4096，可按服务限制调整；旧配置默认使用 OpenAI / Bearer。

远端接口必须使用 HTTPS；HTTP 仅允许 localhost / 127.0.0.1。默认不跟随 API 重定向。

### 主接口与备用接口

每个配置独立保存地址、协议、模型和密钥。在“优先接口”选择主配置，在“失败后尝试”选择备用配置；未选备用时不自动切换。

- 每次新总结先请求主接口。主接口失败或超时后只尝试备用一次；主接口成功时不请求备用，手动停止也不切换。
- 配置备用接口时，主接口首次有效输出等待上限为 8 秒，覆盖连接、响应头和首段内容；心跳、角色声明和空增量不会延长预算。
- 已有文本或思考增量后，生成停顿上限为 30 秒。备用接口、未配置备用的接口首次响应也保留 30 秒；持续生成可以超过 8 秒。
- 切换会清除主接口未完成文本并显示状态。同一次长文总结后续分段与归并复用备用，下一次总结重新尝试主接口。

首段有效输出慢于 8 秒的主接口也会触发切换。核心 API 若显式传入 `requestTimeoutMs`，首次响应与生成停顿均使用该值。

## 提示词、备份与迁移

### 提示词管理

提示词库支持新增、复制、编辑、删除和启用，系统提示词独立保存。模板可使用 `TITLE`、`CONTENT`、`URL`、`SELECTED_LANGUAGE`、`TEXT_CONTENT` 和 `VIDEO_SUBTITLES` 变量。

### 配置备份

“备份与迁移”Tab 导出已保存的 JSON 配置，包括所有接口、主备选择、提示词、语言、分段长度和阅读偏好；未保存的编辑不进入导出。

默认不包含密钥。勾选“导出时包含 API Key”可包含当前会话密钥，导出文件是明文；不包含网页账号、材料或聊天记录。

### 导入与旧配置迁移

支持标准 `readerConfig`、原插件 `chrome.storage.local` 快照或 `{local,sync}` 快照。选择文件后切换到“模型与阅读偏好”Tab 展示待导入内容；核对并点击“保存”后，才备份当前 local 设置、申请权限并写入配置。不含密钥的备份需补填密钥。

迁移保留提示词及启用项、旧 question / systemMessage、语言、可明确归属的 API 配置与三个阅读偏好；不迁移网页账号、token / password、embeddings 缓存或未证实的聊天历史。无法归属的密钥不会套用到其他服务。

## 数据与权限

- 点击阅读入口后，材料会发送到已配置模型接口；单纯浏览页面不会自动调用模型。粘贴、编辑材料后也可手动总结或提问。
- API Key 默认保存在 `chrome.storage.session`，重启浏览器后失效；勾选“记住密钥”后保存在本机 `chrome.storage.local`，不使用 sync。local 存储不是操作系统加密保险库，内容脚本不能读取这些设置。
- 材料和对话仅保存在当前浮窗 / 侧栏内存中，不自动保存跨标签页历史或恢复会话；关闭前导出需要的结果。
- 扩展使用 `activeTab`、`scripting`、`storage`、`sidePanel` 和 `contextMenus`。保存模型配置时申请主备接口来源权限；启用页面按钮时申请 HTTP(S) 页面权限，在线 PDF 来源按需申请。
- 界面不展示服务端可能回显凭证的错误正文。包含密钥的导出文件和迁移材料应留在仓库外或已忽略的 `.local/`。

## 开发与验证

### 构建与测试

以下命令在仓库根目录运行；浏览器测试需要先构建 `dist`：

```sh
pnpm dev:yuki                    # Vite 网页预览，不能读取其他标签页
pnpm build:yuki                  # 类型检查与扩展构建
pnpm test:yuki                   # 核心与配置迁移测试

pnpm --filter yuki-browser-extension exec playwright install chromium
pnpm --filter yuki-browser-extension test:e2e
pnpm --filter yuki-browser-extension test:youtube
pnpm --filter yuki-browser-extension test:preferences
```

旧 `dev:summarizer`、`build:summarizer`、`test:summarizer` 仍是上述 Yuki 命令的兼容别名。

| 测试 | 范围 | 产物 |
| --- | --- | --- |
| `test` | Unicode 分段、消息构建、SSE、错误、取消、主备切换、长文归并与迁移 | 终端测试结果 |
| `test:e2e` | 设置、导入导出、网页 / 选区、PDF、流式总结、问答和浮窗回归 | `.local/verification/summarizer` |
| `test:youtube` | 新旧文字稿、时间戳、字幕失败回退、视频 ID 和来源检查 | 终端测试结果 |
| `test:preferences` | 偏好保存 / 重载、按钮实际行为、全文与第一段请求内容；可追加真实 YouTube | `.local/verification/yuki-preferences`，或指定目录 |

浏览器测试在临时独立用户目录加载 `dist` 的副本，并预授予所需来源权限，不修改用户 Chrome。默认使用本地模型服务和模拟 YouTube 页面，不覆盖原生权限弹窗，也不验证真实模型输出质量。`test:e2e` 可通过 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 指定已有 Chromium。

### 真实 YouTube 验收

为 `test:preferences` 设置 `YUKI_LIVE_YOUTUBE_URL` 会追加真实视频验收，读取失败即测试失败。`YUKI_BROWSER_PROXY` 配置独立 Playwright 浏览器的 HTTP 代理，本地模型服务绕过代理。`YUKI_VERIFICATION_DIR` 指定截图与结果目录，相对路径以 package 目录为基准。

例如在仓库根目录运行：

```sh
YUKI_BROWSER_PROXY='http://127.0.0.1:7897' \
YUKI_LIVE_YOUTUBE_URL='https://www.youtube.com/watch?v=UF8uR6Z6KLc' \
YUKI_VERIFICATION_DIR='../../.local/verification/yuki-youtube-fix' \
pnpm --filter yuki-browser-extension test:preferences
```

该流程仍使用本地模型响应，用于验证真实字幕读取和实际请求材料。既有实测结果及其边界见[验收记录](docs/verification.md)。

## 源码与补充文档

| 文件 | 职责 |
| --- | --- |
| `src/core/index.ts` | 内容类型、模板、分段、消息构建、流式客户端、主备切换和多层归并 |
| `src/capture.ts` | 网页 / 选区与 YouTube 内容提取 |
| `src/pdf.ts` | PDF 文档适配 |
| `src/main.ts` | 阅读界面与浏览器权限 |
| `src/settings-ui.ts` / `src/settings-tabs.ts` | 配置编辑与设置 Tab |
| `src/migration.ts` | 配置导入、备份与迁移 |
| `src/background.ts` / `src/launcher.ts` | 扩展入口、浮窗与页面按钮 |

使用 TypeScript、Vite、Readability、PDF.js、DOMPurify 和 marked。`yuki-browser-extension/core` 可从工作区导入复用，不依赖 Chrome API。

- [验收与安装历史](docs/verification.md)：已验证场景、真实服务与模拟测试的范围。
- [头像资源说明](public/icons/README.md)：长门有希角色头像、生成提示词及图标用途。
- [发布包研究与重建记录](../../docs/research/chatgpt-summarize.md)：参考 ChatGPT Summarize 1.9.6 的行为分析，源码与界面独立实现，未引入原扩展代码。

本项目未复刻原插件的网页账户登录、私有 token 协议、验证码、遥测、付费能力或向量检索库。
