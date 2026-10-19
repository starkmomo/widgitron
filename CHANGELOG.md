# Changelog

## [Unreleased] - 2026-10-19

### 中文

- **侧边栏卡片尺寸**：按模块设置最小高度，arXiv 保留完整阅读与操作区域；额度、GPU、会议卡片保留手动调整高度，上限为完整内容所需高度；内容多时可拉长看全，缩短后在卡片内滚动，少量内容不会拉出大块空白。旧的过小、过高布局会自动修正，后续卡片随之紧凑排列；修复异步主题加载后未绑定内容测量、导致卡片仍能被拉长的问题，测量前采用紧凑上限。展开会议时间线时卡片只增加时间线所需高度，收起后恢复；展开期间仍可手动调整。修正 macOS 桌面层浮窗位于 Finder 图标层下方而无法点击、拖动的问题；浮窗选项改为原生弹出菜单，可超出浮窗边界。补齐主窗口左侧顶部空白区的双击最大化/恢复，与右侧一致。

- **侧边栏与浮窗整理**：侧边栏标题明确为“Widgitron 侧边栏”；侧边栏及独立 arXiv 浮窗移除“已忽略”管理入口，主界面仍可查看和恢复。浮窗按模块设置原生最小尺寸，兼顾 DPI、缩放和旧布局恢复；压缩内边距、页头和模块间距。macOS 浮窗的控制按钮在悬停或键盘聚焦时显示，“普通浮窗 / 始终置顶 / 置于桌面层”合并为互斥选项，位置锁定单独控制，并去掉总览中重复的桌面按钮；修正圆角外灰色残角，接收未激活浮窗的首次点击，避免按钮需要点两次；浅色浮窗内部卡片使用淡灰底和细描边，明确内容分组，透明主题保留玻璃效果。

- **浮窗外观与侧边栏停用**：四个独立浮窗的外观集中到设置中的同一栏目，提供跟随主界面、浅色、深色、透明预设及示例预览；支持多个自定义主题、新建、复制及删除确认弹窗。侧边栏增加独立的启用开关，停用后隐藏内容、停止边缘检测并注销 Windows 快捷键，重启后保留；主动打开可重新启用。临时收起统一标为“隐藏侧边栏”。

