# viz-server

Optional remote page host for [viz](https://github.com/jordanmarchetto/viz).
It accepts finished HTML from a `viz` client, stores it, and returns a URL that
works from another machine. The server never renders viz's page schema, so the
CLI and server do not need matching templates or releases.

This first iteration hosts detached pages. Browser answers and blocking CLI
sessions are planned next.

## Requirements

- Node 22.18 or newer for local development
- Docker, optionally

## Run locally

```bash
npm install

export PUBLIC_BASE_URL=http://localhost:5008
export VIZ_TOKEN="$(openssl rand -hex 32)"
export DATA_DIR="$PWD/data"
npm start
```

The server listens on `0.0.0.0:5008` by default.

Check it:

```bash
curl http://localhost:5008/health
```

## Upload and view a page

The caller generates a UUID v4. The server never replaces an existing ID.

```bash
PAGE_ID="$(node -e 'console.log(crypto.randomUUID())')"

curl --fail-with-body \
  -X PUT "http://localhost:5008/api/pages/$PAGE_ID" \
  -H "Authorization: Bearer $VIZ_TOKEN" \
  -H "Content-Type: text/html; charset=utf-8" \
  --data-binary @page.html
```

The response contains the public URL:

```json
{
  "id": "...",
  "url": "http://localhost:5008/pages/..."
}
```

Uploaded pages are intentionally accessible without authentication to anyone
who knows their random URL. Uploads require the shared bearer token.

## Configuration

| Variable | Default | Purpose |
|---|---:|---|
| `PUBLIC_BASE_URL` | required | Browser-facing origin returned after upload |
| `VIZ_TOKEN` | required | Shared upload secret; at least 16 characters |
| `PORT` | `5008` | Listening port |
| `HOST` | `0.0.0.0` | Listening address |
| `DATA_DIR` | `/data` | Persistent storage root |
| `MAX_PAGE_BYTES` | `2097152` | Maximum HTML upload size |

Trailing slashes are removed from `PUBLIC_BASE_URL`.

## Persistence

Each accepted page creates two files:

```text
$DATA_DIR/pages/<id>.html
$DATA_DIR/pages/<id>.json
```

The JSON sidecar is a commit marker and records creation and answer status. The
server requires both files before serving a page. Writes use temporary files and
an exclusive per-page lock, so concurrent uploads cannot overwrite one another.

## Docker

Copy the sample files into a runtime directory, then create the data directory:

```bash
cp docker-compose.example.yaml docker-compose.yaml
cp .env.example .env
mkdir -p data
# Edit .env before starting.
docker compose up --build -d
```

The repository sample builds locally. Image publishing is intentionally deferred.
For this project's home-server deployment, the machine-local Compose file will
live at `~/docker/viz/docker-compose.yaml`.

If the container cannot write a bind-mounted `data/` directory, make that
directory writable by UID 1000, which is the image's unprivileged `node` user.

## API

### `GET /health`

Returns:

```json
{"status":"ok","protocolVersion":1}
```

### `PUT /api/pages/:id`

Requires:

- UUID v4 page ID
- `Authorization: Bearer <VIZ_TOKEN>`
- `Content-Type: text/html`
- Body no larger than `MAX_PAGE_BYTES`

Returns `201` with the page URL, `409` for a duplicate ID, `413` for an oversized
page, or `415` for another content type.

### `GET /pages/:id`

Serves a stored page as UTF-8 HTML. Returns `404` when the page is absent or
incomplete.

## Development

```bash
npm test
npm run check
```

Tests use temporary directories and ephemeral ports. They cover authentication,
validation, persistence, duplicate and concurrent uploads, serving, and restart
behavior.

## Planned next steps

1. Add remote detached-page support to the `viz` CLI.
2. Add browser answer submission and authenticated long polling.
3. Add remote blocking mode to `viz`.
4. Add optional indexing, cleanup, and published container images later.
