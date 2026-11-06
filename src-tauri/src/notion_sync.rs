//! Pushes the workspace into Notion, mirroring folders as child pages.
//!
//! The run is strictly sequential (Notion allows ~3 requests/second), reports
//! progress through the `notion:progress` event and never aborts on a single
//! document: failures are collected and returned so the UI can list them.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Runtime};

use crate::atomic::read_json;
use crate::error::{AppError, AppResult};
use crate::models::{now_ms, DocFile, Node, NodeKind, Workspace};
use crate::notion::{self, NotionClient, PageLink};
use crate::notion_blocks::{self, BlockNode, ASSET_MARKER};
use crate::paths::{workspace_root, Paths};
use crate::workspace::{self, COMPLETED_ID};

/// Notion accepts at most 100 children per request.
const MAX_BLOCKS: usize = 100;
/// Single-part upload limit; anything bigger degrades to a text placeholder.
const MAX_IMAGE_BYTES: u64 = 20 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SyncMode {
    /// Create only what is missing; documents already synced are skipped.
    NewOnly,
    /// Also rewrite the body of documents changed since the last sync.
    Overwrite,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncOptions {
    #[serde(default)]
    pub include_completed: bool,
    pub mode: SyncMode,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncFailure {
    pub doc_id: String,
    pub title: String,
    pub message: String,
}

#[derive(Debug, Default, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SyncStats {
    pub folders_created: usize,
    pub pages_created: usize,
    pub pages_updated: usize,
    pub pages_skipped: usize,
    pub images_uploaded: usize,
    pub images_failed: usize,
    pub failures: Vec<SyncFailure>,
    pub last_sync_at: u64,
    pub parent_url: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress {
    phase: &'static str,
    done: usize,
    total: usize,
    current: String,
}

fn emit<R: Runtime>(app: &AppHandle<R>, phase: &'static str, done: usize, total: usize, current: &str) {
    let _ = app.emit(
        "notion:progress",
        Progress {
            phase,
            done,
            total,
            current: current.to_string(),
        },
    );
}

// --------------------------------------------------------------- traversal

/// Same ordering as the sidebar: pinned first (newest pin first), then `order`.
fn ordered_children(ws: &Workspace, parent: Option<&str>) -> Vec<Node> {
    let mut list: Vec<&Node> = ws
        .nodes
        .iter()
        .filter(|n| n.parent_id.as_deref() == parent && n.builtin.is_none())
        .collect();
    list.sort_by(|a, b| {
        let a_pinned = a.pinned_at.is_some();
        let b_pinned = b.pinned_at.is_some();
        b_pinned
            .cmp(&a_pinned)
            .then(b.pinned_at.unwrap_or(0).cmp(&a.pinned_at.unwrap_or(0)))
            .then(a.order.cmp(&b.order))
            .then(a.created_at.cmp(&b.created_at))
    });
    list.into_iter().cloned().collect()
}

fn count_scope(ws: &Workspace, parent: Option<&str>, include_completed: bool) -> usize {
    let mut total = 0;
    let mut queue = vec![parent.map(|p| p.to_string())];
    while let Some(current) = queue.pop() {
        for node in ordered_children(ws, current.as_deref()) {
            total += 1;
            if node.kind == NodeKind::Folder {
                queue.push(Some(node.id.clone()));
            }
        }
        if current.is_none() && include_completed {
            total += 1; // the 「已归档」 page itself
            total += ordered_children(ws, Some(COMPLETED_ID)).len();
        }
    }
    total
}

// ------------------------------------------------------------------ images

fn mime_for(name: &str) -> &'static str {
    match name.rsplit('.').next().unwrap_or("").to_ascii_lowercase().as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "avif" => "image/avif",
        "bmp" => "image/bmp",
        "heic" => "image/heic",
        _ => "image/png",
    }
}

fn image_block(upload_id: &str) -> Value {
    json!({
        "object": "block",
        "type": "image",
        "image": { "type": "file_upload", "file_upload": { "id": upload_id } }
    })
}

struct ImageUploads {
    /// workspace-relative path → uploaded file id (None once it failed)
    done: HashMap<String, Option<String>>,
    uploaded: usize,
    failed: usize,
}

impl ImageUploads {
    fn new() -> Self {
        Self {
            done: HashMap::new(),
            uploaded: 0,
            failed: 0,
        }
    }
}

fn collect_asset_refs(nodes: &[BlockNode], out: &mut Vec<String>) {
    for node in nodes {
        if node.block.get("type").and_then(Value::as_str) == Some("image") {
            if let Some(rel) = node
                .block
                .pointer(&format!("/image/{ASSET_MARKER}"))
                .and_then(Value::as_str)
            {
                if !out.iter().any(|existing| existing == rel) {
                    out.push(rel.to_string());
                }
            }
        }
        collect_asset_refs(&node.children, out);
    }
}