- **会议设置与侧边栏同步**：研究领域按钮保持原样，修正与数据源分类编码的匹配；设置中的会议关注支持搜索缩写、英文全称和年份，从完整缓存数据中选择具体届次。对齐 arXiv 代理配置；修复 macOS 侧边栏钉选状态未及时同步到设置开关的问题。
- **SSH 主机选择器**：统一应用内下拉样式，适配浅色和深色主题，支持搜索别名、键盘选择及空结果提示。
- **关键词标签**：arXiv 关键词改为标签输入，回车添加、叉号删除；支持粘贴中英文逗号、分号及换行分隔的多个词，保留短语空格并自动去重。兼容旧配置，仍在收起筛选或离开设置栏目后统一更新论文；筛选说明统一使用与 GPU 设置相同的即时问号浮层。
- **额度卡片**：按内容区宽度排列卡片，为周期名称、剩余额度和重置时间分行留出空间，避免窄卡片截断周期文字或挤压百分比；同步中英文。
- **服务器配置与筛选布局**：SSH 和 Slurm 说明收进问号提示；可从 SSH 配置中选择主机别名并填入已有连接字段，支持嵌套 Include、通配符和带空格的路径，并限制循环与过深递归。CCF 与 CORE 使用相同按钮宽度，研究领域在最小窗口宽度下仍完整显示为一行，无局部滚动。
- **筛选布局与总览**：CCF、CORE 分行排列，等级、研究领域及 arXiv 分类使用等高等宽选项，明确选中状态；会议图标内的研究领域文字加大、加粗并提高对比度。关键词、滑动提示和预设说明精简，中英文同步。总览有会议关注时显示当前未过期的关注数量，无关注时显示可浏览会议总数；arXiv 有关键词时显示待看数量，无关键词时显示所选分类最近批次的论文总数，并支持直接进入对应论文列表；统计文案简化为“已关注 / 待看 / 近期”，无关注的会议只显示数字，英文同步。
- **单行工具栏**：论文和会议的批量入口简化为“Select / Done”（中文“批量选择 / 完成”），保留完整悬停与无障碍说明；页签、选择、忽略入口及日期/搜索始终单行显示。主窗口最小宽度调整为 1040，防止英文控件互相遮挡，并修正旧窗口尺寸恢复后过窄的问题。
- **待看与筛选反馈**：arXiv 的“最新”改为“待看”，只收集关键词匹配的论文；未设置关键词时保持为空，清理旧的无关键词待看缓存并保留收藏。“全部”继续按分类和日期分页浏览。分类和会议筛选点击后自动生效；关键词在页面收起筛选、切换设置栏目或离开设置页时统一保存并更新，无需额外确认。保留草稿、正在保存/更新及失败提示，成功提示 4 秒后消失，并同步中英文说明。
- **导航与总览**：主导航、设置导航、总览统计和模块设置统一为额度、GPU、会议、arXiv 的顺序及名称；额度使用仪表盘图标，arXiv 使用雷达图标。英文会议导航缩为“Conference DDL”，避免换行；总览补充大标题，并为统计数字显示单位。
- **窗口与会议筛选**：顶部改为融入背景的窄拖动区，去掉重复页名和分隔线，保留各平台的窗口按钮。内容区上移：macOS 页头与左侧应用图标对齐，Windows 保留靠上的应用图标及右侧窗口按钮下方的间距。会议页的“截止日期设置”改为“筛选会议 / 收起筛选”，展开面板仅显示研究方向、CCF 和 CORE 等级筛选。arXiv 同步使用“筛选论文 / 收起筛选”，仅展开分类与关键词；更新频率、操作提示和代理配置保留在完整设置页。
- **页面切换**：移除主导航切页时旧页面与新页面同时占位的退出动画，新页面直接从顶部显示，避免从页面底部闪现后跳回。
- **论文筛选与批量操作**：arXiv 卡片可直接收藏或忽略，已忽略内容改为小字入口和标题列表弹窗，支持放回待看及收藏；忽略记录仅属于当前批次并设数量上限，收藏长期保留，兼容旧记录。全部、待看、收藏及忽略弹窗支持批量管理；分页全选仅作用于当前页，页签数量优先读取缓存并在切换后保留。会议已忽略列表同样改为小字弹窗，保留按届次恢复、关注、批量处理和过期清理；主导航与设置中的模块名称统一为“会议截止”。提供独立标识和名称的“Widgitron 测试版”构建。
- **研究页面布局**：论文截止日期与 arXiv 共用页头和紧凑页签，统一标题、设置、刷新、服务开关及搜索/日期筛选的位置和窄窗口排列。批量选择入口紧随页签，搜索与日期筛选保留右侧，工具栏保持单行；批量操作及清理选项按需展开。撤销改为可关闭的短暂提示，8 秒后自动消失，鼠标悬停或键盘聚焦时暂停计时，不再常驻工具栏。
- **macOS 小组件跳转**：点击额度、GPU 或截止日期小组件时打开对应模块页面；应用尚未启动时保留跳转请求，界面就绪后执行。
- **截止日期语言**：时间线和会议卡片中的日期格式跟随界面语言切换，英文界面不再沿用系统的中文日期格式；保持本地时区显示。
- **页面内设置与摘要阅读**：页面展开的设置使用淡蓝色底、强调边线和标题分隔；主题与样式、额度账号与套餐显示、GPU 紧凑样式及恢复位置仅保留在完整设置页；额度与 GPU 页面展开后直接管理监控项和服务器。侧边栏和浮窗中的完整摘要使用更紧凑的字号、行距和内边距，并保留滚动阅读。
- **会议搜索与关注**：支持按会议缩写、英文全称及年份搜索，使用“全部 / 已关注”页签和独立的已忽略列表弹窗；按“会议＋年份”保存选择，不自动延续到下一届。增加批量关注、忽略、取消关注、恢复、清空和已过期条目清理，可撤销批量操作；过期选择保留供管理，未知日期不误判为过期。合并重复的置顶和提醒操作为“关注”，自动保留旧选择。关注的会议按最近截止节点显示在侧边栏、浮窗和 macOS 小组件；忽略与关注互斥，已忽略会议可恢复。点击后立即反馈并按顺序保存，避免连续操作覆盖；macOS 主窗口接受未激活时的首次点击。
- **会议时间线**：每个会议年份合并为一张卡片，收录摘要、正文、ARR、rebuttal 和 decision 等数据源节点；倒计时自动跟随最近的未截止节点，展开可查看包含已过期节点的完整时间线。阶段标签和原始备注保持英文；已关注会议会跨阶段保留，侧边栏、浮窗和 macOS 小组件同步跟随下一节点。按 UTC 偏移、AoE 和 PT 夏令时正确换算截止时间，界面明确展示本地时间。
- **macOS 窗口边缘**：主窗口统一使用系统圆角、轮廓与阴影，修正网页描边与原生圆角叠加时四角轮廓断开的外观。
- **arXiv 日期与翻页**：提供“全部 / 待看 / 已收藏”页签及提交日期（UTC）月历，区分无论文和网络错误；待看按关键词分组，选日期时查询当天匹配论文。“全部”不按关键词筛选，默认显示最近投稿日。每页 100 篇，使用上一页/下一页切换，按分类、关键词、日期和页码缓存已浏览内容，刷新失败时保留当前页。
- **截止日期刷新**：更新数据源到当前 HTTPS 地址，支持 gzip 响应并在请求或解析失败时尝试 GitHub 备用源；手动刷新和后台更新共用处理逻辑，失败时保留缓存，并记录具体错误原因。
- **arXiv 论文卡片**：标题完整换行显示，卡片列数按内容区域宽度调整；摘要按卡片剩余高度自动调整预览行数，避免短标题卡片留出大块空白；可点击“完整摘要”打开独立阅读面板，不改变卡片布局；分别提供打开 arXiv 页面和下载 PDF 的图标按钮。PDF 保存到系统下载目录，避免覆盖同名文件，并显示下载结果。侧边栏和浮窗使用相同操作。
- **侧边栏启动修复**：状态查询不再触发窗口创建，初始化只由应用启动流程负责，并防止并发或重入创建重复控制器。增加设置保存、通知接收和界面更新的诊断记录。
- **Windows 侧边栏**：将主题和模块开关的同步独立于服务初始化，避免其他配置加载失败导致订阅缺失；防止旧请求覆盖新的配置和展开状态，并即时提交侧边栏显示更新。保留原有模糊外观。拖动结束后及时清除移动提示，自定义标题栏颜色也会应用到侧边栏。
- **设置修复**：设置页选中框打开时不再滑入；主页面的“添加额度监控”和“添加服务器”仅展开设置，额度服务商在明确选择后才新增，不再自动创建 Antigravity。浅色界面的 Cursor 图标现在清晰可见。
- **修复**：Windows 侧边栏通过 Tauri 同步窗口显示状态，保留屏幕边缘悬停唤出与离开收起；修正可能完全不可见的问题。Windows 托盘左键打开主界面，右键打开菜单；侧边栏卡片尺寸只保存卡片布局，不覆盖缩放设置。论文截止日期浮窗仅显示已关注的会议，同一会议年份只显示一个投稿轮次。
- **自动构建**：GitHub Actions 支持主分支推送、面向 main 的拉取请求及手动触发，检查 Windows x64 安装包与包含 WidgetKit 扩展的 macOS 应用；仅文档或网页变更跳过完整打包。macOS 使用临时签名，无需上传 Apple 凭证。
- **macOS 系统小组件**：新增额度、GPU 和论文截止日期小组件；GPU 中号小组件可显示三台服务器，直接标出平均使用率，没有 GPU 时显示明确状态。截止日期仅显示用户已关注的近期会议，点击小组件可打开主界面。正常签名的应用通过 App Group 共享展示数据；GitHub 临时签名构建在 macOS 拒绝 App Group 写入时，通过本机回环地址更新小组件。
- **界面与操作**：macOS 主窗口恢复原生红黄绿按钮，修正最小窗口尺寸、总览与设置页布局；主显示器上的侧边栏支持鼠标靠边唤出、离开收起。额度监控、服务器和会议可在对应页面添加或配置，侧边栏与设置面板按钮可再次点击关闭，主界面操作侧边栏时保持焦点。菜单栏图标改为随系统明暗自动着色的单色图标，左键打开主界面，右键使用原生系统菜单；退出项简化为“退出”，并用分隔线隔开。完善中英文界面文案。
- **主机监控**：本机和远程 Linux 服务器显示 CPU、内存用量；没有 GPU 时仍正常显示在线状态。支持解析 SSH 配置中的嵌套 `Include` 文件。
- **arXiv 空状态**：未设置关键词时，待看保持为空，可通过“全部”浏览所选分类的近期论文。

