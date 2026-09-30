import { useState, useEffect } from "react";
import { Cpu, Activity, RefreshCw, List } from "lucide-react";
import { useWidgetTheme } from "../hooks/useWidgetTheme";
import { hexToRgba } from "../utils/color";
import { orderGpuServersByConfig, sortGpuJobGroups } from "../utils/gpuDisplay";
import { handleWidgetAppConfigUpdate } from "../utils/widgetLifecycle";
import { gpuStatHint } from "../utils/statHints";
import { listenServiceUpdateEvents } from "../utils/serviceUpdateEvents";
import { listenGpuDataSync } from "../utils/gpuDataSync";
import { LIVE_DATA_SECTION, refetchSectionLiveData } from "../utils/sectionLiveData";
import { gpuRefreshCachedLabel, messageShowsCached } from "../utils/cachedLabels";
import { CopyButton } from "../components/CopyButton";
import { ServiceErrorBanners } from "../components/ServiceErrorBanners";
import type { GpuConfig, GpuInfo, ServerConfig, ServerGpuData, SlurmQueueJob, SlurmStep } from "../types/config";
import { tauriInvoke } from "../utils/tauriInvoke";
import { tauriListen } from "../utils/tauriListen";
import { formatCpuPercent, formatSystemMemory } from "../utils/systemMetrics";

const NON_COMPACT_GPU_CARD_MIN_WIDTH = 96;
const NON_COMPACT_GPU_CARD_MAX_WIDTH = 112;

function parseSlurmTime(timeStr: string): number {
  if (!timeStr) return 0;
  let days = 0;
  let hours = 0;
  let minutes = 0;
  let seconds = 0;

  let rest = timeStr.trim();
  if (rest.includes('-')) {
    const parts = rest.split('-');
    days = parseInt(parts[0], 10) || 0;
    rest = parts[1];
  }

  const timeParts = rest.split(':');
  if (timeParts.length === 3) {
    hours = parseInt(timeParts[0], 10) || 0;
    minutes = parseInt(timeParts[1], 10) || 0;
    seconds = parseInt(timeParts[2], 10) || 0;
  } else if (timeParts.length === 2) {
    minutes = parseInt(timeParts[0], 10) || 0;
    seconds = parseInt(timeParts[1], 10) || 0;
  } else if (timeParts.length === 1) {
    seconds = parseInt(timeParts[0], 10) || 0;
  }

  return days * 86400 + hours * 3600 + minutes * 60 + seconds;
}

function formatSlurmTime(totalSeconds: number): string {
  if (isNaN(totalSeconds) || totalSeconds < 0) return "00:00";
  const days = Math.floor(totalSeconds / 86400);
  let rem = totalSeconds % 86400;
  const hours = Math.floor(rem / 3600);
  rem = rem % 3600;
  const minutes = Math.floor(rem / 60);
  const seconds = rem % 60;

  const pad = (n: number) => String(n).padStart(2, '0');

  let res = "";
  if (days > 0) {
    res += `${days}-`;
  }
  if (days > 0 || hours > 0) {
    res += `${pad(hours)}:`;
  }
  res += `${pad(minutes)}:${pad(seconds)}`;
  return res;
}

function slurmStateColor(state: string, colors: { success: string; warning: string; subText: string }) {
  const normalized = state.trim().toUpperCase();
  if (normalized === "RUNNING") return colors.success;
  if (normalized === "PENDING") return colors.warning;
  return colors.subText;
}

