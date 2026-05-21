# Product scope

The V1 product is a Chrome Extension MV3 app that saves the currently open Confluence Server/Data Center 7.13.7 page or Google Doc into the user's Notion workspace.

## In scope for V1

- Manual, single-page clipping only.
- Manual, single-document Google Docs clipping only, using the local `gws` CLI through Native Messaging for internal-tool use.
- User-provided Notion Personal Access Token / Internal Integration Token; Notion OAuth is out of scope for V1.
- One configured Confluence base URL with explicit optional host permission.
- Both Notion database and page targets.
- Fetch Confluence storage format through REST API, not DOM-to-Markdown as the main path.
- Create a new Notion page on every save; never update or deduplicate old clipped pages.
- Google Docs support does not use Google OAuth in the extension; `gws` CLI owns Google authentication locally.
- Run save work in the background so popup close does not cancel the task.
- Degrade local content issues with warnings rather than failing the whole page, except for whole-page fetch, parse, and write failures described in the spec.

## Out of scope for V1

- Generic web clipping.
- Public-distribution Google OAuth / Drive API integration.
- Confluence Cloud.
- Space, tree, or site migration.
- Sync, incremental sync, scheduled sync, comments, permissions, version history, and admin UI.
- Google Docs comments, suggestions, permissions, and version history.
- Editable Draw.io import.