fn apply_asset_results(nodes: &mut [BlockNode], uploads: &ImageUploads) {
    for node in nodes.iter_mut() {
        if node.block.get("type").and_then(Value::as_str) == Some("image") {
            if let Some(rel) = node
                .block
                .pointer(&format!("/image/{ASSET_MARKER}"))
                .and_then(Value::as_str)
                .map(str::to_string)
            {
                let name = rel.rsplit('/').next().unwrap_or(&rel).to_string();
                match uploads.done.get(&rel) {
                    Some(Some(id)) => node.block = image_block(id),
                    _ => {
                        node.block = notion_blocks::placeholder(&format!("（图片未同步：{name}）"));
                    }
                }
            }
        }
        apply_asset_results(&mut node.children, uploads);
    }
}

impl ImageUploads {
    /// Uploads every referenced image once; failures are remembered, not fatal.
    async fn upload_all(
        &mut self,
        client: &NotionClient,
        paths: &Paths,
        refs: &[String],
    ) {
        for rel in refs {
            if self.done.contains_key(rel) {
                continue;
            }
            match self.upload_one(client, paths, rel).await {
                Ok(id) => {
                    self.uploaded += 1;
                    self.done.insert(rel.clone(), Some(id));
                }
                Err(_) => {
                    self.failed += 1;
                    self.done.insert(rel.clone(), None);
                }
            }
        }
    }

    async fn upload_one(
        &mut self,
        client: &NotionClient,
        paths: &Paths,
        rel: &str,
    ) -> Result<String, String> {
        let file = paths
            .asset_file(rel)
            .map_err(|err| err.message)?;
        let meta = tokio::fs::metadata(&file)
            .await
            .map_err(|_| "本地文件已不存在".to_string())?;
        if meta.len() > MAX_IMAGE_BYTES {
            return Err("超过单张 20MB 限制".to_string());
        }
        let bytes = tokio::fs::read(&file)
            .await
            .map_err(|err| format!("读取失败：{err}"))?;
        let filename = rel.rsplit('/').next().unwrap_or(rel).to_string();
        let mime = mime_for(&filename);

        let created = client
            .post(
                "/file_uploads",
                json!({ "filename": filename, "content_type": mime }),
            )
            .await
            .map_err(|err| err.message)?;
        let upload_url = created
            .get("upload_url")
            .and_then(Value::as_str)
            .ok_or_else(|| "Notion 没有返回上传地址".to_string())?
            .to_string();
        let id = created
            .get("id")
            .and_then(Value::as_str)
            .ok_or_else(|| "Notion 没有返回上传 id".to_string())?
            .to_string();

        client
            .upload_bytes(&upload_url, &filename, mime, bytes)
            .await
            .map_err(|err| err.message)?;
        Ok(id)
    }
}

// ------------------------------------------------------------------ writing

/// Appends blocks to a page/block, walking children level by level because
/// Notion nests at most two levels per request.
async fn append_tree(client: &NotionClient, parent_id: &str, blocks: &[BlockNode]) -> AppResult<()> {
    let mut queue: Vec<(String, &[BlockNode])> = vec![(parent_id.to_string(), blocks)];
    while let Some((parent, level)) = queue.pop() {
        if level.is_empty() {
            continue;
        }
        let mut created: Vec<String> = Vec::with_capacity(level.len());
        for chunk in level.chunks(MAX_BLOCKS) {
            let values: Vec<Value> = chunk.iter().map(|node| node.block.clone()).collect();
            let response = client
                .patch(
                    &format!("/blocks/{parent}/children"),
                    json!({ "children": values }),
                )
                .await?;
            let results = response
                .get("results")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            for item in &results {
                if let Some(id) = item.get("id").and_then(Value::as_str) {
                    created.push(id.to_string());
                }
            }
        }
        if created.len() != level.len() {
            return Err(AppError::new(
                "notion_append_failed",
                "Notion 返回的块数量与提交的不一致，可能是内容块过多被截断，请重试",
            ));
        }
        for (node, id) in level.iter().zip(created) {
            if !node.children.is_empty() {
                queue.push((id, node.children.as_slice()));
            }
        }
    }
    Ok(())
}

