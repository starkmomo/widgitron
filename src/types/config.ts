export type DashboardTheme = "dark" | "light";

export interface AppConfig {
  theme?: DashboardTheme;
  always_on_top?: Record<string, boolean>;
  embedded?: Record<string, boolean>;
  gpu_enabled?: boolean;
  deadline_enabled?: boolean;
  arxiv_enabled?: boolean;
  quota_enabled?: boolean;
  hide_on_startup?: boolean;
  arxiv_proxy?: string;
  global_scale?: number;
  sidebar_hotkey?: string;
  sidebar_edge?: "left" | "top" | "right" | "bottom";
  sidebar_pinned?: boolean;
  sidebar_hide_widget_headers?: boolean;
  sidebar_monitor_x?: number;
  sidebar_monitor_y?: number;
  sidebar_theme?: SidebarThemeConfig;
  sidebar_width?: number;
  sidebar_length?: number;
  sidebar_widgets?: Record<string, boolean>;
  sidebar_layout?: Record<string, number>;
  sidebar_order?: string[];
  sidebar_tile_sizes?: Record<string, string>;
  sidebar_tile_layout?: Record<string, SidebarTileLayoutConfig>;
  /** 1–10. Lower = harder to open from the screen edge (default 4). */
  sidebar_reveal_sensitivity?: number;
  /** 1–10. Higher = hides sooner after the pointer leaves (default 8). */
  sidebar_hide_sensitivity?: number;
  active_widgets?: Record<string, boolean>;
  language?: "zh-CN" | "en";
  macos_setup_version?: number;
}

export interface SidebarTileLayoutConfig {
  x?: number;
  y?: number;
  w?: number;
  h?: number;
}

export type SidebarThemePresetId = "midnight" | "light";

/** `transparent` remains readable so existing profiles migrate to Light. */
export type SidebarThemeKind = SidebarThemePresetId | "transparent" | "custom";

export interface SidebarThemeDefinition {
  id: string;
  name: string;
  preset?: SidebarThemeKind;
  background?: string;
  header?: string;
  quota?: string;
  gpu?: string;
  deadlines?: string;
  arxiv?: string;
  background_opacity?: number;
  header_opacity?: number;
  card_opacity?: number;
  blur?: number;
}

export interface SidebarThemeConfig {
  /** Legacy selected preset, retained for existing profiles. */
  preset?: SidebarThemeKind;
  /** The selected built-in or user-created theme id. */
  active_theme_id?: string;
  /** User-created editable copies. Built-in themes are always available. */
  themes?: SidebarThemeDefinition[];
  background?: string;
  header?: string;
  quota?: string;
  gpu?: string;
  deadlines?: string;
  arxiv?: string;
  background_opacity?: number;
  header_opacity?: number;
  card_opacity?: number;
  blur?: number;
}

export interface ServerConfig {
  id?: string;
  host: string;
  port?: number;
  user?: string;
  password?: string;
  key_file?: string;
  use_ssh_config?: boolean;
  use_slurm?: boolean;
  show_squeue_list?: boolean;
  squeue_all_users?: boolean;
}

export interface GpuConfig {
  servers: ServerConfig[];
  update_interval?: number;
  compact_mode?: boolean;
}

export interface QuotaItemConfig {
  id: string;
  name: string;
  provider: string;
  auth_mode?: string;
  api_key?: string;
  encrypted_api_key?: string | null;
  api_url?: string;
  json_path?: string;
  max_quota?: number;
  unit?: string;
  account_label?: string;
  plan_type?: string;
  visualizations?: QuotaVisualizationConfig;
}

export interface QuotaConfig {
  items: QuotaItemConfig[];
  update_interval?: number;
  show_account_name?: boolean;
  show_plan_type?: boolean;
  visualizations?: QuotaVisualizationConfig;
  /** One-time migration: Codex / Claude Code / Cursor pinned to top. */
  preferred_provider_order_applied?: boolean;
}

export interface QuotaVisualizationConfig {
  spend_summary?: boolean;
  calendar_heatmap?: boolean;
  daily_bars?: boolean;
  model_breakdown?: boolean;
  token_summary?: boolean;
  /** @deprecated Prefer `heatmap_metric` / `bars_metric`. Kept for older configs. */
  daily_metric?: "queries" | "tokens";
  /** `queries` (default) or `tokens` for calendar heatmap */
  heatmap_metric?: "queries" | "tokens";
  /** `queries` (default) or `tokens` for daily bars */
  bars_metric?: "queries" | "tokens";
  /** `spend` (default) or `tokens` for spend summary card */
  spend_metric?: "spend" | "tokens";
  /** `spend` (default) or `tokens` for model breakdown */
  model_metric?: "spend" | "tokens";
}

