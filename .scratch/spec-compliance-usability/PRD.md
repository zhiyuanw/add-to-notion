# PRD: Complete V1 Spec Compliance and User Usability for Confluence-to-Notion Chrome Extension

Status: ready-for-agent

## Problem Statement

The current Chrome MV3 extension scaffold has most V1 modules in place, but it is not yet usable by a real user. The build passes, but the full test suite fails. More importantly, the critical setup and save paths are blocked: Notion OAuth cannot run because extension identity permission and deploy-time OAuth configuration are missing, Confluence host permission cannot be granted because the manifest declares no optional host patterns, and one required Confluence URL form cannot be resolved because no DOM/bootstrap page identity extraction exists.

From the user's perspective, this means they can install the extension but cannot reliably connect Notion, authorize their Confluence host, detect all required Confluence page URL forms, or save a page with images preserved in the right place. The extension therefore does not yet satisfy the V1 promise: open one Confluence Server/Data Center page, click the extension, and save a reasonably faithful new Notion page.

## Solution

Finish the V1 implementation so the extension is usable end to end for the SPEC-defined workflow.

The solution should keep the existing high-level architecture: Options UI handles setup, Popup UI handles current-page status and save trigger, Background Task Runner owns the ClipTask lifecycle, Confluence modules fetch storage format, Storage XML Parser produces the internal AST, Converter and Asset Handler produce Notion blocks with local degradations, and Notion Writer creates a new page every time.

The work should focus on release blockers first:

- Make Notion OAuth executable in a real extension installation.
- Make configured Confluence origin permission requestable and enforce the normalized base URL path in code.
- Add the missing page identity bridge for `/display/{SPACE}/{Page+Title}` URLs.
- Restore a green full test suite.
- Preserve asset/image placement in converted Notion output instead of appending uploaded assets at the end.
- Fix Notion file upload attach-window validation.
- Make partial writes visible and understandable to the user.
- Make Popup task progress reflect the active background task during long saves.

## User Stories

