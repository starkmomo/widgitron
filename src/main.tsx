import ReactDOM from "react-dom/client";import App from "./App";
import "./index.css";
import type { TauriCommandArgs } from "./types/tauri";
import { tauriInvoke } from "./utils/tauriInvoke";
import { isWindows } from "./utils/platform";

if (isWindows) document.documentElement.dataset.platform = "windows";

const ERROR_LOG_DEBOUNCE_MS = 2000;
const recentErrorLogs = new Map<string, number>();

function frontendErrorDedupeKey(
  args: Pick<TauriCommandArgs["log_frontend_error"], "message" | "source" | "lineno">
): string {
  const source = args.source ?? "unknown";
  const line = args.lineno ?? 0;
  return `${source}:${line}:${args.message}`;
}

function shouldLogFrontendError(args: TauriCommandArgs["log_frontend_error"]): boolean {
  const key = frontendErrorDedupeKey(args);
  const now = Date.now();
  const lastLogged = recentErrorLogs.get(key);
  if (lastLogged !== undefined && now - lastLogged < ERROR_LOG_DEBOUNCE_MS) {
    return false;
  }
  recentErrorLogs.set(key, now);
  return true;
}

function logFrontendError(args: TauriCommandArgs["log_frontend_error"]): void {
  if (!shouldLogFrontendError(args)) {
    return;
  }

  tauriInvoke("log_frontend_error", args).catch((err) => {
    console.error("Failed to log frontend error to Rust:", err);
  });
}

// Catch global Javascript errors
window.addEventListener("error", (event) => {
  const { message, filename, lineno, colno, error } = event;

  // Guard to prevent recursive loops
  if (message && message.includes("Failed to log frontend error to Rust")) {
    return;
  }

  logFrontendError({
    message: message || "Unknown Javascript Error",
    source: filename || "unknown",
    lineno: lineno || undefined,
    colno: colno || undefined,
    error: error ? error.stack || error.toString() : undefined,
  });
});

// Catch unhandled promise rejections
window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  const message = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error ? reason.stack : undefined;

  // Guard to prevent recursive loops
  if (message && message.includes("Failed to log frontend error to Rust")) {
    return;
  }

  logFrontendError({
    message: `Unhandled Rejection: ${message}`,
    source: "unhandledrejection",
    error: stack,
  });
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <App />,
);
