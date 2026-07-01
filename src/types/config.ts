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
  active_widgets?: Record<string, boolean>;
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
}

export interface QuotaConfig {
  items: QuotaItemConfig[];
  update_interval?: number;
  show_account_name?: boolean;
  show_plan_type?: boolean;
}

export interface PaperConfig {
  update_interval?: number;
  max_deadlines?: number;
  show_past_deadlines?: boolean;
  filter_by_rank?: string[];
  filter_by_sub?: string[];
  pinned_titles?: string[];
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

export interface ServerGpuData {
  host: string;
  is_online: boolean;
  gpu_list: GpuInfo[];
  error?: string | null;
  last_update?: string | null;
  slurm_steps?: Record<string, SlurmStep[]> | null;
  slurm_nodelists?: Record<string, string> | null;
  slurm_times?: Record<string, string> | null;
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
}