export function GPUWidgetContent({ hideHeader = false }: { hideHeader?: boolean }) {
  const [serverData, setServerData] = useState<ServerGpuData[]>([]);
  const currentTheme = useWidgetTheme("gpu");
  const [durations, setDurations] = useState<Record<string, number>>({});
  const [gpuConfig, setGpuConfig] = useState<GpuConfig>({ servers: [], compact_mode: true });
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [serviceEnabled, setServiceEnabled] = useState(true);
  const [dashboardTheme, setDashboardTheme] = useState<"light" | "dark">("dark");
  const hasTrackedDurations = serverData.some(
    (server) =>
      Object.keys(server.slurm_times || {}).length > 0 ||
      Object.values(server.slurm_steps || {}).some((steps) => steps.length > 0) ||
      (server.slurm_queue_jobs || []).length > 0
  );

  useEffect(() => {
    if (!hasTrackedDurations) return;
    const timer = setInterval(() => {
      setDurations((prev) => {
        const keys = Object.keys(prev);
        if (keys.length === 0) return prev;
        const next = { ...prev };
        keys.forEach((key) => {
          next[key] = next[key] + 1;
        });
        return next;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [hasTrackedDurations]);

  useEffect(() => {
    setDurations((prev) => {
      let next = prev;
      let changed = false;
      const visibleJobs = new Set<string>();
      const ensureNext = () => {
        if (next === prev) {
          next = { ...prev };
        }
        return next;
      };

      // Accept backend time when missing/ahead, or when far behind (job restart / clock reset).
      // Never snap back on stale squeue strings re-emitted between refreshes.
      const shouldSyncDuration = (currentSecs: number | undefined, backendSecs: number) =>
        currentSecs === undefined ||
        backendSecs > currentSecs ||
        backendSecs < currentSecs - 3600;

      // 1. Gather all visible job IDs and step IDs
      serverData.forEach((server) => {
        server.gpu_list.forEach((gpu) => {
          if (gpu.job_id) {
            visibleJobs.add(gpu.job_id);
          }
        });
        if (server.slurm_times) {
          Object.keys(server.slurm_times).forEach((jobId) => {
            visibleJobs.add(jobId);
          });
        }
        if (server.slurm_steps) {
          Object.values(server.slurm_steps).forEach((steps) => {
            steps.forEach((step) => {
              visibleJobs.add(step.id);
            });
          });
        }
        (server.slurm_queue_jobs || []).forEach((job) => {
          visibleJobs.add(`queue:${job.id}`);
        });
      });

      // 2. Update durations from backend values if available
      serverData.forEach((server) => {
        if (server.slurm_times) {
          Object.entries(server.slurm_times).forEach(([jobId, timeStr]) => {
            const backendSecs = parseSlurmTime(timeStr);
            const currentSecs = next[jobId];
            if (shouldSyncDuration(currentSecs, backendSecs)) {
              ensureNext()[jobId] = backendSecs;
              changed = true;
            }
          });
        }
        if (server.slurm_steps) {
          Object.values(server.slurm_steps).forEach((steps) => {
            steps.forEach((step) => {
              const backendSecs = parseSlurmTime(step.time);
              const currentSecs = next[step.id];
              if (shouldSyncDuration(currentSecs, backendSecs)) {
                ensureNext()[step.id] = backendSecs;
                changed = true;
              }
            });
          });
        }
        (server.slurm_queue_jobs || []).forEach((job) => {
          const key = `queue:${job.id}`;
          const backendSecs = parseSlurmTime(job.time);
          const currentSecs = next[key];
          if (shouldSyncDuration(currentSecs, backendSecs)) {
            ensureNext()[key] = backendSecs;
            changed = true;
          }
        });
      });

      // 3. Clean up keys that are no longer visible
      Object.keys(next).forEach((key) => {
        if (!visibleJobs.has(key)) {
          delete ensureNext()[key];
          changed = true;
        }
      });

      return changed ? next : prev;
    });
  }, [serverData]);

  useEffect(() => {
    let unlisteners: (() => void)[] = [];
    let active = true;

    const load = async () => {
      try {
        const gc = await tauriInvoke("get_gpu_config");
        if (!active) return;
        setGpuConfig(gc);

        const gpuData = await refetchSectionLiveData(LIVE_DATA_SECTION.GPU);
        if (!active) return;
        setServerData(gpuData);

        const u1 = await listenServiceUpdateEvents(
          () => active,
          { gpu: { clearRefresh: () => setRefreshError(null) } },
          { gpuSetter: setServerData }
        );
        if (!active) {
          u1();
        } else {
          unlisteners.push(u1);
        }

        const u4 = await tauriListen("gpu_config_update", (event) => {
          if (!active) return;
          const nextConfig = event.payload;
          setGpuConfig(nextConfig);
          const hosts = new Set((nextConfig?.servers || []).map((s) => s.host));
          setServerData((prev) => prev.filter((s) => hosts.has(s.host)));
        });
        if (!active) {
          u4();
        } else {
          unlisteners.push(() => u4());
        }

        const u3 = await listenGpuDataSync(setServerData, () => active);
        if (!active) {
          u3();
        } else {
          unlisteners.push(u3);
        }

        const appConfig = await tauriInvoke("get_app_config");
        let gpuEnabled = appConfig?.gpu_enabled !== false;
        if (active) {
          setServiceEnabled(gpuEnabled);
          setDashboardTheme(appConfig?.theme === "light" ? "light" : "dark");
        }

        const u6 = await tauriListen("app_config_update", async (event) => {
          if (!active) return;
          gpuEnabled = await handleWidgetAppConfigUpdate(event.payload, gpuEnabled, {
            serviceField: "gpu_enabled",
            setServiceEnabled: setServiceEnabled,
            setDashboardTheme: setDashboardTheme,
            disableClears: {
              clearData: () => setServerData([]),
              clearRefreshError: () => setRefreshError(null),
            },
          });
        });
        if (!active) {
          u6();
        } else {
          unlisteners.push(() => u6());
        }
      } catch (e) {
        console.error("Widget init failed", e);
      }
    };

    load();

    return () => {
      active = false;
      unlisteners.forEach((f) => f());
    };
  }, []);

  if (!currentTheme) return null;

  const getC = (name: string, fallback: string) => {
    const c = currentTheme.primary_colors.find((p) => p.name === name);
    return c ? hexToRgba(c.value, c.opacity ?? 1.0) : fallback;
  };
  const getT = (name: string, fallback: string) => {
    const c = currentTheme.text_colors?.find((p) => p.name === name);
    return c ? hexToRgba(c.value, c.opacity ?? 1.0) : fallback;
  };

  const accent = getC("Accent", "#3b82f6");
  const success = getC("Success", "#10b981");
  const warning = getC("Warning", "#f59e0b");
  const danger = getC("Danger", "#ef4444");
  const mainText = getT("Main Text", "#ffffff");
  const subText = getT("Sub Text", "#94a3b8");

  const activeHosts = new Set((gpuConfig.servers || []).map((s) => s.host));
  const orderedServerData = orderGpuServersByConfig(
    serverData.filter((s) => activeHosts.has(s.host)),
    gpuConfig.servers
  );
  const gpuOnlineCount = orderedServerData.filter((s) => s.is_online).length;
  const gpuOfflineCount = orderedServerData.length - gpuOnlineCount;
  const totalGpus = orderedServerData.reduce((acc, s) => acc + (s.gpu_list?.length ?? 0), 0);
  const gpuStaleCount = orderedServerData.filter((s) => messageShowsCached(s.error)).length;
  const configuredServerCount = (gpuConfig.servers || []).length;
  const gpuStat = gpuStatHint({
    refreshError,
    totalGpus,
    gpuStaleCount,
    gpuServerCount: orderedServerData.length,
    gpuServersOnline: gpuOnlineCount,
    gpuOfflineCount,
  });
  const gpuHeaderHint = gpuStat.hint;
  const isCompact = gpuConfig?.compact_mode !== false;

  const handleRefresh = async () => {
    if (isRefreshing || !serviceEnabled) return;
    setIsRefreshing(true);
    setRefreshError(null);
    try {
      const data = await tauriInvoke("refresh_gpu_data");
      setServerData(data);
    } catch (e) {
      console.error("GPU widget refresh failed", e);
      setRefreshError(String(e));
    } finally {
      setIsRefreshing(false);
    }
  };

  const updateGpuServerField = async (
    host: string,
    field: keyof ServerConfig,
    value: ServerConfig[keyof ServerConfig]
  ) => {
    const servers = (gpuConfig.servers || []).map((server) =>
      server.host === host ? { ...server, [field]: value } : server
    );
    const next = { ...gpuConfig, servers };
    try {
      await tauriInvoke("save_gpu_config", { config: next });
      setGpuConfig(next);
    } catch (e) {
      console.error("Failed to save GPU server setting", e);
    }
  };

  return (
    <div className="h-full flex flex-col" style={{ color: mainText }}>
      {!hideHeader && (
        <div className="flex items-center justify-between gap-2 mb-4">
          <div className="flex items-center gap-2">
            <Cpu size={16} style={{ color: accent }} />
            <span className="text-xs font-black uppercase tracking-widest" style={{ color: subText }}>
              GPU Monitor
            </span>
          </div>
          <div className="flex items-center gap-2">
            {gpuHeaderHint && (
              <span className="text-[8px] font-black uppercase tracking-widest" style={{ color: warning }}>
                {gpuHeaderHint}
              </span>
            )}
            <button
              onClick={handleRefresh}
              disabled={isRefreshing || !serviceEnabled}
              className="p-1 hover:bg-white/10 rounded-md transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ color: subText }}
              title="Restart GPU workers"
            >
              <RefreshCw size={12} className={isRefreshing ? "animate-spin" : "hover:rotate-45 transition-transform"} />
            </button>
          </div>
        </div>
      )}
      <ServiceErrorBanners
        refreshOnly
        refreshError={refreshError}
        onDismissRefresh={() => setRefreshError(null)}
        theme={dashboardTheme}
        refreshCachedLabel={gpuRefreshCachedLabel(orderedServerData.length > 0)}
        className="mb-2 space-y-2"
      />
      <div
        className={`flex-1 overflow-y-auto custom-scrollbar pr-2 ${
          isCompact ? "space-y-6" : "space-y-5"
        }`}
      >
        {!serviceEnabled ? (
          <div
            className="flex w-full flex-col items-center justify-center text-center py-10 px-4 rounded-xl border border-dashed"
            style={{ borderColor: `${subText}33`, color: subText }}
          >
            <span className="text-[10px] font-black uppercase tracking-widest">Service Disabled</span>
            <span className="text-[9px] opacity-70 mt-1">Enable monitoring on the module page.</span>
          </div>
        ) : orderedServerData.length > 0 ? (
          orderedServerData.map((server, idx) => {
            const hasCachedGpus = Array.isArray(server.gpu_list) && server.gpu_list.length > 0;
            const noGpuDetected = server.error === "No GPU detected";
            const showStaleOffline = !server.is_online && hasCachedGpus;
            const serverConfig = (gpuConfig.servers || []).find((entry) => entry.host === server.host);
            const slurmEnabled = serverConfig?.use_slurm === true;
            const showSqueueList = slurmEnabled && serverConfig?.show_squeue_list === true;
            const squeueAllUsers = serverConfig?.squeue_all_users === true;
            const queueJobs = showSqueueList ? server.slurm_queue_jobs || [] : [];

            const groups: Record<string, GpuInfo[]> = {};
            server.gpu_list.forEach((gpu) => {
              const gid = gpu.job_id || "SYSTEM";
              if (!groups[gid]) groups[gid] = [];
              groups[gid].push(gpu);
            });
            // Keep headers for live allocations when GPU probe blips. Only use
            // nodelist/time (from allocation squeue) — not steps, which can lag
            // and resurface jobs that already left the queue.
            if (slurmEnabled) {
              const knownJobIds = new Set<string>([
                ...Object.keys(server.slurm_nodelists || {}),
                ...Object.keys(server.slurm_times || {}),
              ]);
              knownJobIds.forEach((jid) => {
                if (!groups[jid]) groups[jid] = [];
              });
            }

            return (
              <div
                key={idx}
                className={`${isCompact ? "space-y-4" : "space-y-2"} min-w-0 max-w-full`}
              >
                <div
                  className={`flex items-center border-l-2 border-white/10 pl-2 ${
                    isCompact ? "justify-between gap-2" : "justify-between gap-2"
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="text-[10px] font-black uppercase tracking-tighter truncate"
                      style={{ color: mainText }}
                    >
                      {server.host}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {slurmEnabled && (
                      <>
                        <button
                          type="button"
                          data-no-drag="true"
                          onClick={() =>
                            updateGpuServerField(server.host, "show_squeue_list", !showSqueueList)
                          }
                          className={`px-1.5 py-0.5 rounded border text-[7px] font-black uppercase tracking-widest transition-colors ${
                            showSqueueList ? "border-emerald-500/30" : "border-white/10 opacity-60"
                          }`}
                          style={{
                            color: showSqueueList ? success : subText,
                            backgroundColor: showSqueueList ? `${success}12` : "transparent",
                          }}
                          title="Toggle squeue task list"
                        >
                          <span className="inline-flex items-center gap-1">
                            <List size={9} />
                            Queue
                          </span>
                        </button>
                        {showSqueueList && (
                          <div className="flex items-center gap-0.5" data-no-drag="true">
                            <button
                              type="button"
                              onClick={() =>
                                updateGpuServerField(server.host, "squeue_all_users", false)
                              }
                              className={`px-1 py-0.5 rounded text-[7px] font-black uppercase tracking-widest border ${
                                !squeueAllUsers ? "border-emerald-500/30" : "border-white/10 opacity-50"
                              }`}
                              style={{
                                color: !squeueAllUsers ? success : subText,
                                backgroundColor: !squeueAllUsers ? `${success}12` : "transparent",
                              }}
                            >
                              Mine
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                updateGpuServerField(server.host, "squeue_all_users", true)
                              }
                              className={`px-1 py-0.5 rounded text-[7px] font-black uppercase tracking-widest border ${
                                squeueAllUsers ? "border-emerald-500/30" : "border-white/10 opacity-50"
                              }`}
                              style={{
                                color: squeueAllUsers ? success : subText,
                                backgroundColor: squeueAllUsers ? `${success}12` : "transparent",
                              }}
                            >
                              All
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  {noGpuDetected ? (
                    <span className="text-[8px] font-black shrink-0" style={{ color: subText }}>
                      No GPU detected
                    </span>
                  ) : server.is_online ? (
                    <span
                      className={`text-[8px] font-black uppercase shrink-0 ${
                        isCompact ? "" : "rounded border px-1.5 py-0.5"
                      }`}
                      style={{
                        color: success,
                        borderColor: isCompact ? undefined : `${success}44`,
                        backgroundColor: isCompact ? undefined : `${success}12`,
                      }}
                    >
                      Online
                    </span>
                  ) : showStaleOffline ? (
                    <span
                      className={`text-[8px] font-black uppercase shrink-0 ${
                        isCompact ? "" : "rounded border px-1.5 py-0.5"
                      }`}
                      style={{
                        color: warning,
                        borderColor: isCompact ? undefined : `${warning}44`,
                        backgroundColor: isCompact ? undefined : `${warning}12`,
                      }}
                    >
                      Offline · cached
                    </span>
                  ) : (
                    <span
                      className={`text-[8px] font-black uppercase shrink-0 ${
                        isCompact ? "" : "rounded border px-1.5 py-0.5"
                      }`}
                      style={{
                        color: danger,
                        borderColor: isCompact ? undefined : `${danger}44`,
                        backgroundColor: isCompact ? undefined : `${danger}12`,
                      }}
                    >
                      Offline
                    </span>
                  )}
                  </div>
                </div>

                {server.error && !noGpuDetected && (
                  <div
                    className="text-[9px] font-medium italic px-2"
                    style={{ color: showStaleOffline ? warning : danger }}
                  >
                    {server.error}
                  </div>
                )}

                {server.is_online && server.system && (
                  <div className="flex flex-wrap gap-x-3 gap-y-1 pl-2 text-[9px] font-semibold" style={{ color: subText }}>
                    <span>CPU {formatCpuPercent(server.system.cpu_percent)}</span>
                    <span>RAM {formatSystemMemory(server.system.memory_used_bytes)} / {formatSystemMemory(server.system.memory_total_bytes)}</span>
                  </div>
                )}

                <div className={`${isCompact ? "space-y-3" : "space-y-2"} pl-2`}>
                  {isCompact ? (
                    sortGpuJobGroups(groups).map(([jobId, gpus]) => (
                      <div key={jobId} className="space-y-1.5">
                        {jobId !== "SYSTEM" && (
                          <div
                            className="flex items-center justify-between text-[8px] font-black uppercase tracking-widest pl-1 pr-1 group/job"
                            style={{ color: subText }}
                          >
                            <div className="flex items-center gap-1">
                              <Activity size={10} style={{ color: accent }} /> JOB: {jobId}
                              <div className="ml-1 flex items-center" data-no-drag="true">
                                <CopyButton text={jobId} />
                              </div>
                            </div>
                            {(server.slurm_nodelists?.[jobId] || server.slurm_times?.[jobId]) && (
                              <div className="flex items-center gap-1.5 shrink-0 select-none">
                                {server.slurm_nodelists?.[jobId] && (
                                  <span className="opacity-60 font-mono text-[8px] text-right truncate max-w-[120px]" title={server.slurm_nodelists[jobId]}>
                                    {server.slurm_nodelists[jobId]}
                                  </span>
                                )}
                                {server.slurm_times?.[jobId] && (
                                  <span className="opacity-80 font-mono text-[8px] text-right shrink-0" style={{ color: accent }} title="Job Run Time">
                                    {formatSlurmTime(durations[jobId] ?? parseSlurmTime(server.slurm_times[jobId]))}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                        <div className="grid grid-cols-8 gap-1">
                          {gpus.map((gpu, i) => {
                            const usage = gpu.util / 100;
                            const usageColor = usage > 0.9 ? danger : usage > 0.6 ? warning : accent;

                            return (
                              <div
                                key={i}
                                className="relative aspect-square bg-white/5 rounded-lg border border-white/5 flex flex-col items-center justify-center min-w-0 overflow-hidden select-none"
                                title={`GPU #${i}: ${gpu.util}% (${gpu.name})`}
                              >
                                {/* Progress Background Overlay */}
                                <div
                                  className="absolute left-0 top-0 bottom-0 z-0 pointer-events-none opacity-20 transition-[width] duration-300"
                                  style={{ width: `${gpu.util}%`, backgroundColor: usageColor }}
                                />
                                {/* Text Overlay */}
                                <div className="relative z-10 flex flex-col items-center justify-center text-center leading-normal">
                                  <span className="text-[8px] font-black tracking-tighter" style={{ color: mainText }}>
                                    {(gpu.mem_used / 1024).toFixed(0)}G
                                  </span>
                                  <span className="text-[8px] font-bold tracking-tighter opacity-80" style={{ color: subText }}>
                                    {(gpu.power || 0).toFixed(0)}W
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        {(() => {
                          const activeSteps = (server.slurm_steps?.[jobId] || []).filter(
                            (step: SlurmStep) => step.name !== "widgitron-gpu"
                          );
                          if (activeSteps.length === 0) return null;
                          return (
                            <div className="mt-2 space-y-0.5 max-h-24 overflow-y-auto custom-scrollbar">
                              {activeSteps.map((step, sIdx) => {
                                const shortStepId = step.id.includes('.') ? '.' + step.id.split('.').slice(1).join('.') : step.id;
                                return (
                                  <div
                                    key={sIdx}
                                    className="flex items-center justify-between text-[8px] bg-white/5 px-2 py-0.5 rounded border border-white/5 font-mono"
                                  >
                                    <div className="flex items-center gap-1.5 min-w-0 flex-1">
                                      <span style={{ color: accent }} className="shrink-0">{shortStepId}</span>
                                      <span className="font-bold opacity-80 shrink-0" title={step.name}>{step.name}</span>
                                      <span className="opacity-65 truncate" title={step.command}>{step.command}</span>
                                    </div>
                                    <div className="flex items-center gap-2 opacity-60 shrink-0 ml-2">
                                      <span>{formatSlurmTime(durations[step.id] ?? parseSlurmTime(step.time))}</span>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })()}
                      </div>
                    ))
                  ) : (
                    <>
                      <div
                        className="grid gap-1.5 justify-start"
                        style={{
                          gridTemplateColumns: `repeat(auto-fit, minmax(${NON_COMPACT_GPU_CARD_MIN_WIDTH}px, ${NON_COMPACT_GPU_CARD_MAX_WIDTH}px))`,
                        }}
                      >
                        {server.gpu_list.map((gpu, i) => {
                          const usage = gpu.util / 100;
                          const usageColor = usage > 0.9 ? danger : usage > 0.6 ? warning : accent;

                          return (
                            <div
                              key={i}
                              className="h-11 space-y-0.5 bg-white/5 px-2 py-1 rounded-md border border-white/5 flex flex-col justify-center min-w-0"
                              title={`GPU #${i}: ${gpu.util}% (${gpu.name})`}
                            >
                              <div className="flex justify-between items-center text-[8px] font-black tracking-tighter">
                                <span style={{ color: subText }}>#{i}</span>
                                <span style={{ color: usageColor }}>{gpu.util}%</span>
                              </div>
                              <div className="h-0.5 w-full bg-black/40 rounded-full overflow-hidden">
                                <div
                                  className="h-full rounded-full transition-[width] duration-300"
                                  style={{ width: `${gpu.util}%`, backgroundColor: usageColor }}
                                />
                              </div>
                              <div
                                className="flex justify-between items-center gap-1 text-[8px] font-bold tracking-tighter tabular-nums"
                                style={{ color: subText }}
                              >
                                <span>{(gpu.mem_used / 1024).toFixed(0)}G</span>
                                <span className="opacity-50">·</span>
                                <span>{(gpu.power || 0).toFixed(0)}W</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {sortGpuJobGroups(groups).map(([jobId]) => {
                        if (jobId === "SYSTEM") return null;
                        const activeSteps = (server.slurm_steps?.[jobId] || []).filter(
                          (step: SlurmStep) => step.name !== "widgitron-gpu"
                        );

                        return (
                          <div key={jobId} className="space-y-1">
                            <div
                              className="flex items-center justify-between text-[8px] font-black uppercase tracking-widest pl-1 pr-1 group/job"
                              style={{ color: subText }}
                            >
                              <div className="flex items-center gap-1 min-w-0">
                                <Activity size={10} style={{ color: accent }} /> JOB: {jobId}
                                <div className="ml-1 flex items-center" data-no-drag="true">
                                  <CopyButton text={jobId} />
                                </div>
                              </div>
                              {(server.slurm_nodelists?.[jobId] || server.slurm_times?.[jobId]) && (
                                <div className="flex items-center gap-1.5 shrink-0 select-none">
                                  {server.slurm_nodelists?.[jobId] && (
                                    <span className="opacity-60 font-mono text-[8px] text-right truncate max-w-[120px]" title={server.slurm_nodelists[jobId]}>
                                      {server.slurm_nodelists[jobId]}
                                    </span>
                                  )}
                                  {server.slurm_times?.[jobId] && (
                                    <span className="opacity-80 font-mono text-[8px] text-right shrink-0" style={{ color: accent }} title="Job Run Time">
                                      {formatSlurmTime(durations[jobId] ?? parseSlurmTime(server.slurm_times[jobId]))}
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>

                            {activeSteps.length > 0 && (
                              <div className="space-y-0.5 max-h-24 overflow-y-auto custom-scrollbar">
                                {activeSteps.map((step, sIdx) => {
                                  const shortStepId = step.id.includes('.') ? '.' + step.id.split('.').slice(1).join('.') : step.id;
                                  return (
                                    <div
                                      key={sIdx}
                                      className="flex items-center justify-between text-[8px] bg-white/5 px-2 py-0.5 rounded border border-white/5 font-mono"
                                    >
                                      <div className="flex items-center gap-1.5 min-w-0 flex-1">
                                        <span style={{ color: accent }} className="shrink-0">{shortStepId}</span>
                                        <span className="font-bold opacity-80 shrink-0" title={step.name}>{step.name}</span>
                                        <span className="opacity-65 truncate" title={step.command}>{step.command}</span>
                                      </div>
                                      <div className="flex items-center gap-2 opacity-60 shrink-0 ml-2">
                                        <span>{formatSlurmTime(durations[step.id] ?? parseSlurmTime(step.time))}</span>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </>
                  )}
                </div>

                {showSqueueList && (
                  <div className="pl-2 space-y-1">
                    <div
                      className="flex items-center justify-between text-[8px] font-black uppercase tracking-widest"
                      style={{ color: subText }}
                    >
                      <span className="inline-flex items-center gap-1">
                        <List size={10} style={{ color: accent }} />
                        Squeue ({squeueAllUsers ? "all users" : "mine"})
                      </span>
                      <span className="opacity-60">{queueJobs.length} jobs</span>
                    </div>
                    {queueJobs.length > 0 ? (
                      <div className="space-y-0.5 max-h-32 overflow-y-auto custom-scrollbar">
                        {queueJobs.map((job: SlurmQueueJob) => (
                          <div
                            key={`${job.id}-${job.user}`}
                            className="flex items-center justify-between gap-2 text-[8px] bg-white/5 px-2 py-0.5 rounded border border-white/5 font-mono"
                          >
                            <div className="flex items-center gap-1.5 min-w-0 flex-1">
                              <span style={{ color: accent }} className="shrink-0">
                                {job.id}
                              </span>
                              <span className="font-bold opacity-80 truncate" title={job.name}>
                                {job.name}
                              </span>
                              {squeueAllUsers && (
                                <span className="opacity-60 shrink-0">{job.user}</span>
                              )}
                              <span
                                className="shrink-0 uppercase text-[7px] font-black tracking-wider"
                                style={{ color: slurmStateColor(job.state, { success, warning, subText }) }}
                              >
                                {job.state}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 opacity-60 shrink-0">
                              <span className="truncate max-w-[100px]" title={job.nodelist}>
                                {job.nodelist}
                              </span>
                              <span>
                                {formatSlurmTime(
                                  durations[`queue:${job.id}`] ?? parseSlurmTime(job.time)
                                )}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-[8px] italic opacity-60 px-1" style={{ color: subText }}>
                        No jobs in queue
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        ) : configuredServerCount === 0 ? (
          <div
            className="flex w-full flex-col items-center justify-center text-center mt-10 px-4 py-8 rounded-xl border border-dashed"
            style={{ borderColor: `${subText}33`, color: subText }}
          >
            <Cpu size={20} style={{ color: accent, opacity: 0.5 }} className="mb-3" />
            <span className="text-[10px] font-black uppercase tracking-widest mb-1">
              No Servers Configured
            </span>
            <span className="text-[9px] opacity-70 leading-relaxed">
              Open Settings → GPU Monitor to add SSH hosts.
            </span>
          </div>
        ) : (
          <div className="w-full text-[9px] italic text-center mt-4" style={{ color: subText }}>
            Waiting for backend...
          </div>
        )}
      </div>
    </div>
  );
}
