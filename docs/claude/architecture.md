# Architecture constraints

Use the component boundaries from the spec when adding source code:

```text
Popup UI / Options UI
  -> Background Task Runner
      -> Source Detector
          -> Confluence Detector
          -> Google Docs Detector
      -> Confluence Storage Fetcher
      -> Google Docs Native Bridge (`add_to_notion_gws` via gws CLI)
      -> Storage XML Parser / Google Docs HTML Parser
      -> Macro Mapper / Converter
      -> Asset Handler
      -> Notion Target Manager
      -> Notion Writer
```

Expected data flow:

```text
Current tab
  -> detect configured Confluence page + pageId OR Google Docs document + docId
  -> Confluence: fetch /rest/api/content/{pageId}?expand=body.storage,metadata.labels,version,space,children.attachment
  -> Google Docs: call native host add_to_notion_gws to export HTML through local gws CLI
  -> parse source content into internal AST
  -> convert AST directly to Notion blocks
  -> download/upload referenced assets
  -> create new Notion page under selected database/page target
  -> append blocks in batches of at most 100
  -> store/show terminal ClipTask summary
```

## Security and permissions

- Keep Notion tokens in `chrome.storage.local`; content scripts must not receive them.
- Do not request `cookies` permission; Confluence fetches use `fetch(..., { credentials: 'include' })`.
- Do not implement Google OAuth in the extension; Google Docs support uses Native Messaging to call the local `gws` CLI.
- Manifest must request `nativeMessaging` for Google Docs support, and the native host must restrict `allowed_origins` to the extension ID.
- Do not request `<all_urls>`; manifest `host_permissions` may include only `https://api.notion.com/*` for Notion API calls.
- Manifest `optional_host_permissions` may predeclare only `http://*/*` and `https://*/*` as MV3 candidate patterns, but runtime permission requests must request only the configured Confluence origin.
- Host permission is origin-scoped, but detector and REST content fetcher must enforce the normalized Confluence base URL path in code.
- Same-origin assets referenced by storage XML or attachment metadata may be downloaded even when outside the normalized base URL path.
- Parser must disable external entities and resource loading.
- Google Docs export HTML from `gws` is untrusted input and must not preserve executable or renderable raw HTML into Notion.
- Parser must not preserve executable or renderable raw HTML into Notion.

## Notion and task behavior

- Converter should generate Notion blocks directly. Markdown is not the main intermediate format because it loses Notion callout, toggle, table, image, caption, and nested block semantics.
- Asset uploads have concurrency limit 3; files over 20 MB are skipped and preserved as links.
- Uploaded Notion file references must be attached within 1 hour; do not persist uploaded file URLs as durable references.
- Route typed `chrome.storage.local` access through `src/shared/storage/local.ts`.
- Logout cleanup removes Notion state and last terminal summary while preserving the Confluence base URL.
- The extension must not store or receive Google tokens; `gws` owns Google authentication locally.
- Route Notion API requests through `src/notion/auth.ts` `notionApiFetch` so the stored Internal Integration Token is attached in one place and never exposed to content scripts or logs.
- Background task runner must allow only one non-terminal `ClipTask`; duplicate save clicks show existing progress.
- If Notion page creation succeeds but later block append fails, do not archive, delete, or clear the partial page.

## Core domain model

Keep these names and ownership aligned with the spec unless there is a strong reason to change them:

- `ConfluencePageRef` — normalized base URL, page ID, original page URL.
- `GoogleDocRef` — Google Doc ID and original document URL.
- `ConfluencePageData` — title, storage XML, metadata, attachments.
- `GoogleDocData` — title, export HTML, metadata, assets.
- `NotionTarget` — selected `database` or `page` target.
- `ClipTask` — one save operation, status, progress, warnings, and result.
- `AssetRef` — source asset, upload status, Notion file reference.
- `Degradation` — local conversion or upload fallback shown in the result summary.
