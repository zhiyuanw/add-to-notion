# Conversion behavior

Required Confluence macro mapping from the spec:

- `mermaid` / `mermaid-macro` -> Notion code block, language `mermaid` when accepted; otherwise plain-text code fallback with warning.
- `plantuml` -> Notion plain-text code block preserving PlantUML source.
- `code` / `noformat` -> code block preserving text and best-effort language.
- `info` / `note` / `tip` / `warning` -> callout.
- `expand` -> toggle with recursive conversion where possible.
- Draw.io -> rendered image plus optional source link.
- Unknown macro -> unsupported macro callout containing macro name and recoverable body text, but not macro parameters.

Tables are best effort. Complex tables may flatten or degrade without failing the whole task.

Google Docs conversion uses `gws` export HTML from the Native Messaging bridge as untrusted input. It should preserve standard structure: headings, paragraphs, links, ordered/unordered lists, nested lists, inline formatting, basic tables, images, and horizontal rules. Comments and suggestions are out of scope. Google Docs metadata is written as a top-of-page `Google Docs metadata` toggle.
