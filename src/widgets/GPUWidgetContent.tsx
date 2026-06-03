import { useState, useEffect } from "react";
import { Cpu, Activity } from "lucide-react";
import { motion } from "framer-motion";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { WidgetTheme, WidgetThemeConfig } from "../types/theme";
import { hexToRgba } from "../utils/color";
import { CopyButton } from "../components/CopyButton";

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

export function GPUWidgetContent() {
  const [serverData, setServerData] = useState<any[]>([]);
  const [currentTheme, setCurrentTheme] = useState<WidgetTheme | null>(null);
  const [durations, setDurations] = useState<Record<string, number>>({});
  const [gpuConfig, setGpuConfig] = useState<any>({ compact_mode: true });
  const win = getCurrentWindow();

  useEffect(() => {
    const timer = setInterval(() => {
      setDurations((prev) => {
        const next = { ...prev };
        Object.keys(next).forEach((key) => {
          next[key] = next[key] + 1;
        });
        return next;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    setDurations((prev) => {
      const next = { ...prev };
      const visibleJobs = new Set<string>();

      // 1. Gather all visible job IDs and step IDs
      serverData.forEach((server: any) => {
        server.gpu_list.forEach((gpu: any) => {
          if (gpu.job_id) {
            visibleJobs.add(gpu.job_id);
          }
        });
        if (server.slurm_steps) {
          Object.values(server.slurm_steps).forEach((steps: any) => {
            steps.forEach((step: any) => {
              visibleJobs.add(step.id);
            });
          });
        }
      });

      // 2. Update durations from backend values if available
      serverData.forEach((server: any) => {
        if (server.slurm_times) {
          Object.entries(server.slurm_times).forEach(([jobId, timeStr]: any) => {
            const backendSecs = parseSlurmTime(timeStr);
            const currentSecs = next[jobId];
            if (currentSecs === undefined || backendSecs > currentSecs || backendSecs < currentSecs - 45) {
              next[jobId] = backendSecs;
            }
          });
        }
        if (server.slurm_steps) {
          Object.values(server.slurm_steps).forEach((steps: any) => {
            steps.forEach((step: any) => {
              const backendSecs = parseSlurmTime(step.time);
              const currentSecs = next[step.id];
              if (currentSecs === undefined || backendSecs > currentSecs || backendSecs < currentSecs - 45) {
                next[step.id] = backendSecs;
              }
            });
          });
        }
      });

      // 3. Clean up keys that are no longer visible
      Object.keys(next).forEach((key) => {
        if (!visibleJobs.has(key)) {
          delete next[key];
        }
      });

      return next;
    });
  }, [serverData]);

  useEffect(() => {
    let unlisteners: (() => void)[] = [];
    let active = true;

    const load = async () => {
      try {
        const gc = await invoke("get_gpu_config");
        if (!active) return;
        setGpuConfig(gc as any);

        const gpuData = await invoke("get_gpu_data");
        if (!active) return;
        setServerData(gpuData as any[]);

        const config = (await invoke("get_theme_config")) as WidgetThemeConfig;
        if (!active) return;
        const themeId = config.assignments?.[win.label];
        const theme =
          config.themes.find((t) => t.id === themeId) || config.themes.find((t) => t.id === "theme-gpu-default");
        setCurrentTheme(theme || null);

        const u1 = await listen<any>("gpu_update", (event) => {
          if (!active) return;
          const item = event.payload;
          setServerData((prev) => {
            const index = prev.findIndex((s) => s.host === item.host);
            if (index === -1) return [...prev, item];
            const next = [...prev];
            next[index] = item;
            return next;
          });
        });
        if (!active) {
          u1();
        } else {
          unlisteners.push(() => u1());
        }

        const u4 = await listen<any>("gpu_config_update", (event) => {
          if (!active) return;
          setGpuConfig(event.payload);
        });
        if (!active) {
          u4();
        } else {
          unlisteners.push(() => u4());
        }

        const u2 = await listen("theme_update", (event: any) => {
          if (!active) return;
          const config = event.payload as WidgetThemeConfig;
          const themeId = config.assignments?.[win.label];
          const theme =
            config.themes.find((t) => t.id === themeId) || config.themes.find((t) => t.id === "theme-gpu-default");
          setCurrentTheme(theme || null);
        });
        if (!active) {
          u2();
        } else {
          unlisteners.push(() => u2());
        }

        const u3 = await listen("gpu_clear", () => {
          if (!active) return;
          setServerData([]);
        });
        if (!active) {
          u3();
        } else {
          unlisteners.push(() => u3());
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

  return (
    <div className="h-full flex flex-col" style={{ color: mainText }}>
      <div className="flex items-center gap-2 mb-4">
        <Cpu size={16} style={{ color: accent }} />
        <span className="text-xs font-black uppercase tracking-widest" style={{ color: subText }}>
          GPU Monitor
        </span>
      </div>
      <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 space-y-6">
        {serverData.length > 0 ? (
          serverData.map((server: any, idx: number) => {
            const groups: Record<string, any[]> = {};
            server.gpu_list.forEach((gpu: any) => {
              const gid = gpu.job_id || "SYSTEM";
              if (!groups[gid]) groups[gid] = [];
              groups[gid].push(gpu);
            });

            return (
              <div key={idx} className="space-y-4">
                <div className="flex items-center justify-between border-l-2 border-white/10 pl-2">
                  <div className="flex flex-col items-start">
                    <span
                      className="text-[10px] font-black uppercase tracking-tighter"
                      style={{ color: mainText }}
                    >
                      {server.host}
                    </span>
                  </div>
                  {server.is_online ? (
                    <span className="text-[7px] font-black uppercase" style={{ color: success }}>
                      Online
                    </span>
                  ) : (
                    <span className="text-[7px] font-black uppercase" style={{ color: danger }}>
                      Offline
                    </span>
                  )}
                </div>

                {server.error && (
                  <div className="text-[9px] font-medium italic px-2" style={{ color: danger }}>
                    {server.error}
                  </div>
                )}

                <div className="space-y-3 pl-2">
                  {Object.entries(groups).map(([jobId, gpus]) => (
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
                                <span className="opacity-60 font-mono text-[7px] text-right truncate max-w-[120px]" title={server.slurm_nodelists[jobId]}>
                                  {server.slurm_nodelists[jobId]}
                                </span>
                              )}
                              {server.slurm_times?.[jobId] && (
                                <span className="opacity-80 font-mono text-[7px] text-right shrink-0" style={{ color: accent }} title="Job Run Time">
                                  {formatSlurmTime(durations[jobId] ?? parseSlurmTime(server.slurm_times[jobId]))}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                      {(() => {
                        const isCompact = gpuConfig?.compact_mode !== false;
                        return (
                          <div className={isCompact ? "grid grid-cols-8 gap-1" : "grid grid-cols-4 gap-1.5"}>
                            {gpus.map((gpu, i) => {
                              const usage = gpu.util / 100;
                              const usageColor = usage > 0.9 ? danger : usage > 0.6 ? warning : accent;

                              if (isCompact) {
                                return (
                                  <div
                                    key={i}
                                    className="relative aspect-square bg-white/5 rounded-lg border border-white/5 flex flex-col items-center justify-center min-w-0 overflow-hidden select-none"
                                    title={`GPU #${i}: ${gpu.util}% (${gpu.name})`}
                                  >
                                    {/* Progress Background Overlay */}
                                    <motion.div
                                      initial={{ width: 0 }}
                                      animate={{ width: `${gpu.util}%` }}
                                      transition={{ duration: 0.3 }}
                                      className="absolute left-0 top-0 bottom-0 z-0 pointer-events-none opacity-20"
                                      style={{ backgroundColor: usageColor }}
                                    />
                                    {/* Text Overlay */}
                                    <div className="relative z-10 flex flex-col items-center justify-center text-center leading-normal">
                                      <span className="text-[7.5px] font-black tracking-tighter" style={{ color: mainText }}>
                                        {(gpu.mem_used / 1024).toFixed(0)}G
                                      </span>
                                      <span className="text-[6.5px] font-bold tracking-tighter opacity-80" style={{ color: subText }}>
                                        {(gpu.power || 0).toFixed(0)}W
                                      </span>
                                    </div>
                                  </div>
                                );
                              }

                              return (
                                <div
                                  key={i}
                                  className="space-y-1 bg-white/5 p-1.5 rounded-lg border border-white/5 flex flex-col justify-center min-w-0"
                                >
                                  <div className="flex justify-between items-center text-[8px] font-black tracking-tighter">
                                    <span style={{ color: subText }}>#{i}</span>
                                    <span style={{ color: usageColor }}>{gpu.util}%</span>
                                  </div>
                                  <div className="h-1 w-full bg-black/40 rounded-full overflow-hidden">
                                    <motion.div
                                      initial={{ width: 0 }}
                                      animate={{ width: `${gpu.util}%` }}
                                      className="h-full rounded-full"
                                      style={{ backgroundColor: usageColor }}
                                    />
                                  </div>
                                  <div
                                    className="flex justify-between items-center text-[7px] font-bold tracking-tighter tabular-nums"
                                    style={{ color: subText }}
                                  >
                                    <span>{(gpu.mem_used / 1024).toFixed(0)}G</span>
                                    <span>{(gpu.power || 0).toFixed(0)}W</span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        );
                      })()}

                      {(() => {
                        const activeSteps = (server.slurm_steps?.[jobId] || []).filter(
                          (step: any) => step.name !== "widgitron-gpu"
                        );
                        if (activeSteps.length === 0) return null;
                        return (
                          <div className="mt-2 space-y-0.5 max-h-24 overflow-y-auto custom-scrollbar">
                            {activeSteps.map((step: any, sIdx: number) => {
                              const shortStepId = step.id.includes('.') ? '.' + step.id.split('.').slice(1).join('.') : step.id;
                              return (
                                <div
                                  key={sIdx}
                                  className="flex items-center justify-between text-[7px] bg-white/5 px-2 py-0.5 rounded border border-white/5 font-mono"
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
                  ))}
                </div>
              </div>
            );
          })
        ) : (
          <div className="text-xs italic text-center mt-4" style={{ color: subText }}>
            Waiting for backend...
          </div>
        )}
      </div>
    </div>
  );
}
