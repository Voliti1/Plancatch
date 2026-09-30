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
