# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository status

This repository contains a TypeScript Chrome Extension MV3 scaffold plus the product/technical spec.

Primary source of truth:

- `SPEC-Confluence-to-Notion-Chrome-Extension.md` — V1 spec for a Confluence Server/Data Center to Notion Chrome extension.

## Commands

```bash
# Install dependencies
npm install

# Build extension into dist/
npm run build

# Typecheck
npm run typecheck

# Full test suite
npm test

# Single test file
npx vitest run src/tests/scaffold.test.ts
```

When implementation tooling changes, update this section with the actual package manager and commands for:

- dependency install
- dev server / extension watch build
- production build
- lint and typecheck
- full test suite
- single test file / single test case

Do not invent commands before the corresponding tooling exists in the repo.

## Product scope from the spec

The intended project is a Chrome Extension MV3 app that saves the currently open Confluence Server/Data Center 7.13.7 page into the user's Notion workspace.

V1 scope:

- Manual, single-page clipping only.
- Notion OAuth; no manually pasted integration token.
- One configured Confluence base URL with explicit optional host permission.
- Both Notion database and page targets.
- Fetch Confluence storage format through REST API, not DOM-to-Markdown as the main path.
- Create a new Notion page on every save; never update or deduplicate old clipped pages.
- Run save work in the background so popup close does not cancel the task.
- Degrade local content issues with warnings rather than failing the whole page, except for whole-page fetch/parse/write failures described in the spec.

Out of scope for V1:

- Generic web clipping.
- Confluence Cloud.
- Space/tree/site migration.
- Sync, incremental sync, scheduled sync, comments, permissions, version history, admin UI.
- Editable Draw.io import.

## Expected high-level architecture

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

Key data flow:

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

Important architectural constraints:

- Keep Notion tokens in `chrome.storage.local`; content scripts must not receive them.
- Do not request `cookies` permission; Confluence fetches use `fetch(..., { credentials: 'include' })`.
- Do not request `<all_urls>`; request only the configured Confluence origin as an optional host permission.
- Host permission is origin-scoped, but detector and REST content fetcher must enforce the normalized Confluence base URL path in code.
- Same-origin assets referenced by storage XML or attachment metadata may be downloaded even when outside the normalized base URL path.
- Parser must disable external entities/resource loading and must not preserve executable/renderable raw HTML into Notion.
- Converter should generate Notion blocks directly. Markdown is not the main intermediate format because it loses Notion callout, toggle, table, image, caption, and nested block semantics.
- Asset uploads have concurrency limit 3; files over 20 MB are skipped and preserved as links.
- Uploaded Notion file references must be attached within 1 hour; do not persist uploaded file URLs as durable references.
- Route typed `chrome.storage.local` access through `src/shared/storage/local.ts`; logout cleanup removes Notion state and last terminal summary while preserving the Confluence base URL.
- Route Notion API requests through `src/notion/auth.ts` `notionApiFetch` so expired access tokens refresh before calls and refresh failures clear Notion session state.
- Background task runner must allow only one non-terminal `ClipTask`; duplicate save clicks show existing progress.
- If Notion page creation succeeds but later block append fails, do not archive/delete/clear the partial page.

## Core domain model

The spec defines these central entities. Keep names and ownership aligned unless there is a strong reason to change them:

- `ConfluencePageRef` — normalized base URL, page ID, original page URL.
- `ConfluencePageData` — title, storage XML, metadata, attachments.
- `NotionTarget` — selected `database` or `page` target.
- `ClipTask` — one save operation, status/progress/warnings/result.
- `AssetRef` — source asset, upload status, Notion file reference.
- `Degradation` — local conversion/upload fallback shown in result summary.

## Required conversion behavior

Macro mapping required by the spec:

- `mermaid` -> Notion code block, language `mermaid` when accepted; otherwise plain-text code fallback with warning.
- `code` / `noformat` -> code block preserving text and best-effort language.
- `info` / `note` / `tip` / `warning` -> callout.
- `expand` -> toggle with recursive conversion where possible.
- Draw.io -> rendered image plus optional source link.
- Unknown macro -> unsupported macro callout containing macro name and recoverable body text, but not macro parameters.

Tables are best effort. Complex tables may flatten or degrade without failing the whole task.

## Validation and tests to add with implementation

When code is introduced, use the fixture and test matrix in the spec as the baseline. Required fixture profiles:

- `simple` — headings, paragraphs, links, lists, basic table, inline formatting.
- `macro-heavy` — Mermaid, code/noformat, callout macros, expand, Draw.io, unsupported macro.
- `image-heavy` — attachment images, external images, broken image, more than one image batch.

Automated tests should cover at least:

- Confluence base URL normalization and context-path guards.
- Supported page URL detection forms.
- XML external entity blocking.
- Conversion of required macros and unknown macro fallback.
- Asset upload concurrency, oversized files, failed uploads, cross-origin external images.
- Notion database/page target behavior and metadata toggle.
- Re-saving creates a new page every time.
- Notion append batching limit of 100 blocks.
- Duplicate save click while a task is running.
- Logout/token storage boundaries.
