import { useState, useEffect, useRef } from "react";
import { Gauge, RefreshCw, AlertCircle, Minus, Plus, Edit2, Globe, Cpu, User } from "lucide-react";
import { useWidgetTheme } from "../hooks/useWidgetTheme";
import { hexToRgba, adjustColorOpacity } from "../utils/color";
import { isStaleQuotaWarning, quotaHasDisplayValue, orderQuotaByConfig } from "../utils/quotaDisplay";
import { handleWidgetAppConfigUpdate } from "../utils/widgetLifecycle";
import { listenQuotaMonitorStatus, type QuotaMonitorStatus } from "../utils/quotaMonitorStatus";
import { listenServiceUpdateEvents } from "../utils/serviceUpdateEvents";
import { LIVE_DATA_SECTION, refetchSectionLiveData } from "../utils/sectionLiveData";
import { CACHED_LABELS, cachedLabelWhen } from "../utils/cachedLabels";
import { ServiceErrorBanners } from "../components/ServiceErrorBanners";
import type { QuotaItem, QuotaItemConfig, QuotaVisualizationConfig } from "../types/config";
import { QuotaVisualizations } from "../components/QuotaVisualizations";
import type { AntigravitySetupStatus } from "../types/tauri";
import { tauriInvoke } from "../utils/tauriInvoke";
import { tauriListen } from "../utils/tauriListen";

const PROVIDER_LOGOS: Record<string, string> = {
  antigravity: "/icons/antigravity.svg",
  codex: "/icons/codex.svg",
  cursor: "/icons/cursor.svg",
  copilot: "/icons/vscode.svg",
  "qoder-cn": "/icons/qoder-cn.svg",
  pioneer: "/icons/pioneer.svg",
  "claude-code": "/icons/claude-code.svg",
};

function renderQuotaAlert(
  q: QuotaItem,
  expandedErrors: Record<string, boolean>,
  toggleErrorExpand: (id: string) => void,
) {
  if (!q.error_msg) return null;

  const stale = isStaleQuotaWarning(q.error_msg) && quotaHasDisplayValue(q);
  const className = stale
    ? "flex items-start gap-1 text-[8px] text-amber-400 font-medium italic mt-1 bg-amber-500/5 p-1.5 rounded border border-amber-500/15 cursor-pointer hover:bg-amber-500/10 transition-colors"
    : "flex items-start gap-1 text-[8px] text-red-400 font-medium italic mt-1 bg-red-500/5 p-1.5 rounded border border-red-500/10 cursor-pointer hover:bg-red-500/10 transition-colors";

  return (
    <div onClick={() => toggleErrorExpand(q.id)} className={className}>
      <AlertCircle size={10} className="flex-shrink-0 mt-0.5" />
      <span className={expandedErrors[q.id] ? "break-all animate-fadeIn" : "truncate"}>
        {q.error_msg}
      </span>
    </div>
  );
}

