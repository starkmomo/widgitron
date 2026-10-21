# Changelog

## [Unreleased] - 2026-10-22

### 中文

#### arXiv 雷达

- **浏览与筛选**：提供“全部 / 待看 / 已收藏”和 UTC 提交日期选择，支持每页 100 篇翻页与缓存。全部不受关键词影响；待看仅收集关键词匹配项，无关键词时为空。区分无论文与请求失败，刷新失败保留缓存。
- **关键词输入**：改为可添加、删除的标签，支持回车及中英文逗号、分号、换行分隔。收起页面筛选或离开设置栏目后自动保存并更新，提供加载、成功及失败反馈。
- **刷新控制**：关键词增删复用按词缓存，仅查询缺失项并保留其他论文；显示选项和更新间隔不再触发即时请求。合并重复刷新，丢弃过期筛选结果，失败后退避重试。浮窗与侧边栏保留缓存，只以小图标提示失败。
- **收藏与忽略**：卡片可直接收藏、忽略，各列表支持批量操作。已忽略内容通过小字入口打开管理弹窗，可恢复或收藏；忽略记录仅保留当前批次，收藏长期保存，兼容原有记录。
- **阅读与下载**：完整标题下显示作者，摘要预览随可用高度调整，阅读面板补齐全部作者和提交日期。打开 arXiv 页面与下载 PDF 分为两个按钮，下载不覆盖同名文件；浮窗和侧边栏的收藏、忽略按钮使用轻底色，关键词下拉同步卡片背景设置。

#### 会议截止

- **会议时间线**：每届会议显示一张卡片，倒计时自动跟随最近的未截止阶段，展开可查看完整时间线。阶段名称与备注保留英文，截止时间按本地时区显示，日期格式跟随界面语言。
- **搜索与关注**：支持缩写、全称、年份搜索及研究领域、CCF、CORE 筛选。置顶和提醒合并为“关注”，保留旧选择；关注、忽略按届次保存，支持批量管理、过期清理和撤销。关注的会议同步显示于侧边栏、浮窗和系统小组件。
- **数据刷新**：更新截止日期数据源，增加备用源与压缩响应支持，修复解析失败；刷新失败继续显示缓存并提示原因。

#### 浮窗与侧边栏

- **外观设置**：四个浮窗的主题集中管理，提供跟随主界面、浅色、深色、透明和玻璃，以及多个自定义主题。支持新建、复制、删除确认和卡片背景自定义，使用紧凑等高预览；侧边栏主题独立选择，编辑面板可展开、收起。
- **玻璃与阅读**：优化玻璃配色、文字对比度和圆角高光，减少重复底色与失焦变色。macOS 的玻璃主题升级为“液态玻璃”，背景与卡片默认使用 8% 黑色衬底，失焦保留效果；Windows 保持原有玻璃主题。修复主题切换时内容消失。关键词菜单和完整摘要匹配当前主题，虚化后方内容并保留圆角；菜单支持外部点击、Esc 收起，展开时阻断卡片手势。收紧摘要行距，保留滚动阅读。
- **尺寸与排版**：侧边栏模块标题与操作合入彩色顶栏。额度、GPU、会议的浮窗和侧边栏最小高度按首张卡片实测，侧边栏最大高度随完整内容变化，仅从底边调整高度；会议时间线展开时自动增高。arXiv 保留更大阅读区域，调整浮窗大小时显示尺寸。
- **侧边栏停靠**：左右停靠调高度，上下停靠调宽度；标题沿边移动，左侧手柄切换停靠边缘，记忆尺寸与位置并限制在屏幕内。扩大缩放热区，拖动预览保持跟手，调整后不再立即收起；修复 macOS 调整卡片时主窗口抢前景及屏幕上沿无法呼出的问题，Windows 同步停靠与位置记忆逻辑。
- **显示与操作**：两平台默认解锁并置于桌面层，统一悬停显示锁定、置顶、隐藏按钮。隐藏/显示浮窗保留模块选择，全关后重置隐藏状态。macOS 浮窗与侧边栏支持普通桌面切换，修复闪现及点击、拖动问题。侧边栏可彻底停用，钉选与设置同步；修复会议时间线展开时宽度跳动。

