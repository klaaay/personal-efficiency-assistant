import AppKit
import SwiftUI
import ServiceManagement

private let appName = "AgentPigeon"
private let configDirectory = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".config/agent-pigeon", isDirectory: true)
private let configURL = configDirectory.appendingPathComponent("config.json")
private let eventNames = [("task-complete", "任务完成", "checkmark.circle"), ("task-error", "任务出错", "exclamationmark.circle"), ("needs-attention", "需要你处理", "hand.raised")]
private let agentNames = [("codex", "Codex"), ("claude", "Claude Code"), ("gemini", "Gemini CLI"), ("cursor", "Cursor")]

struct Receipt: Decodable, Identifiable {
    let id: String
    let state: String
    let updated: Double
    let attempts: Int
    let agent: String
    let event: String
    let summary: String
    let messageId: Int?
    let error: String?
    var label: String { state == "sent" ? "已送达" : state == "sending" ? "发送中" : "待补发" }
}
struct AgentState: Decodable, Identifiable { let id: String; let name: String; let installed: Bool }
struct Count: Decodable { let state: String; let count: Int }
struct EngineStatus: Decodable { let counts: [Count]; let recent: [Receipt]; let agents: [AgentState] }

final class SettingsModel: ObservableObject {
    @Published var token = ""
    @Published var chatID = ""
    @Published var enabled = true
    @Published var events: Set<String> = Set(eventNames.map { $0.0 })
    @Published var agents: [String: Bool] = [:]
    @Published var receipts: [Receipt] = []
    @Published var installed: [String: Bool] = [:]
    @Published var sent = 0
    @Published var queued = 0
    @Published var busy = false
    @Published var banner = ""
    @Published var isError = false
    @Published var loginEnabled = false
    @Published var loginNeedsApproval = false
    @Published var selected = "通知设置"
    @Published var dirty = false
    private var original: Data?
    private var values: [String: Any] = [:]
    private var running: Process?
    var onConfigChange: (() -> Void)?

