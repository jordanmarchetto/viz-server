# HTTP API

The `viz` CLI uses this API directly. You only need these details when building
another client or diagnosing the connection.

## `GET /health`

Returns the service status and protocol version:

```json
{"status":"ok","protocolVersion":1}
```

## `PUT /api/pages/:id`

Uploads a finished HTML page. The client generates a UUID v4. The server never
replaces an existing ID.

Required request values:

- UUID v4 page ID
- `Authorization: Bearer <VIZ_TOKEN>`
- `Content-Type: text/html`
- Body no larger than `MAX_PAGE_BYTES`

Example:

```bash
PAGE_ID="$(node -e 'console.log(crypto.randomUUID())')"

curl --fail-with-body \
  -X PUT "http://localhost:5008/api/pages/$PAGE_ID" \
  -H "Authorization: Bearer $VIZ_TOKEN" \
  -H "Content-Type: text/html; charset=utf-8" \
  --data-binary @page.html
```

A successful upload returns `201 Created`:

```json
{
  "id": "...",
  "url": "http://localhost:5008/pages/..."
}
```

The endpoint returns `409` for a duplicate ID, `413` for an oversized page, and
`415` for another content type.

## `GET /pages/:id`

Serves a stored page as UTF-8 HTML. The request does not require the shared
token. It returns `404` when the page is absent or incomplete.

Stored pages include response headers that prevent caching, referrer sharing,
and framing:

```http
Cache-Control: private, no-store
Referrer-Policy: no-referrer
X-Frame-Options: DENY
Content-Security-Policy: frame-ancestors 'none'
X-Content-Type-Options: nosniff
```

## `POST /api/pages/:id/answers`

Accepts the first browser answer for a page:

```json
{"answers":{"q1":"Selected option"}}
```

Answer IDs and values must be non-empty strings. A request may contain at most
100 answers, and an answer ID may contain at most 128 characters. The request
body may not exceed `MAX_ANSWER_BYTES`.

The first valid submission returns `200`. Later submissions return `409`.
Answers are persisted before the server responds.

## `GET /api/pages/:id/result`

Requires `Authorization: Bearer <VIZ_TOKEN>`.

If answers already exist, the endpoint returns them immediately with `200`:

```json
{"answers":{"q1":"Selected option"}}
```

Otherwise, it waits for up to `RESULT_WAIT_MS`. A wait that expires returns
`204 No Content`. The client reconnects until its own overall timeout expires.
