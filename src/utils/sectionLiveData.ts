import type {
  ArxivPaper,
  PaperDeadlineInfo,
  QuotaItem,
  ServerGpuData,
} from "../types/config";
import type { LiveDataFetchCommand, LiveDataRefreshCommand } from "../types/tauri";
import { tauriInvoke } from "./tauriInvoke";

export type LiveDataSection = "gpu" | "deadlines" | "arxiv" | "quota";

export type SectionLiveDataMap = {
  gpu: ServerGpuData;
  deadlines: PaperDeadlineInfo;
  arxiv: ArxivPaper;
  quota: QuotaItem;
};

export type AppTab = "dashboard" | "settings" | LiveDataSection;

export type SettingsSection = "general" | "sidebar" | "floating" | "about" | LiveDataSection;

export const LIVE_DATA_SECTION_LABELS: Record<LiveDataSection, string> = {
  gpu: "GPU Monitor",
  deadlines: "Conference DDL",
  arxiv: "arXiv Radar",
  quota: "Quota Monitor",
};

export const APP_TAB_LABELS: Record<AppTab, string> = {
  dashboard: "Overview",
  settings: "Settings",
  ...LIVE_DATA_SECTION_LABELS,
};

export const SETTINGS_SECTION_LABELS: Record<SettingsSection, string> = {
  general: "General",
  sidebar: "Sidebar",
  floating: "Floating style",
  about: "About",
  ...LIVE_DATA_SECTION_LABELS,
};

export function appTabLabel(tab: AppTab): string {
  return APP_TAB_LABELS[tab];
}

export const LIVE_DATA_SECTION = {
  GPU: "gpu",
  DEADLINES: "deadlines",
  ARXIV: "arxiv",
  QUOTA: "quota",
} as const satisfies Record<string, LiveDataSection>;

export const SECTION_FETCH_COMMANDS = {
  [LIVE_DATA_SECTION.GPU]: "get_gpu_data",
  [LIVE_DATA_SECTION.DEADLINES]: "get_deadlines",
  [LIVE_DATA_SECTION.ARXIV]: "get_arxiv_papers",
  [LIVE_DATA_SECTION.QUOTA]: "get_quota_data",
} as const satisfies Record<LiveDataSection, LiveDataFetchCommand>;

export const SECTION_REFRESH_COMMANDS = {
  [LIVE_DATA_SECTION.GPU]: "refresh_gpu_data",
  [LIVE_DATA_SECTION.DEADLINES]: "refresh_paper_deadlines",
  [LIVE_DATA_SECTION.ARXIV]: "refresh_arxiv",
  [LIVE_DATA_SECTION.QUOTA]: "refresh_quota",
} as const satisfies Record<LiveDataSection, LiveDataRefreshCommand>;

const SECTION_FETCH = {
  [LIVE_DATA_SECTION.GPU]: () => tauriInvoke("get_gpu_data"),
  [LIVE_DATA_SECTION.DEADLINES]: () => tauriInvoke("get_deadlines"),
  [LIVE_DATA_SECTION.ARXIV]: () => tauriInvoke("get_arxiv_papers"),
  [LIVE_DATA_SECTION.QUOTA]: () => tauriInvoke("get_quota_data"),
} satisfies {
  [S in LiveDataSection]: () => Promise<SectionLiveDataMap[S][]>;
};

export const LIVE_DATA_SECTIONS: LiveDataSection[] = [
  LIVE_DATA_SECTION.GPU,
  LIVE_DATA_SECTION.DEADLINES,
  LIVE_DATA_SECTION.ARXIV,
  LIVE_DATA_SECTION.QUOTA,
];

export function isLiveDataSection(value: string): value is LiveDataSection {
  return (LIVE_DATA_SECTIONS as string[]).includes(value);
}

export async function refetchSectionLiveData<S extends LiveDataSection>(
  section: S
): Promise<SectionLiveDataMap[S][]> {
  return SECTION_FETCH[section]() as Promise<SectionLiveDataMap[S][]>;
}

export function refetchSectionLiveDataInto<S extends LiveDataSection>(
  section: S,
  setter: (data: SectionLiveDataMap[S][]) => void
): void {
  refetchSectionLiveData(section).then(setter).catch(console.error);
}

export type SectionLiveDataSetters = {
  [S in LiveDataSection]?: (data: SectionLiveDataMap[S][]) => void;
};

export function refetchAllSectionLiveData(setters: SectionLiveDataSetters): void {
  for (const section of LIVE_DATA_SECTIONS) {
    refetchSectionLiveDataForSection(section, setters);
  }
}

export function refetchSectionLiveDataForSection<S extends LiveDataSection>(
  section: S,
  setters: SectionLiveDataSetters
): void {
  const setter = setters[section];
  if (!setter) return;
  void refetchSectionLiveData(section)
    .then((data) => {
      setter(data);
    })
    .catch(console.error);
}
