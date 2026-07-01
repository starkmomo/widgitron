use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;

// --- Config Models ---
#[derive(Debug, Serialize, Deserialize, Default, Clone)]
pub struct ServerConfig {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub host: String,
    pub port: Option<u16>,
    pub user: Option<String>,
    pub password: Option<String>,
    pub key_file: Option<String>,
    pub use_ssh_config: Option<bool>,
    pub use_slurm: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GpuConfig {
    pub servers: Vec<ServerConfig>,
    pub update_interval: Option<u64>,
    pub compact_mode: Option<bool>,
}

impl Default for GpuConfig {
    fn default() -> Self {
        Self {
            servers: vec![],
            update_interval: Some(5),
            compact_mode: Some(true),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PaperConfig {
    pub update_interval: Option<u64>,
    pub max_deadlines: Option<usize>,
    pub show_past_deadlines: Option<bool>,
    pub filter_by_rank: Option<Vec<String>>,
    pub filter_by_sub: Option<Vec<String>>,
    pub pinned_titles: Option<Vec<String>>,
    pub filter_by_core: Option<Vec<String>>,
}

impl Default for PaperConfig {
    fn default() -> Self {
        Self {
            update_interval: Some(3600),
            max_deadlines: Some(50),
            show_past_deadlines: Some(false),
            filter_by_rank: Some(vec!["A".into(), "B".into(), "C".into()]),
            filter_by_sub: None,
            pinned_titles: None,
            filter_by_core: Some(vec!["A*".into(), "A".into()]),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ArxivConfig {
    pub keywords: Vec<String>,
    pub categories: Vec<String>,
    pub update_interval: u64,
    pub show_card_hints: Option<bool>,
}

impl Default for ArxivConfig {
    fn default() -> Self {
        Self {
            keywords: vec!["gaussian".into(), "vla".into(), "llm".into()],
            categories: vec!["cs".into()],
            update_interval: 3600, // 1 hour
            show_card_hints: Some(true),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ArxivPaper {
    pub id: String,
    pub title: String,
    pub summary: String,
    #[serde(default)]
    pub matched_keywords: Vec<String>,
    pub authors: Vec<String>,
    pub link: String,
    pub published: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppConfig {
    pub theme: Option<String>,
    pub always_on_top: Option<HashMap<String, bool>>,
    pub embedded: Option<HashMap<String, bool>>,
    pub gpu_enabled: Option<bool>,
    pub deadline_enabled: Option<bool>,
    pub arxiv_enabled: Option<bool>,
    pub quota_enabled: Option<bool>,
    pub hide_on_startup: Option<bool>,
    pub arxiv_proxy: Option<String>,
    pub active_widgets: Option<HashMap<String, bool>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WidgetVisibilityPayload {
    pub id: String,
    pub visible: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ToggleWidgetResponse {
    pub visible: bool,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            theme: Some("dark".into()),
            always_on_top: Some(HashMap::new()),
            embedded: Some(HashMap::new()),
            gpu_enabled: Some(true),
            deadline_enabled: Some(true),
            arxiv_enabled: Some(true),
            quota_enabled: Some(true),
            hide_on_startup: Some(false),
            arxiv_proxy: None,
            active_widgets: Some(HashMap::new()),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, Default, PartialEq)]
pub struct QuotaBar {
    pub name: String,
    pub value: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reset: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct QuotaItem {
    pub id: String,
    pub name: String,
    pub provider: String,
    /// `"local"` (IDE / local login) or `"api_key"`. When unset, provider default applies.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auth_mode: Option<String>,
    #[serde(default)]
    pub api_key: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub encrypted_api_key: Option<String>,
    pub api_url: Option<String>,
    pub json_path: Option<String>,
    pub max_quota: Option<f64>,
    pub current_value: Option<f64>,
    pub error_msg: Option<String>,
    pub last_update: Option<String>,
    pub unit: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account_label: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub primary_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub primary_reset: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub secondary_value: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub secondary_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub secondary_reset: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tertiary_value: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tertiary_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tertiary_reset: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bars: Option<Vec<QuotaBar>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plan_type: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct QuotaConfig {
    pub items: Vec<QuotaItem>,
    pub update_interval: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub show_account_name: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub show_plan_type: Option<bool>,
}

impl Default for QuotaConfig {
    fn default() -> Self {
        Self {
            items: vec![],
            update_interval: Some(300),
            show_account_name: Some(false),
            show_plan_type: Some(true),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ColorConfig {
    pub name: String,
    pub value: String,
    pub opacity: Option<f32>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WidgetTheme {
    pub id: String,
    pub name: String,
    pub is_default: bool,
    pub bg_color: String,
    pub bg_opacity: f32,
    pub text_colors: Vec<ColorConfig>,
    pub primary_colors: Vec<ColorConfig>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub widget_scope: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WidgetThemeConfig {
    pub themes: Vec<WidgetTheme>,
    pub assignments: HashMap<String, String>, // widget_id -> theme_id
}

impl Default for WidgetThemeConfig {
    fn default() -> Self {
        let gpu_default = WidgetTheme {
            id: "theme-gpu-default".into(),
            name: "GPU Default".into(),
            is_default: true,
            bg_color: "#0f172a".into(),
            bg_opacity: 0.95,
            text_colors: vec![
                ColorConfig {
                    name: "Main Text".into(),
                    value: "#ffffff".into(),
                    opacity: Some(1.0),
                },
                ColorConfig {
                    name: "Sub Text".into(),
                    value: "#94a3b8".into(),
                    opacity: Some(0.6),
                },
            ],
            primary_colors: vec![
                ColorConfig {
                    name: "Accent".into(),
                    value: "#3b82f6".into(),
                    opacity: Some(1.0),
                },
                ColorConfig {
                    name: "Success".into(),
                    value: "#10b981".into(),
                    opacity: Some(1.0),
                },
                ColorConfig {
                    name: "Warning".into(),
                    value: "#f59e0b".into(),
                    opacity: Some(1.0),
                },
                ColorConfig {
                    name: "Danger".into(),
                    value: "#ef4444".into(),
                    opacity: Some(1.0),
                },
            ],
            widget_scope: None,
        };
        let deadline_default = WidgetTheme {
            id: "theme-deadline-default".into(),
            name: "Deadline Default".into(),
            is_default: true,
            bg_color: "#0f172a".into(),
            bg_opacity: 0.95,
            text_colors: vec![
                ColorConfig {
                    name: "Main Text".into(),
                    value: "#ffffff".into(),
                    opacity: Some(1.0),
                },
                ColorConfig {
                    name: "Sub Text".into(),
                    value: "#94a3b8".into(),
                    opacity: Some(0.6),
                },
            ],
            primary_colors: vec![
                ColorConfig {
                    name: "Accent".into(),
                    value: "#8b5cf6".into(),
                    opacity: Some(1.0),
                },
                ColorConfig {
                    name: "Highlight".into(),
                    value: "#f59e0b".into(),
                    opacity: Some(1.0),
                },
            ],
            widget_scope: None,
        };
        let gpu_transparent = WidgetTheme {
            id: "theme-gpu-transparent".into(),
            name: "GPU Transparent".into(),
            is_default: true,
            bg_color: "#ffffff".into(),
            bg_opacity: 0.1,
            text_colors: vec![
                ColorConfig {
                    name: "Main Text".into(),
                    value: "#000000".into(),
                    opacity: Some(1.0),
                },
                ColorConfig {
                    name: "Sub Text".into(),
                    value: "#000000".into(),
                    opacity: Some(1.0),
                },
            ],
            primary_colors: vec![
                ColorConfig {
                    name: "Accent".into(),
                    value: "#3b82f6".into(),
                    opacity: Some(1.0),
                },
                ColorConfig {
                    name: "Success".into(),
                    value: "#10b981".into(),
                    opacity: Some(1.0),
                },
                ColorConfig {
                    name: "Warning".into(),
                    value: "#f59e0b".into(),
                    opacity: Some(1.0),
                },
                ColorConfig {
                    name: "Danger".into(),
                    value: "#ef4444".into(),
                    opacity: Some(1.0),
                },
            ],
            widget_scope: None,
        };
        let deadline_transparent = WidgetTheme {
            id: "theme-deadline-transparent".into(),
            name: "Deadline Transparent".into(),
            is_default: true,
            bg_color: "#ffffff".into(),
            bg_opacity: 0.1,
            text_colors: vec![
                ColorConfig {
                    name: "Main Text".into(),
                    value: "#000000".into(),
                    opacity: Some(1.0),
                },
                ColorConfig {
                    name: "Sub Text".into(),
                    value: "#000000".into(),
                    opacity: Some(1.0),
                },
            ],
            primary_colors: vec![
                ColorConfig {
                    name: "Accent".into(),
                    value: "#8b5cf6".into(),
                    opacity: Some(1.0),
                },
                ColorConfig {
                    name: "Highlight".into(),
                    value: "#f59e0b".into(),
                    opacity: Some(1.0),
                },
            ],
            widget_scope: None,
        };
        let arxiv_default = WidgetTheme {
            id: "theme-arxiv-default".into(),
            name: "Arxiv Radar Default".into(),
            is_default: true,
            bg_color: "#0f172a".into(),
            bg_opacity: 0.8,
            text_colors: vec![
                ColorConfig {
                    name: "Main Text".into(),
                    value: "#ffffff".into(),
                    opacity: Some(1.0),
                },
                ColorConfig {
                    name: "Sub Text".into(),
                    value: "#94a3b8".into(),
                    opacity: Some(0.8),
                },
            ],
            primary_colors: vec![ColorConfig {
                name: "Accent".into(),
                value: "#ec4899".into(),
                opacity: Some(1.0),
            }],
            widget_scope: None,
        };
        let arxiv_transparent = WidgetTheme {
            id: "theme-arxiv-transparent".into(),
            name: "Arxiv Transparent".into(),
            is_default: true,
            bg_color: "#ffffff".into(),
            bg_opacity: 0.1,
            text_colors: vec![
                ColorConfig {
                    name: "Main Text".into(),
                    value: "#000000".into(),
                    opacity: Some(1.0),
                },
                ColorConfig {
                    name: "Sub Text".into(),
                    value: "#000000".into(),
                    opacity: Some(1.0),
                },
            ],
            primary_colors: vec![ColorConfig {
                name: "Accent".into(),
                value: "#ec4899".into(),
                opacity: Some(1.0),
            }],
            widget_scope: None,
        };
        let quota_default = WidgetTheme {
            id: "theme-quota-default".into(),
            name: "Quota Default".into(),
            is_default: true,
            bg_color: "#0f172a".into(),
            bg_opacity: 0.95,
            text_colors: vec![
                ColorConfig {
                    name: "Main Text".into(),
                    value: "#ffffff".into(),
                    opacity: Some(1.0),
                },
                ColorConfig {
                    name: "Sub Text".into(),
                    value: "#94a3b8".into(),
                    opacity: Some(0.6),
                },
            ],
            primary_colors: vec![
                ColorConfig {
                    name: "Accent".into(),
                    value: "#06b6d4".into(),
                    opacity: Some(1.0),
                },
                ColorConfig {
                    name: "Success".into(),
                    value: "#10b981".into(),
                    opacity: Some(1.0),
                },
                ColorConfig {
                    name: "Warning".into(),
                    value: "#f59e0b".into(),
                    opacity: Some(1.0),
                },
                ColorConfig {
                    name: "Danger".into(),
                    value: "#ef4444".into(),
                    opacity: Some(1.0),
                },
            ],
            widget_scope: None,
        };
        let quota_transparent = WidgetTheme {
            id: "theme-quota-transparent".into(),
            name: "Quota Transparent".into(),
            is_default: true,
            bg_color: "#ffffff".into(),
            bg_opacity: 0.1,
            text_colors: vec![
                ColorConfig {
                    name: "Main Text".into(),
                    value: "#000000".into(),
                    opacity: Some(1.0),
                },
                ColorConfig {
                    name: "Sub Text".into(),
                    value: "#000000".into(),
                    opacity: Some(1.0),
                },
            ],
            primary_colors: vec![
                ColorConfig {
                    name: "Accent".into(),
                    value: "#06b6d4".into(),
                    opacity: Some(1.0),
                },
                ColorConfig {
                    name: "Success".into(),
                    value: "#10b981".into(),
                    opacity: Some(1.0),
                },
                ColorConfig {
                    name: "Warning".into(),
                    value: "#f59e0b".into(),
                    opacity: Some(1.0),
                },
                ColorConfig {
                    name: "Danger".into(),
                    value: "#ef4444".into(),
                    opacity: Some(1.0),
                },
            ],
            widget_scope: None,
        };

        let mut assignments = HashMap::new();
        assignments.insert("widget-gpu-default".into(), "theme-gpu-transparent".into());
        assignments.insert(
            "widget-deadlines-default".into(),
            "theme-deadline-transparent".into(),
        );
        assignments.insert(
            "widget-arxiv-default".into(),
            "theme-arxiv-transparent".into(),
        );
        assignments.insert(
            "widget-quota-default".into(),
            "theme-quota-transparent".into(),
        );

        Self {
            themes: vec![
                gpu_default,
                deadline_default,
                arxiv_default,
                quota_default,
                gpu_transparent,
                deadline_transparent,
                arxiv_transparent,
                quota_transparent,
            ],
            assignments,
        }
    }
}

// --- Payload Models ---
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct GpuInfo {
    pub name: String,
    pub mem_used: f32,
    pub mem_total: f32,
    pub util: f32,
    pub temp: Option<f32>,
    pub power: Option<f32>,
    pub job_id: Option<String>,
    pub node: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct SlurmStep {
    pub id: String,
    pub name: String,
    pub time: String,
    pub command: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct ServerGpuData {
    pub host: String,
    pub is_online: bool,
    pub gpu_list: Vec<GpuInfo>,
    pub error: Option<String>,
    pub last_update: Option<String>,
    pub slurm_steps: Option<HashMap<String, Vec<SlurmStep>>>,
    pub slurm_nodelists: Option<HashMap<String, String>>,
    pub slurm_times: Option<HashMap<String, String>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PaperDeadlineInfo {
    pub title: String,
    pub year: String,
    pub deadline_utc: String, // ISO8601
    pub timezone: String,
    pub rank: String,
    pub sub: String,
    pub place: String,
    pub link: String,
    pub ccf: Option<String>,
    pub core: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct YamlConfTimeline {
    pub deadline: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct YamlConfYear {
    pub year: String,
    pub timezone: Option<String>,
    pub place: Option<String>,
    pub link: Option<String>,
    pub timeline: Option<Vec<YamlConfTimeline>>,
}

#[derive(Debug, Deserialize)]
pub struct YamlConfRank {
    pub ccf: Option<String>,
    pub core: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct YamlConfItem {
    pub title: String,
    pub sub: Option<String>,
    pub rank: Option<YamlConfRank>,
    pub confs: Option<Vec<YamlConfYear>>,
}

pub struct GlobalState {
    pub deadlines: Arc<std::sync::Mutex<Vec<PaperDeadlineInfo>>>,
    pub gpu_data: Arc<std::sync::Mutex<HashMap<String, ServerGpuData>>>,
    pub gpu_last_emitted: Arc<std::sync::Mutex<HashMap<String, ServerGpuData>>>,
    pub last_yaml: Arc<std::sync::Mutex<Option<String>>>,
    pub active_monitors: Arc<std::sync::Mutex<HashMap<String, tokio::task::JoinHandle<()>>>>,
    pub active_workers: Arc<std::sync::Mutex<HashMap<String, tokio::task::JoinHandle<()>>>>,
    pub arxiv_papers: Arc<std::sync::Mutex<Vec<ArxivPaper>>>,
    pub quota_data: Arc<std::sync::Mutex<Vec<QuotaItem>>>,
    pub quota_fetch_lock: Arc<tokio::sync::Mutex<()>>,
    pub widget_toggle_lock: Arc<tokio::sync::Mutex<()>>,
}