#### 额度与 GPU 监控

- **额度卡片**：优化窄卡片中的周期、重置时间和百分比排布，修复浅色背景下的 Cursor 图标。主页面提供“管理服务器”和“管理额度监控”入口，支持增删配置；选择服务商后才新增，不再自动创建 Antigravity。
- **主机与 SSH**：本机和远程 Linux 主机显示 CPU、内存用量，无 GPU 时仍可显示在线状态。支持搜索 SSH 配置别名并填入连接信息，解析嵌套 Include、通配符和带空格的路径，防止循环引用；SSH、Slurm 说明收进帮助提示。
- **运行稳定性**：额度显示设置即时本地更新，不再无条件刷新；丢弃与最新配置不符的迟到结果，保留手动额度编辑。GPU 队列设置和更新间隔即时生效，修复跨服务器同号作业计时串扰，并回收停止或异常的 SSH 子进程。补齐 macOS 密码与 API Key 的钥匙串加密存储。

#### 界面与平台修复

- **导航与页面**：统一模块顺序、名称、图标、研究页面工具栏与筛选布局，精简中英文说明和总览统计。页面内设置聚焦常用操作，外观等选项保留在完整设置页；修复切页闪动、设置选中框滑入和英文控件重叠，撤销及成功提示自动消退。
- **Windows**：修复侧边栏主题、模块开关不即时生效、窗口不可见及拖动提示不消失的问题；调整卡片尺寸不再覆盖缩放设置，切换焦点不再出现多余标题栏。托盘左键打开主界面，右键打开菜单。
- **macOS 窗口**：恢复原生窗口按钮、圆角与阴影，补齐顶部拖动和双击最大化区域，修复未激活窗口需要点击两次的问题。浮窗边缘使用原生八向缩放与光标。菜单栏使用适应系统明暗的单色图标和原生菜单；点击 Dock 图标可恢复主窗口，不受浮窗或侧边栏是否可见影响。
- **macOS 系统小组件**：新增额度、GPU、会议截止小组件，GPU 中号支持三台服务器，会议仅显示已关注项目。点击跳转到对应模块，支持冷启动跳转及临时签名构建的数据更新。
- **设置与窗口状态**：避免连续修改设置、侧边栏钉选和布局相互覆盖；原子保存失败保留原配置。修复主题初始化漏更新、设置监听泄漏，以及系统关闭窗口后无法恢复或开关状态残留。

#### 构建与测试

- **构建流程**：支持 main 推送、面向 main 的 PR 和手动构建，产出 Windows x64 安装包及包含 WidgetKit 的 macOS 应用；仅文档、网页改动跳过完整打包。提供独立名称和标识的“Widgitron 测试版”，macOS 构建无需 Apple 签名凭证。

### English

#### arXiv Radar

- **Browsing and filters**: Add All / To read / Saved views, a UTC submission-date picker, and cached pages of 100 papers. All ignores keywords; To read contains keyword matches and stays empty without keywords. Distinguish empty results from request failures and retain cached papers on refresh errors.
- **Keyword input**: Use removable tags with Enter and English/Chinese comma, semicolon, or newline separators. Save and refresh when filters close or the Settings section is left, with loading, success, and error feedback.
- **Refresh control**: Reuse per-keyword caches when editing filters, fetching only missing terms and preserving other papers. Display options and polling intervals no longer trigger immediate requests. Share duplicate refreshes, discard obsolete filter results, and back off after failures. Keep cached papers in widgets and the sidebar with a small failure indicator.
- **Saving and ignoring**: Add card actions and bulk management across lists. Open ignored papers in a separate dialog to restore or save them. Keep ignore records within the current batch, retain saved papers, and preserve existing selections.
- **Reading and downloads**: Show full titles with authors underneath, adapt abstract previews to available space, and include all authors and the submission date in the reading panel. Separate arXiv page and PDF download actions and avoid overwriting files. Use lighter save/ignore buttons in widgets and the sidebar, with keyword dropdowns following card background settings.

#### Conference Deadlines

