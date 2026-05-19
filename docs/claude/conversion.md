# Conversion behavior

Required macro mapping from the spec:

- `mermaid` -> Notion code block, language `mermaid` when accepted; otherwise plain-text code fallback with warning.
- `code` / `noformat` -> code block preserving text and best-effort language.
- `info` / `note` / `tip` / `warning` -> callout.
- `expand` -> toggle with recursive conversion where possible.
- Draw.io -> rendered image plus optional source link.
- Unknown macro -> unsupported macro callout containing macro name and recoverable body text, but not macro parameters.

Tables are best effort. Complex tables may flatten or degrade without failing the whole task.
