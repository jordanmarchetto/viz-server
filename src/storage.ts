import { constants } from "node:fs";
import { access, mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { FileHandle } from "node:fs/promises";

export interface PageMetadata {
  id: string;
  createdAt: string;
  status: "waiting";
  answeredAt: null;
  answers: null;
}

export class DuplicatePageError extends Error {}
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

  private file(id: string, extension: string): string {
    return path.join(this.pagesDir, `${id}.${extension}`);
  }

  private temporary(id: string, extension: string): string {
    return path.join(this.pagesDir, `.${id}.${randomUUID()}.${extension}.tmp`);
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
