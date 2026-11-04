# HeyMarvin feature inventory and gap analysis

Researched 2026-10-15 from heymarvin.com (product, pricing, integrations pages), the Marvin help centre, the 2024 recap, the Fall '25 and Summer 2026 release posts, and G2/TrustRadius for third-party context. Marketing claims were cross-checked against help-centre articles where one existed; where only marketing copy exists, the row says so. Nothing below is invented: if the research did not show a capability, it is marked "not confirmed".

## Changes since this was written

- **2026-10-15, milestone 10:** the highlight explorer (`/explore`) and Themes shipped. Themes are the spec's v2 insights expressed as a browsable tree (decisions D43, D45–D47). In section 8 below, "Insight report editor", "Draft states" and "Custom report templates" are now **Partial**: a theme has a finding, description, confidence, product area, nesting and ordered highlights, but no rich-text body, templates, publishing states, comments or exports. Section 6 "Keyword search" gains browsing by project, tag, person and theme with counts, which Marvin frames as Ask AI rather than navigation.

- **2026-11-04, milestones 12 and 13:** automatic transcription with speaker labels shipped on the server (sections 1 and 2: "Automatic transcription" and "Speakers" are now **Built**, within the spec change in D41). Find and replace in transcripts, notes on highlights, and tag counts per project and across projects are **Built** (sections 2, 3 and 4).

## How to read the status column

| Status | Meaning |
|---|---|
| **Built** | Exists in this repository today and is verified by tests or manual checks |
| **Partial** | Some of it exists; the gap column says what is missing |
| **Not built** | In scope for this product eventually, nothing exists yet |
| **Spec: v2 / Later** | Spec v0.1 explicitly scheduled it for v2 or "Later" |
| **Spec: out of scope** | Spec v0.1 explicitly excluded it (in-app transcription, surveys, recruiting, billing, AI in v1) |
| **Not confirmed** | Marvin may have it, but the research could not confirm the details |

## Marvin in one paragraph

Marvin (formerly HeyMarvin) sells itself as an "AI-native customer insights platform" with four pillars: a **Knowledge Hub** (the repository: files, notes, tags, search, Ask AI), **Research Methods** (an AI notetaker that joins calls, AI-moderated interviews in 40+ languages, the new Live Intercept widget), an **Analysis Studio** (auto-tagging against a global taxonomy, thematic and sentiment analysis, affinity mapping, survey charts, "Deep Research" templates) and **Reporting & Insights** (an insight report editor, clips, playlists and highlight reels, Slack and email digests, Salesforce, an MCP server for Claude/ChatGPT/Copilot). It is priced per seat on Free, Starter, Pro and Enterprise plans with Full, Collaborator and Viewer seat types; the official page lists no prices, and third-party figures disagree ($49 to $99 per month on one listing, $3,000 to $6,000 per year with a five-seat minimum on another). Compliance is a selling point: SOC 2, ISO 27001, ISO 42001, GDPR, HIPAA with a BAA, EU or US data residency.

The repository in this folder was built to spec v0.1, which deliberately covers only the core of the Knowledge Hub: projects, participants, transcript and recording upload, highlighting and tagging, search. Everything AI, every integration, and anything to do with running studies was out of scope or deferred. The gap below is therefore large by design; the useful question is which non-AI pieces the team will miss first.

## Feature inventory and gap

### 1. Capture and ingestion

