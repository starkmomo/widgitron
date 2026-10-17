import { useEffect } from "react";
import { isMacOS } from "./platform";

export type UiLanguage = "zh-CN" | "en";

export function resolveLanguage(language?: string): UiLanguage {
  return language === "zh-CN" || (language !== "en" && isMacOS) ? "zh-CN" : "en";
}

// The existing interface contains labels in many independent widgets. Keep the
// source copy intact so the language can be changed live in every Tauri window.
const ZH: Record<string, string> = {
  "SSH config help": "SSH 配置说明", "Slurm help": "Slurm 模式说明",
  "SSH host": "SSH 主机", "Reload SSH hosts": "重新读取 SSH 主机",
  "Reading SSH config…": "正在读取 SSH 配置…", "Filling SSH host…": "正在填入 SSH 主机…",
  "Select SSH host…": "选择 SSH 主机…", "No SSH hosts found": "未找到 SSH 主机",
  "Could not read SSH config. You can still enter an alias manually.": "读取 SSH 配置失败，仍可手动输入主机别名。",
  "Conference DDL": "会议截止", "arXiv Radar": "arXiv 雷达",
  "To read": "待看", "Show To read": "查看待看", "monitors": "监控项", "GPUs": "GPU", "conferences": "场会议", "papers to read": "篇待看论文",
  "Add keywords to fill To read.": "添加关键词后，匹配的论文会进入待看。",
  "Without keywords, To read stays empty. Browse All to explore papers.": "未设置关键词时，待看保持为空。可到“全部”浏览论文。",
  "No papers to read. Adjust keywords or check back later.": "暂无待看论文。可调整关键词或稍后再来。",
  "Keywords send matching papers to To read. Without keywords, To read stays empty.": "设置关键词后，匹配的论文进入“待看”；不设关键词时，待看保持为空。",
  "Browse All by category and date, without keyword filtering.": "“全部”按分类和日期浏览，不受关键词筛选影响。",
  "Keywords only affect To read.": "关键词仅用于“待看”。",
  "Without keywords, To read stays empty. All ignores keywords.": "未设置关键词时，待看保持为空；“全部”不受关键词筛选影响。",
  "Swipe hints": "滑动提示", "Show swipe hints on cards": "卡片内显示滑动提示",
  "Duplicate to customize colors.": "复制预设后可自定义颜色。",
  "followed": "已关注", "recent papers": "篇近期论文",
  "to read": "待看", "recent": "近期",
  "No keywords configured": "尚未设置关键词", "Add keywords in Paper filters to fill To read.": "请在“论文筛选”中设置关键词，匹配论文后即可查看待看。",
  "Check back later for matching papers.": "稍后再来查看匹配的论文。",
  "Keywords update when you close filters.": "收起筛选后更新关键词。",
  "Keywords update when you leave this settings tab.": "离开此设置栏目后更新关键词。",
  "Applying conference filters…": "正在保存并更新会议列表…", "Conference filters applied.": "会议筛选已生效。",
  "Saving filters and updating To read…": "正在保存筛选并更新待看…", "To read updated.": "待看已更新。",
  "To read is empty. Browse All without keywords.": "待看已清空；未设置关键词时，可到“全部”浏览。",
  "Filters saved. Enable monitoring to update To read.": "筛选已保存；开启监控后更新待看。",
  "Could not save filters. Please try again.": "筛选保存失败，请重试。",
  "Filters saved, but the list could not be updated. Try again.": "筛选已保存，但列表更新失败，请重试。",
  "Conference deadlines": "会议截止", "Ignored conferences": "已忽略的会议", "Close ignored conferences": "关闭已忽略的会议",
  "Select current page": "全选当前页", "Save selected papers": "收藏所选", "Unsave selected papers": "取消所选收藏",
  "Ignore selected papers": "忽略所选", "Return selected papers": "放回所选",
  "Bookmark": "收藏", "Save paper": "收藏论文", "Ignore": "忽略", "← Ignore": "← 忽略",
  "Ignored papers": "已忽略的论文", "Close ignored papers": "关闭已忽略的论文", "Return to reading list": "放回待看",
  "No ignored papers in this batch.": "这批论文没有已忽略的内容。",
  "Could not update paper. Please try again.": "论文操作未成功，请重试。", "Dismiss error": "关闭提示",
  "No saved papers yet. Use Bookmark on a paper to keep it here.": "暂无收藏。点击论文上的“收藏”即可保存在这里。",
  "Test build": "测试版",
  "Overview": "总览", "Dashboard": "主界面", "Settings": "设置", "About": "关于",
  "General": "通用", "General Settings": "通用设置", "Sidebar": "侧边栏",
  "Sidebar Settings": "侧边栏设置", "Quota Monitor": "额度监控",
  "Quota monitor settings": "额度监控设置", "Quota monitor options for this software": "此软件的额度监控选项",
  "Use a local IDE login, or paste an API key when the provider supports it.": "使用本地 IDE 登录；服务商支持时也可填写 API 密钥。",
  "Agent & API Quotas": "Agent 与 API 额度", "GPU Monitor": "GPU 监控",
  "GPU Monitor Status": "GPU 监控状态", "Paper Deadlines": "论文截止日期",
  "Deadlines": "截止日期", "Arxiv Radar": "arXiv 雷达",
  "Quick Launch Widgets": "独立浮窗", "Independent Widgets": "独立浮窗", "Open Sidebar": "打开侧边栏",
  "Close Sidebar": "关闭侧边栏", "Close sidebar": "关闭侧边栏",
  "Hide settings": "收起设置", "Close settings": "关闭设置",
  "Add the Paper Deadlines widget in Notification Center.": "请在通知中心添加“论文截止日期”小组件。",
  "Show Quota Monitor in sidebar": "在侧边栏显示额度监控",
  "Show GPU Monitor in sidebar": "在侧边栏显示 GPU 监控",
  "Show Deadlines in sidebar": "在侧边栏显示截止日期",
  "Show Arxiv Radar in sidebar": "在侧边栏显示 arXiv 雷达",
  "Modules & Display": "模块与显示", "Configure": "配置", "Updating…": "更新中…",
  "GPU monitoring": "GPU 监控开关", "Deadline monitoring": "截止日期监控开关",
  "Arxiv monitoring": "arXiv 监控开关", "Quota monitoring": "额度监控开关",
  "Sidebar On": "侧栏 开", "Sidebar Off": "侧栏 关",
  "Window On": "浮窗 开", "Window Off": "浮窗 关",
  "Move to Desktop": "固定到桌面",
  "Sidebar: Shown": "侧边栏：显示", "Sidebar: Hidden": "侧边栏：隐藏",
  "Floating window: Shown": "独立浮窗：显示", "Floating window: Hidden": "独立浮窗：隐藏",
  "Turn on data collection to open a floating window.": "启用数据采集后才能打开独立浮窗。",
  "Fixed on desktop": "已固定在桌面", "Fix floating window on desktop": "将浮窗固定在桌面",
  "Unpin (Embed in Desktop)": "取消置顶并固定到桌面",
  "Choose which modules collect data and where they appear. The menu bar icon reopens this window or the sidebar.": "选择哪些模块采集数据，以及它们的显示位置。菜单栏图标可重新打开主界面或侧边栏。",
  "Native macOS widgets are unavailable in this build. Fix on Desktop keeps a floating window on the desktop; it does not add a Notification Center widget.": "此版本尚不支持原生 macOS 小组件。“固定到桌面”只会固定浮窗，不会将其添加到通知中心。",
  "This build includes a native quota widget. Open Notification Center → Edit Widgets and search for Widgitron.": "此版本包含原生额度小组件。请打开通知中心 → 编辑小组件，搜索 Widgitron。",
  "This build includes native quota, GPU, and deadline widgets. Open Notification Center → Edit Widgets and search for Widgitron.": "此版本包含原生额度、GPU 和论文截止日期小组件。请打开通知中心 → 编辑小组件，搜索 Widgitron。",
  "System widgets: Quota · GPU · Deadlines. Add from Notification Center.": "系统小组件：额度 · GPU · 截止日期。可在通知中心添加。",
  "macOS widgets: Quota · GPU · Deadlines": "macOS 小组件：额度 · GPU · 截止日期",
  "System widgets unavailable in this build.": "此版本没有系统小组件。",
  "Track AI agent and API limits": "监控 AI Agent 和 API 额度",
  "Monitor GPUs and cluster jobs": "监控 GPU 和集群任务",
  "Track conference submission deadlines": "追踪会议投稿截止日期",
  "Discover recent research papers": "发现最新研究论文",
  "No GPU data yet. Add an SSH server to start monitoring.": "暂无 GPU 数据。添加 SSH 服务器以开始监控。",
  "No GPU detected": "未检测到可监控的 GPU",
  "Add quota monitor": "添加额度监控", "Filter conferences": "筛选会议", "Filter papers": "筛选论文", "Paper filters": "论文筛选", "Conference filters": "会议筛选", "Hide filters": "收起筛选", "Close filters": "关闭筛选", "Edit keywords": "编辑关键词",
  "No recent papers in the selected category. Try another category or refresh later.": "所选分类暂无近期论文。可切换分类或稍后刷新。",
  "Choose category": "选择分类", "No recent papers": "暂无近期论文",
  "Try another category or refresh later.": "可切换分类或稍后刷新。",
  "All papers": "全部论文", "Optional keywords": "关键词（可选）",
  "No quota sources configured yet.": "尚未配置额度来源。",
  "Add server": "添加服务器", "Add quota source": "添加额度来源",
  "Remind me": "提醒我", "Reminding": "提醒中", "Stop reminding me": "取消提醒",
  "Select Remind me on a conference to show its nearest deadline in the macOS widget. The small widget shows two; the medium widget shows three.": "点击会议的“提醒我”，即可在 macOS 小组件中查看最近的截止日期。小号显示 2 个，中号显示 3 个。",
  "Adjust filters": "调整筛选", "Adjust keywords": "调整关键词", "Show latest": "查看最新",
  "No new papers. Adjust keywords or wait for the next update.": "暂无新论文。可调整关键词或等待下次更新。",
  "No saved papers yet. Swipe right on a paper to save it.": "暂无收藏论文。在论文卡片上右滑即可收藏。",
  "No discarded papers. Swipe left on a paper to discard it.": "暂无忽略论文。在论文卡片上左滑即可忽略。",
  "Interface Language": "界面语言",
  "Change the language in the dashboard, sidebar, and widgets.": "切换主界面、侧边栏和浮窗的显示语言。",
  "The sidebar groups all modules in one place. Open independent floating widgets only when needed; use the menu bar icon to reopen this window or the sidebar.": "侧边栏集中显示各模块；需要时再打开独立浮窗。菜单栏图标可以重新打开主界面或侧边栏。",
  "The system quota widget is still in development. Use Fix on Desktop to keep the quota window on the desktop.": "系统额度小组件仍在开发中。当前可用“固定到桌面”将额度浮窗保留在桌面。",
  "Track AI agent & API limits on your desktop": "在桌面查看 AI Agent 与 API 额度",
  "Floating desktop monitoring for GPU clusters": "在桌面监控 GPU 集群",
  "Track conference deadlines on your desktop": "在桌面查看会议截止日期",
  "Swipe to discover latest research papers": "滑动浏览最新研究论文",
  "GPU Monitor Widget": "GPU 监控浮窗", "Paper Deadlines Widget": "论文截止日期浮窗",
  "Arxiv Radar Widget": "arXiv 雷达浮窗", "Quota Monitor Widget": "额度监控浮窗",
  "Hide All Widgets": "隐藏全部浮窗", "Hide Widget": "隐藏浮窗",
  "Show Widget": "显示浮窗", "Active": "已显示", "Ready": "未显示",
  "Total GPUs": "GPU 总数", "Active Deadlines": "待截止日期",
  "ALL SERVERS OFFLINE": "全部服务器离线", "All servers offline": "全部服务器离线",
  "Refresh failed": "刷新失败", "Refresh failed · cached": "刷新失败 · 显示缓存",
  "Update failed": "更新失败", "Update failed · cached": "更新失败 · 显示缓存",
  "Update failed — showing cached GPU data.": "更新失败，正在显示缓存的 GPU 数据。",
  "Refresh failed — showing cached GPU data.": "刷新失败，正在显示缓存的 GPU 数据。",
  "Update failed — showing cached deadlines.": "更新失败，正在显示缓存的截止日期。",
  "Refresh failed — showing cached deadlines.": "刷新失败，正在显示缓存的截止日期。",
  "Update failed — showing cached papers.": "更新失败，正在显示缓存的论文。",
  "Refresh failed — showing cached papers.": "刷新失败，正在显示缓存的论文。",
  "Update failed — showing cached quota data.": "更新失败，正在显示缓存的额度数据。",
  "Refresh failed — showing cached quota data.": "刷新失败，正在显示缓存的额度数据。",
  "7d Usage": "7 天用量",
  "Monitored Agents": "监控的 Agent", "No Sidebar Widgets": "侧边栏暂无模块",
  "Open Settings": "打开设置", "No Agents Configured": "尚未配置 Agent",
  "No Servers Configured": "尚未配置服务器", "No Conferences Tracked": "尚未关注会议",
  "No Upcoming Deadlines": "暂无即将截止的日期",
  "No upcoming deadlines for the selected conferences.": "已关注的会议暂无即将截止的日期。",
  "Select Remind me or pin a deadline on the main page.": "请在主界面选择“提醒我”或固定一个截止日期。",
  "No active data. Configure servers in Settings.": "暂无数据，请在设置中配置服务器。",
  "No agents configured. Go to Settings to add one.": "尚未配置 Agent，请到设置中添加。",
  "No deadlines match your current filters.": "当前筛选条件下没有截止日期。",
  "Open Settings → GPU Monitor to add SSH hosts.": "到设置 → GPU 监控中添加 SSH 主机。",
  "Open the main window Settings → Quota Monitor to add providers.": "到主窗口的设置 → 额度监控中添加服务商。",
  "Adjust filters in Settings → Paper Deadlines.": "到设置 → 会议截止中调整筛选条件。",
  "Enable monitoring on the module page.": "请在对应模块页面开启监控。",
  "All caught up!": "已全部查看", "Check back later for new papers in CS.": "稍后再来看新的计算机科学论文。",
  "Latest": "最新", "Saved": "已收藏", "Discarded": "已忽略",
  "All": "全部", "All keywords": "全部关键词", "Back": "返回", "More": "更多", "Less": "收起",
  "Recent": "最近", "Choose submission date": "选择提交日期",
  "Submission date (UTC)": "提交日期（UTC）", "Show recent papers": "查看最近论文",
  "View papers": "查看论文",
  "Previous page": "上一页", "Next page": "下一页", "Paper pagination": "论文翻页",
  "Loading papers": "正在加载论文", "Loading papers…": "正在加载论文…",
  "No papers matched your keywords on this submission date.": "该提交日期没有匹配关键词的论文。",
  "No papers in the selected categories on this submission date.": "该提交日期下，所选分类暂无论文。",
  "Choose another date or view recent papers. Submissions not yet announced may appear later.": "可换一天或查看最近论文；尚未公布的投稿可能稍后出现。",
  "All papers in the selected categories, without keyword filtering.": "所选分类的全部论文，不按关键词筛选。",
  "Could not load papers. Please retry.": "论文加载失败，请重试。",
  "No papers found in the selected categories.": "所选分类暂无论文。",
  "New": "新增", "Open": "打开", "Close": "关闭", "Delete": "删除", "Delete?": "确认删除？",
  "Copy": "复制", "Copied": "已复制", "Edit": "编辑", "Save": "保存", "Reset": "重置",
  "Refresh All": "全部刷新", "Refresh Deadlines": "刷新截止日期",
  "Refresh Quotas": "刷新额度", "Refresh all GPU servers": "刷新所有 GPU 服务器",
  "Refresh arxiv papers": "刷新 arXiv 论文", "Refresh paper deadlines": "刷新论文截止日期",
  "Refresh papers": "刷新论文", "Refresh quotas": "刷新额度",
  "Restart GPU workers": "重启 GPU 监控", "Service Enabled": "服务已启用",
  "Service Disabled": "服务已关闭", "Enabled": "已启用", "Disabled": "已关闭",
  "Yes": "是", "No": "否", "Online": "在线", "Offline": "离线", "Offline · cached": "离线 · 缓存",
  "Waiting for backend...": "正在等待后台服务…", "No jobs in queue": "队列中没有任务",
  "My jobs": "我的任务", "All users": "所有用户", "Mine": "我的",
  "Queue": "队列", "Memory": "显存", "Temp": "温度", "Job Run Time": "任务运行时间",
  "Open PDF ↑": "打开 PDF ↑", "Open paper": "打开论文", "Remove from saved": "取消收藏",
  "Open arXiv ↑": "打开 arXiv ↑", "Open arXiv": "arXiv 页面",
  "Open arXiv page": "打开 arXiv 页面", "Download PDF": "下载 PDF",
  "Download PDF to Downloads": "下载 PDF 到下载文件夹", "Downloading…": "下载中…",
  "Saved to Downloads": "已保存到下载文件夹",
  "Full abstract": "完整摘要", "Close abstract": "关闭摘要",
  "Could not open arXiv page.": "无法打开 arXiv 页面。",
  "Could not download PDF. Try again.": "PDF 下载失败，请重试。",
  "Delete permanently": "永久删除", "← Discard": "← 忽略", "Save →": "收藏 →",
  "Dashboard Theme": "主界面主题",
  "Choose between light and dark mode for the control panel.": "选择主界面的浅色或深色外观。",
  "Light": "浅色", "Dark": "深色", "Widget & Sidebar Scale": "浮窗与侧边栏缩放",
  "Widget and sidebar scale": "浮窗与侧边栏缩放",
  "Scales desktop widgets and the sidebar to match your display. Dashboard always stays at 100%.": "调整浮窗和侧边栏大小以适应屏幕，主界面始终保持 100%。",
  "Launch at Startup": "登录时启动", "Automatically start Widgitron when you log in to Windows.": "登录系统时自动启动 Widgitron。",
  "Automatically start Widgitron when you log in.": "登录系统时自动启动 Widgitron。",
  "Hide Dashboard on Startup": "启动时隐藏主界面",
  "Keep the control panel hidden in the system tray when the app starts.": "应用启动后仅显示在菜单栏。",
  "App Diagnostic Logs": "应用诊断日志",
  "Open the log folder to view runtime logs and troubleshoot issues.": "打开日志文件夹以查看运行记录和排查问题。",
  "Open Log Folder": "打开日志文件夹", "Dock Edge": "停靠边缘",
  "Reveal Sidebar": "打开侧边栏", "Slide the docked widget hub into view.": "显示汇集各模块的侧边栏。",
  "Choose an edge here, or drag the sidebar header near any screen edge to snap it there.": "选择停靠边缘，或拖动侧边栏顶部靠近屏幕边缘。",
  "Choose the screen edge where the sidebar opens.": "选择侧边栏打开时所靠近的屏幕边缘。",
  "Left": "左", "Top": "上", "Right": "右", "Bottom": "下",
  "Pin Display": "保持显示", "Keep the sidebar pinned open instead of hiding when the pointer leaves.": "让侧边栏保持打开。",
  "Open the sidebar automatically when Widgitron starts.": "Widgitron 启动时自动打开侧边栏。",
  "Reveal sensitivity": "唤出灵敏度", "Hide sensitivity": "收起灵敏度",
  "How easily the edge opens the sidebar. Default (4) is conservative.": "调整触碰屏幕边缘时侧边栏的唤出灵敏度。",
  "How quickly it collapses after the pointer leaves. Default (8) is snappy.": "调整指针离开后的收起速度。",
  "Pin Shortcut": "固定快捷键", "Click the recorder, then press a shortcut to toggle pinned display from anywhere.": "点击录制器，再按快捷键切换固定显示。",
  "Press shortcut...": "请按快捷键…", "Esc cancels": "Esc 取消", "Record": "录制",
  "Sidebar Widgets": "侧边栏模块", "Choose which modules appear inside the summonable sidebar.": "选择在侧边栏中显示的模块。",
  "Hide Widget Headers": "隐藏模块标题",
  "Hide each widget's icon, title, status, and refresh row for a denser layout.": "隐藏图标、标题、状态和刷新栏，让布局更紧凑。",
  "Sidebar Theme": "侧边栏主题", "Surface": "背景", "Header": "标题栏",
  "Surface opacity": "背景不透明度", "Header opacity": "标题栏不透明度",
  "Card opacity": "卡片不透明度", "Frosted blur": "磨砂模糊",
  "Changes update the sidebar immediately.": "更改会立即应用到侧边栏。",
  "Theme & Styling": "主题与样式", "Widget Themes": "浮窗主题",
  "Assign Theme to Widgets": "为浮窗分配主题", "Create Theme": "创建主题",
  "Duplicate Theme": "复制主题", "Editing Custom Theme": "编辑自定义主题",
  "Duplicate": "复制", "Built-in": "内置", "Night": "深色",
  "The focused dark sidebar look.": "高对比度深色侧边栏。",
  "A softly translucent white frosted-glass surface.": "高可读性的浅色磨砂侧边栏。",
  "Quota Default": "额度默认", "Quota Transparent": "额度透明",
  "GPU Default": "GPU 默认", "GPU Transparent": "GPU 透明",
  "Deadline Default": "截止日期默认", "Deadline Transparent": "截止日期透明",
  "Arxiv Radar Default": "arXiv 默认", "Arxiv Transparent": "arXiv 透明",
  "This theme is a read-only system preset. Click": "这是只读的系统预设。点击",
  "to customize colors for this widget.": "即可为这个浮窗自定义颜色。",
  "Use": "使用", "on a built-in theme to make an editable personal version.": "复制内置主题后可编辑个人版本。",
  "System Preset": "系统预设", "Preset": "预设", "Unassigned": "未分配",
  "Background": "背景", "Background Color": "背景颜色",
  "Background & Text Colors": "背景与文字颜色", "Color Configuration": "颜色配置",
  "Main Text": "主文字", "Sub Text": "次要文字", "Main Text Color": "主文字颜色",
  "Sub Text Color": "次要文字颜色", "Primary Colors": "主色调",
  "Theme Name": "主题名称", "Opacity": "不透明度",
  "This theme is read-only. You can assign it to widgets below.": "此主题为只读预设，可以分配给下方浮窗。",
  "Start from a built-in look, then copy it to create an editable personal theme.": "选择内置样式后复制，即可创建可编辑的个人主题。",
  "Add New Server": "添加服务器", "Host / IP": "主机名 / IP",
  "Username": "用户名", "Password": "密码", "Port": "端口",
  "Use ~/.ssh/config": "使用 ~/.ssh/config", "Slurm Cluster Mode": "Slurm 集群模式",
  "Enables job-based monitoring via squeue & srun": "通过 squeue 和 srun 监控任务。",
  "Show squeue list": "显示 squeue 列表", "Toggle squeue task list": "切换 squeue 任务列表",
  "Compact Style": "紧凑样式", "Target CCF Ranks": "目标 CCF 等级",
  "Target CORE Ranks": "目标 CORE 等级", "Subscribed Conferences": "关注的会议",
  "Research Category": "研究类别", "Research Edition": "研究版本",
  "Keywords (Comma separated)": "关键词（用逗号分隔）",
  "Arxiv Proxy": "arXiv 代理",
  "Optional proxy URL used only when fetching arxiv papers. Leave blank to connect directly.": "只在抓取 arXiv 论文时使用；留空则直连。",
  "Add New Quota Monitor": "添加额度监控", "Choose a provider": "选择服务商",
  "Hide providers": "收起服务商列表", "Authentication": "认证方式",
  "Local": "本地登录", "API Key": "API 密钥", "API URL": "API 地址",
  "Custom Endpoint": "自定义端点", "Show Account Name": "显示账号名称",
  "Display email or account name in the widget": "在浮窗中显示邮箱或账号名称。",
  "Show Plan Type": "显示套餐类型", "Display plan or subscription tier in the widget": "在浮窗中显示套餐或订阅级别。",
  "Show Interaction Hints": "显示操作提示",
  "Display swipe instructions at the bottom of cards": "在卡片底部显示滑动操作提示。",
  "Analytics Visualizations": "额度图表", "Update Interval (Hours)": "更新间隔（小时）",
  "Max Quota": "额度上限", "Edit directly": "直接编辑", "Add 1 count": "增加 1 次",
  "Use 1 count": "使用 1 次", "Current version": "当前版本",
  "Software Update": "软件更新", "Check for Updates": "检查更新",
  "Update Available": "有可用更新", "Download and Install Update": "下载并安装更新",
  "Retry Download": "重试下载", "Downloading...": "正在下载…",
  "Download completed. Launching installer...": "下载完成，正在启动安装程序…",
  "Config Directory": "配置目录", "Corrupt Config Backups": "损坏配置备份",
  "Open Config Folder": "打开配置文件夹", "Copy Job ID": "复制任务 ID",
  "Drag sidebar": "拖动侧边栏",
  "Pin sidebar open": "固定侧边栏", "Unpin sidebar": "取消固定侧边栏",
  "Unpin sidebar and enable auto-hide": "取消固定并启用自动收起",
  "Restore Position": "恢复位置", "Unlock to move": "解锁后拖动",
  "Resize widget": "调整浮窗大小",
  "Lock position": "锁定位置", "Keep above other windows": "置于其他窗口之上",
  "Keep in normal window order": "恢复普通窗口层级", "Hide widget": "隐藏浮窗",
  "Fix on Desktop": "固定到桌面", "Desktop": "桌面", "On Desktop": "已固定到桌面",
  "Return to floating window": "恢复浮窗",
  "GPU Light": "GPU 浅色", "Deadline Light": "截止日期浅色",
  "Arxiv Radar Light": "arXiv 浅色", "Quota Light": "额度浅色",
  "Categories": "研究领域", "Graphics": "图形学", "Security": "安全", "Network": "网络", "Systems": "系统",
  "Deadline (UTC)": "截止时间（UTC）", "GPUs Detected": "检测到的 GPU",
  "Deadline details": "截止说明",
  "Deadline type not specified": "截止类型未注明",
  "View timeline": "查看时间线", "Hide timeline": "收起时间线",
  "Local time": "本地时间", "Next deadline": "下一截止节点",
  "Passed": "已截止", "Time to be confirmed": "时间待确认",
  "Pin this conference to widget": "将该会议固定到浮窗",
  "Unpin this conference from widget": "从浮窗取消固定该会议",
  "Job:": "任务：", "JOB:": "任务：", "jobs": "个任务", "papers": "篇论文",
  "Load": "负载", "Move": "移动", "Name": "名称", "JSON Path": "JSON 路径",
  "Last Update:": "上次更新：", "Reset:": "重置：", "Never": "从未更新",
  "Remaining": "剩余",
  "% remaining": "% 剩余", "used": "已使用", "Server #": "服务器 #",
  "No new papers. Adjust keywords in Settings or wait for update.": "暂无新论文，可在设置中调整关键词或等待更新。",
  "No saved papers yet. Swipe right on the widget to save!": "还没有收藏论文，在浮窗中向右滑动即可收藏。",
  "No discarded papers. Swipe left on the widget to discard.": "还没有忽略的论文，在浮窗中向左滑动即可忽略。",
  "Pin this deadline to widget": "将该截止日期固定到浮窗",
  "Unpin this deadline from widget": "从浮窗取消固定该截止日期",
  "Subscribe conference": "关注会议", "Unsubscribe conference": "取消关注会议",
  "Follow": "关注", "Followed": "已关注", "Ignored": "已忽略",
  "Follow conference": "关注会议", "Unfollow conference": "取消关注会议",
  "Ignore conference": "忽略会议", "Restore conference": "恢复会议",
  "Conference lists": "会议列表", "Search conferences": "搜索会议",
  "Search acronym or full name": "搜索会议缩写或英文全称", "Clear search": "清除搜索",
  "Follow a conference on the main page to show it here.": "在主界面关注会议后，即可在此显示。",
  "No conferences found.": "未找到匹配的会议。", "No followed conferences.": "还没有关注的会议。",
  "No ignored conferences.": "还没有忽略的会议。", "View all conferences": "查看全部会议",
  "Could not save conference preferences. Please try again.": "会议偏好保存失败，请重试。",
  "Select": "批量选择", "Done": "完成", "Bulk selection": "批量选择", "Bulk manage": "批量管理", "Finish selecting": "完成选择",
  "Clear expired": "清理已过期", "Unfollow all": "取消全部关注", "Restore all ignored": "恢复全部已忽略",
  "Undo": "撤销", "Conference selection updated": "会议选择已更新", "Conference changes": "会议操作提示", "Paper views": "论文列表",
  "Deselect all": "取消全选",
  "Select current results": "全选当前结果", "Selected": "已选择",
  "Follow selected": "关注所选", "Unfollow selected": "取消关注所选",
  "Ignore selected": "忽略所选", "Restore selected": "恢复所选",
  "Expired": "已过期", "No deadline data available": "暂无截止日期数据",
  "Page settings": "页面设置",
  "Non CCF": "非 CCF", "Non Core": "非 CORE", "Non CORE": "非 CORE",
  "Optional charts for this monitor — heatmap, daily bars, and model breakdown. Enabling these may slow quota refresh slightly.": "可选额度图表：活跃热力图、每日柱状图和模型明细。启用后额度刷新可能略慢。",
  "Calendar heatmap": "日历热力图", "GitHub-style 12-week activity grid": "过去 12 周的活跃热力图",
  "Daily bars": "每日柱状图", "Last 14 days as mini bar chart": "过去 14 天的迷你柱状图",
  "Model breakdown": "模型明细", "Top models by cost or tokens": "按花费或 Token 显示主要模型",
  "Heatmap metric": "热力图指标", "Bars metric": "柱状图指标",
  "Model breakdown metric": "模型明细指标", "Queries": "请求数", "Tokens": "Token 数",
  "Daily queries": "每日请求数", "Daily tokens": "每日 Token 数",
  "By model ($)": "各模型花费（$）", "By model (tokens)": "各模型 Token 用量",
  "Host can be an SSH config alias; OpenSSH resolved HostName, User, Port and IdentityFile are applied.": "主机可以是 SSH 配置中的别名；会使用 OpenSSH 解析出的主机名、用户名、端口和密钥文件。",
  "Show 8 GPUs per row with full progress indicator backgrounds, vertical stacked labels, hiding index numbers.": "每行显示 8 张 GPU，以完整进度背景和纵向标签呈现，并隐藏序号。",
  "Sidebar hide sensitivity": "侧边栏收起灵敏度", "Sidebar reveal sensitivity": "侧边栏唤出灵敏度",
  "Some config files could not be parsed and were renamed with a": "部分配置文件无法解析，已重命名并添加",
  "suffix. Widgitron is using defaults until you fix or remove them.": "后缀。修复或移除这些文件前，Widgitron 会使用默认配置。",
  "Check your network connection or try again later. You can also download updates manually from GitHub Releases.": "请检查网络连接或稍后重试；也可以到 GitHub Releases 手动下载更新。",
  "Check Now": "立即检查", "Checking...": "检查中…",
  "Check to see if updates are available.": "检查是否有可用更新。",
  "Your software is up to date.": "当前已是最新版本。",
  "Update Available:": "发现新版本：", "Current version:": "当前版本：",
  "Release Notes:": "更新说明：", "Engine": "技术栈", "Developer": "开发者",
  "Stable": "稳定版", "System Preset:": "系统预设：", "Used by:": "使用此主题：",
  "Widgitron is a modular desktop widget framework designed for researchers and developers. It is completely free and open-source, available at": "Widgitron 是面向研究人员和开发者的模块化桌面浮窗工具，免费开源。项目地址：",
  "Antigravity IDE not running — launch it to refresh quota locally.": "Antigravity IDE 未运行；启动后即可在本地刷新额度。",
  "Antigravity IDE not running — launch it, or add": "Antigravity IDE 未运行；请启动它，或添加",
  "Antigravity not ready — sign in via the IDE or configure OAuth at": "Antigravity 尚未就绪；请在 IDE 中登录，或在以下路径配置 OAuth：",
  "Click +/- to adjust by 1": "点击 +/− 每次调整 1",
  "Double click to edit value": "双击编辑数值",
  "Exit": "退出", "Quit": "退出", "Dismiss": "关闭",
  "Assign": "分配", "Custom": "自定义", "Usage": "用量",
  "Dock target ready": "已到达停靠位置", "Moving sidebar": "正在移动侧边栏",
  "Unknown Author": "未知作者", "SYSTEM": "系统",
  "Your editable sidebar theme.": "你可以编辑的侧边栏主题。",
};