export function QuotaWidgetContent({ hideHeader = false }: { hideHeader?: boolean }) {
  const [quotas, setQuotas] = useState<QuotaItem[]>([]);
  const currentTheme = useWidgetTheme("quota");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [quotaBackendError, setQuotaBackendError] = useState<string | null>(null);
  const [quotaMonitorStatus, setQuotaMonitorStatus] = useState<QuotaMonitorStatus | null>(null);
  const [showAccountName, setShowAccountName] = useState(false);
  const [showPlanType, setShowPlanType] = useState(true);
  const [configItems, setConfigItems] = useState<QuotaItemConfig[]>([]);
  const [serviceEnabled, setServiceEnabled] = useState(true);
  const [dashboardTheme, setDashboardTheme] = useState<"light" | "dark">("dark");
  
  // Inline editing states for manual quotas
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Error message expansion states
  const [expandedErrors, setExpandedErrors] = useState<Record<string, boolean>>({});
  const [agStatus, setAgStatus] = useState<AntigravitySetupStatus | null>(null);

  // Helper: format display name based on showAccountName setting
  const displayName = (q: QuotaItem) => {
    if (showAccountName && q.account_label) {
      return `${q.name} (${q.account_label})`;
    }
    return q.name;
  };

  const visualizationsFor = (q: QuotaItem): QuotaVisualizationConfig | null =>
    configItems.find((item) => item.id === q.id)?.visualizations
    ?? q.visualizations
    ?? null;

  useEffect(() => {
    let active = true;
    const unlisteners: (() => void)[] = [];

    const loadData = async () => {
      try {
        const qd = await refetchSectionLiveData(LIVE_DATA_SECTION.QUOTA);
        if (!active) return;
        setQuotas(qd);

        // Load show_account_name setting from quota config
        const qc = await tauriInvoke("get_quota_config");
        if (!active) return;
        setShowAccountName(qc?.show_account_name || false);
        setShowPlanType(qc?.show_plan_type !== false);
        setConfigItems(qc?.items || []);
      } catch (e) {
        console.error("Quota widget load failed", e);
      }
    };

    loadData();

    const setup = async () => {
      try {
        const u1 = await listenServiceUpdateEvents(
          () => active,
          {
            quota: {
              clearRefresh: () => setRefreshError(null),
              clearBackend: () => setQuotaBackendError(null),
            },
          },
          { quotaSetter: setQuotas }
        );
        unlisteners.push(u1);

        const u3 = await tauriListen("quota_config_update", (event) => {
          if (!active) return;
          setShowAccountName(event.payload?.show_account_name || false);
          setShowPlanType(event.payload?.show_plan_type !== false);
          setConfigItems(event.payload?.items || []);
        });
        unlisteners.push(u3);

        const u4 = await listenQuotaMonitorStatus(
          setQuotaMonitorStatus,
          setQuotaBackendError,
          () => active
        );
        unlisteners.push(u4);

        const appConfig = await tauriInvoke("get_app_config");
        let quotaEnabled = appConfig?.quota_enabled !== false;
        if (active) {
          setServiceEnabled(quotaEnabled);
          setDashboardTheme(appConfig?.theme === "light" ? "light" : "dark");
        }

        const u5 = await tauriListen("app_config_update", async (event) => {
          if (!active) return;
          quotaEnabled = await handleWidgetAppConfigUpdate(event.payload, quotaEnabled, {
            serviceField: "quota_enabled",
            setServiceEnabled: setServiceEnabled,
            setDashboardTheme: setDashboardTheme,
            disableClears: {
              clearData: () => setQuotas([]),
              clearRefreshError: () => setRefreshError(null),
              clearBackendError: () => setQuotaBackendError(null),
              clearMonitorStatus: () => setQuotaMonitorStatus(null),
            },
          });
        });
        unlisteners.push(u5);
      } catch (e) {
        console.error("Failed to setup quota listeners", e);
      }
    };

    setup();

    return () => {
      active = false;
      unlisteners.forEach((f) => f());
    };
  }, []);

  const tracksAntigravity = configItems.some((item) => {
    const q = quotas.find((entry) => entry.id === item.id);
    return q?.provider === "antigravity";
  }) || quotas.some((q) => q.provider === "antigravity");

  useEffect(() => {
    if (!tracksAntigravity) {
      setAgStatus(null);
      return;
    }
    let active = true;
    const refresh = () => {
      tauriInvoke("get_antigravity_setup_status")
        .then((status) => {
          if (active) setAgStatus(status);
        })
        .catch(() => {
          if (active) setAgStatus(null);
        });
    };
    refresh();
    const interval = window.setInterval(refresh, 15000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [tracksAntigravity, configItems.length, quotas.length]);

  const agReady =
    agStatus?.language_server_running ||
    (agStatus?.has_oauth_tokens && agStatus?.cloud_auth_ready);

  const handleRefresh = async () => {
    if (isRefreshing || !serviceEnabled) return;
    setIsRefreshing(true);
    setRefreshError(null);
    try {
      const [qd, qc] = await Promise.all([
        tauriInvoke("refresh_quota"),
        tauriInvoke("get_quota_config"),
      ]);
      setQuotas(qd);
      setConfigItems(qc?.items || []);
      setShowAccountName(qc?.show_account_name || false);
      setShowPlanType(qc?.show_plan_type !== false);
    } catch (e) {
      console.error("Manual refresh failed", e);
      setRefreshError(String(e));
    } finally {
      setIsRefreshing(false);
    }
  };

  const adjustManualQuota = async (id: string, currentValue: number, delta: number) => {
    const nextVal = Math.max(0, currentValue + delta);
    try {
      // Optimistic local update
      setQuotas((prev) =>
        prev.map((q) => (q.id === id ? { ...q, current_value: nextVal, last_update: "Just now" } : q))
      );
      await tauriInvoke("update_manual_quota", { id, value: nextVal });
    } catch (e) {
      console.error("Failed to adjust manual quota", e);
    }
  };

  const startEditing = (q: QuotaItem) => {
    setEditingId(q.id);
    setEditValue((q.current_value ?? 0).toString());
  };

  const saveDirectValue = async (id: string, valStr: string) => {
    setEditingId(null);
    const parsed = parseFloat(valStr);
    if (isNaN(parsed)) return;
    const nextVal = Math.max(0, parsed);
    try {
      // Optimistic local update
      setQuotas((prev) =>
        prev.map((q) => (q.id === id ? { ...q, current_value: nextVal, last_update: "Just now" } : q))
      );
      await tauriInvoke("update_manual_quota", { id, value: nextVal });
    } catch (e) {
      console.error("Failed to update manual quota directly", e);
    }
  };

  const toggleErrorExpand = (id: string) => {
    setExpandedErrors((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  if (!currentTheme) return null;

  const getC = (name: string, fallback: string) => {
    const c = currentTheme.primary_colors.find((p) => p.name === name);
    return c ? hexToRgba(c.value, c.opacity ?? 1.0) : fallback;
  };
  const getT = (name: string, fallback: string) => {
    const c = currentTheme.text_colors?.find((p) => p.name === name);
    return c ? hexToRgba(c.value, c.opacity ?? 1.0) : fallback;
  };

  const accent = getC("Accent", "#06b6d4");
  const success = getC("Success", "#10b981");
  const warning = getC("Warning", "#f59e0b");
  const danger = getC("Danger", "#ef4444");
  const mainText = getT("Main Text", "#ffffff");
  const subText = getT("Sub Text", "#94a3b8");

  // Only show monitors present in quota config, preserving user-defined order.
  const displayedQuotas = orderQuotaByConfig(quotas, configItems);
  const quotaHardErrorCount = displayedQuotas.filter(
    (q) => q.error_msg && !isStaleQuotaWarning(q.error_msg)
  ).length;
  const quotaStaleCount = displayedQuotas.filter(
    (q) => isStaleQuotaWarning(q.error_msg) && quotaHasDisplayValue(q)
  ).length;
  const quotaHeaderHint =
    quotaMonitorStatus && quotaMonitorStatus.consecutive_failures > 0
      ? `Backoff ${quotaMonitorStatus.backoff_secs}s`
      : quotaHardErrorCount > 0
      ? `${quotaHardErrorCount} error${quotaHardErrorCount > 1 ? "s" : ""}`
      : quotaStaleCount > 0
      ? `${quotaStaleCount} cached`
      : null;

  const renderProviderIcon = (provider: string, isManual = false) => {
    if (isManual) {
      return <User size={10} style={{ color: accent }} className="flex-shrink-0" />;
    }
    const logoSrc = PROVIDER_LOGOS[provider];
    if (logoSrc) {
      return (
        <img
          src={logoSrc}
          alt=""
          className="w-[10px] h-[10px] flex-shrink-0 object-contain"
          draggable={false}
        />
      );
    }
    if (provider.includes("openai")) {
      return <Cpu size={10} style={{ color: success }} className="flex-shrink-0 animate-pulse" />;
    }
    return <Globe size={10} style={{ color: warning }} className="flex-shrink-0" />;
  };

  return (
    <div className="h-full flex flex-col select-none" style={{ color: mainText }}>
      {!hideHeader && (
        <div className="flex items-center justify-between mb-3 border-b border-white/5 pb-2">
          <div className="flex items-center gap-2">
            <Gauge size={16} style={{ color: accent }} className="animate-pulse" />
            <span className="text-xs font-black uppercase tracking-widest" style={{ color: subText }}>
              Quota Monitor
            </span>
            {quotaHeaderHint && (
              <span
                className="text-[8px] font-black uppercase tracking-widest"
                style={{ color: quotaHardErrorCount > 0 ? danger : warning }}
              >
                {quotaHeaderHint}
              </span>
            )}
          </div>
          <button
            onClick={handleRefresh}
            disabled={isRefreshing || !serviceEnabled}
            className="p-1 hover:bg-white/10 rounded-md transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ color: subText }}
            title="Refresh Quotas"
          >
            <RefreshCw size={12} className={isRefreshing ? "animate-spin" : "hover:rotate-45 transition-transform"} />
          </button>
        </div>
      )}

      <ServiceErrorBanners
        backendError={quotaBackendError}
        refreshError={refreshError}
        onDismissBackend={() => setQuotaBackendError(null)}
        onDismissRefresh={() => setRefreshError(null)}
        theme={dashboardTheme}
        showBackend={serviceEnabled}
        className="mb-2 space-y-2"
        backendCachedLabel={cachedLabelWhen(
          displayedQuotas.length > 0,
          CACHED_LABELS.quota.backend
        )}
        refreshCachedLabel={cachedLabelWhen(
          displayedQuotas.length > 0,
          CACHED_LABELS.quota.refresh
        )}
      />

      {tracksAntigravity && agStatus && !agReady && (
        <div className="mb-2 px-2 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[8px] text-amber-300/90 leading-relaxed">
          {agStatus.has_oauth_tokens && !agStatus.language_server_running ? (
            agStatus.cloud_auth_ready ? (
              "Antigravity IDE not running — launch it to refresh quota locally."
            ) : (
              <>
                Antigravity IDE not running — launch it, or add{" "}
                <code className="font-mono">client_secret</code> to{" "}
                <span className="font-mono break-all">{agStatus.oauth_config_path}</span>
              </>
            )
          ) : (
            <>
              Antigravity not ready — sign in via the IDE or configure OAuth at{" "}
              <span className="font-mono break-all">{agStatus.oauth_config_path}</span>
            </>
          )}
        </div>
      )}

      {/* Quotas List */}
      <div className="flex-1 overflow-y-auto custom-scrollbar pr-1 w-full space-y-2 pb-2">
        {!serviceEnabled ? (
          <div
            className="flex flex-col items-center justify-center text-center mt-10 px-4 py-8 rounded-xl border border-dashed"
            style={{ borderColor: `${subText}33`, color: subText }}
          >
            <Gauge size={20} style={{ color: accent, opacity: 0.5 }} className="mb-3" />
            <span className="text-[10px] font-black uppercase tracking-widest mb-1">
              Service Disabled
            </span>
            <span className="text-[9px] opacity-70 leading-relaxed">
              Enable monitoring on the module page.
            </span>
          </div>
        ) : displayedQuotas.length > 0 ? (
          displayedQuotas.map((q) => {
            const hasValue = q.current_value !== null && q.current_value !== undefined;
            const usesQuotaBarLayout =
              q.provider === "codex" ||
              q.provider === "cursor" ||
              q.provider === "antigravity" ||
              q.provider === "copilot" ||
              q.provider === "pioneer" ||
              q.provider === "qoder-cn" ||
              q.provider === "claude-code";

            const isMultiBar =
              hasValue &&
              usesQuotaBarLayout &&
              ((q.bars && q.bars.length > 0) ||
                q.provider === "copilot" ||
                (q.secondary_value !== undefined && q.secondary_value !== null) ||
                (q.tertiary_value !== undefined && q.tertiary_value !== null));

            if (isMultiBar) {
              const bars =
                q.bars && q.bars.length > 0
                  ? q.bars.map((bar) => ({
                      val: bar.value,
                      name: bar.name,
                      reset: bar.reset,
                    }))
                  : [
                      { val: q.current_value ?? 0, name: q.primary_name || "Usage", reset: q.primary_reset },
                      ...(q.secondary_value !== undefined && q.secondary_value !== null
                        ? [{ val: q.secondary_value, name: q.secondary_name || "", reset: q.secondary_reset }]
                        : []),
                      ...(q.tertiary_value !== undefined && q.tertiary_value !== null
                        ? [{ val: q.tertiary_value, name: q.tertiary_name || "", reset: q.tertiary_reset }]
                        : []),
                    ];

              const getBarColor = (pct: number) =>
                pct < 15 ? danger : pct < 40 ? warning : success;

              // Cursor / Copilot: shared reset shown in header
              const headerReset =
                q.provider === "cursor" || q.provider === "copilot" ? q.primary_reset : null;
              // Codex: each bar shows its own reset inline (not in header)
              const showBarReset =
                q.provider === "codex" ||
                q.provider === "antigravity" ||
                q.provider === "claude-code";

              return (
                <div
                  key={q.id}
                  className="bg-white/5 rounded-xl p-3 border border-white/5 relative overflow-hidden group transition-all hover:bg-white/10 hover:border-white/10"
                >
                  <div className="relative z-10 flex flex-col gap-2">
                    {/* Header: Title + optional shared reset */}
                    <div className="flex items-center justify-between w-full min-w-0">
                      <div className="flex items-center gap-1.5 min-w-0">
                        {renderProviderIcon(q.provider)}
                        <span className="text-[10px] font-black truncate" style={{ color: mainText }} title={displayName(q)}>
                          {displayName(q)}
                        </span>
                        {showPlanType && q.plan_type && (
                          <span className="text-[8px] font-extrabold uppercase tracking-widest px-1 py-0.5 rounded bg-white/5 border border-white/5 opacity-70 flex-shrink-0" style={{ color: subText }}>
                            {q.plan_type}
                          </span>
                        )}
                      </div>
                      {headerReset && (
                        <span className="text-[8px] opacity-60 font-medium whitespace-nowrap" style={{ color: subText }}>
                          Reset: {headerReset}
                        </span>
                      )}
                    </div>

                    {/* Bars */}
                    {bars.map((bar, i) => {
                      const pct = bar.val;
                      const color = getBarColor(pct);
                      return (
                        <div key={i} className={`flex flex-col gap-1 ${i > 0 ? "mt-0.5" : ""}`}>
                          <div className="flex justify-between items-center text-[9px] font-bold">
                            <span style={{ color: subText }} className="flex items-center gap-1 min-w-0">
                              <span className="truncate">{bar.name}</span>
                              {showBarReset && bar.reset && (
                                <span className="text-[8px] opacity-50 font-normal whitespace-nowrap">
                                  ({bar.reset})
                                </span>
                              )}
                            </span>
                            <span style={{ color }} className="tabular-nums ml-2 flex-shrink-0">
                              {pct.toFixed(0)}%
                            </span>
                          </div>
                          <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden border border-white/5">
                            <div
                              className="h-full rounded-full transition-all duration-500"
                              style={{
                                width: `${pct}%`,
                                background: `linear-gradient(90deg, ${adjustColorOpacity(color, 0.6)}, ${color})`,
                                boxShadow: `0 0 6px ${adjustColorOpacity(color, 0.7)}`
                              }}
                            />
                          </div>
                        </div>
                      );
                    })}

                    {renderQuotaAlert(q, expandedErrors, toggleErrorExpand)}

                    <QuotaVisualizations
                      provider={q.provider}
                      analytics={q.analytics}
                      config={visualizationsFor(q)}
                      theme={{
                        accent,
                        subText,
                        mainText,
                        scheme: dashboardTheme,
                        emptyCell:
                          dashboardTheme === "light"
                            ? "rgba(15,23,42,0.08)"
                            : "rgba(255,255,255,0.08)",
                      }}
                    />
                  </div>

                  {/* Glowing Background Blob */}
                  <div
                    className="absolute top-0 right-0 w-16 h-16 rounded-full blur-2xl -mr-8 -mt-8 pointer-events-none opacity-20 transition-opacity group-hover:opacity-40"
                    style={{ backgroundColor: getBarColor(bars[0].val) }}
                  />
                </div>
              );
            }

            const hasMax = hasValue && q.max_quota !== undefined && q.max_quota !== null && q.max_quota > 0;
            const current = q.current_value ?? 0;
            const max = q.max_quota ?? 100;
            const percent = hasMax ? Math.min(100, Math.max(0, (current / max) * 100)) : 100;

            // Pick status color
            let statusColor = accent;
            if (!hasValue) {
              statusColor = subText;
            } else if (hasMax) {
              if (percent < 15) {
                statusColor = danger;
              } else if (percent < 40) {
                statusColor = warning;
              } else {
                statusColor = success;
              }
            } else if (q.provider !== "manual" && q.error_msg && !isStaleQuotaWarning(q.error_msg)) {
              statusColor = danger;
            }

            const isManual = q.provider === "manual";
            const isEditing = editingId === q.id;

            return (
              <div
                key={q.id}
                className="bg-white/5 rounded-xl p-3 border border-white/5 relative overflow-hidden group transition-all hover:bg-white/10 hover:border-white/10"
              >
                <div className="relative z-10 flex flex-col gap-1.5">
                  {/* Title, Provider Icon, and Value */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex flex-col min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 min-w-0">
                        {renderProviderIcon(q.provider, isManual)}
                        <span className="text-[10px] font-black truncate" style={{ color: mainText }} title={displayName(q)}>
                          {displayName(q)}
                        </span>
                        {showPlanType && q.plan_type && (
                          <span className="text-[8px] font-extrabold uppercase tracking-widest px-1 py-0.5 rounded bg-white/5 border border-white/5 opacity-70 flex-shrink-0" style={{ color: subText }}>
                            {q.plan_type}
                          </span>
                        )}
                      </div>
                      {/* Antigravity model label + reset time */}
                      {q.provider === "antigravity" && q.primary_name && (
                        <div className="flex items-center justify-between mt-0.5 pl-4">
                          <span className="text-[8px] font-semibold truncate" style={{ color: subText }}>
                            {q.primary_name}
                          </span>
                          {q.primary_reset && (
                            <span className="text-[8px] opacity-60 font-medium whitespace-nowrap ml-2" style={{ color: subText }}>
                              Reset: {q.primary_reset}
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-1 flex-shrink-0">
                      {isEditing ? (
                        <input
                          ref={inputRef}
                          type="number"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveDirectValue(q.id, editValue);
                            if (e.key === "Escape") setEditingId(null);
                          }}
                          onBlur={() => saveDirectValue(q.id, editValue)}
                          className="w-14 bg-white/15 border border-white/20 rounded px-1 py-0.5 text-right text-[10px] font-extrabold focus:outline-none focus:border-cyan-500"
                          style={{ color: mainText }}
                          autoFocus
                          step="any"
                        />
                      ) : (
                        <span
                          onDoubleClick={() => isManual && startEditing(q)}
                          className={`text-[10px] font-extrabold tabular-nums transition-colors ${
                            isManual ? "cursor-pointer hover:bg-white/10 px-1 rounded border border-transparent hover:border-white/5" : ""
                          }`}
                          style={{ color: statusColor }}
                          title={isManual ? "Double click to edit value" : undefined}
                        >
                          {hasValue ? (
                            <>
                              {q.unit === "%"
                                ? Math.round(current)
                                : current.toFixed(current % 1 === 0 ? 0 : 2)}
                              {q.unit === "%" ? "%" : q.unit ? ` ${q.unit}` : ""}
                              {hasMax && q.unit !== "%" && ` / ${max.toFixed(0)}`}
                            </>
                          ) : (
                            "-"
                          )}
                        </span>
                      )}

                      {isManual && !isEditing && (
                        <button
                          onClick={() => startEditing(q)}
                          className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-white/10 rounded transition-all cursor-pointer"
                          style={{ color: subText }}
                          title="Edit directly"
                        >
                          <Edit2 size={8} />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Progress Bar (if max provided) */}
                  {hasMax && (
                    <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden border border-white/5 relative">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${percent}%`,
                          background: `linear-gradient(90deg, ${adjustColorOpacity(statusColor, 0.6)}, ${statusColor})`,
                          boxShadow: `0 0 6px ${adjustColorOpacity(statusColor, 0.7)}`
                        }}
                      />
                    </div>
                  )}

                  {/* Reset Time for non-antigravity single-bar items */}
                  {q.primary_reset && q.provider !== "antigravity" && (

                    <div className="text-[8px] opacity-60 font-medium text-right mt-0.5" style={{ color: subText }}>
                      Reset: {q.primary_reset}
                    </div>
                  )}

                  {/* Manual Controls */}
                  {isManual && (
                    <div className="flex items-center justify-between mt-0.5">
                      <span className="text-[8px] font-bold opacity-60" style={{ color: subText }}>
                        Click +/- to adjust by 1
                      </span>
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => adjustManualQuota(q.id, current, -1)}
                          className="w-5 h-5 flex items-center justify-center rounded bg-white/5 border border-white/10 hover:bg-white/20 active:scale-95 transition-all text-xs font-bold cursor-pointer"
                          title="Use 1 count"
                        >
                          <Minus size={10} />
                        </button>
                        <button
                          onClick={() => adjustManualQuota(q.id, current, 1)}
                          className="w-5 h-5 flex items-center justify-center rounded bg-white/5 border border-white/10 hover:bg-white/20 active:scale-95 transition-all text-xs font-bold cursor-pointer"
                          title="Add 1 count"
                        >
                          <Plus size={10} />
                        </button>
                      </div>
                    </div>
                  )}


                  {renderQuotaAlert(q, expandedErrors, toggleErrorExpand)}
                </div>

                {/* Glowing Background Blob */}
                <div
                  className="absolute top-0 right-0 w-16 h-16 rounded-full blur-2xl -mr-8 -mt-8 pointer-events-none opacity-20 transition-opacity group-hover:opacity-40"
                  style={{ backgroundColor: statusColor }}
                />
              </div>
            );
          })
        ) : (
          <div
            className="flex flex-col items-center justify-center text-center mt-10 px-4 py-8 rounded-xl border border-dashed"
            style={{ borderColor: `${subText}33`, color: subText }}
          >
            <Gauge size={20} style={{ color: accent, opacity: 0.5 }} className="mb-3" />
            <span className="text-[10px] font-black uppercase tracking-widest mb-1">
              No Agents Configured
            </span>
            <span className="text-[9px] opacity-70 leading-relaxed">
              Open the main window Settings → Quota Monitor to add providers.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
