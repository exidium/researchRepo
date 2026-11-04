# Milestone log

What each milestone delivered and how it was verified. Decisions live in `decisions.md`.

## M0 · Scaffold (2026-10-15)

- Next.js 16.4 + TypeScript app, Tailwind 4, shadcn UI kit copied from the sibling project, Prisma 7.10 with the pg adapter, vitest, playwright.
- `/api/health` checks the database. `/projects` placeholder page behind the app shell with sidebar.
- Local database `research` on Homebrew Postgres 17.
- Verified: `pnpm dev`, `curl /api/health` → `{"ok":true,"db":"up"}`, `/projects` → 200, typecheck and lint clean.

## M1 · Schema and role seam (2026-10-15)

- Full Prisma schema for v1 plus the v2 insight tables (`prisma/schema.prisma`).
- Migration `init` (Prisma-generated) and `search_vectors` (hand-written): generated `tsvector` columns on Segment and Highlight with GIN indexes, `pg_trgm` index on segment text, unique index on `lower(Tag.name)`.
- `src/lib/auth.ts`: dev-user seam (`AUTH_DISABLED`, `DEV_USER=admin|editor|viewer`), refused in production.
- `src/lib/authz.ts`: pure `resolveRole`, `requireProjectRole`, `visibleProjectsWhere`, lookups from source/highlight/segment to project.
- `src/server/action.ts`: `authedAction` and `projectAction` wrappers; every mutation goes through them.
- Seed creates three dev users.
- Verified: `prisma migrate status` up to date; `\d "Segment"` shows the generated column and indexes; 7 unit tests for the role matrix pass.

## M2 · Synthetic mirror, importer, seed (2026-10-15)

- `scripts/generate-synthetic-mirror.ts` writes `fixtures/mirror/` with seeded faker data in the Dovetail-mirror shape: 6 projects, 4–6 files each (one note file per project), 24–36 highlights per project with tags, 8 tag groups, duplicate project-scoped tags, and a `participants.json` extension per project carrying role, company, segment and tools.
- `src/lib/transcript/parse-dovetail-md.ts` parses `**Speaker (m:ss):**` turns (also `h:mm:ss`), joins continuation lines, and classifies files with fewer than three turns as notes.
- `src/lib/transcript/locate.ts` finds quoted text inside segments: exact, then whitespace/case-normalised, then by time overlap; otherwise the highlight is imported as ORPHANED.
- `src/server/import/dovetail.ts` upserts everything by external id (idempotent); tags are deduplicated case-insensitively and remember every mirror id in `externalIds`.
- `prisma/seed.ts` truncates content tables, upserts the three dev users, imports `MIRROR_DIR`, and makes the Block Diagramming project RESTRICTED with editor@local as EDITOR.
- Verified: 17 unit tests pass; seed reports 6 projects, 30 sources, 955 segments, 30 participants, 41 tags in 8 groups, 174 highlights (146 exact, 19 normalised, 7 by time, 2 orphaned). A SQL check confirms every ACTIVE single-segment highlight's text equals the slice of its segment at the stored offsets.

## M3 · Projects, participants, sources (2026-10-15)

- Pages: `/projects` (list, show archived toggle, new project dialog), `/projects/[id]` (header, goal, sources table, participants, members panel, edit/archive/delete), `/projects/[id]/sources/[id]` (read-only transcript until M5, edit/delete), `/participants` (search, new), `/participants/[id]` (attributes, sources, edit/delete). Placeholders for `/search` and `/tags`.
- Server actions in `src/server/actions/{projects,participants,sources}.ts`, all through `authedAction`/`projectAction`; zod schemas in `src/lib/validation/`; queries in `src/server/queries/`.
- `ParticipantPicker` searches existing participants and creates one inline, so a person is reused across projects without retyping.
- Members panel adds users by email with a role; restricted projects are hidden from the list, detail and participant source lists for non-members.
- Verified: typecheck and lint clean; every page returns 200 for the admin dev user; the restricted project returns 404 for viewer@local and is absent from their list; the "New source" button only renders for editor and admin.

## M4 · Upload, parsers, media (2026-10-15)

