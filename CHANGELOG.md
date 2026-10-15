# Changelog

## [Unreleased] - 2026-10-15

### 中文
- **macOS 小组件跳转**：点击额度、GPU 或截止日期小组件时打开对应模块页面；应用尚未启动时保留跳转请求，界面就绪后执行。
- **截止日期语言**：时间线和会议卡片中的日期格式跟随界面语言切换，英文界面不再沿用系统的中文日期格式；保持本地时区显示。
- **页面内设置与摘要阅读**：页面展开的设置使用淡蓝色底、强调边线和标题分隔；主题与样式仅保留在完整设置页。侧边栏和浮窗中的完整摘要使用更紧凑的字号、行距和内边距，并保留滚动阅读。
- **会议搜索与关注**：支持按会议缩写、英文全称及年份搜索，并提供“全部 / 已关注 / 已忽略”页签；按“会议＋年份”保存选择，不自动延续到下一届。增加批量关注、忽略、取消关注、恢复、清空和已过期条目清理，可撤销批量操作；过期选择保留供管理，未知日期不误判为过期。合并重复的置顶和提醒操作为“关注”，自动保留旧选择。关注的会议按最近截止节点显示在侧边栏、浮窗和 macOS 小组件；忽略与关注互斥，已忽略会议可恢复。点击后立即反馈并按顺序保存，避免连续操作覆盖；macOS 主窗口接受未激活时的首次点击。
- **会议时间线**：每个会议年份合并为一张卡片，收录摘要、正文、ARR、rebuttal 和 decision 等数据源节点；倒计时自动跟随最近的未截止节点，展开可查看包含已过期节点的完整时间线。阶段标签和原始备注保持英文；已关注会议会跨阶段保留，侧边栏、浮窗和 macOS 小组件同步跟随下一节点。按 UTC 偏移、AoE 和 PT 夏令时正确换算截止时间，界面明确展示本地时间。
- **macOS 窗口边缘**：主窗口统一使用系统圆角、轮廓与阴影，修正网页描边与原生圆角叠加时四角轮廓断开的外观。
- **arXiv 日期与翻页**：在“最新”左侧增加“全部”页签，并在关键词设置旁提供提交日期（UTC）月历，统一页签与工具栏布局，并区分无论文和网络错误提示；“最新”的默认行为和关键词分组保持原样，选日期时查询当天匹配关键词的论文，“全部”不按关键词筛选，默认显示最近投稿日。每页 100 篇，使用上一页/下一页切换，按分类、关键词、日期和页码缓存已浏览内容，刷新失败时保留当前页。
- **截止日期刷新**：更新数据源到当前 HTTPS 地址，支持 gzip 响应并在请求或解析失败时尝试 GitHub 备用源；手动刷新和后台更新共用处理逻辑，失败时保留缓存，并记录具体错误原因。
- **arXiv 论文卡片**：标题完整换行显示，卡片列数按内容区域宽度调整；摘要按卡片剩余高度自动调整预览行数，避免短标题卡片留出大块空白；可点击“完整摘要”打开独立阅读面板，不改变卡片布局；分别提供打开 arXiv 页面和下载 PDF 的图标按钮。PDF 保存到系统下载目录，避免覆盖同名文件，并显示下载结果。侧边栏和浮窗使用相同操作。
- **侧边栏启动修复**：状态查询不再触发窗口创建，初始化只由应用启动流程负责，并防止并发或重入创建重复控制器。增加设置保存、通知接收和界面更新的诊断记录。
- **Windows 侧边栏**：将主题和模块开关的同步独立于服务初始化，避免其他配置加载失败导致订阅缺失；防止旧请求覆盖新的配置和展开状态，并即时提交侧边栏显示更新。保留原有模糊外观。拖动结束后及时清除移动提示，自定义标题栏颜色也会应用到侧边栏。
- **设置修复**：设置页选中框打开时不再滑入；主页面的“添加额度监控”和“添加服务器”仅展开设置，额度服务商在明确选择后才新增，不再自动创建 Antigravity。浅色界面的 Cursor 图标现在清晰可见。
- **修复**：Windows 侧边栏通过 Tauri 同步窗口显示状态，保留屏幕边缘悬停唤出与离开收起；修正可能完全不可见的问题。Windows 托盘左键打开主界面，右键打开菜单；侧边栏卡片尺寸只保存卡片布局，不覆盖缩放设置。论文截止日期浮窗仅显示已关注的会议，同一会议年份只显示一个投稿轮次。
- **自动构建**：新增 GitHub Actions，在推送和拉取请求时检查 Windows x64 安装包与包含 WidgetKit 扩展的 macOS 应用构建；macOS 检查使用临时签名，无需上传 Apple 凭证。
- **macOS 系统小组件**：新增额度、GPU 和论文截止日期小组件；GPU 中号小组件可显示三台服务器，直接标出平均使用率，没有 GPU 时显示明确状态。截止日期仅显示用户已关注的近期会议，点击小组件可打开主界面。正常签名的应用通过 App Group 共享展示数据；GitHub 临时签名构建在 macOS 拒绝 App Group 写入时，通过本机回环地址更新小组件。
- **界面与操作**：macOS 主窗口恢复原生红黄绿按钮，修正最小窗口尺寸、总览与设置页布局；主显示器上的侧边栏支持鼠标靠边唤出、离开收起。额度监控、服务器和会议可在对应页面添加或配置，侧边栏与设置面板按钮可再次点击关闭，主界面操作侧边栏时保持焦点。菜单栏图标改为随系统明暗自动着色的单色图标，左键打开主界面，右键使用原生系统菜单；退出项简化为“退出”，并用分隔线隔开。完善中英文界面文案。
- **主机监控**：本机和远程 Linux 服务器显示 CPU、内存用量；没有 GPU 时仍正常显示在线状态。支持解析 SSH 配置中的嵌套 `Include` 文件。
- **arXiv**：不设置关键词时显示所选分类的近期论文，并改进空状态提示。

