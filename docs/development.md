# Development

## Run without Docker

Requires Node 22.18 or newer.

```bash
npm install
mkdir -p data

export PUBLIC_BASE_URL=http://localhost:5008
export VIZ_TOKEN="$(openssl rand -hex 32)"
export DATA_DIR="$PWD/data"

npm start
```

The server listens on `0.0.0.0:5008` by default. Check it from another terminal:

```bash
curl http://localhost:5008/health
```

## Checks

```bash
npm test
npm run check
```

Tests use temporary directories and ephemeral ports. They cover authentication,
validation, persistence, concurrent first-write behavior, long-poll wakeups and
timeouts, secure page serving, retention cleanup, and restart recovery.

## Project layout

```text
src/main.ts       process startup and graceful shutdown
src/config.ts     environment parsing and validation
src/server.ts     HTTP routes, authentication, and request validation
src/storage.ts    durable page and answer storage
src/waiters.ts    in-memory waiters for blocking clients
test/             configuration and integration tests
```

## Persistence model

Each accepted page creates two files:

```text
$DATA_DIR/pages/<id>.html
$DATA_DIR/pages/<id>.json
```

The JSON sidecar records creation and answer status and acts as the commit
marker. The server requires both files before serving a page.

Writes use temporary files and exclusive per-page locks. Concurrent uploads
cannot overwrite one another, and only the first answer can win. Persisted
answers remain available after a server restart. When retention is configured,
cleanup removes an expired HTML file and its JSON sidecar together and skips
active upload and answer locks.
