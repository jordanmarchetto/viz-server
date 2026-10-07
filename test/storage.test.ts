import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { PageStorage, type PageMetadata } from "../src/storage.ts";

const directories: string[] = [];
const NOW = new Date("2026-10-08T12:00:00.000Z");
const TTL_DAYS = 7;

async function setup(): Promise<{ storage: PageStorage; pages: string }> {
  const directory = await mkdtemp(path.join(tmpdir(), "viz-storage-test-"));
  directories.push(directory);
  const storage = new PageStorage(directory);
  await storage.initialize();
  return { storage, pages: path.join(directory, "pages") };
}

function metadata(id: string, createdAt: string): PageMetadata {
  return { id, createdAt, status: "waiting", answeredAt: null, answers: null };
}

async function writePage(pages: string, id: string, createdAt: string): Promise<void> {
  await Promise.all([
    writeFile(path.join(pages, `${id}.html`), `<h1>${id}</h1>`),
    writeFile(path.join(pages, `${id}.json`), JSON.stringify(metadata(id, createdAt))),
  ]);
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

test("prunes expired pages and incomplete pairs without touching active locks", async () => {
  const { storage, pages } = await setup();
  const expired = "00000000-0000-4000-8000-000000000001";
  const fresh = "00000000-0000-4000-8000-000000000002";
  const incomplete = "00000000-0000-4000-8000-000000000003";
  const incompleteMetadata = "00000000-0000-4000-8000-000000000004";
  const uploadLocked = "00000000-0000-4000-8000-000000000005";
  const answerLocked = "00000000-0000-4000-8000-000000000006";
  const boundary = new Date(NOW.getTime() - TTL_DAYS * 24 * 60 * 60 * 1_000);

  await writePage(pages, expired, boundary.toISOString());
  await writePage(pages, fresh, new Date(boundary.getTime() + 1).toISOString());
  await writeFile(path.join(pages, `${incomplete}.html`), "incomplete");
  await writeFile(
    path.join(pages, `${incompleteMetadata}.json`),
    JSON.stringify(metadata(incompleteMetadata, boundary.toISOString())),
  );
  await writeFile(path.join(pages, `${uploadLocked}.html`), "uploading");
  await writePage(pages, answerLocked, new Date(boundary.getTime() - 1).toISOString());
  await Promise.all([
    utimes(path.join(pages, `${incomplete}.html`), boundary, boundary),
    utimes(path.join(pages, `${uploadLocked}.html`), boundary, boundary),
    writeFile(path.join(pages, `${uploadLocked}.lock`), ""),
    writeFile(path.join(pages, `${answerLocked}.answer.lock`), ""),
  ]);

  assert.equal(await storage.pruneExpired(TTL_DAYS, NOW), 3);
  assert.equal(await exists(path.join(pages, `${expired}.html`)), false);
  assert.equal(await exists(path.join(pages, `${expired}.json`)), false);
  assert.equal(await exists(path.join(pages, `${incomplete}.html`)), false);
  assert.equal(await exists(path.join(pages, `${incompleteMetadata}.json`)), false);
  assert.equal(await exists(path.join(pages, `${fresh}.html`)), true);
  assert.equal(await exists(path.join(pages, `${uploadLocked}.html`)), true);
  assert.equal(await exists(path.join(pages, `${answerLocked}.json`)), true);

  assert.equal(await storage.pruneExpired(TTL_DAYS, NOW), 0);
  assert.match(await readFile(path.join(pages, `${fresh}.html`), "utf8"), new RegExp(fresh));
});