1. As a knowledge worker, I want to connect my Notion workspace through OAuth, so that I do not need to paste or manage integration tokens manually.
2. As a knowledge worker, I want the Notion connect button to work in the installed Chrome extension, so that setup does not fail before I can save anything.
3. As a knowledge worker, I want OAuth configuration errors to be clear, so that I know whether the extension build is missing a client ID or I need to reauthorize.
4. As a knowledge worker, I want Notion tokens stored only locally, so that my auth state is not synced across browsers unexpectedly.
5. As a knowledge worker, I want expired Notion access tokens to refresh automatically, so that a save does not fail just because the previous session aged out.
6. As a knowledge worker, I want refresh failure to clear stale Notion session state, so that I can reconnect cleanly.
7. As a knowledge worker, I want to configure exactly one Confluence base URL, so that the extension knows which internal wiki instance to support.
8. As a knowledge worker, I want the extension to request permission for my configured Confluence origin, so that it can access pages and assets using my browser session.
9. As a security reviewer, I want Confluence host permission to remain origin-scoped while page detection and REST fetch are path-guarded, so that a context-path Confluence installation does not accidentally grant broader content access in code.
10. As a security reviewer, I want the extension to avoid `cookies` permission, so that it never reads or stores Confluence cookies.
11. As a knowledge worker, I want `/pages/viewpage.action?pageId=...` pages detected, so that older Confluence links save correctly.
12. As a knowledge worker, I want `/spaces/{SPACE}/pages/{pageId}` pages detected, so that newer Confluence links save correctly.
13. As a knowledge worker, I want `/display/{SPACE}/{Page+Title}` pages detected, so that common human-readable Confluence links save correctly.
14. As a knowledge worker, I want the extension to extract a page ID from DOM metadata or bootstrap data when the URL lacks one, so that the required display URL form works.
15. As a knowledge worker, I want unsupported Confluence pages to show a clear message, so that I know what to open instead.
16. As a knowledge worker, I want a save task to run in the background, so that closing the popup does not cancel a large page save.
17. As a knowledge worker, I want repeated save clicks during an active task to show the current task, so that I do not accidentally create duplicate pages from double-clicking.
18. As a knowledge worker, I want only one active save task, so that large pages do not overload Notion or Confluence.
19. As a knowledge worker, I want Popup progress to update while the task runs, so that I can see whether the extension is fetching, parsing, converting, uploading images, or writing to Notion.
20. As a knowledge worker, I want task completion to show success, failure, warning count, and Notion URL when available, so that I know what happened after a long save.
21. As a knowledge worker, I want service worker interruption to become a visible failed task with retry guidance, so that silent background termination does not leave me confused.
22. As a knowledge worker, I want the extension to fetch Confluence storage format through REST, so that macro source and storage semantics are available.
23. As a knowledge worker, I want Confluence 401/403 failures mapped to login or permission guidance, so that I know how to recover.
24. As a knowledge worker, I want Confluence 404 failures mapped to missing or inaccessible page guidance, so that I do not mistake permissions for parser bugs.
25. As a knowledge worker, I want Confluence 5xx and network failures to be retryable within the task budget, so that temporary failures do not immediately fail the whole save.
26. As a security reviewer, I want XML external entities and external resource loading blocked, so that malicious storage XML cannot trigger unexpected requests.
27. As a security reviewer, I want unsupported raw HTML converted to text or degradation, so that executable or renderable raw HTML is not emitted into Notion.
28. As a knowledge worker, I want headings, paragraphs, links, lists, inline formatting, tables, images, and attachments handled, so that normal Confluence pages remain readable.
29. As a knowledge worker, I want Mermaid macros saved as Notion code blocks, so that diagram source remains editable.
30. As a knowledge worker, I want code and noformat macros preserved as code blocks, so that technical docs remain useful.
31. As a knowledge worker, I want info, note, tip, and warning macros mapped to Notion callouts, so that semantic emphasis remains visible.
32. As a knowledge worker, I want expand macros mapped to Notion toggles, so that collapsible content remains structured.
33. As a knowledge worker, I want unknown macros to degrade locally without failing the page, so that one unsupported macro does not block saving the whole document.
34. As a knowledge worker, I want unknown macro fallback to omit macro parameters, so that sensitive or noisy config is not copied into Notion by default.
35. As a knowledge worker, I want simple tables converted to Notion tables, so that structured content remains readable.
36. As a knowledge worker, I want complex tables to degrade with a warning instead of failing the page, so that imperfect pages still save.
37. As a knowledge worker, I want Confluence-hosted images downloaded by the browser and uploaded to Notion, so that internal images remain visible outside the VPN or Confluence session.
38. As a knowledge worker, I want uploaded images to appear at the original location in the document, so that the clipped page preserves meaning and reading order.
39. As a knowledge worker, I want failed image uploads to preserve the original Confluence link, so that I can still recover the missing asset manually.
40. As a knowledge worker, I want failed images counted as warnings but not repeated as noisy error callouts, so that the document remains readable.
41. As a knowledge worker, I want cross-origin external images not downloaded with Confluence credentials, so that internal auth does not leak to unrelated hosts.
42. As a knowledge worker, I want usable external image URLs preserved as Notion external image blocks when safe, so that public images still render.
43. As a knowledge worker, I want files over 20 MB skipped and linked, so that oversized assets do not fail the whole task.
44. As a knowledge worker, I want Notion file uploads attached before expiry, so that uploaded files do not become broken Notion blocks.
45. As a knowledge worker, I want Draw.io rendered images imported when possible, so that architecture diagrams remain visible.
46. As a knowledge worker, I want Draw.io source links preserved when available, so that I can find the editable original.
47. As a knowledge worker, I want to select either a Notion database or page target, so that the extension supports both common personal knowledge base structures.
48. As a knowledge worker, I want database target selection to store the title property, so that later saves can create database pages without changing schema.
49. As a knowledge worker, I want stale database target failures to tell me to reselect the target, so that I can fix permission or schema drift.
50. As a knowledge worker, I want Notion database properties left unchanged, so that the extension does not mutate my workspace schema.
51. As a knowledge worker, I want every save to create a new Notion page, so that repeated clips never overwrite earlier captured content.
52. As a knowledge worker, I want clipped pages titled with the Confluence page title, so that the saved document is easy to recognize.
53. As a knowledge worker, I want Confluence metadata in a Notion toggle at the top, so that source URL, page ID, labels, and modified time remain traceable.
54. As a knowledge worker, I want block append batching under Notion API limits, so that large pages save reliably.
55. As a knowledge worker, I want partial Notion writes reported as partial, so that I know a half-created Notion page may exist.
56. As a knowledge worker, I want partial write result summaries to include the Notion URL when available, so that I can inspect or delete the partial page manually.
57. As a developer, I want the full test suite green, so that regressions in the save pipeline are visible before release.
58. As a developer, I want tests to use stable time inputs, so that passing tests do not depend on the calendar date.
59. As a developer, I want deep modules with testable interfaces, so that Confluence detection, conversion, asset handling, Notion writing, and ClipTask lifecycle can be verified without a browser E2E for every case.
60. As a release owner, I want a release checklist test that reflects actual release readiness, so that checked boxes do not mask missing runtime permissions or broken user paths.

## Implementation Decisions

