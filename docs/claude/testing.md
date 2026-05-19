# Testing expectations

When code is introduced, use the fixture and test matrix in `SPEC-Confluence-to-Notion-Chrome-Extension.md` as the baseline.

## Fixture profiles

- `simple` — headings, paragraphs, links, lists, basic table, inline formatting.
- `macro-heavy` — Mermaid, code/noformat, callout macros, expand, Draw.io, unsupported macro.
- `image-heavy` — attachment images, external images, broken image, more than one image batch.

## Automated coverage

Tests should cover at least:

- Confluence base URL normalization and context-path guards.
- Supported page URL detection forms.
- XML external entity blocking.
- Conversion of required macros and unknown macro fallback.
- Asset upload concurrency, oversized files, failed uploads, cross-origin external images.
- Notion database/page target behavior and metadata toggle.
- Re-saving creates a new page every time.
- Notion append batching limit of 100 blocks.
- Duplicate save click while a task is running.
- Logout and token storage boundaries.