/// Deletes every direct child of a page (used by "全部重写").
async fn clear_children(client: &NotionClient, page_id: &str) -> AppResult<usize> {
    let mut removed = 0;
    for _ in 0..64 {
        let response = client
            .get(&format!("/blocks/{page_id}/children?page_size=100"))
            .await?;
        let ids: Vec<String> = response
            .get("results")
            .and_then(Value::as_array)
            .map(|list| {
                list.iter()
                    .filter_map(|item| item.get("id").and_then(Value::as_str))
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default();
        if ids.is_empty() {
            break;
        }
        for id in ids {
            client.delete(&format!("/blocks/{id}")).await?;
            removed += 1;
        }
    }
    Ok(removed)
}

async fn create_page(client: &NotionClient, parent_page: &str, title: &str) -> AppResult<String> {
    let body = json!({
        "parent": { "type": "page_id", "page_id": parent_page },
        "properties": { "title": notion::title_property(title) }
    });
    let page = client.post("/pages", body).await?;
    page.get("id")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| AppError::new("notion_create_failed", "Notion 没有返回新页面的 id"))
}

async fn rename_page(client: &NotionClient, page_id: &str, title: &str) -> AppResult<()> {
    client
        .patch(
            &format!("/pages/{page_id}"),
            json!({ "properties": { "title": notion::title_property(title) } }),
        )
        .await?;
    Ok(())
}

// --------------------------------------------------------------------- run

struct Ctx<'a, R: Runtime> {
    app: &'a AppHandle<R>,
    client: &'a NotionClient,
    paths: &'a Paths,
    ws: &'a Workspace,
    cfg: notion::NotionConfig,
    options: SyncOptions,
    stats: SyncStats,
    uploads: ImageUploads,
    done: usize,
    total: usize,
}

impl<'a, R: Runtime> Ctx<'a, R> {
    fn tick(&mut self, phase: &'static str, current: &str) {
        self.done += 1;
        emit(self.app, phase, self.done, self.total, current);
    }
}

/// Creates or reuses the Notion page for a folder and returns its page id.
async fn ensure_folder_page<R: Runtime>(
    ctx: &mut Ctx<'_, R>,
    folder: &Node,
    notion_parent: &str,
) -> AppResult<String> {
    if let Some(page) = ctx.cfg.folders.get(&folder.id).cloned() {
        return Ok(page); // created by a previous run; keep the user's edits
    }
    let page = create_page(ctx.client, notion_parent, &folder.name).await?;
    ctx.cfg.folders.insert(folder.id.clone(), page.clone());
    ctx.stats.folders_created += 1;
    Ok(page)
}

async fn sync_doc<R: Runtime>(
    ctx: &mut Ctx<'_, R>,
    node: &Node,
    notion_parent: &str,
) -> AppResult<()> {
    let existing = ctx.cfg.pages.get(&node.id).cloned();
    let needs_body = match &existing {
        None => true,
        // a page whose body never landed is retried even in "new only" mode
        Some(link) => !link.ok
            || (ctx.options.mode == SyncMode::Overwrite && link.doc_updated_at < node.updated_at),
    };

    if !needs_body {
        ctx.stats.pages_skipped += 1;
        ctx.tick("docs", &node.name);
        return Ok(());
    }

    // read the body first: a missing or broken file must not create an empty
    // page in Notion
    let doc = read_json::<DocFile>(&ctx.paths.doc_file(&node.id)?).await?;
    let title = if node.name.trim().is_empty() {
        doc.title.clone()
    } else {
        node.name.clone()
    };
    let mut blocks = notion_blocks::convert_doc(&doc.content);
    let mut refs = Vec::new();
    collect_asset_refs(&blocks, &mut refs);
    ctx.uploads.upload_all(ctx.client, ctx.paths, &refs).await;
    apply_asset_results(&mut blocks, &ctx.uploads);

    let mut page_id = existing.as_ref().map(|link| link.page_id.clone());
    let mut created = page_id.is_none();
    let mut outcome: AppResult<()> = Ok(());

    if let Some(id) = page_id.clone() {
        outcome = async {
            rename_page(ctx.client, &id, &title).await?;
            clear_children(ctx.client, &id).await?;
            append_tree(ctx.client, &id, &blocks).await
        }
        .await;

        // the page was deleted / un-shared in Notion since the last sync: build
        // a fresh one instead of failing the document
        if let Err(err) = &outcome {
            if err.code == "notion_not_found" {
                page_id = None;
                created = true;
                ctx.cfg.pages.remove(&node.id);
                outcome = Ok(());
            }
        }
    }

    if page_id.is_none() {
        let id = create_page(ctx.client, notion_parent, &title).await?;
        outcome = append_tree(ctx.client, &id, &blocks).await;
        page_id = Some(id);
    }

    let ok = outcome.is_ok();
    if let Some(id) = page_id {
        ctx.cfg.pages.insert(
            node.id.clone(),
            PageLink {
                page_id: id,
                title: title.clone(),
                doc_updated_at: if ok { doc.updated_at } else { 0 },
                synced_at: now_ms(),
                ok,
            },
        );
    }

    match outcome {
        Ok(()) => {
            if created {
                ctx.stats.pages_created += 1;
            } else {
                ctx.stats.pages_updated += 1;
            }
        }
        Err(err) => ctx.stats.failures.push(SyncFailure {
            doc_id: node.id.clone(),
            title: title.clone(),
            message: err.message,
        }),
    }
    ctx.tick("docs", &title);
    Ok(())
}