    init() { load(); updateLoginStatus() }
    func message(_ text: String, error: Bool = false) { banner = text; isError = error }
    func load() {
        do {
            let data = try Data(contentsOf: configURL)
            guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw CocoaError(.fileReadCorruptFile) }
            original = data; values = json
            token = json["botToken"] as? String ?? ""; chatID = json["chatId"] as? String ?? ""
            enabled = json["enabled"] as? Bool ?? true
            events = Set(json["events"] as? [String] ?? eventNames.map { $0.0 })
            agents = json["agents"] as? [String: Bool] ?? [:]
            dirty = false
        } catch {
            if FileManager.default.fileExists(atPath: configURL.path) { message("无法读取现有配置，请先检查文件。", error: true) }
        }
    }
    private func write(_ json: [String: Any]) throws {
        let existing = try? Data(contentsOf: configURL)
        guard existing == original else { throw NSError(domain: appName, code: 1, userInfo: [NSLocalizedDescriptionKey: "配置已被其他进程修改，请重新载入后保存。"] ) }
        try FileManager.default.createDirectory(at: configDirectory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: configDirectory.path)
        let data = try JSONSerialization.data(withJSONObject: json, options: [.prettyPrinted, .sortedKeys])
        // 先以 0600 创建同目录临时文件，再原子替换，凭据不经过命令行。
        let temp = configDirectory.appendingPathComponent(".config-\(UUID().uuidString).tmp")
        defer { try? FileManager.default.removeItem(at: temp) }
        guard FileManager.default.createFile(atPath: temp.path, contents: data, attributes: [.posixPermissions: 0o600]) else { throw CocoaError(.fileWriteUnknown) }
        if rename(temp.path, configURL.path) != 0 { throw CocoaError(.fileWriteUnknown) }
        original = data; values = json
    }
    @discardableResult func save() -> Bool {
        let cleanToken = token.trimmingCharacters(in: .whitespacesAndNewlines)
        let cleanChat = chatID.trimmingCharacters(in: .whitespacesAndNewlines)
        guard cleanToken.range(of: "^[0-9]+:[A-Za-z0-9_-]{20,}$", options: .regularExpression) != nil,
              cleanChat.range(of: "^(-?[0-9]+|@[A-Za-z0-9_]+)$", options: .regularExpression) != nil else {
            message("请填写有效的 Bot Token 和 Chat ID。", error: true); return false
        }
        var json = values
        json["botToken"] = cleanToken; json["chatId"] = cleanChat; json["enabled"] = enabled
        json["events"] = eventNames.map { $0.0 }.filter { events.contains($0) }; json["agents"] = agents
        do {
            try write(json); dirty = false; message("设置已保存，新事件立即使用。")
            onConfigChange?(); return true
        } catch { message(error.localizedDescription, error: true); return false }
    }
    func toggleFromMenu() {
        // 菜单只改全局开关，不写入设置页尚未保存的凭据。
        do {
            let current = try Data(contentsOf: configURL)
            guard var json = try JSONSerialization.jsonObject(with: current) as? [String: Any] else { return }
            original = current
            let next = !(json["enabled"] as? Bool ?? true)
            json["enabled"] = next; try write(json); enabled = next
            message(next ? "已恢复通知。" : "已暂停通知，待发记录会保留。")
            onConfigChange?()
        } catch { message("无法更改通知开关，请打开设置检查配置。", error: true) }
    }
    func updateLoginStatus() {
        loginEnabled = SMAppService.mainApp.status == .enabled
        loginNeedsApproval = SMAppService.mainApp.status == .requiresApproval
    }
    func setLogin(_ value: Bool) {
        do {
            if value { try SMAppService.mainApp.register() }
            else { try SMAppService.mainApp.unregister() }
            updateLoginStatus()
            message(loginNeedsApproval ? "请在系统设置的登录项中允许 AgentPigeon。" : "登录时启动设置已更新。")
        } catch { updateLoginStatus(); message("无法更新登录项，请在系统设置中检查。", error: true) }
    }
    func run(_ arguments: [String], finished: @escaping (Int32, Data) -> Void) {
        guard !busy else { return }
        guard let resource = Bundle.main.url(forResource: "runtime", withExtension: "json"),
              let data = try? Data(contentsOf: resource),
              let runtime = try? JSONSerialization.jsonObject(with: data) as? [String: String],
              let node = runtime["node"], let cli = runtime["cli"],
              FileManager.default.isExecutableFile(atPath: node), FileManager.default.fileExists(atPath: cli) else {
            message("找不到通知引擎。请从项目重新构建安装 AgentPigeon。", error: true); return
        }
        busy = true
        let process = Process(); running = process
        process.executableURL = URL(fileURLWithPath: node)
        process.arguments = ["--use-env-proxy", cli] + arguments
        process.standardInput = FileHandle.nullDevice
        let output = Pipe(); process.standardOutput = output; process.standardError = FileHandle.nullDevice
        DispatchQueue.global(qos: .utility).async {
            do {
                try process.run()
                let timeout = DispatchWorkItem { if process.isRunning { process.terminate() } }
                DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + 65, execute: timeout)
                let result = output.fileHandleForReading.readDataToEndOfFile()
                process.waitUntilExit(); timeout.cancel()
                DispatchQueue.main.async { self.running = nil; self.busy = false; finished(process.terminationStatus, result) }
            } catch {
                DispatchQueue.main.async { self.running = nil; self.busy = false; self.message("通知引擎启动失败，请重新构建应用。", error: true) }
            }
        }
    }
    func refresh() {
        run(["ui-status"]) { code, data in
            guard code == 0, let status = try? JSONDecoder().decode(EngineStatus.self, from: data) else {
                self.message("无法读取投递状态，请稍后重试。", error: true); return
            }
            self.receipts = status.recent
            self.installed = Dictionary(uniqueKeysWithValues: status.agents.map { ($0.id, $0.installed) })
            self.sent = status.counts.first { $0.state == "sent" }?.count ?? 0
            self.queued = status.counts.filter { $0.state != "sent" }.reduce(0) { $0 + $1.count }
        }
    }
    func testMessage() {
        guard save() else { return }
        run(["test"]) { code, _ in
            self.message(code == 0 ? "测试消息已送达 Telegram。" : "测试未送达，已保留待补发；请检查 Token、Chat ID 和网络。", error: code != 0)
            self.refresh()
        }
    }
    func retry() {
        run(["retry"]) { code, _ in
            self.message(code == 0 ? "补发检查完成。" : "仍有消息未送达，请检查网络和 Telegram 配置。", error: code != 0)
            self.refresh()
        }
    }
    func install() {
        run(["install", "--all"]) { code, _ in
            self.message(code == 0 ? "接入配置已更新，原设置已备份。请重新开启 Agent 会话。" : "接入未完成；现有配置受保护，请检查项目说明。", error: code != 0)
            self.refresh()
        }
    }
    func shutdown() { if running?.isRunning == true { running?.terminate() } }
}

