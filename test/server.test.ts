import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { createServer as createHttpServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, test } from "node:test";
import { createHandler } from "../src/server.ts";
import type { Config } from "../src/config.ts";

const TOKEN = "test-secret-at-least-16-characters";
const PAGE_ID = "9fd2c9e3-e0a8-43ce-97ab-2b9db79154ae";
const HTML = "<!doctype html><title>Remote viz</title><h1>It works</h1>";

interface TestServer {
  server: Server;
  url: string;
  dataDir: string;
}

const running: TestServer[] = [];

async function start(overrides: Partial<Config> = {}): Promise<TestServer> {
  const dataDir = overrides.dataDir ?? await mkdtemp(path.join(tmpdir(), "viz-server-test-"));
  const config: Config = {
    host: "127.0.0.1",
    port: 0,
    publicBaseUrl: "https://viz.example.test",
    token: TOKEN,
    dataDir,
    maxPageBytes: 1024,
    ...overrides,
  };
  const handler = await createHandler(config);
  const server = createHttpServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object");
  const result = { server, url: `http://127.0.0.1:${address.port}`, dataDir };
  running.push(result);
  return result;
}

async function stop(instance: TestServer): Promise<void> {
  await new Promise<void>((resolve, reject) => instance.server.close((error) => error ? reject(error) : resolve()));
  running.splice(running.indexOf(instance), 1);
}

afterEach(async () => {
  await Promise.all(running.splice(0).map(async (instance) => {
    await new Promise<void>((resolve) => instance.server.close(() => resolve()));
    await rm(instance.dataDir, { recursive: true, force: true });
  }));
});

function upload(url: string, id = PAGE_ID, init: RequestInit = {}): Promise<Response> {
  return fetch(`${url}/api/pages/${id}`, {
    method: "PUT",
    headers: {
      authorization: `Bearer ${TOKEN}`,
      "content-type": "text/html; charset=utf-8",
      ...init.headers,
    },
    body: init.body ?? HTML,
  });
}

describe("viz-server", () => {
  test("reports health without authentication", async () => {
    const instance = await start();
    const response = await fetch(`${instance.url}/health`);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ok", protocolVersion: 1 });
  });

  test("requires bearer authentication for uploads", async () => {
    const instance = await start();
    const response = await fetch(`${instance.url}/api/pages/${PAGE_ID}`, {
      method: "PUT",
      headers: { "content-type": "text/html" },
      body: HTML,
    });

    assert.equal(response.status, 401);
    assert.equal(response.headers.get("www-authenticate"), "Bearer");
  });

  test("rejects invalid IDs, content types, and oversized pages", async () => {
    const instance = await start({ maxPageBytes: 32 });

    assert.equal((await upload(instance.url, "../../etc/passwd")).status, 404);
    assert.equal((await upload(instance.url, "not-a-random-uuid")).status, 400);
    assert.equal((await upload(instance.url, PAGE_ID, { headers: { "content-type": "application/json" } })).status, 415);
    assert.equal((await upload(instance.url, PAGE_ID, { body: "x".repeat(33) })).status, 413);
  });

  test("stores and serves finished HTML with metadata", async () => {
    const instance = await start();
    const response = await upload(instance.url);

    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), {
      id: PAGE_ID,
      url: `https://viz.example.test/pages/${PAGE_ID}`,
    });

    const pages = path.join(instance.dataDir, "pages");
    assert.equal(await readFile(path.join(pages, `${PAGE_ID}.html`), "utf8"), HTML);
    const metadata = JSON.parse(await readFile(path.join(pages, `${PAGE_ID}.json`), "utf8")) as Record<string, unknown>;
    assert.equal(metadata.id, PAGE_ID);
    assert.equal(metadata.status, "waiting");
    assert.equal(metadata.answeredAt, null);
    assert.equal(metadata.answers, null);
    assert.match(String(metadata.createdAt), /^\d{4}-\d{2}-\d{2}T/);

    const page = await fetch(`${instance.url}/pages/${PAGE_ID}`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-type") ?? "", /^text\/html/);
    assert.equal(await page.text(), HTML);
  });

  test("does not overwrite a duplicate page", async () => {
    const instance = await start();
    assert.equal((await upload(instance.url)).status, 201);
    assert.equal((await upload(instance.url, PAGE_ID, { body: "<h1>replacement</h1>" })).status, 409);
    assert.equal(await readFile(path.join(instance.dataDir, "pages", `${PAGE_ID}.html`), "utf8"), HTML);
  });

  test("allows only one concurrent upload for an ID", async () => {
    const instance = await start();
    const responses = await Promise.all([upload(instance.url), upload(instance.url)]);
    assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
    const names = await readdir(path.join(instance.dataDir, "pages"));
    assert.deepEqual(names.sort(), [`${PAGE_ID}.html`, `${PAGE_ID}.json`]);
  });

  test("serves a persisted page after restart", async () => {
    const first = await start();
    assert.equal((await upload(first.url)).status, 201);
    const dataDir = first.dataDir;
    await stop(first);

    const second = await start({ dataDir });
    const response = await fetch(`${second.url}/pages/${PAGE_ID}`);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), HTML);
  });

  test("returns 404 for missing pages and routes", async () => {
    const instance = await start();
    assert.equal((await fetch(`${instance.url}/pages/${PAGE_ID}`)).status, 404);
    assert.equal((await fetch(`${instance.url}/nope`)).status, 404);
  });
});
