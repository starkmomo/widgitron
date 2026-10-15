import { listen, type Event, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AppConfigUpdatePayload,
  ArxivConfigUpdatePayload,
  ArxivUpdatePayload,
  BackendServiceErrorPayload,
  GpuConfigUpdatePayload,
  GpuPrunePayload,
  GpuUpdatePayload,
  OtaDownloadProgressPayload,
  PaperConfigUpdatePayload,
  PaperUpdatePayload,
  QuotaConfigUpdatePayload,
  QuotaMonitorStatusPayload,
  QuotaUpdatePayload,
  SidebarStateUpdatePayload,
  ThemeUpdatePayload,
  UnitPayload,
  WidgetVisibilityChangedPayload,
} from "../types/events";

export interface TauriEventMap {
  app_config_update: AppConfigUpdatePayload;
  main_navigation_pending: UnitPayload;
  gpu_config_update: GpuConfigUpdatePayload;
  paper_config_update: PaperConfigUpdatePayload;
  arxiv_config_update: ArxivConfigUpdatePayload;
  quota_config_update: QuotaConfigUpdatePayload;
  theme_update: ThemeUpdatePayload;
  gpu_update: GpuUpdatePayload;
  paper_update: PaperUpdatePayload;
  arxiv_update: ArxivUpdatePayload;
  quota_update: QuotaUpdatePayload;
  widget_visibility_changed: WidgetVisibilityChangedPayload;
  gpu_clear: UnitPayload;
  gpu_prune: GpuPrunePayload;
  arxiv_saved_update: UnitPayload;
  arxiv_discarded_update: UnitPayload;
  ota_download_progress: OtaDownloadProgressPayload;
  quota_monitor_status: QuotaMonitorStatusPayload;
  sidebar_state_update: SidebarStateUpdatePayload;
  paper_error: BackendServiceErrorPayload;
  arxiv_error: BackendServiceErrorPayload;
}

export type TauriEvent = keyof TauriEventMap;

export type TauriEventPayload<E extends TauriEvent> = TauriEventMap[E];

/** All frontend/backend event names — useful for grep and runtime checks. */
export const TAURI_EVENT_NAMES = [
  "app_config_update",
  "main_navigation_pending",
  "gpu_config_update",
  "paper_config_update",
  "arxiv_config_update",
  "quota_config_update",
  "theme_update",
  "gpu_update",
  "paper_update",
  "arxiv_update",
  "quota_update",
  "widget_visibility_changed",
  "gpu_clear",
  "gpu_prune",
  "arxiv_saved_update",
  "arxiv_discarded_update",
  "ota_download_progress",
  "quota_monitor_status",
  "sidebar_state_update",
  "paper_error",
  "arxiv_error",
] as const satisfies readonly TauriEvent[];

export function tauriListen<E extends TauriEvent>(
  event: E,
  handler: (event: Event<TauriEventMap[E]>) => void
): Promise<UnlistenFn> {
  return listen<TauriEventMap[E]>(event, handler);
}
