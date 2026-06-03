# Robustness & Long-Term Testing Standards for Widgitron

To ensure the Widgitron Tauri application remains highly stable, performs without memory leaks during multi-day execution, and avoids crashing/hanging, developers must adhere to the following coding standards and patterns.

---

## 1. Rust Backend Standards

### 1.1 Safe Lock Handling (Mutex / RwLock)
Never call `.unwrap()` or `.expect()` directly on `.lock()` or `.read()`/.`write()` operations. If a thread holding a lock panics, the lock becomes poisoned. Calling `.unwrap()` on a poisoned lock will propagate the panic to the caller thread, crashing the entire Tauri application.

*   **Background Threads / Long-running loops**: Use `.unwrap_or_else(|e| e.into_inner())` to recover the guard even if the lock was poisoned, or log and handle the error gracefully.
    ```rust
    // Good: Background monitor loop continues running even if another thread crashed
    let mut data = state.lock().unwrap_or_else(|err| {
        log::warn!("Lock poisoned, recovering inner state");
        err.into_inner()
    });
    ```
*   **Commands / API Handlers**: Use `.map_err()` to propagate a clean error message back to the frontend instead of panicking.
    ```rust
    // Good: Return error to React instead of crashing the app
    let state = state.lock().map_err(|e| e.to_string())?;
    ```

### 1.2 Strict Timeout Policies
All network requests, socket connections, and database operations must have explicit timeouts. Relying on default network clients without timeouts risks freezing worker threads permanently if a server responds too slowly.

*   Use `reqwest::Client` with an explicit `timeout` configuration. Never use `reqwest::get` or default client creations without custom configuration.
    ```rust
    // Good: Connection and request will timeout after 30 seconds
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()?;
    ```

### 1.3 Safe Option/Result Unwrapping on Startup
Tauri app builders and startup routines must avoid panicking on optional resources (like icons, environment configuration, or directories).

*   Use safe patterns with default fallbacks or clean error returns instead of calling `.unwrap()` on `Option` types.
    ```rust
    // Good: Fallback when window icon is not present
    let app_icon = app.default_window_icon().cloned();
    ```

---

## 2. Frontend React Standards

### 2.1 Async Event Listeners & Cleanups
Tauri's `listen` function is asynchronous and returns a `Promise<UnlistenFn>`. If a React component unmounts before this promise resolves:
1.  The `UnlistenFn` is never obtained or executed, causing a permanent memory leak in the Tauri webview.
2.  The callback will capture references to outdated state setters, triggering React warnings and potential logic errors.

*   **Required Design Pattern**: Use a local `active` boolean flag combined with a tracked `unlisteners` cleanup array.
    ```typescript
    useEffect(() => {
      let active = true;
      const unlisteners: (() => void)[] = [];
    
      const setup = async () => {
        try {
          const unlisten = await listen<PayloadType>("event-name", (event) => {
            if (!active) return;
            // Safe state update:
            setData(event.payload);
          });
    
          if (!active) {
            unlisten(); // Clean up immediately if component unmounted while registering
          } else {
            unlisteners.push(unlisten);
          }
        } catch (error) {
          console.error("Failed to register event listener:", error);
        }
      };
      setup();
    
      return () => {
        active = false;
        unlisteners.forEach((fn) => fn());
      };
    }, []);
    ```

### 2.2 Asynchronous Fetching in Hooks
When fetching initial data inside `useEffect` (e.g., calling `invoke("get_data")`), check the `active` flag before writing back to React state.
```typescript
useEffect(() => {
  let active = true;

  const loadData = async () => {
    try {
      const data = await invoke("get_data");
      if (!active) return;
      setData(data);
    } catch (e) {
      console.error(e);
    }
  };
  loadData();

  return () => {
    active = false;
  };
}, []);
```

---

## 3. Verification & CI/CD Checklist

Before submitting code changes, run the following command checklist from the workspace root to ensure code compliance:

1.  **Rust Backend Verification**:
    *   Verify code compiles without warnings: `cargo check --manifest-path src-tauri/Cargo.toml`
    *   Run test suite: `cargo test --manifest-path src-tauri/Cargo.toml`
2.  **React Frontend Verification**:
    *   Compile TS and build: `npm run build` or `pnpm build`
3.  **Memory Audits**:
    *   Periodically check the Webview and Rust backend memory consumption during extended mock runs (e.g., 24+ hour run simulation).
