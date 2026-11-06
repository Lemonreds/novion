//! Markdown / HTML / JSON export and full-workspace backup.
//!
//! Everything is written into `~/Downloads/Novion` so the user never has to
//! pick a folder, and every export is self-contained: rendered Markdown points
//! at `assets/` next to the file, and the full backup additionally keeps a
//! byte-exact copy of `workspace.json` + `docs/` + `assets/` so a workspace can
//! be restored by hand without this app.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager, Runtime};

use crate::atomic::{read_json, write_atomic, write_json_atomic};
use crate::error::{AppError, AppResult};
use crate::markdown;
use crate::models::{now_ms, Builtin, DocFile, NodeKind, Workspace};
use crate::paths::{export_root, workspace_root, Paths};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    /// file for a single document, folder for a workspace backup
    pub path: String,
    pub files: usize,
    pub bytes: u64,
    pub assets: usize,
    pub format: String,
}

// ------------------------------------------------------------------- helpers

/// File-system safe name: separators become dashes, everything else is kept so
/// Chinese titles stay readable.
fn safe_name(name: &str, fallback: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|ch| match ch {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '-',
            ch if ch.is_control() => ' ',
            ch => ch,
        })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.').trim();
    let bounded: String = trimmed.chars().take(80).collect();
    let bounded = bounded.trim().to_string();
    if bounded.is_empty() {
        fallback.to_string()
    } else {
        bounded
    }
}

/// `2025-11-04 18-31-07` in local time (shells out to `date`, which costs one
/// fork per export and is the only dependency-free way to get the local zone).
fn local_stamp() -> String {
    if let Ok(out) = std::process::Command::new("date")
        .arg("+%Y-%m-%d %H-%M-%S")
        .output()
    {
        if out.status.success() {
            let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !text.is_empty() {
                return text;
            }
        }
    }
    utc_stamp(now_ms())
}

/// Fallback stamp (UTC) so an export never fails because `date` is missing.
fn utc_stamp(ms: u64) -> String {
    let secs = ms / 1000;
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    // Howard Hinnant's civil-from-days
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let mut year = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    if month <= 2 {
        year += 1;
    }
    format!(
        "{year:04}-{month:02}-{day:02} {:02}-{:02}-{:02}",
        rem / 3_600,
        (rem % 3_600) / 60,
        rem % 60
    )
}

/// Appends ` (2)`, ` (3)`… until the path is free.
fn unique_path(dir: &Path, stem: &str, ext: &str) -> PathBuf {
    let mut candidate = dir.join(format!("{stem}.{ext}"));
    let mut n = 2;
    while candidate.exists() {
        candidate = dir.join(format!("{stem} ({n}).{ext}"));
        n += 1;
    }
    candidate
}

async fn file_size(path: &Path) -> u64 {
    tokio::fs::metadata(path)
        .await
        .map(|m| m.len())
        .unwrap_or(0)
}

async fn create_dir(dir: &Path) -> AppResult<()> {
    tokio::fs::create_dir_all(dir)
        .await
        .map_err(|e| AppError::io(&format!("创建目录 {} 失败", dir.display()), e))
}

/// Copies the assets referenced by one document into `dest`.
async fn copy_assets(paths: &Paths, dest: &Path, refs: &[String]) -> (usize, u64) {
    let mut copied = 0;
    let mut bytes = 0;
    for rel in refs {
        let Ok(src) = paths.asset_file(rel) else { continue };
        if !tokio::fs::try_exists(&src).await.unwrap_or(false) {
            continue;
        }
        let Some(name) = src.file_name() else { continue };
        let target = dest.join(name);
        if tokio::fs::try_exists(&target).await.unwrap_or(false) {
            continue;
        }
        if create_dir(dest).await.is_err() {
            continue;
        }
        if tokio::fs::copy(&src, &target).await.is_ok() {
            copied += 1;
            bytes += file_size(&target).await;
        }
    }
    (copied, bytes)
}

