use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tokio::io::AsyncWriteExt;

use crate::{config_store, models::AppConfig};

fn valid_paper_id(id: &str) -> bool {
    let digits = |value: &str| !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit());
    let base = match id.rsplit_once('v') {
        Some((base, version)) if digits(version) => base,
        _ => id,
    };
    if let Some((category, number)) = base.split_once('/') {
        return category.starts_with(|character: char| character.is_ascii_alphabetic())
            && category
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || b".-".contains(&byte))
            && number.len() == 7
            && digits(number);
    }
    match base.split_once('.') {
        Some((month, number)) => {
            month.len() == 4
                && digits(month)
                && (number.len() == 4 || number.len() == 5)
                && digits(number)
        }
        None => false,
    }
}

// Close the file before removing it on failure or cancellation, including on
// Windows. A finished download is kept; partial PDFs are never left behind.
struct PendingPdf {
    path: PathBuf,
    file: Option<tokio::fs::File>,
    complete: bool,
}

impl Drop for PendingPdf {
    fn drop(&mut self) {
        drop(self.file.take());
        if !self.complete {
            let _ = std::fs::remove_file(&self.path);
        }
    }
}

async fn save_pdf(
    mut response: reqwest::Response,
    directory: &Path,
    id: &str,
) -> Result<PathBuf, String> {
    let stem = id.replace('/', "_");
    let mut suffix = 0_u32;
    let mut pending = loop {
        let name = if suffix == 0 {
            format!("{stem}.pdf")
        } else {
            format!("{stem} ({suffix}).pdf")
        };
        let path = directory.join(name);
        match tokio::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .await
        {
            Ok(file) => {
                break PendingPdf {
                    path,
                    file: Some(file),
                    complete: false,
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => suffix += 1,
            Err(error) => return Err(format!("Could not save PDF: {error}")),
        }
    };
    let mut signature = Vec::with_capacity(5);
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| format!("PDF download failed: {error}"))?
    {
        signature.extend(chunk.iter().take(5 - signature.len()).copied());
        pending
            .file
            .as_mut()
            .unwrap()
            .write_all(&chunk)
            .await
            .map_err(|error| format!("Could not write PDF: {error}"))?;
    }
    if signature != b"%PDF-" {
        return Err("arXiv did not return a PDF. Please try again later.".into());
    }
    pending
        .file
        .as_mut()
        .unwrap()
        .flush()
        .await
        .map_err(|error| error.to_string())?;
    pending
        .file
        .as_mut()
        .unwrap()
        .sync_all()
        .await
        .map_err(|error| error.to_string())?;
    drop(pending.file.take());
    pending.complete = true;
    Ok(pending.path.clone())
}

#[tauri::command]
pub async fn download_arxiv_pdf(app: AppHandle, id: String) -> Result<String, String> {
    if !valid_paper_id(&id) {
        return Err("Invalid arXiv paper ID".into());
    }
    let config = config_store::read_config::<AppConfig>(&app, "app_config.json");
    let mut builder = reqwest::Client::builder()
        .user_agent(concat!("Widgitron/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(120));
    if let Some(proxy) = config
        .arxiv_proxy
        .as_deref()
        .map(str::trim)
        .filter(|proxy| !proxy.is_empty())
    {
        builder = builder.proxy(reqwest::Proxy::all(proxy).map_err(|error| error.to_string())?);
    }
    let response = builder
        .build()
        .map_err(|error| error.to_string())?
        .get(format!("https://arxiv.org/pdf/{id}"))
        .send()
        .await
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?;
    let directory = app
        .path()
        .download_dir()
        .map_err(|error| error.to_string())?;
    tokio::fs::create_dir_all(&directory)
        .await
        .map_err(|error| error.to_string())?;
    let path = save_pdf(response, &directory, &id).await?;
    Ok(path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::AsyncReadExt;

    // Exercise file writes using an HTTP response, without depending on the
    // arXiv network or writing into the user's Downloads folder.
    async fn response(body: &'static [u8]) -> reqwest::Response {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = [0_u8; 4096];
            stream.read(&mut request).await.unwrap();
            stream
                .write_all(
                    format!(
                        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                        body.len()
                    )
                    .as_bytes(),
                )
                .await
                .unwrap();
            stream.write_all(body).await.unwrap();
        });
        reqwest::Client::builder()
            .no_proxy()
            .build()
            .unwrap()
            .get(format!("http://{address}/paper.pdf"))
            .send()
            .await
            .unwrap()
    }

    fn test_directory(name: &str) -> PathBuf {
        let path =
            std::env::temp_dir().join(format!("widgitron-pdf-{}-{name}", std::process::id()));
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn paper_ids_cannot_escape_the_download_directory() {
        for id in ["2609.12345v2", "0704.0001", "math.GT/0309136v1"] {
            assert!(valid_paper_id(id));
        }
        for id in [
            "../../file",
            "/2609.12345",
            "https://arxiv.org/abs/2609.12345",
            "2609.12345.pdf",
            "math/../../file",
        ] {
            assert!(!valid_paper_id(id));
        }
    }

    #[tokio::test]
    async fn downloads_do_not_overwrite_existing_pdfs() {
        let directory = test_directory("collision");
        let original = directory.join("2609.12345v2.pdf");
        std::fs::write(&original, b"existing paper").unwrap();
        let pdf = b"%PDF-1.7\nnew paper";
        let path = save_pdf(response(pdf).await, &directory, "2609.12345v2")
            .await
            .unwrap();
        assert_ne!(path, original);
        assert_eq!(std::fs::read(&original).unwrap(), b"existing paper");
        assert_eq!(std::fs::read(path).unwrap(), pdf);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[tokio::test]
    async fn non_pdf_responses_are_removed() {
        let directory = test_directory("invalid");
        assert!(save_pdf(
            response(b"<html>busy</html>").await,
            &directory,
            "2609.12345"
        )
        .await
        .is_err());
        assert_eq!(std::fs::read_dir(&directory).unwrap().count(), 0);
        std::fs::remove_dir(directory).unwrap();
    }
}