- Keep the existing architecture boundaries: Popup UI, Options UI, Background Task Runner, Confluence Detector, Confluence Storage Fetcher, Storage XML Parser, Converter/Macro Mapper, Asset Handler, Notion Target Manager, Notion Writer, shared typed local storage, shared request retry helper, and debug logger.
- Treat the current save pipeline as the orchestration layer. It should coordinate domain modules but avoid absorbing parsing, conversion, asset upload, or Notion API details.
- Add an explicit page identity bridge for Confluence display URLs. The bridge should extract `pageId` from DOM metadata or bootstrap data and pass it to background detection without exposing Notion tokens to content scripts.
- Keep content scripts isolated from Notion auth state. They may provide page identity only.
- Make extension manifest permissions match runtime API use. `chrome.identity` use requires identity permission. Confluence host authorization requires a manifest strategy that allows requesting the configured origin without requesting `<all_urls>` or `cookies`.
- Keep normalized Confluence base URL path guards in code even when Chrome grants origin-level host permission.
- Preserve single configured Confluence base URL semantics. Changing base URL replaces the active configuration and must stop detection/fetching against the old normalized URL.
- Fix the request/test deadline model so tests remain deterministic regardless of current date. Tests should control `now`, `startedAt`, and deadline-sensitive fetch behavior through stable injected time or future relative timestamps.
- Rework asset conversion so image/asset references are represented at their original document location. Asset extraction, upload, and rendering should share a stable identity or placeholder interface that allows the Writer to emit the final Notion file block in place.
- Treat all asset failures as local degradations unless the whole external API request class fails in a way the SPEC defines as whole-task failure.
- Fix Notion upload attach-window validation. A completed upload is attachable only if its expiry is absent or still in the future at attach time. Expired uploads must degrade to the original source link and warning.
- Add a partial-write result shape or warning type that distinguishes general Notion write failure from a write failure after page creation. The result must retain partial page ID/URL when available.
- Make Popup observe active task changes after mount. Polling or storage-change subscription is acceptable if it keeps UI simple and does not create a second task.
- Keep Notion Writer behavior: create a new page first, prepend Confluence metadata toggle, append children in batches of at most 100, do not archive/delete/clear partial pages after append failure.
- Keep database target behavior: database title property is read when the target is selected, saved locally, and used during save; database schema is not created or modified.
- Keep debug logs local and redacted. No debug export is part of this PRD.
- Avoid adding generic web clipper behavior, multi-instance Confluence config, queues, sync, or bulk migration.

## Testing Decisions

- Good tests assert user-visible or module-boundary behavior, not private implementation details. Prefer testing inputs and outputs of deep modules: page detection result, parsed document/degradations, converted blocks/degradations, processed asset results, writer API calls, task state transitions, and popup rendered state.
- The full test suite must pass with `npm test`. Production build and typecheck must pass with the documented commands.
- Add or update tests for Notion OAuth runtime readiness: authorization URL generation, callback validation, token exchange persistence, and manifest permission expectations for identity-based OAuth.
- Add or update tests for Confluence host permission requestability and path guard behavior. Tests should verify origin-scoped permission request plus code-level context-path enforcement.
- Add tests for display URL page identity extraction from DOM metadata/bootstrap data. Tests should prove Notion tokens are not sent to or required by the content-side extraction path.
- Update save pipeline tests so deadline handling is deterministic. Tests should cover success, parse failure, partial write, repeated save creates new page, and local warnings.
- Add converter/asset integration tests proving image placeholders are replaced in original order, uploaded image blocks appear at the original Confluence image position, failed uploads preserve source links in place, and no per-image error callouts are added.
- Add tests for Notion upload attach-window validation: no expiry, future expiry, already expired expiry, and boundary behavior.
- Add tests for partial write summary: failed status, partial marker/warning, partial page URL when available, and no cleanup attempt.
- Add Popup tests for active task progress updates after mount and duplicate save click behavior.
- Keep existing prior art: Confluence base URL tests, detector tests, fetcher tests, storage parser tests, converter macro tests, asset extraction/processing/rendering tests, Notion OAuth/auth/target/writer tests, background ClipTask runner tests, popup/options tests, request retry tests, and release checklist tests.
- Add at least one release checklist test that fails when critical manifest permissions or required content-script/page-identity wiring are absent.
- Manual E2E remains required before release against a real Confluence Server/Data Center 7.13.7 instance and a real Notion workspace.

## Out of Scope

- Generic web clipping for non-Confluence pages.
- Confluence Cloud support.
- Space, page tree, or site-wide migration.
- Bidirectional sync.
- Incremental sync or scheduled sync.
- Confluence comments, permissions, version history, or audit history sync.
- Full fidelity for complex tables, merged cells, colored headers, or arbitrary layout.
- Editable Draw.io import into Notion.
- Notion-to-Confluence export.
- Multiple Confluence base URLs or multi-instance switching.
- Multi-user admin UI or centralized policy management.
- Automatic cleanup, archive, delete, or deduplication of previously created Notion pages.
- Debug export.
- Compression or transformation of uploaded images beyond what Notion requires.

## Further Notes

The current repository already contains useful V1 structure and many tests. This PRD is not a rewrite request. It is a release-readiness completion pass.

Known immediate blockers from review:

- Full test suite fails in the save pipeline tests.
- Notion OAuth cannot run in a real extension installation with current placeholder config and manifest permissions.
- Confluence host permission cannot be granted with an empty optional host permission declaration.
- Required display URL support is incomplete because no DOM/bootstrap page identity path exists.
- Uploaded assets are appended to the end instead of replacing original image references.
- Notion upload expiry validation is wrong.
- Partial writes are not clearly marked as partial in result summaries.
- Popup task progress is not live after mount.

Release should not proceed until these are resolved and validated by automated tests plus manual E2E on real Confluence Server/Data Center 7.13.7 pages.