/// Recursive copy used for the byte-exact `raw/` backup.
async fn copy_tree(src: &Path, dest: &Path) -> AppResult<(usize, u64)> {
    let mut files = 0;
    let mut bytes = 0;
    let mut stack = vec![(src.to_path_buf(), dest.to_path_buf())];

    while let Some((from, to)) = stack.pop() {
        if !tokio::fs::try_exists(&from).await.unwrap_or(false) {
            continue;
        }
        create_dir(&to).await?;
        let mut reader = tokio::fs::read_dir(&from)
            .await
            .map_err(|e| AppError::io(&format!("读取目录 {} 失败", from.display()), e))?;
        while let Some(entry) = reader
            .next_entry()
            .await
            .map_err(|e| AppError::io("遍历目录失败", e))?
        {
            let target = to.join(entry.file_name());
            let kind = entry
                .file_type()
                .await
                .map_err(|e| AppError::io("读取文件类型失败", e))?;
            if kind.is_dir() {
                stack.push((entry.path(), target));
            } else if kind.is_file() {
                tokio::fs::copy(entry.path(), &target)
                    .await
                    .map_err(|e| AppError::io("复制文件失败", e))?;
                files += 1;
                bytes += file_size(&target).await;
            }
        }
    }
    Ok((files, bytes))
}

// ------------------------------------------------------------- single export

#[tauri::command]
pub async fn export_doc<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    format: String,
) -> AppResult<ExportResult> {
    let paths = Paths::new(workspace_root(&app)?);
    let file = paths.doc_file(&id)?;
    if !tokio::fs::try_exists(&file).await.unwrap_or(false) {
        return Err(AppError::not_found("文档文件不存在"));
    }
    let doc = read_json::<DocFile>(&file).await?;

    let ws = crate::workspace::load_shared(&paths).await.ok();
    let title = ws
        .as_ref()
        .and_then(|ws| ws.nodes.iter().find(|n| n.id == id))
        .map(|n| n.name.clone())
        .filter(|name| !name.trim().is_empty())
        .unwrap_or_else(|| doc.title.clone());
    let title = if title.trim().is_empty() {
        "Untitled".to_string()
    } else {
        title
    };

    let root = export_root(&app);
    create_dir(&root).await?;
    let stem = safe_name(&title, "Untitled");
    let format = format.trim().to_ascii_lowercase();

    // Bytes, not a `String`: a JSON export used to serialise into a `Vec<u8>`,
    // convert it lossily into a `String` and then back into bytes when writing
    // — three copies of the whole document for one file.
    let (target, payload): (PathBuf, Vec<u8>) = match format.as_str() {
        "md" | "markdown" => {
            let body = markdown::to_markdown(&doc.content, "");
            (
                unique_path(&root, &stem, "md"),
                format!("# {title}\n\n{body}").into_bytes(),
            )
        }
        "html" => {
            let page = markdown::html_document(&title, &doc.content);
            (unique_path(&root, &stem, "html"), page.into_bytes())
        }
        "json" => {
            let json = serde_json::to_vec_pretty(&doc)
                .map_err(|e| AppError::json("序列化文档失败", e))?;
            (unique_path(&root, &stem, "json"), json)
        }
        other => {
            return Err(AppError::invalid(format!(
                "不支持的导出格式：{other}（可用 md / html / json）"
            )))
        }
    };

    // images are referenced as `assets/x.png`; put them next to the export so
    // the file stays readable when it is moved together with that folder
    let (assets, asset_bytes) = if format == "md" || format == "html" {
        copy_assets(
            &paths,
            &root.join("assets"),
            &crate::assets::collect_asset_refs(&doc.content),
        )
        .await
    } else {
        (0, 0)
    };

    write_atomic(&target, &payload).await?;
    Ok(ExportResult {
        path: target.to_string_lossy().to_string(),
        files: 1,
        bytes: file_size(&target).await + asset_bytes,
        assets,
        format,
    })
}

