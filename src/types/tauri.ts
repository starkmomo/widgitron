import type {
  AppConfig,
  ArxivConfig,
  ArxivPaper,
  GpuConfig,
  PaperConfig,
  PaperDeadlineInfo,
  SidebarTileLayoutConfig,
  QuotaConfig,
  QuotaItem,
  ServerGpuData,
} from "./config";
import type { WidgetThemeConfig } from "./theme";

export interface ToggleWidgetResponse {
  visible: boolean;
}

export interface SidebarDockState {
  edge: "left" | "top" | "right" | "bottom";
  pinned: boolean;
  expanded: boolean;
  dragging: boolean;
  preview_edge: SidebarDockState["edge"] | null;
}

export interface UpdateInfo {
  has_update: boolean;
  current_version: string;
  latest_version: string;
  release_notes: string;
  download_url?: string | null;
  asset_name?: string | null;
}

export interface OtaDownloadProgress {
  state: "downloading" | "completed" | "error";
  progress: number;
  error?: string | null;
}

export interface AntigravitySetupStatus {
  has_oauth_tokens: boolean;
  cloud_auth_ready: boolean;
  language_server_running: boolean;
  oauth_config_path: string;
  config_dir: string;
  program_files_install: boolean;
}

export type LiveDataFetchCommand =
  | "get_gpu_data"
  | "get_deadlines"
  | "get_arxiv_papers"
  | "get_quota_data";

export type LiveDataRefreshCommand =
  | "refresh_gpu_data"
  | "refresh_paper_deadlines"
  | "refresh_arxiv"
  | "refresh_quota";

export type LiveDataCommandResult = {
  get_gpu_data: ServerGpuData[];
  get_deadlines: PaperDeadlineInfo[];
  get_arxiv_papers: ArxivPaper[];
  get_quota_data: QuotaItem[];
  refresh_gpu_data: ServerGpuData[];
  refresh_paper_deadlines: PaperDeadlineInfo[];
  refresh_arxiv: ArxivPaper[];
  refresh_quota: QuotaItem[];
};

export interface TauriCommandMap {
  get_app_config: AppConfig;
  get_gpu_config: GpuConfig;
  ssh_config_has_host: boolean;
  get_paper_config: PaperConfig;
  get_arxiv_config: ArxivConfig;
  get_quota_config: QuotaConfig;
  get_theme_config: WidgetThemeConfig;
  get_gpu_data: ServerGpuData[];
  get_deadlines: PaperDeadlineInfo[];
  get_arxiv_papers: ArxivPaper[];
  get_quota_data: QuotaItem[];
  refresh_gpu_data: ServerGpuData[];
  refresh_paper_deadlines: PaperDeadlineInfo[];
  refresh_arxiv: ArxivPaper[];
  refresh_quota: QuotaItem[];
  get_arxiv_saved_papers: ArxivPaper[];
  get_arxiv_discarded_papers: ArxivPaper[];
  get_config_dir_path: string;
  get_corrupt_config_files: string[];
  get_antigravity_setup_status: AntigravitySetupStatus;
  check_for_updates: UpdateInfo;
  toggle_widget: ToggleWidgetResponse;
  save_gpu_config: void;
  save_paper_config: void;
  save_arxiv_config: void;
  save_quota_config: void;
  save_app_config: void;
  save_sidebar_tile_layout: AppConfig;
  set_widget_always_on_top: AppConfig;
  set_widget_desktop_fixed: AppConfig;
  save_theme_config: void;
  download_and_install_update: void;
  create_widget: void;
  close_widget: void;
  hide_all_widgets: void;
  restore_widget_position: void;
  open_log_dir: void;
  open_config_dir: void;
  open_link: void;
  mark_arxiv_seen: void;
  remove_arxiv_saved_paper: void;
  remove_arxiv_discarded_paper: void;
  update_manual_quota: void;
  show_main: void;
  show_sidebar: void;
  hide_sidebar: void;
  toggle_sidebar_visibility: void;
  get_native_quota_widget_status: boolean;
  toggle_sidebar: void;
  get_sidebar_state: SidebarDockState;
  set_sidebar_pinned: SidebarDockState;
  begin_sidebar_drag: SidebarDockState;
  exit_app: void;
  set_desktop_mode: void;
  log_frontend_error: void;
}

export type TauriCommand = keyof TauriCommandMap;

