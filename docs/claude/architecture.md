# Architecture constraints

Use the component boundaries from the spec when adding source code:

```text
Popup UI / Options UI
  -> Background Task Runner
      -> Confluence Detector
      -> Confluence Storage Fetcher
      -> Storage XML Parser
      -> Macro Mapper / Converter
      -> Asset Handler
      -> Notion Target Manager
      -> Notion Writer
```

Expected data flow:

```text
Current tab
  -> detect configured Confluence page + pageId
  -> fetch /rest/api/content/{pageId}?expand=body.storage,metadata.labels,version,space,children.attachment
  -> parse storage XML into internal AST
  -> convert AST directly to Notion blocks
  -> download/upload referenced same-origin assets
  -> create new Notion page under selected database/page target
  -> append blocks in batches of at most 100
  -> store/show terminal ClipTask summary
```

## Security and permissions

- Keep Notion tokens in `chrome.storage.local`; content scripts must not receive them.
- Do not request `cookies` permission; Confluence fetches use `fetch(..., { credentials: 'include' })`.
- Do not request `<all_urls>`; manifest `optional_host_permissions` may predeclare only `http://*/*` and `https://*/*` as MV3 candidate patterns, but runtime permission requests must request only the configured Confluence origin.
- Host permission is origin-scoped, but detector and REST content fetcher must enforce the normalized Confluence base URL path in code.
- Same-origin assets referenced by storage XML or attachment metadata may be downloaded even when outside the normalized base URL path.
- Parser must disable external entities and resource loading.
- Parser must not preserve executable or renderable raw HTML into Notion.

## Notion and task behavior

- Converter should generate Notion blocks directly. Markdown is not the main intermediate format because it loses Notion callout, toggle, table, image, caption, and nested block semantics.
- Asset uploads have concurrency limit 3; files over 20 MB are skipped and preserved as links.
- Uploaded Notion file references must be attached within 1 hour; do not persist uploaded file URLs as durable references.
- Route typed `chrome.storage.local` access through `src/shared/storage/local.ts`.
- Logout cleanup removes Notion state and last terminal summary while preserving the Confluence base URL.
- Route Notion API requests through `src/notion/auth.ts` `notionApiFetch` so the stored Internal Integration Token is attached in one place and never exposed to content scripts or logs.
- Background task runner must allow only one non-terminal `ClipTask`; duplicate save clicks show existing progress.
- If Notion page creation succeeds but later block append fails, do not archive, delete, or clear the partial page.

## Core domain model

Keep these names and ownership aligned with the spec unless there is a strong reason to change them:

- `ConfluencePageRef` — normalized base URL, page ID, original page URL.
- `ConfluencePageData` — title, storage XML, metadata, attachments.
- `NotionTarget` — selected `database` or `page` target.
- `ClipTask` — one save operation, status, progress, warnings, and result.
- `AssetRef` — source asset, upload status, Notion file reference.
- `Degradation` — local conversion or upload fallback shown in the result summary.
