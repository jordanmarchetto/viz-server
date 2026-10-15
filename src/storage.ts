import { constants } from "node:fs";
import { access, mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { FileHandle } from "node:fs/promises";

export type Answers = Record<string, string>;

export interface PageMetadata {
  id: string;
  createdAt: string;
  status: "waiting" | "answered";
  answeredAt: string | null;
  answers: Answers | null;
}

export class DuplicatePageError extends Error {}
export class DuplicateAnswerError extends Error {}
export class MissingPageError extends Error {}

export class PageStorage {
  readonly pagesDir: string;

  constructor(dataDir: string) {
    this.pagesDir = path.join(dataDir, "pages");
  }

  async initialize(): Promise<void> {
    await mkdir(this.pagesDir, { recursive: true });
  }

  async create(id: string, html: string): Promise<PageMetadata> {
    const lockPath = this.file(id, "lock");
    let lock: FileHandle;
    try {
      lock = await open(lockPath, "wx", 0o600);
    } catch (error) {
      if (isCode(error, "EEXIST")) throw new DuplicatePageError(id);
      throw error;
    }

    const htmlPath = this.file(id, "html");
    const metadataPath = this.file(id, "json");
    const temporaryHtml = this.temporary(id, "html");
    const temporaryMetadata = this.temporary(id, "json");

    try {
      if (await exists(htmlPath) || await exists(metadataPath)) throw new DuplicatePageError(id);

      const metadata: PageMetadata = {
        id,
        createdAt: new Date().toISOString(),
        status: "waiting",
        answeredAt: null,
        answers: null,
      };

      await Promise.all([
        writeFile(temporaryHtml, html, { encoding: "utf8", mode: 0o600, flag: "wx" }),
        writeFile(temporaryMetadata, `${JSON.stringify(metadata, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" }),
      ]);
      await rename(temporaryHtml, htmlPath);
      await rename(temporaryMetadata, metadataPath);
      return metadata;
    } catch (error) {
      await Promise.all([
        rm(temporaryHtml, { force: true }),
        rm(temporaryMetadata, { force: true }),
      ]);
      if (error instanceof DuplicatePageError || isCode(error, "EEXIST")) {
        throw new DuplicatePageError(id);
      }
      // The metadata sidecar marks a complete page. Remove a partial HTML file
      // if the second rename failed so it cannot become visible later.
      if (!(await exists(metadataPath))) await rm(htmlPath, { force: true });
      throw error;
    } finally {
      await lock.close();
      await rm(lockPath, { force: true });
    }
  }

  async readHtml(id: string): Promise<string> {
    // Require both files. Metadata is written last and acts as the commit marker.
    if (!(await exists(this.file(id, "json")))) throw new MissingPageError(id);
    try {
      return await readFile(this.file(id, "html"), "utf8");
    } catch (error) {
      if (isCode(error, "ENOENT")) throw new MissingPageError(id);
      throw error;
    }
  }

  async readMetadata(id: string): Promise<PageMetadata> {
    try {
      return JSON.parse(await readFile(this.file(id, "json"), "utf8")) as PageMetadata;
    } catch (error) {
      if (isCode(error, "ENOENT")) throw new MissingPageError(id);
      throw error;
    }
  }

  /** Remove expired complete pages and stale incomplete page pairs. */
  async pruneExpired(ttlDays: number, now = new Date()): Promise<number> {
    const cutoff = now.getTime() - ttlDays * 24 * 60 * 60 * 1_000;
    const names = await readdir(this.pagesDir);
    const ids = new Set<string>();
    for (const name of names) {
      const match = name.match(/^([0-9a-f-]{36})\.(?:html|json)$/i);
      if (match) ids.add(match[1]);
    }

    let removed = 0;
    for (const id of ids) {
      const observedTimestamp = await this.pageTimestamp(id);
      if (observedTimestamp === null || observedTimestamp > cutoff) continue;

      const uploadLockPath = this.file(id, "lock");
      const uploadLock = await tryLock(uploadLockPath);
      if (!uploadLock) continue;

      const answerLockPath = this.file(id, "answer.lock");
      let answerLock: FileHandle | null = null;
      try {
        answerLock = await tryLock(answerLockPath);
        if (!answerLock) continue;

        const timestamp = await this.pageTimestamp(id);
        if (timestamp === null || timestamp > cutoff) continue;
        await Promise.all([
          rm(this.file(id, "html"), { force: true }),
          rm(this.file(id, "json"), { force: true }),
        ]);
        removed += 1;
      } finally {
        if (answerLock) {
          await answerLock.close();
          await rm(answerLockPath, { force: true });
        }
        await uploadLock.close();
        await rm(uploadLockPath, { force: true });
      }
    }
    return removed;
  }

  async submitAnswers(id: string, answers: Answers): Promise<PageMetadata> {
    const lockPath = this.file(id, "answer.lock");
    let lock: FileHandle;
    try {
      lock = await open(lockPath, "wx", 0o600);
    } catch (error) {
      if (isCode(error, "EEXIST")) throw new DuplicateAnswerError(id);
      throw error;
    }

    try {
      const metadata = await this.readMetadata(id);
      if (metadata.status === "answered") throw new DuplicateAnswerError(id);
      const answered: PageMetadata = {
        ...metadata,
        status: "answered",
        answeredAt: new Date().toISOString(),
        answers,
      };
      const temporary = this.temporary(id, "json");
      try {
        await writeFile(temporary, `${JSON.stringify(answered, null, 2)}\n`, {
          encoding: "utf8",
          mode: 0o600,
          flag: "wx",
        });
        await rename(temporary, this.file(id, "json"));
      } catch (error) {
        await rm(temporary, { force: true });
        throw error;
      }
      return answered;
    } finally {
      await lock.close();
      await rm(lockPath, { force: true });
    }
  }

  private async pageTimestamp(id: string): Promise<number | null> {
    try {
      const metadata = JSON.parse(await readFile(this.file(id, "json"), "utf8")) as Partial<PageMetadata>;
      if (typeof metadata.createdAt === "string") {
        const createdAt = Date.parse(metadata.createdAt);
        if (Number.isFinite(createdAt)) return createdAt;
      }
    } catch (error) {
      if (!(error instanceof SyntaxError) && !isCode(error, "ENOENT")) throw error;
    }

    const timestamps: number[] = [];
    for (const extension of ["html", "json"]) {
      try {
        timestamps.push((await stat(this.file(id, extension))).mtimeMs);
      } catch (error) {
        if (!isCode(error, "ENOENT")) throw error;
      }
    }
    return timestamps.length === 0 ? null : Math.max(...timestamps);
  }

  private file(id: string, extension: string): string {
    return path.join(this.pagesDir, `${id}.${extension}`);
  }

  private temporary(id: string, extension: string): string {
    return path.join(this.pagesDir, `.${id}.${randomUUID()}.${extension}.tmp`);
  }
}

async function tryLock(file: string): Promise<FileHandle | null> {
  try {
    return await open(file, "wx", 0o600);
  } catch (error) {
    if (isCode(error, "EEXIST")) return null;
    throw error;
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file, constants.F_OK);
    return true;
  } catch (error) {
    if (isCode(error, "ENOENT")) return false;
    throw error;
  }
}

function isCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