struct Card<Content: View>: View {
    let title: String
    @ViewBuilder let content: () -> Content
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(title).font(.headline)
            content()
        }.padding(20).frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.primary.opacity(0.07), lineWidth: 1))
    }
}
struct SettingsView: View {
    @ObservedObject var model: SettingsModel
    private let sections = [("通知设置", "bell"), ("Agent 接入", "point.3.connected.trianglepath.dotted"), ("投递记录", "tray")]
    var body: some View {
        HStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 26) {
                HStack(spacing: 10) {
                    Image(systemName: "bird.fill").font(.system(size: 25)).foregroundStyle(.blue)
                    VStack(alignment: .leading, spacing: 2) { Text(appName).font(.headline); Text("让 Agent 的消息找到你").font(.system(size: 10)).foregroundStyle(.secondary) }
                }.padding(.top, 10)
                VStack(spacing: 6) {
                    ForEach(sections, id: \.0) { title, symbol in
                        Button {
                            model.selected = title
                            if title != "通知设置" { model.refresh() }
                        } label: {
                            Label(title, systemImage: symbol).frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 12).padding(.vertical, 10)
                                .foregroundStyle(model.selected == title ? Color.accentColor : Color.primary)
                                .background(model.selected == title ? Color.accentColor.opacity(0.10) : .clear, in: RoundedRectangle(cornerRadius: 8))
                                .contentShape(Rectangle())
                        }.buttonStyle(.plain)
                    }
                }
                Spacer()
                HStack(spacing: 6) { Circle().fill(model.enabled ? .green : .orange).frame(width: 6, height: 6); Text(model.enabled ? "通知已开启" : "通知已暂停").font(.caption).foregroundStyle(.secondary) }
                Text("版本 1.1.2").font(.caption2).foregroundStyle(.tertiary)
            }.padding(20).frame(width: 205).background(Color(nsColor: .windowBackgroundColor))
            Divider()
            VStack(alignment: .leading, spacing: 0) {
                HStack {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(model.selected).font(.system(size: 25, weight: .semibold))
                        Text(subtitle).font(.callout).foregroundStyle(.secondary)
                    }
                    Spacer()
                    if model.busy { ProgressView().controlSize(.small) }
                }.padding(26)
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        if model.selected == "通知设置" { notifications }
                        else if model.selected == "Agent 接入" { integrations }
                        else { history }
                    }.padding(.horizontal, 26).padding(.bottom, 22)
                }
                Divider()
                HStack(spacing: 12) {
                    if !model.banner.isEmpty {
                        Image(systemName: model.isError ? "exclamationmark.circle" : "checkmark.circle").foregroundStyle(model.isError ? .orange : .green)
                        Text(model.banner).font(.caption).foregroundStyle(.secondary).lineLimit(3).accessibilityIdentifier("operationStatus")
                    } else { Text(model.dirty ? "有未保存的设置" : "凭据仅保存在这台 Mac 上").font(.caption).foregroundStyle(.secondary) }
                    Spacer(minLength: 8)
                    if model.selected != "投递记录" {
                        Button("重新载入") { model.load(); model.message("已载入本地配置。") }.disabled(model.busy)
                        Button("保存设置") { model.save() }.buttonStyle(.borderedProminent).disabled(model.busy).keyboardShortcut("s", modifiers: .command)
                    }
                }.padding(.horizontal, 26).padding(.vertical, 16).frame(minHeight: 66)
            }.frame(maxWidth: .infinity, maxHeight: .infinity).background(Color(nsColor: .underPageBackgroundColor))
        }.frame(minWidth: 800, idealWidth: 880, minHeight: 620, idealHeight: 700)
    }
    var subtitle: String {
        if model.selected == "Agent 接入" { return "选择哪些 Agent 可以向你发送通知。" }
        if model.selected == "投递记录" { return "查看最近 30 条通知，确认消息是否送达。" }
        return "任务完成或需要你时，通过 Telegram 通知。"
    }
    var notifications: some View {
        Group {
            Card(title: "通知偏好") {
                Toggle("开启 Telegram 通知", isOn: Binding(get: { model.enabled }, set: { model.enabled = $0; model.dirty = true })).toggleStyle(.switch)
                Text("关闭后忽略新事件，暂停补发；已有待发记录会保留。").font(.caption).foregroundStyle(.secondary)
                Divider()
                HStack(spacing: 18) {
                    ForEach(eventNames, id: \.0) { id, title, _ in
                        Toggle(title, isOn: Binding(get: { model.events.contains(id) }, set: { if $0 { model.events.insert(id) } else { model.events.remove(id) }; model.dirty = true }))
                    }
                }
            }
            Card(title: "Telegram") {
                VStack(alignment: .leading, spacing: 7) {
                    Text("Bot Token").font(.subheadline).foregroundStyle(.secondary)
                    SecureField("从 BotFather 获取", text: Binding(get: { model.token }, set: { model.token = $0; model.dirty = true })).textFieldStyle(.roundedBorder).accessibilityIdentifier("botToken")
                }
                VStack(alignment: .leading, spacing: 7) {
                    Text("Chat ID").font(.subheadline).foregroundStyle(.secondary)
                    TextField("个人或群组的 Chat ID", text: Binding(get: { model.chatID }, set: { model.chatID = $0; model.dirty = true })).textFieldStyle(.roundedBorder).accessibilityIdentifier("chatID")
                }
                HStack {
                    Button { model.testMessage() } label: { Label("保存并发送测试消息", systemImage: "paperplane") }.disabled(model.busy)
                    Spacer()
                    Link("打开 BotFather", destination: URL(string: "https://t.me/BotFather")!).font(.caption)
                }
                Text("测试消息不受通知总开关和事件筛选影响。").font(.caption).foregroundStyle(.secondary)
            }
            Card(title: "菜单栏") {
                Toggle("登录 Mac 时启动 AgentPigeon", isOn: Binding(get: { model.loginEnabled }, set: { model.setLogin($0) })).toggleStyle(.switch)
                if model.loginNeedsApproval { Button("打开系统登录项设置") { SMAppService.openSystemSettingsLoginItems() } }
                Text("关闭设置窗口后留在菜单栏；退出菜单栏应用不会停止已接入的通知。").font(.caption).foregroundStyle(.secondary)
            }
        }
    }
    var integrations: some View {
        Group {
            Card(title: "接入的 Agent") {
                ForEach(agentNames, id: \.0) { id, title in
                    HStack {
                        Image(systemName: model.installed[id] == true ? "checkmark.circle.fill" : "circle.dashed").foregroundStyle(model.installed[id] == true ? .green : .secondary)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(title).fontWeight(.medium)
                            Text(model.installed[id] == true ? "已检测到 hook 配置" : "尚未检测到 hook 配置").font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Toggle("接收 \(title) 通知", isOn: Binding(get: { model.agents[id] != false }, set: { model.agents[id] = $0; model.dirty = true })).labelsHidden().toggleStyle(.switch)
                    }.padding(.vertical, 5)
                    if id != "cursor" { Divider() }
                }
                HStack {
                    Button("接入 / 修复 hooks") { model.install() }.disabled(model.busy)
                    Button("刷新状态") { model.refresh() }.disabled(model.busy)
                }.padding(.top, 6)
                Text("保留已有第三方 hooks，修改前备份配置。接入状态不代表 Agent 已登录；新配置可能需要重新开启会话。").font(.caption).foregroundStyle(.secondary)
            }
            Card(title: "其他 Agent") {
                Text("支持通过通用 JSON hook 接入其他工具。OpenCode 不会自动安装。").font(.callout).foregroundStyle(.secondary)
                Button("查看接入说明") { openReadme() }
            }
        }
    }
    var history: some View {
        Group {
            HStack(spacing: 14) {
                Card(title: "已送达") { Text("\(model.sent)").font(.system(size: 30, weight: .semibold, design: .rounded)) }
                Card(title: "待补发 / 发送中") { Text("\(model.queued)").font(.system(size: 30, weight: .semibold, design: .rounded)).foregroundStyle(model.queued > 0 ? .orange : .primary) }
            }
            HStack {
                Text("最近投递").font(.headline)
                Spacer()
                Button("立即补发") { model.retry() }.disabled(model.busy || !model.enabled)
                Button("刷新") { model.refresh() }.disabled(model.busy)
            }.padding(.top, 6)
            if model.receipts.isEmpty {
                VStack(spacing: 12) {
                    Image(systemName: "tray").font(.system(size: 30)).foregroundStyle(.secondary)
                    Text("还没有投递记录").font(.headline)
                    Text("发送一条测试消息，或等待 Agent 完成任务。").foregroundStyle(.secondary)
                }.frame(maxWidth: .infinity).padding(35)
            } else {
                VStack(spacing: 0) {
                    ForEach(model.receipts) { receipt in
                        VStack(alignment: .leading, spacing: 8) {
                            HStack {
                                Text(receipt.agent).fontWeight(.semibold)
                                Text(eventNames.first { $0.0 == receipt.event }?.1 ?? receipt.event).font(.caption).foregroundStyle(.secondary)
                                Spacer()
                                Text(receipt.label).font(.caption).foregroundStyle(receipt.state == "sent" ? .green : .orange)
                            }
                            if !receipt.summary.isEmpty { Text(receipt.summary).font(.callout).lineLimit(3).textSelection(.enabled) }
                            if let error = receipt.error { Text(error).font(.caption).foregroundStyle(.orange) }
                            Text(Date(timeIntervalSince1970: receipt.updated / 1000), style: .date).font(.caption2).foregroundStyle(.tertiary)
                            + Text("  ").font(.caption2)
                            + Text(Date(timeIntervalSince1970: receipt.updated / 1000), style: .time).font(.caption2).foregroundStyle(.tertiary)
                        }.padding(16)
                        if receipt.id != model.receipts.last?.id { Divider().padding(.horizontal, 16) }
                    }
                }.background(Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: 12))
            }
            Text("网络失败时每分钟自动补发；没有持续轮询。关闭全局通知会暂停补发。").font(.caption).foregroundStyle(.secondary)
        }
    }
    func openReadme() {
        guard let url = Bundle.main.url(forResource: "runtime", withExtension: "json"), let data = try? Data(contentsOf: url),
              let runtime = try? JSONSerialization.jsonObject(with: data) as? [String: String], let cli = runtime["cli"] else { return }
        NSWorkspace.shared.open(URL(fileURLWithPath: cli).deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("README.md"))
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate, NSWindowDelegate {
    let model = SettingsModel()
    var item: NSStatusItem!
    var window: NSWindow?
    func applicationDidFinishLaunching(_ notification: Notification) {
        // 避免重复启动生成多个菜单栏图标。
        if let identifier = Bundle.main.bundleIdentifier,
           let other = NSRunningApplication.runningApplications(withBundleIdentifier: identifier).first(where: { $0.processIdentifier != getpid() }) {
            other.activate(options: []); NSApp.terminate(nil); return
        }
        NSApp.setActivationPolicy(.accessory)
        item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        let icon = NSImage(systemSymbolName: "bird.fill", accessibilityDescription: appName) ?? NSImage(systemSymbolName: "paperplane.fill", accessibilityDescription: appName)
        icon?.isTemplate = true; item.button?.image = icon; item.button?.toolTip = appName
        let menu = NSMenu(); menu.delegate = self; item.menu = menu
        model.onConfigChange = { [weak self] in
            guard let self = self else { return }
            self.item.button?.appearsDisabled = !self.model.enabled
        }
        item.button?.appearsDisabled = !model.enabled
        rebuildMenu(menu)
        if CommandLine.arguments.contains("--settings") { showSettings() }
        if CommandLine.arguments.contains("--render-preview") { renderPreview() }
    }
    func menuWillOpen(_ menu: NSMenu) { rebuildMenu(menu) }
    func rebuildMenu(_ menu: NSMenu) {
        menu.removeAllItems()
        let header = NSMenuItem(title: appName, action: nil, keyEquivalent: ""); header.isEnabled = false; menu.addItem(header)
        menu.addItem(.separator())
        let status = NSMenuItem(title: model.enabled ? "暂停通知" : "恢复通知", action: #selector(toggleNotifications), keyEquivalent: ""); status.target = self; menu.addItem(status)
        let settings = NSMenuItem(title: "设置…", action: #selector(showSettings), keyEquivalent: ","); settings.target = self; menu.addItem(settings)
        let history = NSMenuItem(title: "查看投递记录", action: #selector(showHistory), keyEquivalent: ""); history.target = self; menu.addItem(history)
        menu.addItem(.separator())
        let quit = NSMenuItem(title: "退出 AgentPigeon", action: #selector(quit), keyEquivalent: "q"); quit.target = self; menu.addItem(quit)
    }
    @objc func showSettings() {
        if window == nil {
            let hosting = NSHostingView(rootView: SettingsView(model: model))
            let win = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 880, height: 700), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
            win.title = appName; win.contentView = hosting; win.minSize = NSSize(width: 800, height: 650)
            win.isReleasedWhenClosed = false; win.delegate = self; win.center(); window = win
        }
        model.updateLoginStatus()
        window?.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true)
        model.refresh()
    }
    @objc func showHistory() { model.selected = "投递记录"; showSettings() }
    @objc func toggleNotifications() { model.toggleFromMenu() }
    @objc func quit() { NSApp.terminate(nil) }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool { showSettings(); return true }
    func windowWillClose(_ notification: Notification) {
        window?.contentView = nil
        window = nil
    }
    func applicationWillTerminate(_ notification: Notification) { model.shutdown() }
    // 仅绘制独立预览：使用虚拟数据，不读取/显示真实凭据和投递正文。
    func renderPreview() {
        model.token = "123456:example-token-never-used"; model.chatID = "123456789"; model.banner = "设置已保存，新事件立即使用。"
        model.installed = Dictionary(uniqueKeysWithValues: agentNames.map { ($0.0, true) })
        let output = CommandLine.arguments.firstIndex(of: "--preview-path").flatMap { i in i + 1 < CommandLine.arguments.count ? CommandLine.arguments[i + 1] : nil } ?? "/tmp/agentpigeon-preview.png"
        let view = NSHostingView(rootView: SettingsView(model: model)); view.frame = NSRect(x: 0, y: 0, width: 880, height: 700)
        let win = NSWindow(contentRect: view.frame, styleMask: [.borderless], backing: .buffered, defer: false); win.contentView = view
        view.layoutSubtreeIfNeeded()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            if let bitmap = view.bitmapImageRepForCachingDisplay(in: view.bounds) {
                view.cacheDisplay(in: view.bounds, to: bitmap)
                if let png = bitmap.representation(using: .png, properties: [:]) { try? png.write(to: URL(fileURLWithPath: output)) }
            }
            NSApp.terminate(nil)
        }
    }
}

let delegate = AppDelegate()
NSApplication.shared.delegate = delegate
NSApplication.shared.run()