- `src/lib/storage.ts`: files under `UPLOAD_DIR/sources/<sourceId>/`, streamed through a byte limiter to a temp file and renamed on success; path-escape guards.
- Parsers in `src/lib/transcript/`: VTT (voice tags, NOTE/STYLE blocks, markup stripped, entities decoded), SRT (comma timings, `{\an8}` and HTML stripped), DOCX via mammoth (`Name:` prefix, optional leading or inline timestamp), plus `coalesce.ts` that merges fine-grained cues into utterances (D18) and `parse-file.ts` dispatching on extension.
- `PUT /api/upload/[sourceId]/[kind]`: raw-body upload (D13), extension allowlist (415), size limit (413), highlight lock (409, D20), parse and replace segments, FAILED status with message on parse errors. Replacing a file deletes the previous one.
- `GET/HEAD /api/media/[sourceId]/[kind]`: single-range streaming (206/416) for recordings, attachment download for transcripts, VIEWER role required.
- UI: upload panel with drag-and-drop, progress and download links; media player bound to a small zustand store; transcript view where clicking a line seeks and the playing line is marked. Duration is persisted once from the browser's `loadedmetadata`, no ffprobe.
- Verified: 30 unit tests (parsers, coalescing, storage limiter); curl run on a scratch source: VTT parsed into 5 segments with two speakers, DOCX replace, `.pdf` → 415, 5 KB recording stored, `Range: 100-199` → 206 with correct `Content-Range`, bad range → 416, downloaded bytes identical, viewer gets 403 on upload and 200 on playback, seeded source with highlights → 409.

## M5 · Transcript editor and highlights (2026-10-15)