#[tauri::command]
pub async fn notion_sync_docs<R: Runtime>(
    app: AppHandle<R>,
    options: SyncOptions,
) -> AppResult<SyncStats> {
    let cfg = notion::snapshot(&app);
    if cfg.token().is_none() {
        return Err(AppError::new(
            "notion_no_token",
            "还没有连接 Notion：请先填入 Integration Token 并验证",
        ));
    }
    if cfg.parent_page_id.is_empty() {
        return Err(AppError::new(
            "notion_no_parent",
            "还没有选择同步目标：请粘贴一个 Notion 页面链接并点「检测页面」",
        ));
    }

    let client = NotionClient::from_app(&app)?;
    let paths = Paths::new(workspace_root(&app)?);
    paths.ensure_dirs().await?;
    let ws = workspace::load_shared(&paths).await?;

    let total = count_scope(&ws, None, options.include_completed);
    let mut ctx = Ctx {
        app: &app,
        client: &client,
        paths: &paths,
        ws: &ws,
        cfg,
        options,
        stats: SyncStats::default(),
        uploads: ImageUploads::new(),
        done: 0,
        total,
    };
    emit(&app, "prepare", 0, total, "");

    // breadth-first walk: every entry carries the Notion page its children go
    // into and the workspace parent that provides the ordering
    let mut queue: Vec<(String, Option<String>)> =
        vec![(ctx.cfg.parent_page_id.clone(), None)];
    let mut root_done = false;

    while let Some((notion_parent, ws_parent)) = queue.pop() {
        let children = ordered_children(ctx.ws, ws_parent.as_deref());

        for node in children {
            match node.kind {
                NodeKind::Folder => {
                    match ensure_folder_page(&mut ctx, &node, &notion_parent).await {
                        Ok(page) => {
                            ctx.tick("folders", &node.name);
                            queue.push((page, Some(node.id.clone())));
                        }
                        Err(err) => {
                            // a folder that cannot be created takes its subtree
                            // with it: report once, keep going with the rest
                            ctx.stats.failures.push(SyncFailure {
                                doc_id: node.id.clone(),
                                title: node.name.clone(),
                                message: err.message,
                            });
                            ctx.tick("folders", &node.name);
                        }
                    }
                }
                NodeKind::Doc => {
                    if let Err(err) = sync_doc(&mut ctx, &node, &notion_parent).await {
                        ctx.stats.failures.push(SyncFailure {
                            doc_id: node.id.clone(),
                            title: node.name.clone(),
                            message: err.message,
                        });
                        ctx.tick("docs", &node.name);
                    }
                }
            }
        }

        // 「已归档」 lives at the root but is excluded from `ordered_children`
        if ws_parent.is_none() && !root_done {
            root_done = true;
            if ctx.options.include_completed {
                let completed = ctx
                    .ws
                    .nodes
                    .iter()
                    .find(|n| n.id == COMPLETED_ID)
                    .cloned();
                if let Some(folder) = completed {
                    match ensure_folder_page(&mut ctx, &folder, &notion_parent).await {
                        Ok(page) => {
                            ctx.tick("folders", &folder.name);
                            queue.push((page, Some(folder.id.clone())));
                        }
                        Err(err) => {
                            ctx.stats.failures.push(SyncFailure {
                                doc_id: folder.id.clone(),
                                title: folder.name.clone(),
                                message: err.message,
                            });
                            ctx.tick("folders", &folder.name);
                        }
                    }
                }
            }
        }
    }

    let now = now_ms();
    ctx.cfg.last_sync_at = now;
    notion::save(&app, &ctx.cfg).await?;
    notion::remember(&app, &ctx.cfg);

    let mut stats = ctx.stats;
    stats.last_sync_at = now;
    stats.parent_url = notion::page_url(&ctx.cfg.parent_page_id);
    stats.images_uploaded = ctx.uploads.uploaded;
    stats.images_failed = ctx.uploads.failed;
    emit(
        &app,
        "done",
        stats.pages_created + stats.pages_updated + stats.pages_skipped,
        total,
        "",
    );
    Ok(stats)
}