/// Renders one document as a print-ready HTML page.
///
/// The UI loads it into a hidden frame and calls `print()`: macOS then offers
/// "存储为 PDF", which produces a real PDF with selectable text and correctly
/// embedded CJK fonts — something a hand-rolled PDF writer cannot match.
#[tauri::command]
pub async fn render_doc_html<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    asset_base: Option<String>,
) -> AppResult<String> {
    let paths = Paths::new(workspace_root(&app)?);
    let file = paths.doc_file(&id)?;
    if !tokio::fs::try_exists(&file).await.unwrap_or(false) {
        return Err(AppError::not_found("文档文件不存在"));
    }
    let doc = read_json::<DocFile>(&file).await?;

    let ws = crate::workspace::load_shared(&paths).await.ok();
    let title = ws
        .as_ref()
        .and_then(|ws| ws.nodes.iter().find(|n| n.id == id))
        .map(|n| n.name.clone())
        .filter(|name| !name.trim().is_empty())
        .unwrap_or_else(|| doc.title.clone());
    let title = if title.trim().is_empty() {
        "Untitled".to_string()
    } else {
        title
    };

    // Images must be reachable from the print frame. `asset_base` is the
    // webview's asset-protocol prefix (…/assets/), which keeps working where a
    // `file://` URL would be blocked by the webview's origin rules.
    //
    // The body is moved out of `doc` and rewritten in place: cloning it only to
    // rewrite a few `src` attributes doubled the memory of every print.
    let mut content = doc.content;
    let base = asset_base.unwrap_or_else(|| {
        format!("file://{}/", paths.assets_dir().to_string_lossy())
    });
    absolutize_assets(&mut content, &base);
    Ok(markdown::html_print_document(&title, &content))
}

/// Rewrites `assets/x.png` to a loadable URL so the print frame can show it.
fn absolutize_assets(content: &mut serde_json::Value, base: &str) {
    match content {
        serde_json::Value::Array(items) => {
            for item in items.iter_mut() {
                absolutize_assets(item, base);
            }
        }
        serde_json::Value::Object(map) => {
            if map.get("type").and_then(|t| t.as_str()) == Some("image") {
                if let Some(attrs) = map.get_mut("attrs").and_then(|a| a.as_object_mut()) {
                    if let Some(src) = attrs.get("src").and_then(|s| s.as_str()) {
                        if let Some(rel) = src.strip_prefix("assets/") {
                            let sep = if base.ends_with('/') { "" } else { "/" };
                            let url = format!("{base}{sep}{rel}");
                            attrs.insert("src".into(), serde_json::Value::String(url));
                        }
                    }
                }
            }
            for value in map.values_mut() {
                absolutize_assets(value, base);
            }
        }
        _ => {}
    }
}

// ---------------------------------------------------------- workspace backup

#[tauri::command]
pub async fn export_workspace<R: Runtime>(app: AppHandle<R>) -> AppResult<ExportResult> {
    let paths = Paths::new(workspace_root(&app)?);
    let ws = crate::workspace::load_shared(&paths).await?;

    let root = export_root(&app);
    create_dir(&root).await?;
    let dir = root.join(format!("备份-{}", local_stamp()));
    create_dir(&dir).await?;

    // 1. byte-exact copy of the source of truth
    let raw = dir.join("raw");
    create_dir(&raw).await?;
    let mut files = 0;
    let mut bytes = 0;
    if tokio::fs::try_exists(&paths.workspace_file()).await.unwrap_or(false) {
        let target = raw.join("workspace.json");
        tokio::fs::copy(paths.workspace_file(), &target)
            .await
            .map_err(|e| AppError::io("备份 workspace.json 失败", e))?;
        files += 1;
        bytes += file_size(&target).await;
    }
    for sub in ["docs", "assets"] {
        let (f, b) = copy_tree(&paths.root.join(sub), &raw.join(sub)).await?;
        files += f;
        bytes += b;
    }

    // 2. readable Markdown mirror of the tree
    let md_root = dir.join("markdown");
    create_dir(&md_root).await?;
    let mirror = mirror_workspace(&paths, &ws, &md_root).await?;
    files += mirror.files;
    bytes += mirror.bytes;

    let manifest = serde_json::json!({
        "app": "Novion",
        "formatVersion": 1,
        "exportedAt": now_ms(),
        "source": paths.root.to_string_lossy(),
        "docs": ws.nodes.iter().filter(|n| n.kind == NodeKind::Doc).count(),
        "files": files,
        "bytes": bytes,
        "layout": {
            "raw": "逐字节副本：workspace.json + docs/ + assets/",
            "markdown": "按目录结构导出的 .md 文件，图片在 markdown/assets/"
        }
    });
    write_json_atomic(&dir.join("manifest.json"), &manifest).await?;
    write_atomic(&dir.join("README.txt"), README.as_bytes()).await?;
    files += 2;

    Ok(ExportResult {
        path: dir.to_string_lossy().to_string(),
        files,
        bytes,
        assets: mirror.assets,
        format: "backup".to_string(),
    })
}