export interface QuotaDailyPoint {
  date: string;
  value: number;
  label?: string | null;
}

export interface QuotaModelBreakdown {
  model: string;
  value: number;
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_tokens?: number | null;
  token_total?: number | null;
}

export interface QuotaSpendSummary {
  spent_cents: number;
  limit_cents?: number | null;
  included_cents?: number | null;
  bonus_cents?: number | null;
  remaining_cents?: number | null;
  billing_cycle_start?: string | null;
  billing_cycle_end?: string | null;
  billing_cycle_progress_pct?: number | null;
  currency?: string | null;
}

export interface QuotaTokenSummary {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens?: number | null;
  cache_write_tokens?: number | null;
  total_tokens?: number | null;
  session_count?: number | null;
  request_count?: number | null;
}

export interface QuotaAnalytics {
  spend?: QuotaSpendSummary | null;
  daily_activity?: QuotaDailyPoint[];
  daily_queries?: QuotaDailyPoint[];
  daily_tokens?: QuotaDailyPoint[];
  model_breakdown?: QuotaModelBreakdown[];
  tokens?: QuotaTokenSummary | null;
  total_cost_cents?: number | null;
}

export interface PaperConfig {
  update_interval?: number;
  max_deadlines?: number;
  show_past_deadlines?: boolean;
  filter_by_rank?: string[];
  filter_by_sub?: string[];
  pinned_titles?: string[];
  pinned_deadline_ids?: string[];
  subscribed_titles?: string[];
  filter_by_core?: string[];
}

export interface ArxivConfig {
  keywords?: string[];
  categories?: string[];
  update_interval?: number;
  show_card_hints?: boolean;
}

export interface ArxivPaper {
  id: string;
  title: string;
  summary: string;
  matched_keywords?: string[];
  authors: string[];
  link: string;
  published: string;
  updated?: string;
}

export interface GpuInfo {
  name: string;
  mem_used: number;
  mem_total: number;
  util: number;
  temp?: number | null;
  power?: number | null;
  job_id?: string | null;
  node?: string | null;
}

export interface SlurmStep {
  id: string;
  name: string;
  time: string;
  command: string;
}

export interface SlurmQueueJob {
  id: string;
  name: string;
  user: string;
  state: string;
  time: string;
  nodelist: string;
}

export interface ServerGpuData {
  host: string;
  is_online: boolean;
  gpu_list: GpuInfo[];
  error?: string | null;
  last_update?: string | null;
  system?: {
    cpu_percent?: number | null;
    memory_used_bytes: number;
    memory_total_bytes: number;
  } | null;
  slurm_steps?: Record<string, SlurmStep[]> | null;
  slurm_nodelists?: Record<string, string> | null;
  slurm_times?: Record<string, string> | null;
  slurm_queue_jobs?: SlurmQueueJob[] | null;
}

export interface PaperDeadlineInfo {
  title: string;
  year: string;
  deadline_utc: string;
  timezone: string;
  rank: string;
  sub: string;
  place: string;
  link: string;
  ccf?: string | null;
  core?: string | null;
}

export interface QuotaBar {
  name: string;
  value: number;
  reset?: string | null;
}

export interface QuotaBarDisplay {
  val: number;
  name: string;
  reset?: string | null;
}

export interface QuotaItem {
  id: string;
  name: string;
  provider: string;
  auth_mode?: string | null;
  api_key: string;
  encrypted_api_key?: string | null;
  api_url?: string | null;
  json_path?: string | null;
  max_quota?: number | null;
  current_value?: number | null;
  error_msg?: string | null;
  last_update?: string | null;
  unit?: string | null;
  account_label?: string | null;
  primary_name?: string | null;
  primary_reset?: string | null;
  secondary_value?: number | null;
  secondary_name?: string | null;
  secondary_reset?: string | null;
  tertiary_value?: number | null;
  tertiary_name?: string | null;
  tertiary_reset?: string | null;
  bars?: QuotaBar[] | null;
  plan_type?: string | null;
  analytics?: QuotaAnalytics | null;
  visualizations?: QuotaVisualizationConfig | null;
}
