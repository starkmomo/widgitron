import { getCurrentWindow } from "@tauri-apps/api/window";
import { getAllWebviewWindows } from "@tauri-apps/api/webviewWindow";
import type { AppConfig } from "../types/config";
import { tauriInvoke } from "./tauriInvoke";
import {
  LIVE_DATA_SECTION,
  LIVE_DATA_SECTION_LABELS,
  type AppTab,
  type LiveDataSection,
  type SectionLiveDataMap,
} from "./sectionLiveData";

export type ServiceField = "gpu_enabled" | "deadline_enabled" | "arxiv_enabled" | "quota_enabled";

export const SERVICE_FIELD_TO_TAB: Record<ServiceField, LiveDataSection> = {
  gpu_enabled: "gpu",
  deadline_enabled: "deadlines",
  arxiv_enabled: "arxiv",
  quota_enabled: "quota",
};

export const SERVICE_WIDGET_IDS: Record<ServiceField, string> = {
  gpu_enabled: "widget-gpu-default",
  deadline_enabled: "widget-deadlines-default",
  arxiv_enabled: "widget-arxiv-default",
  quota_enabled: "widget-quota-default",
};

export const SERVICE_WIDGET_ID_LIST = Object.values(SERVICE_WIDGET_IDS);

export function serviceWidgetMeta(field: ServiceField): { id: string; title: string } {
  return {
    id: SERVICE_WIDGET_IDS[field],
    title: LIVE_DATA_SECTION_LABELS[SERVICE_FIELD_TO_TAB[field]],
  };
}

export interface ServiceDisableHandlers {
  onGpuDisable?: () => void;
  onDeadlineDisable?: () => void;
  onArxivDisable?: () => void;
  onQuotaDisable?: () => void;
}

export interface ServiceDisableClearActions {
  clearData?: () => void;
  clearRefreshError?: () => void;
  clearBackendError?: () => void;
  clearMonitorStatus?: () => void;
  onExtra?: () => void;
}

export function runServiceDisableClears(actions: ServiceDisableClearActions): void {
  actions.clearData?.();
  actions.clearRefreshError?.();
  actions.clearBackendError?.();
  actions.clearMonitorStatus?.();
  actions.onExtra?.();
}

export function buildServiceDisableHandlers(
  actionsByField: Partial<Record<ServiceField, ServiceDisableClearActions>>
): ServiceDisableHandlers {
  const handler = (field: ServiceField): (() => void) | undefined => {
    const actions = actionsByField[field];
    if (!actions) return undefined;
    return () => runServiceDisableClears(actions);
  };
  return {
    onGpuDisable: handler("gpu_enabled"),
    onDeadlineDisable: handler("deadline_enabled"),
    onArxivDisable: handler("arxiv_enabled"),
    onQuotaDisable: handler("quota_enabled"),
  };
}

export function applyServiceDisableClears(
  prevConfig: AppConfig | null | undefined,
  nextConfig: AppConfig | null | undefined,
  handlers: ServiceDisableHandlers
) {
  if (!nextConfig) return;

  if (prevConfig?.gpu_enabled !== false && nextConfig.gpu_enabled === false) {
    handlers.onGpuDisable?.();
  }
  if (prevConfig?.deadline_enabled !== false && nextConfig.deadline_enabled === false) {
    handlers.onDeadlineDisable?.();
  }
  if (prevConfig?.arxiv_enabled !== false && nextConfig.arxiv_enabled === false) {
    handlers.onArxivDisable?.();
  }
  if (prevConfig?.quota_enabled !== false && nextConfig.quota_enabled === false) {
    handlers.onQuotaDisable?.();
  }
}