### English

- **Sidebar card sizing**: Added module-specific minimum heights, preserving a usable reading and action area for arXiv. Quota, GPU, and conference cards retain manual resizing up to their complete content height: long lists can be expanded beyond one screen or scrolled in a shorter card, while short lists cannot leave large blank areas. Restored undersized or oversized cards are clamped and following cards close up. Content measurement attaches after asynchronous theme loading; cards use compact bounds until measurement is ready. Conference cards temporarily grow by the newly opened timeline height and restore their collapsed height when it is closed; manual resizing remains available while expanded. Fixed macOS desktop-layer widgets sitting below Finder's icon window and losing clicks and drags. Floating options now use a native menu that can extend outside the widget. Added native drag and double-click zoom/restore to the dashboard's upper-left blank area.

- **Sidebar and floating windows**: Renamed the sidebar header to “Widgitron Sidebar”. Removed ignored-paper management from the sidebar and floating arXiv cards; it remains available in the dashboard. Added native minimum sizes per module, accounting for DPI, UI zoom, and restored layouts, and tightened padding, headers, and spacing. macOS controls appear on hover or keyboard focus; a single menu selects Normal floating window, Always on top, or Desktop layer, with a separate position lock. Removed the duplicate desktop button from Overview. Clipped grey artifacts outside floating-window corners and enabled first-click actions on inactive macOS widgets. Light floating windows use subtle grey card fills and outlines to distinguish content groups; transparent themes retain their glass styling.

