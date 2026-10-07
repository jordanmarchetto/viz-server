# viz-server

`viz-server` makes pages from [`viz`](https://github.com/jordanmarchetto/viz)
available on another machine. Use it when `viz` runs over SSH, inside a remote
development environment, or anywhere a local `file://` or localhost URL cannot
reach your browser.

You do not need this server when `viz` and your browser run on the same machine.
Local mode remains the default.

```text
viz CLI  ── uploads finished HTML ──>  viz-server  ──>  browser
   │                                      │                │
   └──────── waits for answers <──────────┴── submits ─────┘
```

The server stores finished HTML rather than interpreting the `viz` page format.
The CLI and server therefore do not need matching templates or releases.

## Requirements

- Docker and Docker Compose for the recommended setup
- Node 22.18 or newer for development without Docker
- A URL reachable from the browser

## Quick start with Docker

Clone the repository and create the runtime files:

```bash
git clone https://github.com/jordanmarchetto/viz-server.git
cd viz-server
cp docker-compose.example.yaml docker-compose.yaml
cp .env.example .env
mkdir -p data
```

Generate a shared token:

```bash
openssl rand -hex 32
```

Edit `.env` and set the browser-facing URL and generated token. Use localhost
for an initial local test:

```dotenv
PUBLIC_BASE_URL=http://localhost:5008
VIZ_TOKEN=paste-the-generated-token-here
```

Start the server and check its health:

```bash
docker compose up --build -d
curl http://localhost:5008/health
```

The health response includes the protocol version:

```json
{"status":"ok","protocolVersion":1}
```

## Connect viz

Configure the `viz` CLI with the server address and the same token from `.env`:

```bash
viz config remote
# Server URL: http://localhost:5008
# Shared token: [input is hidden]
```

Now use `viz` normally:

```bash
echo '{"title":"Hello","blocks":[{"type":"md","text":"# Remote page"}]}' \
  | viz --open
```

`viz` saves a local copy, uploads the page, and prints both locations:

```text
file: file:///path/to/page.html
page: http://localhost:5008/pages/550e8400-e29b-41d4-a716-446655440000
```

Pages with decisions can also submit answers through the server. The waiting
`viz` process receives the first submitted answer and continues.

## Before exposing it to a network

- Put the server behind HTTPS when it crosses an untrusted network.
- Keep `VIZ_TOKEN` secret. It authorizes page uploads and answer retrieval.
- Treat page URLs as private links. Anyone who knows a URL can view that page.
- Persist and protect `DATA_DIR`. Pages and answers are not removed
  automatically.

See [Configuration and deployment](docs/configuration.md) for reverse-proxy
requirements, environment variables, storage, and security details.

## Documentation

- [Configuration and deployment](docs/configuration.md): Environment variables,
  Docker Compose, client setup, reverse proxies, security, and retention.
- [HTTP API](docs/api.md): Upload, page, answer, result, and health endpoints.
- [Development](docs/development.md): Local Node setup, tests, project layout,
  and the persistence model.