export async function handleWidgetAppConfigUpdate(
  payload: AppConfig | null | undefined,
  currentEnabled: boolean,
  options: {
    serviceField: ServiceField;
    setServiceEnabled: (enabled: boolean) => void;
    setDashboardTheme?: (theme: "light" | "dark") => void;
    disableClears: ServiceDisableClearActions;
  }
): Promise<boolean> {
  if (!payload) return currentEnabled;
  if (payload.theme && options.setDashboardTheme) {
    options.setDashboardTheme(payload.theme === "light" ? "light" : "dark");
  }
  const nextEnabled = payload[options.serviceField] !== false;
  if (nextEnabled === currentEnabled) return currentEnabled;
  options.setServiceEnabled(nextEnabled);
  if (!nextEnabled) {
    runServiceDisableClears(options.disableClears);
    await closeCurrentWidgetWindow();
  }
  return nextEnabled;
}

export function applyWidgetVisibilityChange(
  labels: string[],
  id: string,
  visible: boolean
): string[] {
  if (visible) {
    return labels.includes(id) ? labels : [...labels, id];
  }
  return labels.filter((label) => label !== id);
}

export type ServiceFieldLiveData = {
  gpu_enabled: SectionLiveDataMap["gpu"];
  deadline_enabled: SectionLiveDataMap["deadlines"];
  arxiv_enabled: SectionLiveDataMap["arxiv"];
  quota_enabled: SectionLiveDataMap["quota"];
};

export type ServiceRefreshPayload =
  | ServiceFieldLiveData["gpu_enabled"][]
  | ServiceFieldLiveData["deadline_enabled"][]
  | ServiceFieldLiveData["arxiv_enabled"][]
  | ServiceFieldLiveData["quota_enabled"][];

export type ServiceToggleCallbacks<F extends ServiceField> = {
  onRefreshStart?: () => void;
  onRefreshEnd?: () => void;
  onRefreshError?: (message: string) => void;
  onRefreshSuccess?: (data: ServiceFieldLiveData[F][]) => void;
  onDisableStart?: () => void;
  onDisableEnd?: () => void;
  onToggleError?: (message: string) => void;
};

export type ServiceToggleCallbacksByField = {
  [F in ServiceField]: ServiceToggleCallbacks<F>;
};

export type ServiceToggleError = { field: ServiceField; message: string };

export function serviceToggleErrorForTab(
  error: ServiceToggleError | null,
  activeTab: AppTab
): string | null {
  if (!error) return null;
  if (SERVICE_FIELD_TO_TAB[error.field] !== activeTab) return null;
  return error.message;
}

export function formatWidgetToggleError(message: string): string {
  return `Widget toggle failed: ${message}`;
}

export async function invokeToggleWidget(id: string, title: string): Promise<boolean> {
  const { visible } = await tauriInvoke("toggle_widget", { id, title });
  return visible;
}

/** @deprecated Use ServiceToggleCallbacks */
export type ServiceEnableCallbacks<F extends ServiceField> = ServiceToggleCallbacks<F>;

export function serviceToggleLabel(field: ServiceField): string {
  return LIVE_DATA_SECTION_LABELS[SERVICE_FIELD_TO_TAB[field]];
}

export function serviceToggleServiceLabel(field: ServiceField): string {
  return `${serviceToggleLabel(field)} Service`;
}

export type ServiceToggleBusyState = Partial<Record<ServiceField, boolean>>;

export type SetServiceToggleBusy = (
  updater: (prev: ServiceToggleBusyState) => ServiceToggleBusyState
) => void;