- **Conference timelines**: Show one card per edition, count down to the next upcoming stage, and expand the complete timeline. Keep stage names and notes in English, convert deadlines to local time, and format dates in the interface language.
- **Search and following**: Search acronyms, full names, and years; filter by research area, CCF, and CORE. Combine pin and reminder actions into Follow while preserving existing choices. Manage following and ignoring per edition, with bulk actions, expired-item cleanup, and Undo. Synchronize followed conferences across sidebar, floating, and system widgets.
- **Data refresh**: Update the deadline source, add a fallback and compressed-response support, and fix parsing failures. Preserve cached data on errors and show the reason.

#### Floating Widgets and Sidebar

- **Appearance settings**: Manage all four widgets together with Follow main, Light, Dark, Transparent, Glass, and multiple custom themes. Support creation, copying, deletion confirmation, card backgrounds, and compact equal-height previews. Keep sidebar themes independent, with a collapsible editor.
- **Glass and reading**: Refine glass colors, contrast, and edge highlights; reduce stacked fills and focus-related changes. Replace macOS Glass with native Liquid Glass, using 8% black backgrounds and card fills and preserving the inactive effect. Keep Windows Glass unchanged and fix disappearing content when switching themes. Match keyword menus and full abstracts to the selected theme, blur underlying content, and preserve corners. Dismiss menus with outside clicks or Escape and block card gestures while open. Use tighter, scrollable abstract text.
- **Sizing and layout**: Move sidebar titles and actions into colored module headers. Measure the first quota, GPU, or conference card to set widget and sidebar minimum heights. Cap sidebar heights at their full content, resize them from the bottom, and grow conference cards when timelines open. Reserve more reading space for arXiv and show floating dimensions while resizing.
- **Sidebar docking**: Resize height when docked left/right and width when docked top/bottom. Drag the title along its edge or the left grip to change edges; remember size and position within screen bounds. Enlarge resize targets, keep drag previews under the pointer, and prevent immediate hiding after adjustments. Fix macOS dashboard activation during card resizing and top-edge reveal; apply docking and position persistence to Windows as well.
- **Visibility and controls**: Default both platforms to unlocked desktop widgets with consistent hover controls. Hide/show preserves selected modules; switching every widget off resets temporary hiding. Support ordinary macOS Spaces for widgets and the sidebar, and fix flashes, clicks, and dragging. Allow the sidebar to be disabled, synchronize its pin setting, and prevent conference timeline width shifts.

#### Quota and GPU Monitoring

- **Quota cards**: Improve period, reset-time, and percentage layout in narrow cards, and fix Cursor icons on light backgrounds. Use compact Servers and Quotas management buttons to add or remove entries. Create a monitor only after a provider is chosen, without automatically adding Antigravity.
- **Hosts and SSH**: Show CPU and memory for localhost and remote Linux hosts, retaining an online state without GPUs. Search SSH aliases and fill connection fields; support nested Includes, globs, and paths with spaces while preventing cycles. Move SSH and Slurm explanations into help popovers.
- **Runtime stability**: Apply quota display settings locally without refetching, reject results for outdated configurations, and preserve manual edits. Apply GPU queue settings and polling intervals at runtime, isolate matching job numbers across servers, and reap SSH processes after cancellation or errors. Add Keychain-backed encrypted storage for macOS passwords and API keys.

#### Interface and Platform Fixes

- **Navigation and pages**: Align module order, names, icons, research toolbars, and filters. Simplify bilingual copy and overview metrics, keep inline settings focused on common actions, and centralize appearance options in Settings. Fix page flashes, sliding settings selections, and overlapping English controls; dismiss Undo and success notices automatically.
- **Windows**: Fix delayed sidebar theme/module updates, invisible windows, and stuck drag notices. Preserve zoom when resizing sidebar cards and prevent extra native captions after focus changes. Left-clicking the tray icon opens the dashboard; right-clicking opens its menu.
- **macOS windows**: Restore native window buttons, corners, and shadows; complete the top drag and double-click zoom areas and accept the first click in inactive windows. Use native resizing and cursors on all widget edges and corners. Use an appearance-aware monochrome menu bar icon and native menu. Clicking the Dock icon restores the dashboard even when widgets or the sidebar are visible.
- **macOS system widgets**: Add quota, GPU, and conference widgets. The medium GPU widget supports three servers; conferences show followed entries only. Open the matching module on click, including cold launches, and support data updates in ad-hoc builds.
- **Settings and window state**: Preserve concurrent settings, sidebar pins, and layout edits; retain the previous config if atomic saving fails. Fix missed initial theme updates, leaked settings listeners, and native close operations that left windows unrecoverable or switches out of sync.

