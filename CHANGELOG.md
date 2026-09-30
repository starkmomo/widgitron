# Changelog

## [Unreleased] - 2026-09-30

### 中文
- **修复**：Windows 侧边栏通过 Tauri 同步窗口显示状态，保留屏幕边缘悬停唤出与离开收起；修正可能完全不可见的问题。Windows 托盘左键打开主界面，右键打开菜单；侧边栏卡片尺寸只保存卡片布局，不覆盖缩放设置。论文截止日期浮窗仅显示已提醒或置顶的会议，同一会议年份只显示一个投稿轮次。
- **自动构建**：新增 GitHub Actions，在推送和拉取请求时检查 Windows x64 安装包与包含 WidgetKit 扩展的 macOS 应用构建；macOS 检查使用临时签名，无需上传 Apple 凭证。
- **macOS 系统小组件**：新增额度、GPU 和论文截止日期小组件；GPU 中号小组件可显示三台服务器，直接标出平均使用率，没有 GPU 时显示明确状态。截止日期仅显示用户设置提醒或置顶的近期会议，点击小组件可打开主界面。正常签名的应用通过 App Group 共享展示数据；GitHub 临时签名构建在 macOS 拒绝 App Group 写入时，通过本机回环地址更新小组件。
- **界面与操作**：macOS 主窗口恢复原生红黄绿按钮，修正最小窗口尺寸、总览与设置页布局；主显示器上的侧边栏支持鼠标靠边唤出、离开收起。额度监控、服务器和会议可在对应页面添加或配置，侧边栏与设置面板按钮可再次点击关闭，主界面操作侧边栏时保持焦点。菜单栏图标改为随系统明暗自动着色的单色图标，左键打开主界面，右键使用原生系统菜单；退出项简化为“退出”，并用分隔线隔开。完善中英文界面文案。
- **主机监控**：本机和远程 Linux 服务器显示 CPU、内存用量；没有 GPU 时仍正常显示在线状态。支持解析 SSH 配置中的嵌套 `Include` 文件。
- **arXiv**：不设置关键词时显示所选分类的近期论文，并改进空状态提示。

### English
- **Fixes**: Synchronized Windows sidebar visibility through Tauri while retaining edge hover reveal and leave to hide behavior; fixed cases where it was completely invisible. Left click on the Windows tray icon opens the dashboard and right click opens the menu. Resizing sidebar cards now saves only card layout, preserving the scale setting. Deadline floating widgets now show only selected conferences and one submission round per conference year.
- **Continuous builds**: Added GitHub Actions checks for the Windows x64 installer and macOS app with WidgetKit on pushes and pull requests. macOS build checks use ad-hoc signing and require no Apple credentials.
- **Native macOS widgets**: Added quota, GPU, and paper deadline widgets. The medium GPU widget shows up to three servers with explicit average utilization and a clear no-GPU state. Deadline widgets show only upcoming conferences selected for reminders or pinned by the user; clicking a widget opens the dashboard. Signed apps share display-only snapshots through an App Group; GitHub's ad-hoc builds use a local loopback feed when macOS denies App Group writes.
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