- `src/lib/transcript/schema.ts` (doc > segment+ > text, highlight mark with `excludes: ""` so highlights can overlap) and `doc.ts` (build the editor document from rows, selection → anchors, mark ranges → offsets, anchors → positions), both pure and unit-tested.
- `src/components/transcript/editor-extensions.ts`: plain-DOM segment node view with speaker and time gutter; Enter/Backspace/Delete at boundaries are no-ops; a `filterTransaction` plugin rejects any transaction that changes the number or order of segments (D6); paste is plain text.
- `TranscriptEditor.tsx`: TipTap editor, floating selection toolbar (highlight, or highlight with a tag), highlight side panel (tags, delete, orphaned section), speaker popover (rename one line or all lines, link a participant), click-to-seek and playback marking, `?highlight=` deep link selection.
- Server actions in `src/server/actions/highlights.ts`: `createHighlight` (validates anchors, text = slice), `setHighlightTags`, `deleteHighlight`, `saveSegment` (version check; re-anchors highlights that start or end in the edited segment from the editor's mark ranges; orphans single-segment highlights whose marks vanished; shifts multi-segment ones to the neighbouring boundary), `renameSpeaker`. `createTag` lets editors add tags inline.
- Verified: 36 unit tests; Playwright `tests/e2e/transcript.spec.ts` (4 tests) against the seeded DB: seeded highlights render as marks and panel items; a highlight across two segments is stored with segment anchors; typing before it shifts only its start offset and leaves its text unchanged after reload; deleting a highlight's words marks it ORPHANED with the text kept; the test cleans up after itself.
- Fixed along the way: a `"use server"` module may only export async functions (moved `highlightSelect` to `src/server/queries/highlights.ts`); Playwright needed a newer Chromium build.

## M6 · Tag management (2026-10-15)

- `/tags`: groups in order (rename inline, move up/down, delete keeps tags), tags per group with usage counts, inline rename (case-insensitive clash is reported), colour picker, move between groups, merge dialog, archive/restore (archived hidden by default, still shown on existing highlights), delete with confirmation. Non-admins see the list read-only.
- Actions in `src/server/actions/tags.ts`, all `requireAdmin` except `createTag` (editors create tags while highlighting). Query `listTagsAdmin` in `src/server/queries/tags.ts`.
- Verified: Playwright `tests/e2e/tags.spec.ts`: merging a tag into another keeps every highlight tagged exactly once, removes the source tag, and lowers the tag count by one; rename and archive update the row and the database. Typecheck and lint clean.
- Note: the dev server briefly served the tags page in a Fast Refresh reload loop right after new server actions were added; it cleared after other pages were visited. Restarting `next dev` after adding a `"use server"` module avoids it.

## M7 · Search and saved views (2026-10-15)

- `src/lib/validation/search.ts` is the one filter shape; `src/lib/search-params.ts` maps it to short URL keys with nuqs (`q`, `scope`, `project`, `area`, `tag`, `tags=any|all`, `role`, `company`, `segment`, `tool`, `from`, `to`, `page`).
- `src/server/queries/search.ts`: two `$queryRaw` queries (highlights, transcript lines) with ranking, `ts_headline` snippets, access clause, project/product-area/date/participant filters, tag ANY/ALL, offset pagination (25 per page).
- `/search`: filter bar (keyword, scope toggle, project, product area, tags with any/all, role, company, segment, tool, dates, clear), result cards linking to `?highlight=` or `?segment=` on the source page, pagination, save view. `/views/[id]` redirects to the search; the sidebar lists own and shared views; a view can be deleted from its search page.
- Verified: 8 DB-backed vitest cases over the SQL (keyword, phrase and negation, tag ANY ⊇ ALL, project/area/date/company narrowing, tag filter on lines, viewer never sees the restricted project, pagination) plus 3 Playwright tests (result → highlighted moment selected in the editor; transcript result → segment flashed; filter in URL → saved view → reopened from sidebar → deleted).

## M8 · Deploy preparation (2026-10-15)

- `Dockerfile` (multi-stage, standalone output, non-root), `docker-compose.prod.yml` (app, db, `migrate` and `backup` tool profiles, named volumes for Postgres and uploads), `deploy/Caddyfile`, `deploy/.env.prod.example`, `scripts/backup.sh` for cron, and `documentation/deploy.md` with the one-time setup, release steps, first admin and restore notes.
- The app shell is `force-dynamic` so a production build never prerenders a database page. `UPLOAD_DIR` resolution carries a `turbopackIgnore` hint so the standalone bundle does not trace the whole project.
- Verified: `pnpm build` passes with every app route dynamic and no trace warning; `node .next/standalone/server.js` answers `/api/health`, redirects `/projects` to `/login` when signed out, and serves `/login`. Docker itself is verified on the server (not installed locally, D4).

## M9 · Login and users (2026-10-15)

- `src/lib/password.ts` (argon2id via `@node-rs/argon2`), `src/lib/session.ts` (random token in an HttpOnly cookie, SHA-256 stored, 30 days), `src/lib/auth.ts` now resolves the dev seam or the session; `requirePageUser` vs `requireUser` (D35).
- `/login` (form with `useActionState`, generic error, keeps the email), sign-out in the sidebar, `/users` admin page (create with initial password, toggle admin, set password, delete with project reassignment), `scripts/create-user.ts` for the first admin. Seed gives dev users the password `password12` (override with `DEV_PASSWORD`).
- Verified: `AUTH_E2E=1` Playwright spec with `AUTH_DISABLED=false`: signed-out redirect, wrong password rejected without clearing the email, editor signs in and out and never sees Users, admin sees Users, anonymous `PUT /api/upload` gets 401. Standalone production server refuses the dev seam in production.

## M10 · Highlight explorer and themes (2026-10-15)

- `/explore`: left tree with pivots Projects (default), Tags, People, Themes and counts on every node; middle list of highlights under the selected node (60 per page, keyboard j/k and arrows); right pane with the highlight in transcript context (two segments either side, marked span), participant and source facts, player seeking to the moment, "Open transcript", tags and themes.
- Themes: create (finding, description, confidence, product area, parent), edit, delete (creator or admin), nest, drag highlight cards onto theme nodes, "Add to theme" picker in the detail pane, remove from a theme. `Theme`/`ThemeHighlight` replace the `Insight` tables (D45).
- Home, login and logout now land on `/explore`; "Explore" is the first sidebar entry.
- Schema declares the generated search columns and GIN indexes so Prisma sees no drift (D48); the themes migration restores the indexes the first failed run dropped.
- Verified: typecheck and lint clean; all pivots and node types render with the seeded data; Playwright `tests/e2e/explore.spec.ts` covers tree navigation, list narrowing, keyboard selection, detail pane, theme creation, drag-and-drop, picker add, nesting, removal and deletion.
- Dev-server note: the page reload loop seen on `/tags` earlier recurred on every page; a clean `.next` (stop, `rm -rf .next`, start) fixed it. Recorded in AGENTS.md.
- Follow-up the same day: the explorer moved to its own route group `(explore)` with a top bar and no sidebar; a keyword search in the top bar (`q` in the URL) narrows the tree counts and the list (D49). Covered by a third Playwright test.

## M11 · Static explorer demo on GitHub Pages (2026-10-18)

- `scripts/export-demo-data.ts` (`pnpm demo:data`) writes the synthetic, OPEN-project subset of the database to `demo/public/data.json` with four example themes; it refuses non-synthetic data.
- `demo/`: standalone Vite + React app reusing `src/lib/explore.ts`, `colors.ts` and `transcript/time.ts`; pivots, counts, keyword search (quotes, minus), highlight list with j/k, context pane with the marked span, read-only themes. No recordings, no editing.
- `scripts/publish-demo.sh` builds `demo/` and force-pushes `demo/dist` to the `gh-pages` branch that Pages serves. Repository made public (D50).
- Verified: local `vite preview` under the `/heyMarvinClone/` base path, exercised with Playwright: 140 highlights, tags pivot with 10 groups, theme view with 13 highlights, search narrowing to 18, context mark rendered, no console errors.
- Follow-up (2026-10-18): the static site now covers the whole repository UI read-only: sidebar, projects list and detail, sources with the highlighted transcript and side panel (`?highlight=` and `?segment=` deep links), participants list and detail, tags by group, search with scope and filters. Hash routing (`#/projects/…`) so links work on Pages; old `?pivot=` explorer links redirect. Repository renamed to `exidium/researchRepo` (D51). Verified with a scripted browser walk of every page under the `/researchRepo/` base path: no console errors.
- Follow-up (2026-10-18): the explorer is back inside the sidebar shell in the app and the static site; its header keeps the keyword search (D52). Root typecheck and lint now exclude `demo/`, which has its own toolchain.

## M12 · Automatic transcription (2026-11-04)

- `TranscriptionJob` table and `Source.language` (migration `transcription_jobs`, checked before applying).
- `src/server/transcription.ts`: `enqueueTranscription` and `transcriptionState`; upload route queues a job for a recording on an empty source; `requestTranscription` action for editors.
- `worker/`: Python container that claims jobs, transcribes with faster-whisper, coalesces cues, replaces segments in one transaction, writes progress, marks failures on the job and the source.
- Source page: transcription panel with queued (and place in queue), running (progress bar), done (model, language, segment count) and failed states; polls every 4 s while active; button locked once highlights exist.
- Verified locally with the `tiny` model on a synthetic 24-second two-voice M4A: upload queued the job automatically; a failure (PyAV incompatibility, since pinned) was recorded on job and source; clicking Re-transcribe in the browser queued a job, the worker finished it in 4 s, and the page showed five correctly timed lines without a reload. Two dependency bugs that would have crashed the container were found and pinned this way.
- Speaker diarization (D56): sherpa-onnx models baked into the worker image, word-level splitting at speaker changes, voiceprint second pass. Verified locally: two-voice and three-voice synthetic conversations get every line's speaker right, one voice stays one speaker, missing models fall back to a transcript without speakers. 9 unit tests in `worker/test_worker.py` cover speaker assignment, splitting and coalescing.
- Speaker assignment reworked to one speaker per sentence with artefact-speaker folding (D57); 11 worker unit tests.
- Deployed to the Helsinki server 2026-11-04 (Bruno approved). The first release hit two build problems, fixed: the slim Python image has no `bzip2` (model now unpacked with Python's `tarfile`), and a Docker build-cache snapshot error (cleared with `docker builder prune`). The release script stops before migrating or restarting when a build fails, so the live site was never half-updated.
- Benchmark on the server's 3 worker cores, 295 s synthetic recording: medium 26 min, large-v3 39 min, diarization 7 min per hour of audio. A 60-minute interview with medium takes about 33 minutes end to end.

## M13 · Editor tools: find and replace, notes, tag counts (2026-11-04)

- `src/lib/transcript/find.ts` (pure, 6 unit tests) and a ProseMirror plugin in `editor-extensions.ts` that keeps matches current as the text changes and paints them; `FindBar.tsx` with previous/next, match case, whole word, replace and replace all.
- Inline note editor on each highlight in `HighlightPanel.tsx`, using the existing `setHighlightNote` action.
- `tagProjectCounts` and `tagMatrix` in `src/server/queries/tags.ts`; "Tags in this project" on the project page; "By project" tab on `/tags` with a shaded tags × projects table.
- Verified: 50 unit tests, 15 Playwright tests including `tests/e2e/editor-tools.spec.ts` (reversible replace-all with anchor checks, note persistence, count links landing on matching search results).
