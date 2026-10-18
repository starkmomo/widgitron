import { Gauge, Cpu, Calendar, Radar, type LucideIcon } from "lucide-react";
import { LIVE_DATA_SECTION_LABELS, type LiveDataSection } from "./sectionLiveData";
import type { ServiceField } from "./widgetLifecycle";

export const MODULE_NAVIGATION: {
  section: LiveDataSection; field: ServiceField; label: string; Icon: LucideIcon; detail: string; accent: string;
}[] = [
  { section: "quota", field: "quota_enabled", label: LIVE_DATA_SECTION_LABELS.quota, Icon: Gauge, detail: "Track AI agent and API limits", accent: "text-cyan-400" },
  { section: "gpu", field: "gpu_enabled", label: LIVE_DATA_SECTION_LABELS.gpu, Icon: Cpu, detail: "Monitor GPUs and cluster jobs", accent: "text-purple-400" },
  { section: "deadlines", field: "deadline_enabled", label: LIVE_DATA_SECTION_LABELS.deadlines, Icon: Calendar, detail: "Track conference submission deadlines", accent: "text-emerald-400" },
  { section: "arxiv", field: "arxiv_enabled", label: LIVE_DATA_SECTION_LABELS.arxiv, Icon: Radar, detail: "Discover recent research papers", accent: "text-pink-400" },
];