export function createSetServiceBusy(
  setServiceToggleBusy: SetServiceToggleBusy
): (field: ServiceField, busy: boolean) => void {
  return (field, busy) => {
    setServiceToggleBusy((prev) => {
      if (busy) return { ...prev, [field]: true };
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };
}

export function isServiceToggleBusy(
  field: ServiceField,
  serviceToggleBusy: ServiceToggleBusyState
): boolean {
  return Boolean(serviceToggleBusy[field]);
}

export function formatServiceToggleError(
  field: ServiceField,
  message: string,
  kind: "toggle" | "refresh" = "toggle"
): string {
  const label = serviceToggleLabel(field);
  return kind === "refresh" ? `${label} refresh failed: ${message}` : `${label} toggle failed: ${message}`;
}

const refreshServiceFieldData = {
  gpu_enabled: () => tauriInvoke("refresh_gpu_data"),
  deadline_enabled: () => tauriInvoke("refresh_paper_deadlines"),
  arxiv_enabled: () => tauriInvoke("refresh_arxiv"),
  quota_enabled: () => tauriInvoke("refresh_quota"),
} satisfies {
  [F in ServiceField]: () => Promise<ServiceFieldLiveData[F][]>;
};

const refreshSectionLiveData = {
  gpu: () => tauriInvoke("refresh_gpu_data"),
  deadlines: () => tauriInvoke("refresh_paper_deadlines"),
  arxiv: () => tauriInvoke("refresh_arxiv"),
  quota: () => tauriInvoke("refresh_quota"),
} satisfies {
  [S in LiveDataSection]: () => Promise<SectionLiveDataMap[S][]>;
};

const dispatchRefreshSuccess = {
  gpu_enabled: (
    callbacks: ServiceToggleCallbacks<"gpu_enabled"> | undefined,
    data: ServiceFieldLiveData["gpu_enabled"][]
  ) => {
    callbacks?.onRefreshSuccess?.(data);
  },
  deadline_enabled: (
    callbacks: ServiceToggleCallbacks<"deadline_enabled"> | undefined,
    data: ServiceFieldLiveData["deadline_enabled"][]
  ) => {
    callbacks?.onRefreshSuccess?.(data);
  },
  arxiv_enabled: (
    callbacks: ServiceToggleCallbacks<"arxiv_enabled"> | undefined,
    data: ServiceFieldLiveData["arxiv_enabled"][]
  ) => {
    callbacks?.onRefreshSuccess?.(data);
  },
  quota_enabled: (
    callbacks: ServiceToggleCallbacks<"quota_enabled"> | undefined,
    data: ServiceFieldLiveData["quota_enabled"][]
  ) => {
    callbacks?.onRefreshSuccess?.(data);
  },
} satisfies {
  [F in ServiceField]: (
    callbacks: ServiceToggleCallbacks<F> | undefined,
    data: ServiceFieldLiveData[F][]
  ) => void;
};

const SECTION_REFRESH_RUN = {
  gpu: refreshSectionLiveData.gpu,
  deadlines: refreshSectionLiveData.deadlines,
  arxiv: refreshSectionLiveData.arxiv,
  quota: refreshSectionLiveData.quota,
} satisfies {
  [S in LiveDataSection]: () => Promise<SectionLiveDataMap[S][]>;
};

export interface ServiceFieldToggleDeps<F extends ServiceField = ServiceField> {
  clearRefreshError: () => void;
  setRefreshError: (message: string) => void;
  onRefreshSuccess?: (data: ServiceFieldLiveData[F][]) => void;
}

export type ServiceFieldToggleDepsMap = {
  [F in ServiceField]: ServiceFieldToggleDeps<F>;
};

export function buildServiceFieldToggleDeps<F extends ServiceField>(
  clearRefreshError: () => void,
  setRefreshError: (message: string) => void,
  onRefreshSuccess?: (data: ServiceFieldLiveData[F][]) => void
): ServiceFieldToggleDeps<F> {
  return { clearRefreshError, setRefreshError, onRefreshSuccess };
}

export interface BuildServiceToggleCallbacksOptions {
  setServiceBusy: (field: ServiceField, busy: boolean) => void;
  fields: ServiceFieldToggleDepsMap;
  onGeneralServiceError?: (error: ServiceToggleError | null) => void;
}

function buildSingleServiceToggleCallbacks<F extends ServiceField>(
  field: F,
  deps: ServiceFieldToggleDeps<F>,
  setServiceBusy: (field: ServiceField, busy: boolean) => void,
  onGeneralServiceError?: (error: ServiceToggleError | null) => void
): ServiceToggleCallbacks<F> {
  return {
    onRefreshStart: () => {
      deps.clearRefreshError();
      onGeneralServiceError?.(null);
      setServiceBusy(field, true);
    },
    onRefreshEnd: () => setServiceBusy(field, false),
    onRefreshError: (message: string) => {
      deps.setRefreshError(message);
      onGeneralServiceError?.({
        field,
        message: formatServiceToggleError(field, message, "refresh"),
      });
    },
    onRefreshSuccess: deps.onRefreshSuccess,
    onDisableStart: () => {
      onGeneralServiceError?.(null);
      setServiceBusy(field, true);
    },
    onDisableEnd: () => setServiceBusy(field, false),
    onToggleError: (message: string) => {
      onGeneralServiceError?.({
        field,
        message: formatServiceToggleError(field, message),
      });
    },
  };
}

export function buildServiceToggleCallbacks(
  options: BuildServiceToggleCallbacksOptions
): ServiceToggleCallbacksByField {
  const { setServiceBusy, fields, onGeneralServiceError } = options;
  return {
    gpu_enabled: buildSingleServiceToggleCallbacks(
      "gpu_enabled",
      fields.gpu_enabled,
      setServiceBusy,
      onGeneralServiceError
    ),
    deadline_enabled: buildSingleServiceToggleCallbacks(
      "deadline_enabled",
      fields.deadline_enabled,
      setServiceBusy,
      onGeneralServiceError
    ),
    arxiv_enabled: buildSingleServiceToggleCallbacks(
      "arxiv_enabled",
      fields.arxiv_enabled,
      setServiceBusy,
      onGeneralServiceError
    ),
    quota_enabled: buildSingleServiceToggleCallbacks(
      "quota_enabled",
      fields.quota_enabled,
      setServiceBusy,
      onGeneralServiceError
    ),
  };
}

export interface MasterServiceToggleHandlerOptions {
  appConfig: AppConfig;
  onSaveApp: (config: AppConfig) => void | Promise<void>;
  serviceDisableHandlers?: ServiceDisableHandlers;
  onActiveWidgetsChanged?: (labels: string[]) => void | Promise<void>;
  serviceToggleCallbacks: ServiceToggleCallbacksByField;
  onClearGeneralError?: () => void;
}

export function createMasterServiceToggleHandler(
  options: MasterServiceToggleHandlerOptions
): (field: ServiceField, enabled: boolean) => Promise<void> {
  const {
    appConfig,
    onSaveApp,
    serviceDisableHandlers,
    onActiveWidgetsChanged,
    serviceToggleCallbacks,
    onClearGeneralError,
  } = options;

  return async (field, enabled) => {
    onClearGeneralError?.();
    switch (field) {
      case "gpu_enabled":
        await toggleMasterService(
          field,
          enabled,
          appConfig,
          onSaveApp,
          serviceDisableHandlers,
          onActiveWidgetsChanged,
          serviceToggleCallbacks.gpu_enabled
        );
        break;
      case "deadline_enabled":
        await toggleMasterService(
          field,
          enabled,
          appConfig,
          onSaveApp,
          serviceDisableHandlers,
          onActiveWidgetsChanged,
          serviceToggleCallbacks.deadline_enabled
        );
        break;
      case "arxiv_enabled":
        await toggleMasterService(
          field,
          enabled,
          appConfig,
          onSaveApp,
          serviceDisableHandlers,
          onActiveWidgetsChanged,
          serviceToggleCallbacks.arxiv_enabled
        );
        break;
      case "quota_enabled":
        await toggleMasterService(
          field,
          enabled,
          appConfig,
          onSaveApp,
          serviceDisableHandlers,
          onActiveWidgetsChanged,
          serviceToggleCallbacks.quota_enabled
        );
        break;
    }
  };
}

export function activeWidgetLabelsFromConfig(
  config: AppConfig | null | undefined
): string[] | null {
  const map = config?.active_widgets as Record<string, boolean> | undefined;
  if (!map) return null;
  return Object.entries(map)
    .filter(([, visible]) => visible)
    .map(([id]) => id);
}

export async function queryActiveWidgetLabels(): Promise<string[]> {
  const windows = await getAllWebviewWindows();
  const active: string[] = [];
  for (const w of windows) {
    if (w.label.startsWith("widget-") && (await w.isVisible())) {
      active.push(w.label);
    }
  }
  return active;
}

export async function resolveActiveWidgetLabels(config: AppConfig): Promise<string[]> {
  const fromConfig = activeWidgetLabelsFromConfig(config);
  if (fromConfig !== null) {
    return fromConfig;
  }
  return queryActiveWidgetLabels();
}

export async function toggleMasterService(
  field: "gpu_enabled",
  enabled: boolean,
  appConfig: AppConfig,
  onSaveApp: (config: AppConfig) => void | Promise<void>,
  handlers?: ServiceDisableHandlers,
  onActiveWidgetsChanged?: (labels: string[]) => void | Promise<void>,
  toggleCallbacks?: ServiceToggleCallbacks<"gpu_enabled">
): Promise<void>;
export async function toggleMasterService(
  field: "deadline_enabled",
  enabled: boolean,
  appConfig: AppConfig,
  onSaveApp: (config: AppConfig) => void | Promise<void>,
  handlers?: ServiceDisableHandlers,
  onActiveWidgetsChanged?: (labels: string[]) => void | Promise<void>,
  toggleCallbacks?: ServiceToggleCallbacks<"deadline_enabled">
): Promise<void>;
export async function toggleMasterService(
  field: "arxiv_enabled",
  enabled: boolean,
  appConfig: AppConfig,
  onSaveApp: (config: AppConfig) => void | Promise<void>,
  handlers?: ServiceDisableHandlers,
  onActiveWidgetsChanged?: (labels: string[]) => void | Promise<void>,
  toggleCallbacks?: ServiceToggleCallbacks<"arxiv_enabled">
): Promise<void>;
export async function toggleMasterService(
  field: "quota_enabled",
  enabled: boolean,
  appConfig: AppConfig,
  onSaveApp: (config: AppConfig) => void | Promise<void>,
  handlers?: ServiceDisableHandlers,
  onActiveWidgetsChanged?: (labels: string[]) => void | Promise<void>,
  toggleCallbacks?: ServiceToggleCallbacks<"quota_enabled">
): Promise<void>;
export async function toggleMasterService(
  field: ServiceField,
  enabled: boolean,
  appConfig: AppConfig,
  onSaveApp: (config: AppConfig) => void | Promise<void>,
  handlers?: ServiceDisableHandlers,
  onActiveWidgetsChanged?: (labels: string[]) => void | Promise<void>,
  toggleCallbacks?: ServiceToggleCallbacksByField[ServiceField]
): Promise<void> {
  const { id } = serviceWidgetMeta(field);
  const next = { ...appConfig, [field]: enabled };
  await onSaveApp(next);
  let effectiveConfig = next;

  if (!enabled) {
    applyServiceDisableClears(appConfig, next, handlers ?? {});
    toggleCallbacks?.onDisableStart?.();
    try {
      await tauriInvoke("close_widget", { id });
    } finally {
      toggleCallbacks?.onDisableEnd?.();
    }
  } else {
    toggleCallbacks?.onRefreshStart?.();
    try {
      switch (field) {
        case "gpu_enabled": {
          dispatchRefreshSuccess.gpu_enabled(
            toggleCallbacks as ServiceToggleCallbacks<"gpu_enabled"> | undefined,
            await refreshServiceFieldData.gpu_enabled()
          );
          break;
        }
        case "deadline_enabled": {
          dispatchRefreshSuccess.deadline_enabled(
            toggleCallbacks as ServiceToggleCallbacks<"deadline_enabled"> | undefined,
            await refreshServiceFieldData.deadline_enabled()
          );
          break;
        }
        case "arxiv_enabled": {
          dispatchRefreshSuccess.arxiv_enabled(
            toggleCallbacks as ServiceToggleCallbacks<"arxiv_enabled"> | undefined,
            await refreshServiceFieldData.arxiv_enabled()
          );
          break;
        }
        case "quota_enabled": {
          dispatchRefreshSuccess.quota_enabled(
            toggleCallbacks as ServiceToggleCallbacks<"quota_enabled"> | undefined,
            await refreshServiceFieldData.quota_enabled()
          );
          break;
        }
      }
    } catch (e) {
      const message = String(e);
      console.error(`Refresh after enabling ${field} failed`, e);
      toggleCallbacks?.onRefreshError?.(message);
      effectiveConfig = { ...appConfig, [field]: false };
      await onSaveApp(effectiveConfig);
      applyServiceDisableClears(next, effectiveConfig, handlers ?? {});
      toggleCallbacks?.onDisableStart?.();
      try {
        await tauriInvoke("close_widget", { id });
      } finally {
        toggleCallbacks?.onDisableEnd?.();
      }
    } finally {
      toggleCallbacks?.onRefreshEnd?.();
    }
  }

  if (onActiveWidgetsChanged) {
    try {
      const persistedConfig = await tauriInvoke("get_app_config");
      await onActiveWidgetsChanged(await resolveActiveWidgetLabels(persistedConfig));
    } catch (e) {
      console.error("Failed to refresh active widget list", e);
    }
  }
}

export async function closeCurrentWidgetWindow() {
  try {
    const label = getCurrentWindow().label;
    await tauriInvoke("close_widget", { id: label });
  } catch (e) {
    console.error("Failed to close widget on service disable", e);
  }
}

export interface CreateSectionRefreshHandlerOptions<S extends LiveDataSection = LiveDataSection> {
  isRefreshing: boolean;
  setIsRefreshing: (busy: boolean) => void;
  clearError: () => void;
  setError: (message: string) => void;
  section: S;
  onSuccess?: (data: SectionLiveDataMap[S][]) => void;
  logLabel?: string;
}

export interface LiveDataSectionErrorActions {
  gpu?: { clearRefresh: () => void };
  deadlines?: { clearRefresh: () => void; clearBackend: () => void };
  arxiv?: { clearRefresh: () => void; clearBackend: () => void };
  quota?: { clearRefresh: () => void; clearBackend: () => void };
}

export function clearLiveDataSectionErrors(
  section: LiveDataSection,
  actions: LiveDataSectionErrorActions
): void {
  switch (section) {
    case LIVE_DATA_SECTION.GPU:
      actions.gpu?.clearRefresh();
      break;
    case LIVE_DATA_SECTION.DEADLINES:
      actions.deadlines?.clearRefresh();
      actions.deadlines?.clearBackend();
      break;
    case LIVE_DATA_SECTION.ARXIV:
      actions.arxiv?.clearRefresh();
      actions.arxiv?.clearBackend();
      break;
    case LIVE_DATA_SECTION.QUOTA:
      actions.quota?.clearRefresh();
      actions.quota?.clearBackend();
      break;
  }
}

export function createSectionRefreshHandler<S extends LiveDataSection>(
  options: CreateSectionRefreshHandlerOptions<S>
): () => Promise<void> {
  const {
    isRefreshing,
    setIsRefreshing,
    clearError,
    setError,
    section,
    onSuccess,
    logLabel,
  } = options;

  return async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    clearError();
    try {
      const data = (await SECTION_REFRESH_RUN[section]()) as SectionLiveDataMap[S][];
      onSuccess?.(data);
    } catch (e) {
      console.error(logLabel ?? `${section} refresh failed`, e);
      setError(String(e));
    } finally {
      setIsRefreshing(false);
    }
  };
}
