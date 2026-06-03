import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { invoke } from "@tauri-apps/api/core";

// Catch global Javascript errors
window.addEventListener("error", (event) => {
  const { message, filename, lineno, colno, error } = event;
  
  // Guard to prevent recursive loops
  if (message && message.includes("Failed to log frontend error to Rust")) {
    return;
  }

  invoke("log_frontend_error", {
    message: message || "Unknown Javascript Error",
    source: filename || "unknown",
    lineno: lineno || null,
    colno: colno || null,
    error: error ? error.stack || error.toString() : null
  }).catch((err) => {
    console.error("Failed to log frontend error to Rust:", err);
  });
});

// Catch unhandled promise rejections
window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  const message = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error ? reason.stack : null;

  // Guard to prevent recursive loops
  if (message && message.includes("Failed to log frontend error to Rust")) {
    return;
  }

  invoke("log_frontend_error", {
    message: `Unhandled Rejection: ${message}`,
    source: "unhandledrejection",
    lineno: null,
    colno: null,
    error: stack
  }).catch((err) => {
    console.error("Failed to log frontend error to Rust:", err);
  });
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
