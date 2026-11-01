# Haruhi 阅读助手

个人效率助手工作区的独立 Chrome Manifest V3 扩展。基于 ChatGPT Summarize 1.9.6 发布包的行为分析重新实现，源码、界面和构建产物均独立；原扩展代码没有进入此包。分析过程见 [逆向报告](../../docs/research/chatgpt-summarize.md)。

## 安装与使用

```bash
pnpm install
pnpm build:summarizer
```

1. 打开 `chrome://extensions/`，开启开发者模式，点击“加载已解压的扩展程序”。
2. 选择本项目的 `packages/summarizer-browser-extension/dist`。
3. 点击扩展图标打开侧边栏。在“模型与阅读偏好”填写接口、模型和自己的 API Key，点击“保存并授权接口”。
4. 切换到目标网页并点击扩展图标，再点击“读取当前页 / 选区”；也可右键选中文字，或直接粘贴文本、导入 PDF。
5. 确认材料，选择总结方式后点击“开始总结”，或直接提问。结果可导出为 Markdown。

原 Haruhi 链接扩展继续单独运行；`pnpm build` 保持原行为，`pnpm build:all` 构建两个子项目。

## 能力与边界

| 能力 | 实现 |
| --- | --- |
| 网页 / 选区 | Readability 提取正文，优先当前选区；仅在主动操作时注入，不常驻所有网页 |
| YouTube | 优先已展开文字稿，其次读取当前视频公开字幕轨；保留时间戳。没有字幕、站点限制或页面结构变化时提示手动展开 / 粘贴 |
| PDF | PDF.js 本地 worker 解析本地或 HTTPS 在线 PDF，附页码；限制 30 MB / 500 页，不含扫描件 OCR。跨域重定向链接请下载后导入 |
| 模型 | OpenAI / DeepSeek 预设，以及完整 URL 的 OpenAI Chat Completions 兼容接口；模型名称可修改。Claude 仅能通过兼容网关接入，未实现原生 Anthropic 协议 |
| 长文 | 按 Unicode 字符分段，逐段提取再多层归并；不静默截掉尾部。字符预算不是精确 token 预算，应按所用模型调整 |
| 问答 | 短文基于原文；长文基于压缩摘要，界面明确提示可能省略细节；历史按字符预算保留最近完整轮次 |
| 输出 | SSE 流式回答、取消、HTTP / 截断错误反馈、净化 Markdown、明暗主题、Markdown 导出 |
| 模板 | 要点总结、研究笔记、行动清单与自定义提示词；修改材料会清空旧会话，重新总结会开始新会话 |

YouTube 在线字幕可用性与真实模型账号调用需在使用环境中确认；自动验收使用本地接口替身，不代表真实供应商调用成功。没有复刻原插件的网页账户登录、私有 token 协议、验证码流程、遥测、付费能力或站点全覆盖。

## 数据与权限

- 只有点击总结 / 发送问题才会将材料发送到配置接口；材料可能含个人或内部内容，发送前可在文本框检查修改。
- API Key 默认放入 `chrome.storage.session`，重启浏览器后失效。勾选“记住密钥”后保存于本机 `chrome.storage.local`，不使用 sync；这不是操作系统加密保险库。内容脚本不能读取 local 设置。
- 对话和材料仅在打开的面板内存中保留，不自动建立跨标签页历史或恢复会话。关闭面板前请导出需要的结果。
- 权限为 `activeTab`、`scripting`、`storage`、`sidePanel`、`contextMenus`。API / 在线 PDF 的来源权限按用户点击按需申请。
- HTTP 仅允许 localhost / 127.0.0.1 模型服务；远端必须 HTTPS。默认不跟随 API 重定向，不在 UI 显示服务端可能回显凭证的错误正文。
- 普通浏览器内部页面无法提取；Chrome PDF 查看器请改用“导入 PDF”或“读取在线 PDF”。

## 开发与验证

```bash
pnpm dev:summarizer                    # 网页预览，不能读取其他标签页
pnpm test:summarizer                   # 分段、流解析、错误和取消测试
pnpm --filter summarizer-browser-extension test:e2e
```

浏览器验收需要 Playwright Chromium：如未安装，运行 `pnpm --filter summarizer-browser-extension exec playwright install chromium`。测试在临时独立用户目录加载 `dist` 的副本，预授权本地服务与模拟 YouTube 域名，以本地模型服务和字幕夹具验证功能，结束时关闭自己的浏览器。无头测试不覆盖原生权限弹窗，也不调用真实模型或真实 YouTube 字幕。可用 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 指定已有 Chromium 可执行文件。产物保存到仓库的 `.local/verification/summarizer`（Git 忽略）。

`src/core/index.ts` 导出内容类型、模板、分段、消息构建、流式客户端与多层归并，可从工作区导入 `summarizer-browser-extension/core` 复用；它不依赖 Chrome API。`src/capture.ts` 负责网页内容适配，`src/pdf.ts` 负责文档适配，`src/main.ts` 管理界面和浏览器权限。

### 本次验证记录（2026-11-01）

- 工作区两个子项目均构建通过，现有 Haruhi 构建命令保持可用。
- 核心测试覆盖 Unicode 无损分段、资料消息隔离、接口验证、SSE 跨字节 / CRLF、正常结束尾包、HTTP / 流错误 / 截断、长文归并和取消。
- 独立 Chromium 中通过：扩展加载、已授权来源设置、正文和选区注入、两种 YouTube 字幕夹具、流式总结与追问、Markdown 净化与导出、真实文本 PDF 的 worker 解析、主题。
- `playwright-cli` 网页预览验证通过：粘贴、模拟流式总结，无横向溢出，最终控制台无错误。测试服务不调用真实供应商。
- 尚未验收：真实账号模型调用、真实 YouTube 的当前字幕限制、原生来源授权弹窗。没有将这些项目列为通过。
