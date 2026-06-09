use std::fs::{File, OpenOptions};
use std::io::Write;
use std::sync::Mutex;
use std::path::PathBuf;
use tauri::AppHandle;
use tauri::Manager;

pub struct SimpleLogger {
    file: Mutex<File>,
}

impl SimpleLogger {
    pub fn new(log_path: PathBuf) -> std::io::Result<Self> {
        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(log_path)?;
        Ok(Self {
            file: Mutex::new(file),
        })
    }
}

impl log::Log for SimpleLogger {
    fn enabled(&self, metadata: &log::Metadata) -> bool {
        // Allow up to INFO level to be handled by the logger (for console printing)
        metadata.level() <= log::Level::Info
    }

    fn log(&self, record: &log::Record) {
        if self.enabled(record.metadata()) {
            let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
            let log_line = format!(
                "[{}] [{}] [{}:{}] {}\n",
                timestamp,
                record.level(),
                record.file().unwrap_or("unknown"),
                record.line().unwrap_or(0),
                record.args()
            );

            // ONLY write to the log file if it is WARN or ERROR (keeps file size small)
            if record.level() <= log::Level::Warn {
                if let Ok(mut file) = self.file.lock() {
                    let _ = file.write_all(log_line.as_bytes());
                    // sync_all guarantees bytes hit disk — important for catching crashes
                    let _ = file.sync_all();
                }
            }

            // Mirror to stderr as a secondary safety net
            let _ = std::io::stderr().write_all(log_line.as_bytes());
        }
    }

    fn flush(&self) {
        if let Ok(mut file) = self.file.lock() {
            let _ = file.flush();
        }
    }
}

/// Keep only the most recent `keep` log files, deleting older ones.
fn prune_old_logs(log_dir: &PathBuf, keep: usize) {
    let Ok(entries) = std::fs::read_dir(log_dir) else { return };

    let mut log_files: Vec<PathBuf> = entries
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.starts_with("widgitron_") && n.ends_with(".log"))
                .unwrap_or(false)
        })
        .collect();

    // Sort by filename (timestamp embedded, so lexicographic == chronological)
    log_files.sort();

    if log_files.len() > keep {
        for old in &log_files[..log_files.len() - keep] {
            let _ = std::fs::remove_file(old);
        }
    }
}

/// Write a crash entry directly to the log file, bypassing the logger.
/// Uses sync_all() to guarantee the bytes reach disk before the process exits.
fn write_crash_log(log_path: &PathBuf, line: &str) {
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(log_path) {
        let _ = file.write_all(line.as_bytes());
        let _ = file.sync_all(); // belt-and-suspenders flush
    }
    // Also write to stderr so it's visible in the terminal even without a file
    let _ = std::io::stderr().write_all(line.as_bytes());
}

pub fn init(app: &AppHandle) -> Result<PathBuf, String> {
    let log_dir = app.path().app_log_dir().unwrap_or_else(|_| {
        std::env::current_dir().unwrap_or_default().join("logs")
    });
    std::fs::create_dir_all(&log_dir).map_err(|e| e.to_string())?;

    // Each startup gets its own timestamped log file
    let timestamp = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S");
    let log_path = log_dir.join(format!("widgitron_{}.log", timestamp));

    // Remove old logs, keep the 20 most recent
    prune_old_logs(&log_dir, 20);

    // Initialize custom logger — enable INFO filter for console logging
    let logger = SimpleLogger::new(log_path.clone()).map_err(|e| e.to_string())?;
    log::set_boxed_logger(Box::new(logger))
        .map(|()| log::set_max_level(log::LevelFilter::Info))
        .map_err(|e| e.to_string())?;

    // Setup panic hook — writes synchronously so crash logs are never lost
    let log_path_clone = log_path.clone();
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
        let payload = info.payload();
        let message = if let Some(s) = payload.downcast_ref::<&str>() {
            *s
        } else if let Some(s) = payload.downcast_ref::<String>() {
            s.as_str()
        } else {
            "Box<Any>"
        };

        let location = info.location()
            .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
            .unwrap_or_else(|| "unknown".into());

        let panic_log = format!(
            "[{}] [PANIC] [{}] {}\n",
            timestamp,
            location,
            message
        );

        write_crash_log(&log_path_clone, &panic_log);
        default_hook(info);
    }));

    Ok(log_path)
}
