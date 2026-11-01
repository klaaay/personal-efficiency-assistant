using System;
using System.IO;
using System.Text;
using System.Drawing;
using System.Diagnostics;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using System.Web.Script.Serialization;
using Microsoft.Win32;

internal class Pigeon : ApplicationContext {
    readonly JavaScriptSerializer json = new JavaScriptSerializer();
    readonly string root = AppDomain.CurrentDomain.BaseDirectory;
    readonly string home = Environment.GetEnvironmentVariable("AGENT_PIGEON_HOME") ?? Environment.GetEnvironmentVariable("AGENT_NOTIFY_HOME") ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".config", "agent-pigeon");
    NotifyIcon tray;
    readonly Icon appIcon = new Icon(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"AgentPigeon.ico"),32,32);
    readonly Icon trayIcon = new Icon(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"AgentPigeon.ico"),16,16);
    Form window;
    Dictionary<string, object> config;
    string snapshot;
    TextBox token, chat;
    ListView history;
    Label connection, deliveryCount;
    Dictionary<string, Label> agentStates = new Dictionary<string, Label>();
    readonly Color ink = Color.FromArgb(28, 42, 53), muted = Color.FromArgb(112, 125, 137), accent = Color.FromArgb(22, 117, 104);
    CheckBox enabled, complete, error, attention, codex, claude, gemini, cursor, startup;
    Label status;
    bool busy;
    static EventWaitHandle showRequest;
    Control dispatcher;
    RegisteredWaitHandle showWait;
    string ConfigPath { get { return Path.Combine(home, "config.json"); } }
    static readonly string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";

    [STAThread] static void Main(string[] args) {
        bool created;
        showRequest = new EventWaitHandle(false, EventResetMode.AutoReset, "Local\\AgentPigeon-Show-" + Environment.UserName);
        using (var mutex = new Mutex(true, "Local\\AgentPigeon-" + Environment.UserName, out created)) {
            if (!created) { showRequest.Set(); return; }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            try { Application.Run(new Pigeon(args)); }
            catch { MessageBox.Show("AgentPigeon 无法启动，请重新安装并检查配置文件。", "AgentPigeon"); }
        }
    }
    Pigeon(string[] args) {
        dispatcher = new Control(); var handle = dispatcher.Handle;
        showWait = ThreadPool.RegisterWaitForSingleObject(showRequest, (s,t) => {
            if (!dispatcher.IsDisposed) dispatcher.BeginInvoke(new Action(ShowSettings));
        }, null, Timeout.Infinite, false);
        tray = new NotifyIcon { Icon = trayIcon, Text = "AgentPigeon", Visible = true };
        var menu = new ContextMenuStrip();
        menu.Items.Add("设置与投递记录", null, (s,e) => ShowSettings());
        menu.Items.Add("暂停 / 恢复通知", null, (s,e) => {
            try { LoadConfig(); config["enabled"] = !Flag(config, "enabled"); SaveConfig(); if (window != null) Populate(); }
            catch { MessageBox.Show("配置已变化或无法保存，请重新打开设置。", "AgentPigeon"); }
        });
        menu.Items.Add("立即补发", null, async (s,e) => await RunAction("retry"));
        menu.Items.Add("退出托盘", null, (s,e) => { showWait.Unregister(null); dispatcher.Dispose(); tray.Visible = false; tray.Dispose(); appIcon.Dispose(); trayIcon.Dispose(); ExitThread(); });
        tray.ContextMenuStrip = menu;
        tray.DoubleClick += (s,e) => ShowSettings();
        if (Array.IndexOf(args, "--settings") >= 0) ShowSettings();
    }
    static bool Flag(Dictionary<string, object> d, string key) { return !d.ContainsKey(key) || !Object.Equals(d[key], false); }
    void LoadConfig() {
        snapshot = File.Exists(ConfigPath) ? File.ReadAllText(ConfigPath) : null;
        config = snapshot == null ? new Dictionary<string, object>() : json.Deserialize<Dictionary<string, object>>(snapshot);
        if (config == null) throw new Exception();
    }
    void SaveConfig() {
        Directory.CreateDirectory(home);
        if ((File.Exists(ConfigPath) ? File.ReadAllText(ConfigPath) : null) != snapshot) throw new Exception();
        var text = json.Serialize(config);
        var temp = ConfigPath + "." + Guid.NewGuid().ToString("N");
        try {
            File.WriteAllText(temp, text, new UTF8Encoding(false));
            if (File.Exists(ConfigPath)) File.Replace(temp, ConfigPath, null); else File.Move(temp, ConfigPath);
            snapshot = text;
        } finally { if (File.Exists(temp)) File.Delete(temp); }
        tray.Text = Flag(config, "enabled") ? "AgentPigeon · 通知已开启" : "AgentPigeon · 已暂停";
    }
    Label Caption(string text, int size, bool bold) { return new Label { Text = text, AutoSize = true, ForeColor = bold ? ink : muted, Font = new Font("Microsoft YaHei UI", size, bold ? FontStyle.Bold : FontStyle.Regular), Margin = new Padding(0, 0, 0, 8) }; }
    FlowLayoutPanel Stack(Control parent) {
        var stack = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.TopDown, WrapContents = false, AutoScroll = true, Padding = new Padding(32, 26, 32, 16) }; parent.Controls.Add(stack); return stack;
    }
    Panel Card(FlowLayoutPanel parent, int height) {
        var card = new Panel { Width = 622, Height = height, BackColor = Color.White, Padding = new Padding(22), Margin = new Padding(0, 10, 0, 8) };
        parent.Controls.Add(card); return card;
    }
    void LabelAt(Control parent, string title, int x, int y, int size, bool bold) { var label = Caption(title, size, bold); label.Location = new Point(x,y); parent.Controls.Add(label); }
    CheckBox Switch(Control parent, string title, int x, int y, int width) {
        var c = new PigeonSwitch { Text = title, Location = new Point(x,y), Size = new Size(width,32), ForeColor = ink, Cursor = Cursors.Hand }; parent.Controls.Add(c); return c;
    }
    TextBox Field(Control parent, int x, int y, int width) {
        var border = new Panel { Location = new Point(x,y), Size = new Size(width,39), BackColor = Color.FromArgb(242,246,246), Padding = new Padding(12,9,12,8) };
        var input = new TextBox { Dock = DockStyle.Fill, BorderStyle = BorderStyle.None, BackColor = border.BackColor, ForeColor = ink, Font = new Font("Segoe UI",11) }; border.Controls.Add(input); parent.Controls.Add(border); return input;
    }
    void ShowSettings() {
        if (window != null) { window.Show(); window.Activate(); return; }
        // Build all children in 96-DPI logical units before scaling the complete tree.
        // Setting AutoScaleMode.Dpi before adding children scales the empty form only.
        window = new Form { Text = "AgentPigeon", AutoScaleMode = AutoScaleMode.None, ClientSize = new Size(900,660), StartPosition = FormStartPosition.CenterScreen, Font = new Font("Microsoft YaHei UI",9), BackColor = Color.FromArgb(245,248,248) };
        window.SuspendLayout();
        window.Icon=appIcon;
        var sidebar = new Panel { Dock = DockStyle.Left, Width = 204, BackColor = Color.FromArgb(233,240,238), Padding = new Padding(20) };
        var body = new Panel { Dock = DockStyle.Fill };
        window.Controls.Add(body); window.Controls.Add(sidebar);
        var brand=new PictureBox { Location=new Point(22,26),Size=new Size(42,42),SizeMode=PictureBoxSizeMode.Zoom };
        using(var brandImage=Image.FromFile(Path.Combine(root,"AgentPigeon.png"))) brand.Image=new Bitmap(brandImage); sidebar.Controls.Add(brand);
        LabelAt(sidebar,"AgentPigeon",22,86,17,true); LabelAt(sidebar,"让进展，及时抵达。",24,122,9,false);
        var foot = new Label { Text = "轻驻桌面 · 随时送达\nWINDOWS EDITION", Dock = DockStyle.Bottom, Height = 54, ForeColor = muted, Font = new Font("Microsoft YaHei UI",8) }; sidebar.Controls.Add(foot);
        var bottom = new Panel { Dock = DockStyle.Bottom, Height = 90, BackColor = Color.White, Padding = new Padding(24,12,24,8) }; body.Controls.Add(bottom);
        var buttons = new FlowLayoutPanel { Dock = DockStyle.Top, Height = 42, FlowDirection = FlowDirection.LeftToRight };
        AddButton(buttons, "保存设置", async () => { SaveForm(); await Task.FromResult(0); });
        AddButton(buttons, "发送测试通知", async () => { SaveForm(); await RunAction("test"); });
        AddButton(buttons, "重新载入", async () => { LoadConfig(); Populate(); await RefreshHistory(); });
        status = Caption("设置保存在这台电脑，关闭窗口后仍可接收通知。",9,false); status.Dock = DockStyle.Bottom; status.Height = 23; status.AutoSize = false;
        bottom.Controls.Add(buttons); bottom.Controls.Add(status);
        var host = new Panel { Dock = DockStyle.Fill }; body.Controls.Add(host); host.BringToFront();
        var pages = new Panel[3]; var nav = new Button[3]; string[] names = { "通知设置", "Agent 接入", "投递记录" };
        for(int i=0;i<3;i++) {
            int index = i; pages[i] = new Panel { Dock = DockStyle.Fill, Visible = i==0 }; host.Controls.Add(pages[i]);
            nav[i] = new Button { Text = "  " + names[i], TextAlign = ContentAlignment.MiddleLeft, Location = new Point(14,190+i*52), Size = new Size(176,44), FlatStyle = FlatStyle.Flat, ForeColor = ink, BackColor = i==0 ? Color.White : sidebar.BackColor, Font = new Font("Microsoft YaHei UI",10), Cursor = Cursors.Hand }; nav[i].FlatAppearance.BorderSize=0; sidebar.Controls.Add(nav[i]);
            nav[i].Click += (s,e) => { for(int n=0;n<3;n++) { pages[n].Visible=n==index; nav[n].BackColor=n==index?Color.White:sidebar.BackColor; } if(index==2) { var unused=RefreshHistory(); } };
        }
        var settingsPage = Stack(pages[0]); settingsPage.Controls.Add(Caption("通知设置",23,true)); settingsPage.Controls.Add(Caption("专注手边的事，重要进展交给信鸽。",10,false));
        var telegram = Card(settingsPage,150);
        LabelAt(telegram,"Telegram",22,18,12,true); connection = Caption("已配置",9,false); connection.Location=new Point(500,22); connection.ForeColor=accent; telegram.Controls.Add(connection);
        LabelAt(telegram,"Bot Token",22,60,9,false); token=Field(telegram,22,83,360); token.UseSystemPasswordChar=true; token.AccessibleName="Bot Token";
        LabelAt(telegram,"Chat ID",404,60,9,false); chat=Field(telegram,404,83,196); chat.AccessibleName="Chat ID";
        var preferences=Card(settingsPage,156);
        enabled=Switch(preferences,"启用通知",22,14,300);
        var divider=new Panel { Location=new Point(22,58),Size=new Size(578,1),BackColor=Color.FromArgb(234,240,238) }; preferences.Controls.Add(divider);
        LabelAt(preferences,"接收哪些通知",22,74,10,true);
        complete=Switch(preferences,"任务完成",22,108,176); error=Switch(preferences,"运行出错",215,108,176); attention=Switch(preferences,"需要你处理",408,108,192);
        var launch=Card(settingsPage,96); LabelAt(launch,"启动与后台",22,15,12,true);
        startup=Switch(launch,"登录 Windows 时启动托盘",22,50,410);
        var agentPage=Stack(pages[1]); agentPage.Controls.Add(Caption("Agent 接入",23,true)); agentPage.Controls.Add(Caption("选择要接收通知的助手。开关修改后请保存。",10,false));
        string[] ids={"codex","claude","gemini","cursor"}; string[] titles={"Codex","Claude Code","Gemini CLI","Cursor"}; string[] hints={"任务回合完成后通知你","完成、错误与需要处理的时刻","完成与提醒事件","完成、错误与任务中止"};
        CheckBox[] switches=new CheckBox[4]; agentStates.Clear();
        for(int i=0;i<4;i++) { var card=Card(agentPage,82); LabelAt(card,titles[i],22,15,12,true); LabelAt(card,hints[i],22,46,9,false); var state=Caption("检测中",9,false); state.Location=new Point(360,29); card.Controls.Add(state); agentStates[ids[i]]=state; switches[i]=Switch(card,"",530,24,65); switches[i].AccessibleName=titles[i]+" 通知"; }
        codex=switches[0]; claude=switches[1]; gemini=switches[2]; cursor=switches[3];
        var connectButtons=new FlowLayoutPanel { Width=622,Height=48,Margin=new Padding(0,12,0,0) }; agentPage.Controls.Add(connectButtons);
        AddButton(connectButtons,"接入 Codex / Claude",async()=>await RunAction("install")); AddButton(connectButtons,"接入全部助手",async()=>await RunAction("install --all"));
        var historyPage=Stack(pages[2]); historyPage.Controls.Add(Caption("投递记录",23,true)); deliveryCount=Caption("最近的通知与送达状态。",10,false); historyPage.Controls.Add(deliveryCount);
        var historyCard=Card(historyPage,378);
        history=new ListView { Dock=DockStyle.Fill, View=View.Details, FullRowSelect=true, BorderStyle=BorderStyle.None, HeaderStyle=ColumnHeaderStyle.Nonclickable, BackColor=Color.White, ForeColor=ink, Font=new Font("Microsoft YaHei UI",9), ShowItemToolTips=true };
        history.Columns.Add("时间",95); history.Columns.Add("助手",110); history.Columns.Add("状态",75); history.Columns.Add("摘要",270); historyCard.Controls.Add(history);
        var historyButtons=new FlowLayoutPanel { Width=622,Height=48,Margin=new Padding(0,12,0,0) }; historyPage.Controls.Add(historyButtons);
        AddButton(historyButtons,"刷新记录",async()=>await RefreshHistory()); AddButton(historyButtons,"补发待送通知",async()=>await RunAction("retry"));
        window.FormClosed += (s,e) => { brand.Image.Dispose(); window.Dispose(); window = null; };
        LoadConfig(); Populate();
        window.Shown += async (s,e) => await RefreshHistory();
        using(var graphics=window.CreateGraphics()) {
            float scale=graphics.DpiX/96f;
            window.Scale(new SizeF(scale,scale));
            window.MinimumSize=new Size((int)(916*scale),(int)(690*scale));
            foreach(ColumnHeader column in history.Columns) column.Width=(int)(column.Width*scale);
        }
        window.ResumeLayout(true);
        window.Show();
    }
    void AddButton(FlowLayoutPanel p, string name, Func<Task> action) {
        bool primary = name == "保存设置" || name == "接入 Codex / Claude";
        var b = new Button { Text = name, AutoSize = true, Height=36, MinimumSize=new Size(106,36), Padding=new Padding(10,0,10,0), FlatStyle=FlatStyle.Flat, BackColor=primary?accent:Color.FromArgb(239,244,243), ForeColor=primary?Color.White:ink, Cursor=Cursors.Hand, Margin = new Padding(0,0,10,0) }; b.FlatAppearance.BorderSize=0;
        b.Click += async (s,e) => { if (busy) return; busy = true; b.Enabled = false;
            try { await action(); } catch { if (window != null) status.Text = "操作失败；如配置被其他进程修改，请刷新后重试。"; }
            finally { busy = false; if (!b.IsDisposed) b.Enabled = true; }
        }; p.Controls.Add(b);
    }
    void Populate() {
        token.Text = config.ContainsKey("botToken") ? Convert.ToString(config["botToken"]) : "";
        chat.Text = config.ContainsKey("chatId") ? Convert.ToString(config["chatId"]) : "";
        connection.Text = token.Text.Length > 0 && chat.Text.Length > 0 ? "● 已配置" : "待配置";
        enabled.Checked = Flag(config, "enabled");
        string ev = config.ContainsKey("events") ? json.Serialize(config["events"]) : "task-complete task-error needs-attention";
        complete.Checked = ev.Contains("task-complete"); error.Checked = ev.Contains("task-error"); attention.Checked = ev.Contains("needs-attention");
        var a = config.ContainsKey("agents") ? config["agents"] as Dictionary<string, object> : null;
        a = a ?? new Dictionary<string, object>();
        codex.Checked = Flag(a, "codex"); claude.Checked = Flag(a, "claude"); gemini.Checked = Flag(a, "gemini"); cursor.Checked = Flag(a, "cursor");
        using (var key = Registry.CurrentUser.OpenSubKey(RunKey)) startup.Checked = key != null && key.GetValue("AgentPigeon") != null;
    }
    void SaveForm() {
        if (String.IsNullOrWhiteSpace(token.Text) || String.IsNullOrWhiteSpace(chat.Text)) throw new Exception();
        config["botToken"] = token.Text.Trim(); config["chatId"] = chat.Text.Trim(); config["enabled"] = enabled.Checked;
        var events = new List<string>(); if (complete.Checked) events.Add("task-complete"); if (error.Checked) events.Add("task-error"); if (attention.Checked) events.Add("needs-attention"); config["events"] = events;
        var agents = config.ContainsKey("agents") ? config["agents"] as Dictionary<string, object> : null;
        agents = agents ?? new Dictionary<string, object>(); agents["codex"] = codex.Checked; agents["claude"] = claude.Checked; agents["gemini"] = gemini.Checked; agents["cursor"] = cursor.Checked; config["agents"] = agents;
        SaveConfig();
        using (var key = Registry.CurrentUser.CreateSubKey(RunKey)) {
            if (startup.Checked) key.SetValue("AgentPigeon", "\"" + Application.ExecutablePath + "\""); else key.DeleteValue("AgentPigeon", false);
        }
        status.Text = "设置已保存。";
    }
    async Task<string> Run(string command) {
        return await Task.Run(() => {
            var runtime = json.Deserialize<Dictionary<string, object>>(File.ReadAllText(Path.Combine(root, "runtime.json")));
            var info = new ProcessStartInfo(Convert.ToString(runtime["node"]), "--use-env-proxy \"" + Path.Combine(root, "src", "cli.mjs") + "\" " + command) {
                UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true, StandardOutputEncoding = Encoding.UTF8
            };
            info.EnvironmentVariables["AGENT_PIGEON_HOME"] = home;
            using (var p = Process.Start(info)) {
                var output = p.StandardOutput.ReadToEndAsync(); var errors = p.StandardError.ReadToEndAsync();
                if (!p.WaitForExit(60000)) { p.Kill(); throw new Exception(); }
                Task.WaitAll(output, errors); if (p.ExitCode != 0) throw new Exception(); return output.Result;
            }
        });
    }
    async Task RunAction(string command) {
        try { if(window!=null) status.Text="正在处理，请稍候…"; await Run(command); if (window != null) { status.Text = command=="test"?"测试通知已送达 Telegram。":command.StartsWith("install")?"助手已接入，新会话将使用这些通知设置。":"待送通知已处理。"; await RefreshHistory(); } }
        catch { if (window != null) status.Text = "操作失败，请检查凭据、网络和投递记录。"; else tray.ShowBalloonTip(4000, "AgentPigeon", "操作失败，请打开设置查看投递记录。", ToolTipIcon.Warning); }
    }
    async Task RefreshHistory() {
        try {
            string result = await Run("ui-status"); if (window == null) return;
            var data = json.Deserialize<Dictionary<string, object>>(result);
            foreach (Dictionary<string, object> a in (System.Collections.IEnumerable)data["agents"]) { string id=Convert.ToString(a["id"]); if(agentStates.ContainsKey(id)) { bool connected=Object.Equals(a["installed"],true); agentStates[id].Text=connected?"● 已接入":"尚未接入"; agentStates[id].ForeColor=connected?accent:muted; } }
            history.BeginUpdate(); history.Items.Clear(); int sent=0,pending=0;
            foreach (Dictionary<string, object> row in (System.Collections.IEnumerable)data["recent"]) {
                bool delivered=Convert.ToString(row["state"])=="sent"; if(delivered)sent++;else pending++;
                var time=new DateTime(1970,1,1,0,0,0,DateTimeKind.Utc).AddMilliseconds(Convert.ToDouble(row["updated"])).ToLocalTime();
                var item=new ListViewItem(new string[]{time.ToString("MM-dd HH:mm"),Convert.ToString(row["agent"]),delivered?"已送达":"待送达",Convert.ToString(row["summary"])}); item.ForeColor=delivered?ink:Color.FromArgb(174,116,32); item.ToolTipText=Convert.ToString(row["summary"])+"\nTelegram #"+row["messageId"]; history.Items.Add(item);
            }
            history.EndUpdate(); deliveryCount.Text="最近 "+history.Items.Count+" 条通知    ·    "+sent+" 已送达    ·    "+pending+" 待送达";
        } catch { if (window != null) status.Text = "无法读取投递记录，请检查安装。"; }
    }
}