#### Builds and Testing

- **Build workflow**: Build on main pushes, PRs targeting main, or manual dispatch, producing Windows x64 installers and macOS apps with WidgetKit. Skip full packaging for documentation-only or website-only changes. Provide a separately named and identified test app; macOS builds do not require Apple signing credentials.

## [0.2.6] - 2026-09-24

### Highlights
- **Quota analytics**: Cursor and Claude usage charts — calendar heatmap, daily bars, model breakdown, and spend / token summaries.
- **Per-monitor visuals**: Toggle heatmap, bars, and model charts per quota monitor in Settings.
- **Light sidebar default**: Default sidebar theme is light glass, with a narrower starting width.

## [0.2.5] - 2026-07-15

### Highlights
- **Sidebar sensitivity**: Reveal / hide sensitivity are configurable in Settings (defaults keep today’s feel: cautious edge open, snappy auto-hide).
- **Upgrade-safe settings**: Installed builds always store user configs in AppData; migrate leftover exe-adjacent configs once, and soft-merge JSON on schema bumps so reinstalls stop wiping preferences.
- **Mixed-DPI desktop lock**: Compensates WebView zoom when desktop-locked widgets sit on a lower-scale secondary monitor under the primary-DPI desktop host.
- **Monitor / cache polish**: Thinner sidebar resize handles (no longer block dragging); GPU/Quota cache clears finished Slurm jobs and avoids sticky “showing cached” banners.

## [0.2.4] - 2026-06-20

### Highlights
- **Quota Monitor — more agent providers**: Added or expanded quota fetchers for **Qoder CN** (local IDE cache + OpenAPI), **Pioneer AI** (API key), **Claude Code** (local `~/.claude/settings.json` or MiniMax `sk-cp-` proxy token), and **MiniMax CN** (Bearer API key with optional JSON path). Existing providers remain: **Antigravity** (language server + cloud OAuth fallback), **Codex**, **Cursor**, **VS Code Copilot**, plus **OpenAI-compatible** custom endpoints.
- **Startup performance**: Lighter widget window init, staggered backend monitors, OTA dedupe, and reduced duplicate IPC on launch.
- **Type safety & IPC**: Typed `tauriInvoke` / `tauriListen` / `tauriEmit` helpers and shared event payload types.
- **Quota UX**: Clearer Antigravity setup hints and softer offline/cached-data messages for Copilot and other providers.

## [0.2.3] - 2026-06-09

### Highlights
- **OTA Update System**: Integrated full automatic in-app software update checking, asynchronous installer download with progress tracking, and silent startup.
- **Stability Polish**: Robust network request timeouts and event-listener cleanup optimization to guarantee smooth performance.

## [0.2.2] - 2026-06-03

### Highlights
- **Quota Monitor**: Added support for multi-progress bar monitoring and subscription package display toggle.
- **Paper Deadlines**: Added CORE and CCF conference rank information and filtering.
- **Arxiv Radar**: Fixed intermittent fetch failures by implementing robust URL percent-encoding and quote-wrapping for multi-word search phrases. Added validation of HTTP response status codes.
- **UI/UX Polish**: Beautiful dashboard sidebar, customized setting list styles, and widget color unification.

## [0.2.1] - 2026-05-14

### Highlights
- **Arxiv Radar**: New research curation tool with intuitive swipe gestures (Save/Discard/Open PDF).
- **Theme Engine**: Advanced customization system for widget colors, opacity, and theme assignments.
- **UI/UX Polish**: Enhanced information density with expanded paper summaries and full-title rendering.
- **Stability Fixes**: Resolved window freezing on startup and improved cross-session position memory for all widgets.

## [0.2.0] - 2026-05-10
- **Tauri 2.0 Migration**: Major backend overhaul for improved performance and modern API support.
- **Glassmorphism UI**: Complete visual redesign for a premium desktop experience.
- **SSH Optimization**: Enhanced GPU monitoring efficiency for remote HPC clusters.
