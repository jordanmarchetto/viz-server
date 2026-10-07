# Configuration and deployment

`viz-server` reads its configuration from environment variables when it starts.

## Environment variables

| Variable | Default | Purpose |
|---|---:|---|
| `PUBLIC_BASE_URL` | Required | Browser-facing origin included in uploaded page URLs |
| `VIZ_TOKEN` | Required | Shared client secret; at least 16 characters |
| `PORT` | `5008` | Listening port |
| `HOST` | `0.0.0.0` | Listening address |
| `DATA_DIR` | `/data` | Persistent storage root |
| `MAX_PAGE_BYTES` | `2097152` | Maximum HTML upload size |
| `MAX_ANSWER_BYTES` | `65536` | Maximum browser answer body size |
| `RESULT_WAIT_MS` | `25000` | Maximum duration of one result request |

`PUBLIC_BASE_URL` must be an absolute HTTP or HTTPS URL. Trailing slashes are
removed. Generate a token with at least 16 characters. For example:

```bash
openssl rand -hex 32
```

## Docker Compose

Copy the sample files into a runtime directory:

```bash
cp docker-compose.example.yaml docker-compose.yaml
cp .env.example .env
mkdir -p data
```

Set both required values in `.env`:

```dotenv
PUBLIC_BASE_URL=https://viz.example.com
VIZ_TOKEN=replace-with-the-output-of-openssl-rand
```

Start the server:

```bash
docker compose up --build -d
docker compose ps
curl http://localhost:5008/health
```

The sample builds the image locally and stores data in `./data`. If the
container cannot write to that directory, make it writable by UID 1000, the
unprivileged `node` user in the image.

## Connect a viz client

On every machine that runs `viz`, configure the API address and the same shared
token:

```bash
viz config remote
# Server URL: http://server.home:5008
# Shared token: [input is hidden]
```

The server URL must be reachable from the CLI. It may differ from
`PUBLIC_BASE_URL`, which must be reachable from the browser. For example, the
CLI can upload over a private network while the browser opens an HTTPS URL
through a reverse proxy.

Run `viz config show` to inspect the active client configuration without
printing the token. Run `viz config disable` to return the client to local-only
mode.

## Reverse proxy

For access outside a trusted private network, place `viz-server` behind an HTTPS
reverse proxy. Configure the proxy to:

- Forward the browser routes and `/api/` routes to port 5008.
- Allow HTML uploads up to `MAX_PAGE_BYTES`.
- Keep result requests open longer than `RESULT_WAIT_MS`.
- Preserve the request method, body, content type, and `Authorization` header.

Set `PUBLIC_BASE_URL` to the external HTTPS origin. The server uses this value
when it returns a browser link after upload.

## Security and retention

Uploads and result polling require the shared bearer token. Browser page URLs
do not require authentication. The random UUID in each URL acts as the page's
read capability, so only share a page URL with people who may view it.

The first browser answer is accepted without exposing the shared token in the
page. Later submissions receive `409 Conflict`.

Pages and answers remain in `DATA_DIR` indefinitely. There is no automatic
cleanup or index. Protect and back up that directory according to the
sensitivity of the rendered content.