/** All frontend/backend command names — useful for grep and runtime checks. */
export const TAURI_COMMAND_NAMES = [
  "get_app_config",
  "get_gpu_config",
  "ssh_config_has_host",
  "get_paper_config",
  "get_arxiv_config",
  "get_quota_config",
  "get_theme_config",
  "get_gpu_data",
  "get_deadlines",
  "get_arxiv_papers",
  "get_quota_data",
  "refresh_gpu_data",
  "refresh_paper_deadlines",
  "refresh_arxiv",
  "refresh_quota",
  "get_arxiv_saved_papers",
  "get_arxiv_discarded_papers",
  "get_config_dir_path",
  "get_corrupt_config_files",
  "get_antigravity_setup_status",
  "check_for_updates",
  "toggle_widget",
  "save_gpu_config",
  "save_paper_config",
  "save_arxiv_config",
  "save_quota_config",
  "save_app_config",
  "save_sidebar_tile_layout",
  "set_widget_always_on_top",
  "set_widget_desktop_fixed",
  "save_theme_config",
  "download_and_install_update",
  "create_widget",
  "close_widget",
  "hide_all_widgets",
  "restore_widget_position",
  "open_log_dir",
  "open_config_dir",
  "open_link",
  "mark_arxiv_seen",
  "remove_arxiv_saved_paper",
  "remove_arxiv_discarded_paper",
  "update_manual_quota",
  "show_main",
  "show_sidebar",
  "hide_sidebar",
  "toggle_sidebar_visibility",
  "get_native_quota_widget_status",
  "toggle_sidebar",
  "get_sidebar_state",
  "set_sidebar_pinned",
  "begin_sidebar_drag",
  "exit_app",
  "set_desktop_mode",
  "log_frontend_error",
] as const satisfies readonly TauriCommand[];

type CommandNameUnion = (typeof TAURI_COMMAND_NAMES)[number];
type _MissingFromCommandNames = Exclude<TauriCommand, CommandNameUnion>;
type _AssertAllCommandsListed = [_MissingFromCommandNames] extends [never] ? true : never;
const _allCommandsListed: _AssertAllCommandsListed = true;
void _allCommandsListed;

export type TauriInvokeResult<C extends TauriCommand> = TauriCommandMap[C];

export interface TauriCommandArgs {
  get_app_config: undefined;
  get_gpu_config: undefined;
  ssh_config_has_host: { host: string };
  get_paper_config: undefined;
  get_arxiv_config: undefined;
  get_quota_config: undefined;
  get_theme_config: undefined;
  get_gpu_data: undefined;
  get_deadlines: undefined;
  get_arxiv_papers: undefined;
  get_quota_data: undefined;
  refresh_gpu_data: undefined;
  refresh_paper_deadlines: undefined;
  refresh_arxiv: undefined;
  refresh_quota: undefined;
  get_arxiv_saved_papers: undefined;
  get_arxiv_discarded_papers: undefined;
  get_config_dir_path: undefined;
  get_corrupt_config_files: undefined;
  get_antigravity_setup_status: undefined;
  check_for_updates: undefined;
  save_gpu_config: { config: GpuConfig };
  save_paper_config: { config: PaperConfig };
  save_arxiv_config: { config: ArxivConfig };
  save_quota_config: { config: QuotaConfig };
  save_app_config: { config: AppConfig };
  save_sidebar_tile_layout: {
    order: string[];
    layout: Record<string, SidebarTileLayoutConfig>;
    widgets: Record<string, boolean> | null;
  };
  set_widget_always_on_top: { label: string; pinned: boolean };
  set_widget_desktop_fixed: { label: string; fixed: boolean };
  save_theme_config: { config: WidgetThemeConfig };
  toggle_widget: { id: string; title: string };
  create_widget: { id: string; title: string };
  close_widget: { id: string };
  set_desktop_mode: { label: string; enabled: boolean };
  open_link: { url: string };
  mark_arxiv_seen: { id: string; saved: boolean };
  remove_arxiv_saved_paper: { id: string };
  remove_arxiv_discarded_paper: { id: string };
  update_manual_quota: { id: string; value: number };
  download_and_install_update: { downloadUrl: string; assetName: string };
  restore_widget_position: { id: string; title: string };
  log_frontend_error: {
    message: string;
    source?: string;
    lineno?: number;
    colno?: number;
    error?: string;
  };
  show_main: undefined;
  hide_all_widgets: undefined;
  show_sidebar: undefined;
  hide_sidebar: undefined;
  toggle_sidebar_visibility: undefined;
  get_native_quota_widget_status: undefined;
  toggle_sidebar: undefined;
  get_sidebar_state: undefined;
  set_sidebar_pinned: { pinned: boolean };
  begin_sidebar_drag: undefined;
  exit_app: undefined;
  open_log_dir: undefined;
  open_config_dir: undefined;
}