- **Floating appearance and sidebar control**: Manage all four floating windows in one Settings section, with live examples, Follow main, Light, Dark, Transparent, and multiple custom themes. Add explicit creation, duplication, and a deletion dialog. A persistent sidebar enable switch stops edge reveal and unregisters the Windows shortcut when disabled; opening it explicitly enables it again. Temporary dismissal is labeled Hide Sidebar.

- **Conference settings and sidebar sync**: Preserve the research-area controls while matching their values to the source category codes. Search the full cached conference catalog by acronym, full name, or year and follow a specific edition from Settings. Align arXiv proxy settings and synchronize macOS sidebar pin changes with the Settings switch immediately.
- **SSH host picker**: Use a consistent in-app dropdown in light and dark themes, with alias search, keyboard selection, and empty-result feedback.
- **Keyword tags**: Enter adds an arXiv keyword and each tag has a remove action. Paste multiple entries separated by English/Chinese commas, semicolons, or newlines, preserving phrase spaces and removing duplicates. Retain existing configurations and update papers when filters close or the settings section is left. Use the same immediate question-mark help as GPU settings.
- **Quota cards**: Size the grid to the available content width and separate period names, remaining percentages, and reset times to prevent truncation and collisions in narrow cards, in both languages.
- **Server setup and filter layout**: Move SSH and Slurm explanations into question-mark help. Select local SSH aliases to fill connection fields, with nested Includes, globs, quoted paths, and cycle/depth limits. Give CCF and CORE equal button widths and fit research areas on one row at the minimum window width, without local scrolling.
- **Filters and overview**: Arrange CCF and CORE on separate rows with consistently sized rank, research-area, and arXiv category choices and accessible selection states. Enlarge and strengthen research-area codes inside conference icons. Shorten keyword, swipe-hint, and preset copy in both languages. Overview shows upcoming followed conferences when any are followed, otherwise browsable conferences; arXiv shows To read with keywords or the selected categories’ latest paper total without them, and opens the corresponding paper view. Use concise followed / to read / recent metrics in both languages and omit the unit for the unfollowed conference total.
- **Single-row toolbars**: Shorten bulk controls to Select / Done with full tooltips and accessible labels. Keep view tabs, selection, ignored items, and date/search controls on one row. Set a 1040-point minimum window width and clamp restored window sizes to prevent English controls from overlapping.
- **To read and filter feedback**: Rename arXiv Latest to To read and collect only keyword matches. Leave it empty without keywords, clear legacy unfiltered reading caches, and preserve saved papers. Keep All as paginated browsing by category and date. Apply category and conference choices immediately; save keyword drafts and update papers when closing inline filters, switching settings sections, or leaving Settings, with no extra confirmation. Retain draft, saving/updating, and failure feedback in both languages; dismiss success messages after four seconds.
- **Navigation and overview**: Share module order, names, and icons across main navigation, Settings, overview statistics, and module controls: Quota, GPU, Conferences, then arXiv. Use a gauge for Quota and a radar icon for arXiv. Shorten the English conference label to Conference DDL to prevent wrapping. Add an Overview heading and concise statistic labels.
- **Window chrome and conference filters**: Use a compact drag area that blends with the page, removing duplicate section names and the divider while preserving window controls. Move content upward to align page headers with the app icon on macOS; keep the Windows icon near the top and reserve space below its window controls. Rename the conference page action to “Filter conferences / Hide filters”; its inline panel contains only research areas and CCF/CORE rank filters. Use “Filter papers / Hide filters” for arXiv, showing only categories and keywords inline while keeping update intervals, hints, and proxy options in full Settings.
- **Page navigation**: Remove overlapping exit animations between main sections and reset the scroll viewport on navigation, preventing pages from briefly appearing below the previous section.
- **Paper triage and bulk actions**: Add bookmarking and ignoring to arXiv cards, with a compact ignored-paper dialog for restoring or bookmarking titles. Scope bounded ignore records to the current batch, retain saved papers, and import legacy selections. Support bulk actions across All, To read, Saved, and the ignored dialog; select only the current page when paginated and retain cached tab counts. Move ignored conferences into a matching dialog with restore, follow, bulk actions, and expired cleanup while retaining edition-scoped preferences. Shorten the Chinese navigation label and add a separately identified test app build.
- **Research page layout**: Share the header and compact tabs across deadlines and arXiv, aligning titles, settings, refresh, service controls, and search/date filters. Place bulk selection beside view tabs, keep search and date controls on the right in a single-row toolbar, and reveal bulk actions and cleanup controls only when needed. Replace the persistent Undo control with a dismissible notice that expires after eight seconds and pauses while hovered or focused.
- **macOS widget navigation**: Open the matching quota, GPU, or deadline page when a widget is clicked, retaining the destination until the main interface is ready on a cold launch.
- **Deadline date language**: Format timeline and conference card dates using the selected interface language instead of the system language, while preserving the local time zone.
- **Inline settings and abstract reading**: Distinguish expanded page settings with a tinted surface, accent border, and separated header. Keep theme styling, quota account and plan visibility, GPU compact mode, and position restoration in full Settings; inline quota and GPU panels focus on monitors and servers. Use denser type, line spacing, and padding for full abstracts in sidebars and floating widgets while preserving scrolling.
- **Conference search and following**: Search by acronym, source full name, and year with All and Followed tabs plus a separate ignored-conference dialog. Store preferences per conference edition without automatically following later years. Add bulk follow, ignore, unfollow, restore, clear-all, and expired cleanup with Undo; retain expired selections for management and never treat unknown dates as expired. Combine the overlapping pin and reminder controls into Follow while preserving existing selections. Show followed conferences in sidebar, floating, and macOS widgets ordered by their next deadline. Ignoring removes Follow and can be reversed. Update controls immediately, serialize preference saves to preserve rapid changes, and accept the first click in an inactive macOS main window.
- **Conference timelines**: Show one card per conference year with every available abstract, paper, ARR, rebuttal, and decision milestone. Count down to the nearest upcoming stage, roll forward locally, and expand to view the complete timeline including past events. Keep stage labels and source notes in English, preserve followed conferences across stage changes, and synchronize sidebar, floating, and macOS widgets. Correctly convert UTC offsets, AoE, and Pacific daylight-saving time, and explicitly display local time.
- **macOS window edges**: Use the system corner clipping, outline, and shadow for the main window, avoiding broken corner outlines caused by overlapping web and native window borders.
- **arXiv dates and pagination**: Provide All, To read, and Saved tabs with a submission date (UTC) calendar, consistent toolbars, and distinct empty-date and network-error states. Group To read by keywords; a selected date queries that day's matches. All ignores keywords and defaults to the latest submission day. Display 100 papers per page with Previous/Next navigation, cache browsed pages by categories, keywords, date and page number, and preserve the current page on refresh failure.
- **Deadline refresh**: Use the current HTTPS data source with gzip support and a GitHub fallback for request or parsing failures. Manual and background refreshes share the same handling, preserve cached data on failure, and log the underlying error.
- **arXiv paper cards**: Show complete wrapping titles and adapt column count to the available content width. Adapt abstract preview line counts to the available card height, with a full abstract reading dialog that preserves the card layout. Provide separate icon buttons for opening the arXiv page and downloading the PDF to the system Downloads folder, without overwriting existing files, and show download feedback. Sidebar and floating widgets use the same actions.
- **Sidebar startup fix**: State queries no longer create windows. Application setup owns initialization, with a nonblocking guard against concurrent or reentrant controller creation. Added diagnostics for settings saves, notification delivery, and UI updates.
- **Windows sidebar**: Subscribe to theme and module settings independently of service initialization, so unrelated loading failures cannot block updates. Prevent stale reads from replacing newer settings or reveal events, and commit sidebar appearance updates immediately. Preserve the original blur styling. Clear the moving overlay when dragging ends, and apply custom header colors.
- **Settings fixes**: The selected settings tab no longer slides in on open. Dashboard add buttons only reveal the quota or server settings; a quota monitor is created only after a provider is chosen, with no automatic Antigravity entry. The Cursor icon remains visible on light backgrounds.
- **Fixes**: Synchronized Windows sidebar visibility through Tauri while retaining edge hover reveal and leave to hide behavior; fixed cases where it was completely invisible. Left click on the Windows tray icon opens the dashboard and right click opens the menu. Resizing sidebar cards now saves only card layout, preserving the scale setting. Deadline floating widgets now show only selected conferences and one submission round per conference year.
- **Continuous builds**: GitHub Actions checks the Windows x64 installer and macOS app with WidgetKit on main pushes, pull requests targeting main, and manual dispatch. Documentation-only and website-only changes skip full packaging. macOS checks use ad-hoc signing without Apple credentials.
- **Native macOS widgets**: Added quota, GPU, and paper deadline widgets. The medium GPU widget shows up to three servers with explicit average utilization and a clear no-GPU state. Deadline widgets show only upcoming conferences followed by the user; clicking a widget opens the dashboard. Signed apps share display-only snapshots through an App Group; GitHub's ad-hoc builds use a local loopback feed when macOS denies App Group writes.
- **Interface and controls**: Restored native macOS window controls and improved minimum window sizing, overview layout, and Settings layout. The sidebar on the primary display now opens when the pointer reaches its edge and hides when the pointer leaves. Quota monitors, servers, and conferences can be added or configured from their pages; sidebar and settings controls now toggle closed as well as open without taking focus from the dashboard. The menu bar icon is now monochrome and adapts to the system appearance; a left click opens the dashboard, while a right click opens a native macOS menu. The separated quit item uses the short label “Quit”, and Chinese/English interface copy has been refined.
- **Host monitoring**: Added CPU and memory usage for localhost and remote Linux servers, with a clear online state when no GPU is present. SSH configuration parsing now follows nested `Include` files.
- **arXiv empty states**: Leave To read empty without keywords and use All to browse recent papers from the selected categories.

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
