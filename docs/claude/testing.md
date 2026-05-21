# Testing expectations

When code is introduced, use the fixture and test matrix in `SPEC-Confluence-to-Notion-Chrome-Extension.md` as the baseline.

## Fixture profiles

- `simple` — headings, paragraphs, links, lists, basic table, inline formatting.
- `macro-heavy` — Mermaid, code/noformat, callout macros, expand, Draw.io, unsupported macro.
- `image-heavy` — attachment images, external images, broken image, more than one image batch.
- `google-simple` — Google export HTML with headings, paragraphs, links, lists, basic table, inline formatting.
- `google-image-heavy` — multiple images, broken image, oversized image, image download failure.
- `google-structure-heavy` — nested lists, table fallback, heading hierarchy, horizontal rules.

## Automated coverage

Tests should cover at least:

- Confluence base URL normalization and context-path guards.
- Supported page URL detection forms.
- Google Docs URL detection for `/edit`, `/preview`, and `/copy` with query/hash.
- XML external entity blocking.
- Google Docs HTML parser treats exported HTML as untrusted input and never emits executable/renderable raw HTML.
- Conversion of required macros and unknown macro fallback.
- Conversion of `google-simple`, `google-image-heavy`, and `google-structure-heavy` fixtures.
- Asset upload concurrency, oversized files, failed uploads, cross-origin external images.
- Notion database/page target behavior and metadata toggle.
- Re-saving creates a new page every time.
- Notion append batching limit of 100 blocks.
- Duplicate save click while a task is running.
- Missing Native Messaging host and `gws` auth/export failure create no Notion page and show actionable guidance.
- Internal Integration Token storage boundaries, invalid-token handling, logout cleanup, and absence of Notion OAuth/refresh-token flow.
- Absence of Google OAuth client ID/scopes/token storage in the extension; Google auth stays inside local `gws`.