const README: &str = "\
Novion 备份
===========

raw/
  逐字节副本：workspace.json（目录树）、docs/（每篇文档的 TipTap JSON）、
  assets/（图片）。把整个 raw/ 复制回 ~/Documents/Novion 即可还原工作区。

markdown/
  按文件夹结构导出的 Markdown，适合阅读、搜索或迁移到别的工具。
  图片在 markdown/assets/ 下，相对路径已经处理好在任意子目录打开。

manifest.json
  本次导出的时间、来源目录与文件统计。
";

struct Mirror {
    files: usize,
    bytes: u64,
    assets: usize,
}

/// Writes one `.md` per document, mirroring the sidebar tree.
async fn mirror_workspace(
    paths: &Paths,
    ws: &Workspace,
    md_root: &Path,
) -> AppResult<Mirror> {
    let mut children: HashMap<Option<String>, Vec<&crate::models::Node>> = HashMap::new();
    for node in &ws.nodes {
        children.entry(node.parent_id.clone()).or_default().push(node);
    }
    for list in children.values_mut() {
        list.sort_by(|a, b| a.order.cmp(&b.order).then(a.name.cmp(&b.name)));
    }

    // (parent id, target dir, depth) — the trash subtree is never mirrored
    let mut stack: Vec<(Option<String>, PathBuf, usize)> = vec![(None, md_root.to_path_buf(), 0)];
    let mut used: HashSet<String> = HashSet::new();
    let mut files = 0;
    let mut bytes = 0;

    while let Some((parent, dir, depth)) = stack.pop() {
        let Some(list) = children.get(&parent) else { continue };
        for node in list.clone() {
            if node.builtin == Some(Builtin::Trash) || node.trashed_at.is_some() {
                continue;
            }
            match node.kind {
                NodeKind::Folder => {
                    let name = match node.builtin {
                        Some(Builtin::Completed) => "已归档".to_string(),
                        _ => safe_name(&node.name, "未命名文件夹"),
                    };
                    let next = dir.join(name);
                    create_dir(&next).await?;
                    stack.push((Some(node.id.clone()), next, depth + 1));
                }
                NodeKind::Doc => {
                    let Ok(file) = paths.doc_file(&node.id) else { continue };
                    let Ok(doc) = read_json::<DocFile>(&file).await else {
                        continue;
                    };
                    let stem = safe_name(&node.name, "Untitled");
                    let key = format!("{}/{}", dir.to_string_lossy(), stem.to_lowercase());
                    let stem = if used.insert(key) {
                        stem
                    } else {
                        format!("{stem} ({})", crate::paths::short_id())
                    };
                    let prefix = "../".repeat(depth);
                    let body = markdown::to_markdown(&doc.content, &prefix);
                    let title = if node.name.trim().is_empty() {
                        "Untitled"
                    } else {
                        node.name.as_str()
                    };
                    let payload = format!("# {title}\n\n{body}");
                    let target = unique_path(&dir, &stem, "md");
                    write_atomic(&target, payload.as_bytes()).await?;
                    files += 1;
                    bytes += file_size(&target).await;
                }
            }
        }
    }

    let asset_dir = md_root.join("assets");
    let (asset_files, asset_bytes) = copy_tree(&paths.assets_dir(), &asset_dir).await?;
    files += asset_files;
    bytes += asset_bytes;
    Ok(Mirror {
        files,
        bytes,
        assets: asset_files,
    })
}

// ------------------------------------------------------------------- reveal

