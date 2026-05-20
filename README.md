# Add to Notion

Chrome MV3 extension for saving Confluence Server/Data Center pages to Notion.

## Overview

Add to Notion clips the currently open Confluence Server/Data Center page and creates a new page in the user's Notion workspace. It is designed for manual, single-page clipping rather than site migration or continuous sync.

The extension fetches Confluence storage-format content through the Confluence REST API, converts it to Notion blocks, and writes the result to a configured Notion database or page target.

## V1 scope

Supported in V1:

- Manual clipping of one Confluence page at a time.
- Confluence Server/Data Center pages, with the current target baseline at Confluence 7.13.7.
- User-provided Notion Internal Integration Token / Personal Access Token.
- One configured Confluence base URL with runtime host permission.
- Notion database and page targets.
- Background save tasks so closing the popup does not cancel the save.
- Local conversion degradations reported as warnings where possible.

Out of scope for V1:

- Generic web clipping.
- Confluence Cloud.
- Space, tree, or site migration.
- Sync, incremental sync, scheduled sync, comments, permissions, version history, and admin UI.
- Editable Draw.io import.

## Repository layout

```text
public/                 Chrome extension static files and manifest
scripts/                Build scripts
src/background/         MV3 service worker and save task runner
src/confluence/         Confluence URL detection, permission, fetch, and parsing logic
src/converter/          Confluence storage to Notion block conversion
src/notion/             Notion auth, target management, and writer logic
src/options/            Extension options page entrypoint
src/popup/              Extension popup entrypoint
src/shared/             Shared domain models, storage helpers, and request utilities
src/tests/              Vitest test suite and fixtures
docs/claude/            Project scope, architecture, conversion, and testing notes
```

## Prerequisites

- Node.js 20 or newer is recommended.
- npm.
- Chrome or another Chromium-based browser that supports Manifest V3 extensions.
- A Notion integration token with access to the destination page or database.
- Access to a Confluence Server/Data Center instance.

## Install

```bash
npm install
```

## Development commands

```bash
npm run typecheck
npm test
npm run build
```

Run a single test file:

```bash
npx vitest run src/tests/scaffold.test.ts
```

## Build and load the extension

Build the unpacked extension:

```bash
npm run build
```

The build output is written to `dist/`.

To load it in Chrome:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this repository's `dist/` directory.

## Configure the extension

1. Open the extension options page.
2. Enter the Confluence base URL for the server you want to clip from.
3. Grant the requested runtime host permission for that Confluence origin.
4. Create a connection in Notion. Enter the connection's Internal Integration Token.
5. Configure the connection onto a destination Notion database target.
6. Finally, select the Notion database on the extension options page.

Notion tokens are stored in `chrome.storage.local` and are only used from extension-side Notion API calls.

## Usage

1. Open a supported Confluence Server/Data Center page in Chrome.
2. Click the Add to Notion extension icon.
3. Start a save from the popup.
4. Keep browsing if desired; the background task continues after the popup closes.
5. Review the final task summary for success, warnings, or errors.

Each save creates a new Notion page. The extension does not update or deduplicate previously clipped pages.

## Testing notes

The test suite uses Vitest and covers the current scaffold across Confluence detection/fetching/parsing, conversion, assets, Notion writing, storage boundaries, options, popup, and background task behavior.

When adding behavior, align coverage with the fixture profiles and expectations in `docs/claude/testing.md` and `SPEC-Confluence-to-Notion-Chrome-Extension.md`.

## Security notes

- The extension does not request the `cookies` permission.
- Confluence fetches use browser credentials through `fetch(..., { credentials: 'include' })`.
- The manifest only grants Notion API host permission by default.
- Confluence host access is requested at runtime for the configured origin.
- Content scripts must not receive Notion tokens.
- Raw executable or renderable HTML from Confluence storage should not be preserved into Notion output.

## License

See [LICENSE](LICENSE).