| Feature | What Marvin does | Ours | Status | Gap / notes |
|---|---|---|---|---|
| Meeting notetaker | A bot joins Zoom, Google Meet and Microsoft Teams calls from the calendar, records, transcribes and takes automatic notes; can be invited by email to calendar events (help: Set up integrations; Fall '25) | None | Spec: Later ("Zoom or Teams import") | Spec wants file import from those tools, not a bot |
| In-app and phone recording | Record in-person meetings and phone calls inside Marvin and transcribe them (2024 recap; help: What kinds of data) | None | Spec: out of scope (transcription) | |
| Automatic transcription | Every recording is transcribed; transcripts can be translated into 35 languages (help: Annotation tool) | We import VTT, SRT, DOCX and Dovetail markdown produced elsewhere | Spec: out of scope | Self-hosted Whisper would be the obvious route if the exclusion is reversed |
| File uploads | Audio, video, Word and Google Docs, Excel and Sheets, PowerPoint, PDF, TXT, images (JPG/PNG); Import API accepts up to 10 GB of media and 500 MB of documents per transfer (help: Upload files; Import API) | VTT, SRT, DOCX, MD, TXT transcripts; MP4, M4A, MP3 recordings, streamed to disk with configurable limits | Partial | No PDF, PPT, XLSX, images, WAV, MOV; no "note" files other than markdown |
| Cloud drive sync | Google Drive, OneDrive and SharePoint bring in files, with auto-import (help: Set up integrations) | None | Not built | |
| Survey import | Qualtrics, Pendo, SurveyMonkey, Google Forms, Microsoft Forms (refreshed twice daily), Dscout, CSV; responses become charts and NPS (help: What kinds of data; Fall '25) | None | Spec: out of scope (surveys) | |
| Support tickets and sales calls | Zendesk, Intercom tickets in bulk; Gong call sync with participants added to the panel (2024 recap) | None | Not built | Pro plan only in Marvin |
| Usability platforms | UserTesting, Maze, Dscout imports for mixed-media analysis (help: What kinds of data) | None | Not built | |
| Dovetail import | Imports Dovetail projects, notes and tag hierarchy (needs Collaborator access); not video, audio, rich text in insights or CSV surveys (help: Import from Dovetail) | Importer for a Dovetail export mirror (projects, files, highlights, tags, participants), idempotent by external id | Partial | Ours reads an offline mirror rather than the Dovetail API; no insight import |
| Import API | Continuous sync of audio, video, text, CSV, PDF and Office files from any system (Summer 2026) | None | Not built | |
| Trim recording | Trim start and end of a recording; transcript, highlights, notes, summaries and search update; original not kept (help: Annotation tool) | None | Not built | Our anchors would survive a trim only if segment times are shifted, not text |

### 2. Transcript and annotation tool

| Feature | What Marvin does | Ours | Status | Gap / notes |
|---|---|---|---|---|
| Edit transcript text | Click a word and type over it (help: Annotation tool) | Inline editing in the TipTap editor; highlights keep their anchors (segment + offset) through edits | Built | Ours additionally guarantees highlights elsewhere never shift (decisions D5, D6, D19) |
| Search inside a transcript | Keyword search showing every instance (help: Annotation tool) | None in the editor; repository search finds the line and deep-links to it | Not built | Small: a find bar over segment text |
| Find and replace | Fix a misspelt word once or everywhere (help: Annotation tool) | None | Not built | Small; must go through `saveSegment` per segment to keep anchors |
| Speakers | Assign, swap, unassign and add speakers; speaker identification on transcription (help: Annotation tool) | Rename one line or all lines by a speaker, link a speaker to a participant | Built | No "add a speaker to part of a segment" (would need a split, excluded in v1) |
| Listen to one speaker | Play only one speaker's portions (help: Annotation tool) | None | Not built | Medium: needs segment-time playlist in the player |
| Playback sync | Transcript follows the video; notes link to timestamps (marketing; help: Clips) | Click a line to seek; the playing line is marked; duration captured from the browser | Built | Spec listed this under v2; it shipped early |
| Download transcript | Download as .docx; translate into 35 languages (help: Annotation tool) | Download of the original uploaded file only | Partial | Export of the edited transcript (docx/vtt/txt) is not built; translation is AI, out of scope |
| File metadata | Change the file date; add file tags; "Mark as annotated" (help: Annotation tool) | Source date and participants editable | Partial | No file-level tags, no reviewed flag |
| Hide personal information | Redact sensitive participant details; speaker anonymisation with a preserve list; face blur (Enterprise; Summer 2026) | None | Not built | Spec open question about participant data was answered "admin deletes"; redaction never discussed |
| Summaries | AI summary per file, editable and regenerable, role-tuned, shareable to Slack (help: Annotation tool) | None | Spec: out of scope (AI) | |

### 3. Notes, highlights and clips

| Feature | What Marvin does | Ours | Status | Gap / notes |
|---|---|---|---|---|
| Highlight text and tag it | Highlight transcript text, add labels, questions or a note; this is the unit of evidence (help: Tagging) | Select any span, including across segments, highlight it, tag it from the toolbar or the side panel | Built | |
| Note text on a highlight | Every highlight is a "note" with free text; "Create Note" (help: Annotation tool) | `Highlight.note` column and `setHighlightNote` action exist; no UI | Partial | Small: a text field in the side panel |
| Auto-notes | AI generates notes for the whole recording or all files in a project (2024 recap) | None | Spec: out of scope (AI) | |
| Live Notes during calls | Flag moments, add labels, tag discussion-guide questions, bookmarks during a live call, synced to the recording afterwards; collaborative (help: Live Notes) | None | Not built | Depends on recording integration |
| Automatic clips | Highlighting text automatically creates a video clip; clip length follows the highlighted text; share link shows video, note and transcript (help: Clips) | Highlight start/end times are known from segments; no clip rendering or clip page | Spec: v2 | ffmpeg cutting was planned for v2 |
| Playlists and highlight reels | Combine selected clips into a playlist in one click; stitch reels for stakeholders; embed in insights (help: Clips; marketing) | None | Spec: v2 | |
| Share a note or clip by link | Share icon on every note and clip; recipients without a seat can view depending on admin link settings (help: Share research) | None; a highlight is reachable only by logged-in users via `/search` deep links | Not built | |
| Copy notes to a report | Copy notes from the file or notes menu for use in an Insight (help: Annotation tool) | None | Spec: v2 (insights) | |

### 4. Tags and taxonomy

| Feature | What Marvin does | Ours | Status | Gap / notes |
|---|---|---|---|---|
| Global tag list with groups | Tags managed from a "Manage" dialog; groups such as time period or company; each group marked project-only or across Marvin (help: File tags) | Global groups with ordering, colours, counts; rename, merge, archive, delete (admin) | Built | |
| Project-scoped tags | Labels created inside a project; groups can be project-only (help: File tags; Tagging) | All tags are global | Not built | Medium: `Tag.projectId` plus picker scoping |
| Tag hierarchy | Parent and child labels by drag and drop, drilled into on graphs (help: Tagging) | Flat groups only | Not built | Medium |
| Tag templates | Save a project's labels as a template reusable across projects (help: Tagging) | None | Not built | Smaller once project-scoped tags exist |
| Edit approval | Full-seat users may edit global tags only with admin approval (help: File tags) | Editors can create tags; only admins rename, merge, archive | Partial | A "proposed" state would be the equivalent |
| Merge overlapping labels | Merge from the Labels page (help: Tagging) | Merge keeps every highlight tagged once, moves Dovetail ids (D29) | Built | |
| Archive | Advised in content; a dedicated archive feature was not confirmed | Archive and restore, hidden from pickers, still filterable | Built | We may exceed Marvin here |
| File-level tags | Tags on whole files, separate from content labels (help: File tags) | None | Not built | Small: `SourceTag` table and picker on the source page |
| AI auto-tagging | Every incoming source is tagged against the global taxonomy; "AI-powered Tagging" matches the existing taxonomy (marketing; Fall '25) | None | Spec: out of scope (AI) | The most-cited Marvin time saver ("68% reduction in analysis time") |
| Tag graphs and AND filters | Graphs grouped by label or question; filters combine labels with AND (help: Tagging) | Search supports ANY/ALL tag filters; no charts | Partial | Tag frequency counts per project would be cheap |

### 5. Participants and research panel

| Feature | What Marvin does | Ours | Status | Gap / notes |
|---|---|---|---|---|
| Central participant panel | A Research Panel across projects, searchable by name, email, cohort and attributes (help: Research Panel) | Global participants list with search, reusable across projects, linked to sources and speakers | Built | |
| Custom columns | Add text, yes/no, number, date and multi-select dropdown fields; show or restrict fields per project (help: Research Panel) | Fixed fields: role, company, segment, tools, notes | Not built | Medium: a JSON `attributes` column plus a field-definition table |
| Filter research by attributes | Use panel attributes as filters in Ask AI and analysis (help: Research Panel) | Role, company, segment and tool filters in search | Built | |
| CSV import and export | Add participants by CSV; download all participant data as CSV by email link (help: Research Panel) | None | Not built | Small |
| CRM and recruiting sync | Salesforce and Rally sync participant data automatically (help: Research Panel) | None | Not built | Spec excludes recruiting |
| Participant bios | AI summary per participant with last-contact date and call summaries (help: Research Panel) | Detail page lists their sources and highlight counts | Partial | The non-AI part exists |
| Access to participant data | Admin-only by default, extendable to Full seats, optionally limited to the Participants tab (help: Research Panel) | Any signed-in user can view and edit; only admins delete (D22) | Partial | An admin setting would close this |
| Consent and PII | Redact versus anonymise participant details (help: related article, not read) | None | Not confirmed / Not built | |

### 6. Search and Ask AI

| Feature | What Marvin does | Ours | Status | Gap / notes |
|---|---|---|---|---|
| Keyword search | Search across files, notes, clips, recordings and insights; admins can restrict Viewers to published insights and playlists (help: Share research) | Postgres full-text search over highlights and transcript lines with phrase and negation syntax, ranking, snippets, filters by project, product area, tag (any/all), participant attributes and dates; deep links to the moment | Built | Insights and files are not searchable because they do not exist yet; no Viewer restriction setting |
| Saved views | Not confirmed as a named feature; "topic subscriptions" cover a similar need | Named, shareable saved searches in the sidebar | Built | |
| Ask AI with citations | Questions at file, project or repository level; answers cite the transcript and timestamp; shareable answer links; Agentic Ask AI 2.0 cross-checks sources (marketing; Fall '25; Summer 2026) | None | Spec: out of scope (AI) | Repository-wide Ask AI is a paid tier in Marvin |
| Deep Research templates | JTBD, thematic analysis, hypothesis testing, persona development, project summary, custom prompts (Analysis Studio page; Fall '25) | None | Spec: out of scope (AI) | |
| Organizational Memory | Admins upload brand and product context that Ask AI applies (Summer 2026) | None | Spec: out of scope (AI) | |
| Topic subscriptions and digests | Follow topics; weekly AI reports; fortnightly research digest newsletter by Slack or email (marketing; 2024 recap) | None | Not built | Non-AI version: email a saved view's new results weekly |

### 7. Analysis

| Feature | What Marvin does | Ours | Status | Gap / notes |
|---|---|---|---|---|
| Analyze page | Notes grouped by discussion-guide question for a global view (help: Tagging) | None | Not built | Depends on discussion guides |
| Thematic analysis with counts | Groups recurring themes and tracks frequency; reports with frequency counts (Analysis Studio page) | None | Spec: out of scope (AI) | A non-AI tag-frequency matrix per project or across projects is cheap and useful |
| Sentiment / emotion analysis | Positive, neutral, negative per note (Analysis Studio page) | None | Spec: out of scope (AI) | |
| Affinity mapping | Cluster themes and findings on collaborative boards; AI-assisted version previewed (Analysis Studio; Fall '25) | None | Not built | Manual affinity board is non-AI and feasible |
| Cross-project analysis | Ask across interviews, surveys and tickets; patterns across all sources (Analysis Studio page) | Search and filters work across projects | Partial | No analysis views, only lists |
| Survey charts and NPS | Closed-ended responses as charts; NPS promoters/passives/detractors; segment slicing (Analysis Studio; 2024 recap) | None | Spec: out of scope (surveys) | |
| Database table view | Spreadsheet-style view of notes on the Analyze page (Fall '25) | None | Not built | A table of highlights with tag columns is small |
| Discussion guides | Create guides when importing data; tag notes against guide questions (help centre category) | None | Not built | |

### 8. Insights and reporting

| Feature | What Marvin does | Ours | Status | Gap / notes |
|---|---|---|---|---|
| Insight report editor | Blocks: text, tables, callouts, lists, checklists, cover image, table of contents, images, graphs; citations to notes, clips and documents; embed notes (text, video or both) and playlists (help: Create Insights) | `Insight` and `InsightHighlight` tables only; no page | Spec: v2 | The spec's v2 insight is simpler: statement, description, confidence, product area, linked highlights |
| Templates | Marvin templates and team templates; save as template; rename or delete (help: Create Insights) | None | Spec: v2 | |
| Draft states and publishing | Private draft, shared draft, published; publish page adds title, description, cover, file tags, Research Areas (help: Create Insights) | None | Spec: v2 | |
| Comments and mentions | Comments with @ mentions and GIFs on insights; comments on insights before publishing (help: Create Insights; 2024 recap) | None | Spec: Later (comments) | |
| View analytics | View counts for admins and Full seats; admins download the viewer list as CSV (help: Create Insights) | None | Not built | |
| AI writing and presentations | AI Writer (polish, shorten); automatic AI presentation and audio summary on publish (help: Create Insights) | None | Spec: out of scope (AI) | |
| Exports | PDF download of whole or selected pages; attach to Jira; Notion export; PowerPoint mentioned in marketing but not in help (help: Create Insights; 2024 recap) | None | Spec: Later (Confluence export) | |
| Research Areas and branded library | Published insights linked to Research Areas; branded insights library; custom branding (Pro) (help: Create Insights; marketing) | None | Not built | |
| Custom report templates | Organise findings in formats that suit stakeholders (2024 recap) | None | Spec: v2 | |

### 9. Sharing, collaboration and integrations

| Feature | What Marvin does | Ours | Status | Gap / notes |
|---|---|---|---|---|
| Share by link | Share icon on files, projects, insights and playlists; three modes: seat required, organisation guests verified by email or SSO for 7 days (Pro+), anyone with the link (help: Share research) | None; every page requires a signed-in user | Not built | Medium: signed share tokens for a source, highlight or insight |
| Team-wide visibility settings | "Let all team members view published Insights & Playlists"; Viewer search restriction (help: Share research) | Open projects give everyone Viewer; restricted projects hide everything from non-members | Partial | No admin settings page |
| Comments | On insights (and, per 2024 recap, in live chat during calls) | None | Spec: Later | |
| Live chat, virtual backroom, live broadcasting | Chat during calls; stakeholders watch interviews unseen; stream sessions to the team (2024 recap) | None | Not built | Tied to live recording, which is out of scope |
| Slack | `/heymarvin` brings cited research into a channel; post summaries to Slack in one click; digests; Live Intercept notifications (marketing; Fall '25) | None | Not built | |
| Task and design tools | Export notes to Jira, Asana, Figma, Google Sheets; share insights to Miro, FigJam, Confluence, Notion; Figma Make queries the repository (help: Set up integrations; marketing) | None | Spec: Later (Confluence export) | |
| Salesforce | Bidirectional sync; CRM records linked to the panel; answers for sales teams (pricing add-on) | None | Not built | |
| MCP server and API | Marvin MCP pushes insights into Claude, ChatGPT, Copilot, Cursor, Perplexity, Gemini; Marvin API (Pro) (marketing) | None | Not built | An MCP server over our Postgres search would be a small, high-leverage piece if the team uses Claude |

### 10. Access, administration and security

| Feature | What Marvin does | Ours | Status | Gap / notes |
|---|---|---|---|---|
| Seat types | Admin, Full, Collaborator, Viewer; unlimited viewers with Ask AI; free guest accounts via SSO magic link (pricing; help: Share research) | Global admin flag; per-project Admin, Editor, Viewer; owner is project admin | Partial | No collaborator tier, no guests |
| Role-based access | Project membership gates notes, files, AI; admin settings control link access, viewer search, panel access, tag approval (help: Share research; Research Panel; File tags) | Project membership and open/restricted access enforced in every action, route and search query | Built | No admin settings UI; the equivalent toggles are code constants |
| SSO | Okta and SAML single sign-on (compliance add-on) | Email and password with cookie sessions; users created by admins or a CLI | Partial | Spec: company SSO "one of the last things" |
| Data residency and certifications | US or EU data centres; SOC 2, ISO 27001, ISO 42001, GDPR, HIPAA with BAA (marketing; pricing) | Self-hosted on a Hetzner VM in the EU; no certifications apply | Not applicable | Self-hosting removes the vendor-trust question but adds the backup and patching burden (deploy.md) |
| PII redaction | Automatic PII redaction and face blur (Enterprise); speaker anonymisation with preserve list (Summer 2026) | None | Not built | |
| Audit and analytics | Who viewed an insight, as CSV (help: Create Insights) | None | Not built | |
| Data export | "How do I export data from Marvin?" article exists (not read); participant CSV export confirmed | Backups (pg_dump + uploads tar); no user-facing export | Not built | Small: project export as JSON plus files |
| Nightly backups | Vendor-managed | `scripts/backup.sh`, 14-day rotation | Built | |

### 11. Research methods (adjacent to the repository)

| Feature | What Marvin does | Ours | Status |
|---|---|---|---|
| AI-moderated interviews | Hundreds of simultaneous voice interviews in 40+ languages; prototype testing (marketing; Fall '25) | None | Spec: out of scope (recruiting, surveys, AI) |
| Live Intercept | Voice-to-voice AI interviewer embedded in a product, triggered by conditions, Slack notification on completion (Summer 2026) | None | Spec: out of scope |
| Live interviews with notetaker | Human-led calls with automatic notes and live collaboration (marketing) | None | Spec: out of scope |
| Mixed Methods Study, AI Personas, Team Workspaces, Ask AI in Teams | Announced for after Summer 2026 | None | Spec: out of scope |

## Scorecard

Counting the rows above (Marvin features, not the spec's acceptance criteria):

| Area | Built | Partial | Not built | Spec: v2 / Later | Spec: out of scope |
|---|---|---|---|---|---|
| Capture and ingestion | 0 | 2 | 5 | 1 | 3 |
| Transcript tool | 3 | 2 | 4 | 0 | 1 |
| Notes, highlights, clips | 1 | 1 | 2 | 3 | 1 |
| Tags and taxonomy | 3 | 2 | 4 | 0 | 1 |
| Participants | 2 | 2 | 4 | 0 | 0 |
| Search and Ask AI | 2 | 0 | 1 | 0 | 3 |
| Analysis | 0 | 1 | 4 | 0 | 3 |
| Insights and reporting | 0 | 0 | 2 | 6 | 1 |
| Sharing and integrations | 0 | 1 | 5 | 2 | 0 |
| Access and security | 2 | 2 | 3 | 0 | 0 |
| Research methods | 0 | 0 | 0 | 0 | 4 |
| **Total (90 rows; one "not applicable" row excluded)** | **13** | **13** | **34** | **12** | **17** |

Read it this way: about a third of Marvin's surface is AI or study-running that the spec excluded; the repository core the spec asked for is built; the real distance to "a Marvin replacement" is the middle column plus insights, clips, sharing and integrations.

## Where this repository is ahead of, or different from, Marvin

- **Highlights survive editing by construction.** Anchors are segment id plus character offset, segments cannot be split or merged, and a highlight whose words are deleted is kept as "orphaned" (decisions D5, D6, D19). Marvin's help notes that trimming updates highlights, but documents no guarantee for text edits.
- **Tag archive, merge with id history, and case-insensitive uniqueness** are implemented; Marvin's archive could not be confirmed.
- **Saved, shareable filter views** exist as first-class objects; Marvin's equivalent is topic subscriptions.
- **Self-hosted, no seat pricing, EU data by default**, which was the reason for the project.
- **Synthetic seed data in the Dovetail mirror shape**, so the real export can be imported later with the same code.

## Suggested next steps

Ordered by what the team would feel first. Sizes are rough: S under a day, M a few days, L a week or more. Nothing here is committed.

**A. Finish spec v2 as written**
1. Insights: statement, description, confidence, product area, linked highlights from any project; browse by tag and product area; open a highlight at its moment. (M)
2. Clips: play a highlight from its start to end time in the player; cut MP4/MP3 clips with ffmpeg on the server; download link. (M)
3. Playlists of clips, minimal: ordered list, play through. (S after clips)

**B. Non-AI parity that costs little**
4. Note text on highlights in the side panel (column and action already exist). (S)
5. Find and find-and-replace inside a transcript, routed through per-segment saves. (S)
6. Tag frequency counts per project and a cross-project tag × project matrix. (S)
7. Custom participant columns (typed definitions plus JSON values) and CSV import/export. (M)
8. File-level tags on sources, and project-scoped tags with a template to copy a set. (M)
9. Comments on highlights and insights with mentions. (M)
10. Share-by-link for a source, highlight or insight with a signed token and an admin setting for link modes. (M)
11. Admin settings page: who can see participants, who can create tags, link modes, viewer search restriction. (S–M)
12. Project export (JSON plus files) and per-source edited-transcript export (docx, vtt, txt). (S)
13. A table view of highlights with tag columns, sortable and filterable. (S)

**C. Ingestion**
14. Import of Zoom and Teams recording folders and their VTT transcripts (spec "Later"). (M)
15. PDF, PPTX, XLSX and image files as "note" sources with text extraction where possible. (M)
16. In-app transcription with a self-hosted Whisper service. Reverses a spec exclusion; needs Bruno's decision. (L)
17. Confluence or Notion export of insights (spec "Later"). (M)

**D. AI tier, only if the team asks (spec)**
18. Auto-tagging new sources against the global taxonomy, with a review queue. (M–L)
19. Per-source summaries and per-highlight suggestions. (M)
20. Ask-the-repository with citations to highlight and timestamp, built on the existing full-text search as the retriever. (L)
21. Thematic clustering across highlights. (L)
22. An MCP server exposing search and highlights to Claude, which is small once the API exists and is Marvin's current headline. (S–M)

## Sources

Product and pricing: [heymarvin.com](https://heymarvin.com/), [Knowledge Hub](https://heymarvin.com/product/ux-research-repository), [Analysis Studio](https://heymarvin.com/product/qualitative-analysis), [Pricing](https://heymarvin.com/pricing), [Integrations](https://heymarvin.com/integrations).

Help centre: [Annotate and analyze files](https://help.heymarvin.com/en/articles/10130418-annotate-and-analyze-files), [How tagging expedites qualitative analysis](https://help.heymarvin.com/en/articles/10130442-how-tagging-expedites-qualitative-analysis-in-marvin), [Use file tags](https://help.heymarvin.com/en/articles/10260903-use-file-tags-to-organize-and-surface-insights), [Create, edit and share video clips](https://help.heymarvin.com/en/articles/10130429-how-to-create-edit-and-share-video-clips), [Create Insights](https://help.heymarvin.com/en/articles/10130450-how-do-i-create-insights-a-k-a-research-reports), [Share research and control access](https://help.heymarvin.com/en/articles/11707357-share-research-and-control-who-has-access-to-it), [Research Panel](https://help.heymarvin.com/en/articles/10130405-manage-your-research-panel-and-participant-data-in-projects), [What kinds of data can I bring in](https://help.heymarvin.com/en/articles/10130475-what-kinds-of-data-can-i-bring-into-marvin), [Set up integrations](https://help.heymarvin.com/en/articles/10130407-set-up-integrations), [Import from Dovetail](https://help.heymarvin.com/en/articles/10656686-import-your-data-from-dovetail), [Import APIs](https://help.heymarvin.com/en/articles/16019741-bring-in-data-from-any-tool-through-marvin-s-import-apis), [Live Notes](https://help.heymarvin.com/en/articles/10130433-how-to-take-live-notes).

Release notes: [2024 product updates](https://heymarvin.com/resources/marvin-product-updates-2024), [Fall '25 updates](https://heymarvin.com/resources/keep-up-the-research-momentum-fall25-updates), [Summer 2026 release](https://heymarvin.com/resources/everything-we-launched-at-our-summer-product-showcase-2026).

Third party (pricing and reviews, figures conflict): [G2](https://www.g2.com/products/heymarvin/reviews), [TrustRadius pricing](https://www.trustradius.com/products/heymarvin/pricing), [AIChief](https://aichief.com/ai-data-management/heymarvin/), [DoReveal comparison](https://doreveal.com/blog/best-heymarvin-alternatives-competitors), [Looppanel comparison](https://www.looppanel.com/blog/marvin-alternatives).
