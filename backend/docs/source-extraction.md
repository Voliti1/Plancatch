# Source extraction API (stage 2)

Authenticated `POST /api/sources/{source_id}/analyze` accepts no body and returns
202 with a SourceResponse snapshot in `processing`. The source must belong to
the caller. Poll `GET /api/sources/{source_id}` for completion.

States:
- `pending`: not yet requested, or source contents changed.
- `processing`: extraction in progress.
- `extracted`: extracted_text is ready. **No AI inference has run.**
- `requires_login`: HTTP 401 or a page containing a non-hidden password input;
  not fetched with credentials. Password-form detection is conservative, not definitive.
  Explicitly hidden optional login popups (hidden/aria-hidden/inline display or
  visibility, including inherited hiding) do not block public content. Their
  text is excluded from extraction and AI input. External CSS is not evaluated.
- `failed`: inspect error_message (safe code).
- `completed`: reserved for a later AI pipeline; this worker never sets it.

403 is `access_denied`, not necessarily a login requirement. Robots denial,
429, unsupported files, empty/JavaScript-only pages, network failures and size
limits also produce explicit failure codes. Title is filled from HTML only
when the user's title is empty. Text is not truncated silently.

Only HTTP/HTTPS on ports 80/443 is allowed. All DNS answers must be public;
the connection is pinned to one validated address. TLS validates the original
hostname. Redirect targets and robots requests use the same protection.
Cookies, authentication headers, proxy environment variables and embedded
resources are not forwarded or fetched. There is no browser rendering or
CAPTCHA bypass. robots.txt 404/410 is treated as absent; other non-200 responses
fail closed. Site terms/permission still need separate review for supported sites.

Saramin public relay job URLs have a bounded adapter: when the HTML itself links
to a single same-origin `/zf_user/jobs/view` canonical with exactly the same
numeric `rec_idx`, extraction reads that public server-rendered job page instead
of the JavaScript-only relay shell. The original page must first pass the login
gate. The canonical consumes the existing navigation budget and is subject to
the same DNS pinning, TLS, robots, timeout and size checks. Different jobs,
origins, credentials, ports, extra query fields and conflicting canonical links
are not followed. No generic canonical crawler, AJAX calls, cookies, login or
automatic iframe fetching are enabled. The stored original_url remains unchanged.

### Same-page structured job evidence

The extractor reads HTML already downloaded under the existing policy. In addition
to visible main/body text, it now reads inert inline `application/ld+json` blocks
containing Schema.org `JobPosting` records. No JavaScript is executed, no JSON-LD
context or metadata URL is fetched, and arbitrary scripts/hidden body content are
still excluded. No general browser, AJAX, iframe or login bypass is introduced.

Only a record whose `url`, `@id`, or fallback `mainEntityOfPage` identifies the
fetched page is usable. Conflicting references, other jobs/hosts, credentials,
ports, invalid dates and incompatible multiple same-page records are ignored.
Generic query parameters remain part of the page identity. JobKorea's numeric
`/Recruit/GI_Read/{id}` path permits its query-free metadata URL when the submitted
URL contains tracking/search parameters; a supplied posting identifier must also
match that path ID. This adapter never changes or fetches an identity link.

Validated ISO `validThrough` is appended with a clear JSON-LD provenance label,
job title, page URL and sanitized description. Dates and offsets are preserved
verbatim: no current year, end-of-day time or Korean timezone is filled in.
Date-only/timezone-free values add explicit Korean review notices. The AI adapter
also enforces those notices: all proposed dates in such an input remain null and
unselected until a user enters/confirms a complete datetime in the review screen,
even if the model guessed an offset or omitted its own warnings. Opt-in automatic
registration therefore remains blocked; manual review/edit/approval still works.

JSON-LD capture is limited to 16 blocks and 100,000 characters in total; each
graph walk is limited to 128 nodes and depth 8. Malformed/oversized/unrelated
metadata does not replace usable visible content. Combined text retains the
existing 100,000-character extraction and 40,000-character AI input limits.
An empty page may be extracted only when usable same-page job evidence exists.
Other JavaScript-only pages still require manual text input or future rendering.

For the observed public JobKorea job 50076426, the original HTML contains
`validThrough: 2026-10-31T23:59`; visible job text lives in a hidden streamed
container in the initial HTML. The old extractor dropped that text and all scripts,
so the AI never received the deadline. The metadata supplies the missing evidence,
but not a timezone, so this page requires explicit user confirmation.

Existing stored extracts are not rewritten automatically. Re-extract the original
Source, then start a new analysis; a prior Analysis keeps its own original snapshot.
No DB migration, frontend change, secret change or security-group update is needed.

Limits: 2 simultaneous jobs per application process, 2 MB response,
100,000 characters, at most 3 followed redirects, 8-second socket timeout,
30-second HTTP read budget. OS DNS resolution may outlast that budget.
Duplicates or edits/deletes while processing return 409; full worker capacity
returns 429. Failed and extracted sources can be retried; changed source
contents clear the old extraction.

This MVP uses FastAPI BackgroundTasks, not a durable queue. A process restart
may leave jobs in processing; restart recovery and a persistent queue are
required before larger-scale use. Do not deploy schema changes without applying
Alembic revision 20260930_0004 first. No frontend changes are included here.