function translated(source: string): string {
  const whitespace = source.match(/^(\s*)([\s\S]*?)(\s*)$/);
  if (!whitespace) return source;
  const [, before, core, after] = whitespace;
  const normalized = core.replace(/\s+/g, " ").trim();
  if (ZH[normalized]) return before + ZH[normalized] + after;
  const count = core.match(/^(All|Latest|Saved|Discarded) \((\d+)\)$/);
  if (count) return `${before}${ZH[count[1]]} (${count[2]})${after}`;
  const online = core.match(/^(\d+)\/(\d+) servers online$/i);
  if (online) return `${before}${online[1]}/${online[2]} 台服务器在线${after}`;
  const stale = core.match(/^(\d+) showing cached$/i);
  if (stale) return `${before}${stale[1]} 项显示缓存${after}`;
  const errors = core.match(/^(\d+) update errors?$/i);
  if (errors) return `${before}${errors[1]} 项更新失败${after}`;
  const backoff = core.match(/^Backing off (\d+)s$/i);
  if (backoff) return `${before}${backoff[1]} 秒后重试${after}`;
  const latestVersion = normalized.match(/^You are on the latest version \(([^)]+)\)\.$/);
  if (latestVersion) return `${before}当前已是最新版本（${latestVersion[1]}）。${after}`;
  return source;
}

