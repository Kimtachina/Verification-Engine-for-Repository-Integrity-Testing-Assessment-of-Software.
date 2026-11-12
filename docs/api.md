# VERITAS API

Base URL: `http://127.0.0.1:4000` (start with `bun run api`). Every request and response
body is validated against the Zod schemas in `shared/src/schemas/`; the schema named in
each section is the contract.

The server scans only the root set in `veritas.config.ts`. Clients cannot choose another
path. It listens on 127.0.0.1 by default, so only the local machine can reach it.

## Errors

Every non-2xx response is `ApiError`: `{ "error": string, "details"?: string }`.

| Status | When |
|---|---|
| 400 | Invalid body or query (`details` names the field), invalid JSON, invalid config |
| 404 | Unknown scan, finding or route |
| 409 | A scan is already running, or the scan is not completed yet |
| 500 | Unexpected error. The body never contains paths or stack traces; see the server log |
| 501 | Report format not implemented yet |

## Endpoints

### `GET /api/health` → `Health`
Version, scan root, each external tool (`available`, `source`: `bundled` or `path`) and the
id of the running scan, if any.

### `POST /api/scans` → `202 Scan`
Body (`StartScanRequest`, all optional): `{ dimensions?: Dimension[], failOn?: Severity, minScore?: number }`.
Returns the scan with `status: "running"`; it continues in the background. One scan runs at a
time: a second request gets 409 until the first finishes.

### `GET /api/scans?limit=50&offset=0` → `Scan[]`
Newest first. `limit` 1–200.

### `GET /api/scans/:id` → `Scan`

### `GET /api/scans/:id/events` → Server-Sent Events
Each event's `event:` line is its type and `data:` is a `ScanEvent` JSON object:
`discovery-started`, `discovery-finished`, `analyzer-started`, `analyzer-finished`,
`scan-finished`. A running scan first replays the events so far. The stream always ends
with exactly one `scan-finished`, sent after the results are stored, so fetching findings
at that moment always works. For a finished scan it sends only `scan-finished` and closes.

### `GET /api/scans/:id/findings` → `FindingPage`
Query (`FindingQuery`):

| Param | Meaning |
|---|---|
| `severity` | Comma-separated list, e.g. `critical,high` |
| `dimension` | Comma-separated list |
| `file` | Exact path, or a folder prefix ending in `/` |
| `q` | Case-insensitive text in message, rule or file. `%` and `_` match literally |
| `sort` | `severity` (default), `file`, `dimension` |
| `limit` / `offset` | 1–500, default 50 / default 0 |

Response: `{ items: Finding[], total, limit, offset }`. `total` counts all matches.

### `GET /api/scans/:id/compare/:baseId` → `ScanComparison`
`:id` is the newer scan, `:baseId` the one to compare against. Findings are matched by
fingerprint, so a finding that only moved lines counts as persisting.
`{ scoreDelta, introduced: Finding[], resolved: Finding[], persistingCount }`. Both scans
must be completed (409 otherwise).

### `GET /api/scans/:id/report?format=json` → `Report`
Downloads as `veritas-report-<id>.json`. `markdown`, `html` and `sarif` return 501 until step 6.

### `GET /api/findings/:id` → `Finding`

## Configuration (environment)

| Variable | Default |
|---|---|
| `VERITAS_CONFIG_DIR` | current directory (where `veritas.config.ts` lives) |
| `VERITAS_DB` | `<config dir>/.veritas/veritas.db` |
| `HOST` / `PORT` | `127.0.0.1` / `4000` |
| `VERITAS_CORS_ORIGINS` | `http://localhost:3000` (comma-separated) |

Scans left running when the server stopped are marked `failed` at the next start.