### English
- **macOS widget navigation**: Open the matching quota, GPU, or deadline page when a widget is clicked, retaining the destination until the main interface is ready on a cold launch.
- **Deadline date language**: Format timeline and conference card dates using the selected interface language instead of the system language, while preserving the local time zone.
- **Inline settings and abstract reading**: Distinguish expanded page settings with a tinted surface, accent border, and separated header. Keep theme styling in the full Settings page. Use denser type, line spacing, and padding for full abstracts in sidebars and floating widgets while preserving scrolling.
- **Conference search and following**: Search by acronym, source full name, and year across All, Followed, and Ignored tabs. Store preferences per conference edition without automatically following later years. Add bulk follow, ignore, unfollow, restore, clear-all, and expired cleanup with Undo; retain expired selections for management and never treat unknown dates as expired. Combine the overlapping pin and reminder controls into Follow while preserving existing selections. Show followed conferences in sidebar, floating, and macOS widgets ordered by their next deadline. Ignoring removes Follow and can be reversed. Update controls immediately, serialize preference saves to preserve rapid changes, and accept the first click in an inactive macOS main window.
- **Conference timelines**: Show one card per conference year with every available abstract, paper, ARR, rebuttal, and decision milestone. Count down to the nearest upcoming stage, roll forward locally, and expand to view the complete timeline including past events. Keep stage labels and source notes in English, preserve followed conferences across stage changes, and synchronize sidebar, floating, and macOS widgets. Correctly convert UTC offsets, AoE, and Pacific daylight-saving time, and explicitly display local time.
- **macOS window edges**: Use the system corner clipping, outline, and shadow for the main window, avoiding broken corner outlines caused by overlapping web and native window borders.
- **arXiv dates and pagination**: Add All before Latest and a submission date (UTC) calendar beside keyword settings, stabilize tab and toolbar layout, and distinguish empty dates from network errors. Preserve the default Latest behavior and keyword groups; a selected date queries that day's keyword matches. All ignores keywords and defaults to the latest submission day. Display 100 papers per page with Previous/Next navigation, cache browsed pages by categories, keywords, date and page number, and preserve the current page on refresh failure.
- **Deadline refresh**: Use the current HTTPS data source with gzip support and a GitHub fallback for request or parsing failures. Manual and background refreshes share the same handling, preserve cached data on failure, and log the underlying error.
- **arXiv paper cards**: Show complete wrapping titles and adapt column count to the available content width. Adapt abstract preview line counts to the available card height, with a full abstract reading dialog that preserves the card layout. Provide separate icon buttons for opening the arXiv page and downloading the PDF to the system Downloads folder, without overwriting existing files, and show download feedback. Sidebar and floating widgets use the same actions.
- **Sidebar startup fix**: State queries no longer create windows. Application setup owns initialization, with a nonblocking guard against concurrent or reentrant controller creation. Added diagnostics for settings saves, notification delivery, and UI updates.
- **Windows sidebar**: Subscribe to theme and module settings independently of service initialization, so unrelated loading failures cannot block updates. Prevent stale reads from replacing newer settings or reveal events, and commit sidebar appearance updates immediately. Preserve the original blur styling. Clear the moving overlay when dragging ends, and apply custom header colors.
- **Settings fixes**: The selected settings tab no longer slides in on open. Dashboard add buttons only reveal the quota or server settings; a quota monitor is created only after a provider is chosen, with no automatic Antigravity entry. The Cursor icon remains visible on light backgrounds.
- **Fixes**: Synchronized Windows sidebar visibility through Tauri while retaining edge hover reveal and leave to hide behavior; fixed cases where it was completely invisible. Left click on the Windows tray icon opens the dashboard and right click opens the menu. Resizing sidebar cards now saves only card layout, preserving the scale setting. Deadline floating widgets now show only selected conferences and one submission round per conference year.
- **Continuous builds**: Added GitHub Actions checks for the Windows x64 installer and macOS app with WidgetKit on pushes and pull requests. macOS build checks use ad-hoc signing and require no Apple credentials.
- **Native macOS widgets**: Added quota, GPU, and paper deadline widgets. The medium GPU widget shows up to three servers with explicit average utilization and a clear no-GPU state. Deadline widgets show only upcoming conferences followed by the user; clicking a widget opens the dashboard. Signed apps share display-only snapshots through an App Group; GitHub's ad-hoc builds use a local loopback feed when macOS denies App Group writes.
- **Interface and controls**: Restored native macOS window controls and improved minimum window sizing, overview layout, and Settings layout. The sidebar on the primary display now opens when the pointer reaches its edge and hides when the pointer leaves. Quota monitors, servers, and conferences can be added or configured from their pages; sidebar and settings controls now toggle closed as well as open without taking focus from the dashboard. The menu bar icon is now monochrome and adapts to the system appearance; a left click opens the dashboard, while a right click opens a native macOS menu. The separated quit item uses the short label “Quit”, and Chinese/English interface copy has been refined.
- **Host monitoring**: Added CPU and memory usage for localhost and remote Linux servers, with a clear online state when no GPU is present. SSH configuration parsing now follows nested `Include` files.
- **arXiv**: With no keywords, shows recent papers from the selected category and provides clearer empty states.

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