type TextRecord = { source: string; rendered: string };
const textRecords = new WeakMap<Text, TextRecord>();
const attributeRecords = new WeakMap<Element, Map<string, TextRecord>>();
const ATTRIBUTES = ["title", "aria-label", "placeholder"] as const;

function localizeText(node: Text, language: UiLanguage) {
  if (node.parentElement?.closest("script,style,textarea,code,pre,[data-no-localize]")) return;
  const previous = textRecords.get(node);
  const source = previous && node.data === previous.rendered ? previous.source : node.data;
  const rendered = language === "zh-CN" ? translated(source) : source;
  textRecords.set(node, { source, rendered });
  if (node.data !== rendered) node.data = rendered;
}

function localizeAttributes(element: Element, language: UiLanguage) {
  const records = attributeRecords.get(element) ?? new Map<string, TextRecord>();
  for (const name of ATTRIBUTES) {
    const value = element.getAttribute(name);
    if (value === null) continue;
    const previous = records.get(name);
    const source = previous && value === previous.rendered ? previous.source : value;
    const rendered = language === "zh-CN" ? translated(source) : source;
    records.set(name, { source, rendered });
    if (value !== rendered) element.setAttribute(name, rendered);
  }
  attributeRecords.set(element, records);
}

function localizeTree(root: Node, language: UiLanguage) {
  if (root.nodeType === Node.TEXT_NODE) {
    localizeText(root as Text, language);
    return;
  }
  if (!(root instanceof Element)) return;
  localizeAttributes(root, language);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node.nodeType === Node.TEXT_NODE) localizeText(node as Text, language);
    else localizeAttributes(node as Element, language);
  }
}

export function useUiLocalization(language: UiLanguage) {
  useEffect(() => {
    document.documentElement.lang = language;
    localizeTree(document.body, language);
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "characterData") localizeTree(mutation.target, language);
        else if (mutation.type === "attributes") localizeAttributes(mutation.target as Element, language);
        else mutation.addedNodes.forEach((node) => localizeTree(node, language));
      }
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: [...ATTRIBUTES],
    });
    return () => observer.disconnect();
  }, [language]);
}