internal class PigeonSwitch : CheckBox {
    public PigeonSwitch() { SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer, true); }
    protected override void OnPaint(PaintEventArgs e) {
        e.Graphics.Clear(BackColor);
        e.Graphics.SmoothingMode=System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
        float scale=Height/32f;
        e.Graphics.ScaleTransform(scale,scale);
        int y=6;
        using(var brush=new SolidBrush(Checked?Color.FromArgb(22,117,104):Color.FromArgb(201,211,213))) {
            e.Graphics.FillEllipse(brush,0,y,20,20); e.Graphics.FillEllipse(brush,16,y,20,20); e.Graphics.FillRectangle(brush,10,y,16,20);
        }
        using(var white=new SolidBrush(Color.White)) e.Graphics.FillEllipse(white,Checked?19:3,y+3,14,14);
        e.Graphics.ResetTransform();
        int textLeft=(int)(46*scale);
        TextRenderer.DrawText(e.Graphics,Text,Font,new Rectangle(textLeft,0,Math.Max(0,Width-textLeft),Height),ForeColor,BackColor,TextFormatFlags.Left|TextFormatFlags.VerticalCenter);
        if(Focused) ControlPaint.DrawFocusRectangle(e.Graphics,ClientRectangle);
    }
    protected override void OnCheckedChanged(EventArgs e) { base.OnCheckedChanged(e); Invalidate(); }
}