/// Shows an exported file or folder in Finder. Only paths under the export /
/// workspace roots are accepted, so this cannot be used to open arbitrary files.
#[tauri::command]
pub async fn reveal_path<R: Runtime>(app: AppHandle<R>, path: String) -> AppResult<()> {
    fn canon(path: &Path) -> PathBuf {
        path.canonicalize().unwrap_or_else(|_| path.to_path_buf())
    }

    let target = canon(Path::new(path.trim()));
    if !target.exists() {
        return Err(AppError::not_found("路径不存在"));
    }

    let mut allowed: Vec<PathBuf> = vec![canon(&export_root(&app))];
    for extra in [
        app.path().download_dir().ok(),
        app.path().document_dir().ok(),
        workspace_root(&app).ok(),
    ]
    .into_iter()
    .flatten()
    {
        allowed.push(canon(&extra));
    }
    if !allowed.iter().any(|root| target.starts_with(root)) {
        return Err(AppError::invalid("只能打开导出目录中的文件"));
    }

    std::process::Command::new("open")
        .arg("-R")
        .arg(&target)
        .spawn()
        .map_err(|e| AppError::io("打开 Finder 失败", e))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::Node;
    use serde_json::json;

    #[test]
    fn names_lose_path_separators() {
        assert_eq!(safe_name("a/b:c", "x"), "a-b-c");
        assert_eq!(safe_name("   ", "未命名"), "未命名");
        assert_eq!(safe_name("...", "未命名"), "未命名");
        assert_eq!(safe_name("正常标题", "x"), "正常标题");
    }

    #[test]
    fn utc_stamp_is_padded() {
        assert_eq!(utc_stamp(0), "1970-01-01 00-00-00");
        // 2025-11-04T10:31:07Z
        assert_eq!(utc_stamp(1_762_252_267_000), "2025-11-04 10-31-07");
    }

    fn temp_paths() -> Paths {
        let root = std::env::temp_dir().join(format!(
            "novion-export-test-{}",
            uuid::Uuid::new_v4().simple()
        ));
        Paths::new(root)
    }

    #[tokio::test]
    async fn mirror_mirrors_the_tree_and_keeps_images_relative() {
        let paths = temp_paths();
        paths.ensure_dirs().await.unwrap();

        let doc = DocFile {
            id: "d_a".to_string(),
            title: "第一篇".to_string(),
            created_at: 1,
            updated_at: 2,
            schema_version: 1,
            content: json!({
                "type": "doc",
                "content": [
                    { "type": "paragraph", "content": [{ "type": "text", "text": "正文" }] },
                    { "type": "image", "attrs": { "src": "assets/img_x.png" } }
                ]
            }),
        };
        write_json_atomic(&paths.doc_file(&doc.id).unwrap(), &doc)
            .await
            .unwrap();
        tokio::fs::write(paths.assets_dir().join("img_x.png"), b"png")
            .await
            .unwrap();

        let folder = Node::new(
            "f_sub".to_string(),
            NodeKind::Folder,
            "子目录".to_string(),
            None,
            0,
        );
        let doc_node = Node::new(
            "d_a".to_string(),
            NodeKind::Doc,
            "第一篇".to_string(),
            Some("f_sub".to_string()),
            0,
        );
        let trash = {
            let mut node = Node::new(
                "f_trash".to_string(),
                NodeKind::Folder,
                "回收站".to_string(),
                None,
                1,
            );
            node.builtin = Some(Builtin::Trash);
            node
        };
        let ws = Workspace {
            version: 1,
            updated_at: 3,
            nodes: vec![folder, doc_node, trash],
        };

        let md_root = paths.root.join("markdown");
        let mirror = mirror_workspace(&paths, &ws, &md_root).await.unwrap();

        let file = md_root.join("子目录").join("第一篇.md");
        let text = tokio::fs::read_to_string(&file).await.unwrap();
        assert!(text.starts_with("# 第一篇\n\n正文"), "{text}");
        // one folder deep → images are reached through ../assets
        assert!(text.contains("../assets/img_x.png"), "{text}");
        assert!(md_root.join("assets").join("img_x.png").exists());
        assert_eq!(mirror.assets, 1);
        assert!(!md_root.join("回收站").exists());

        let _ = tokio::fs::remove_dir_all(&paths.root).await;
    }
}
