import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, RequestListener, ServerResponse } from "node:http";
import type { Config } from "./config.ts";
import { DuplicatePageError, MissingPageError, PageStorage } from "./storage.ts";

const PROTOCOL_VERSION = 1;
const PAGE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class BodyTooLargeError extends Error {}

export async function createHandler(config: Config): Promise<RequestListener> {
  const storage = new PageStorage(config.dataDir);
  await storage.initialize();

  return (request, response) => {
    void handle(request, response, config, storage).catch((error: unknown) => {
      console.error("viz-server request failed", error);
      if (!response.headersSent) sendJson(response, 500, { error: "internal server error" });
      else response.destroy();
    });
  };
}

async function handle(
  request: IncomingMessage,
  response: ServerResponse,
  config: Config,
  storage: PageStorage,
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://localhost");

  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, { status: "ok", protocolVersion: PROTOCOL_VERSION });
    return;
  }

  const upload = url.pathname.match(/^\/api\/pages\/([^/]+)$/);
  if (request.method === "PUT" && upload) {
    if (!authorized(request, config.token)) {
      response.setHeader("WWW-Authenticate", "Bearer");
      sendJson(response, 401, { error: "unauthorized" });
      return;
    }

    const id = upload[1];
    if (!PAGE_ID.test(id)) {
      sendJson(response, 400, { error: "page ID must be a UUID v4" });
      return;
    }
    if (!isHtml(request.headers["content-type"])) {
      sendJson(response, 415, { error: "content-type must be text/html" });
      return;
    }

    let html: string;
    try {
      html = await readBody(request, config.maxPageBytes);
    } catch (error) {
      if (error instanceof BodyTooLargeError) {
        sendJson(response, 413, { error: `page exceeds ${config.maxPageBytes} bytes` });
        return;
      }
      throw error;
    }

    try {
      await storage.create(id, html);
    } catch (error) {
      if (error instanceof DuplicatePageError) {
        sendJson(response, 409, { error: "page already exists" });
        return;
      }
      throw error;
    }

    sendJson(response, 201, {
      id,
      url: `${config.publicBaseUrl}/pages/${id}`,
    });
    return;
  }

  const page = url.pathname.match(/^\/pages\/([^/]+)$/);
  if (request.method === "GET" && page) {
    const id = page[1];
    if (!PAGE_ID.test(id)) {
      sendJson(response, 404, { error: "page not found" });
      return;
    }
    try {
      const html = await storage.readHtml(id);
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Length": Buffer.byteLength(html),
        "X-Content-Type-Options": "nosniff",
      }).end(html);
    } catch (error) {
      if (error instanceof MissingPageError) {
        sendJson(response, 404, { error: "page not found" });
        return;
      }
      throw error;
    }
    return;
  }

  sendJson(response, 404, { error: "not found" });
}

function authorized(request: IncomingMessage, expectedToken: string): boolean {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) return false;
  const provided = Buffer.from(authorization.slice("Bearer ".length));
  const expected = Buffer.from(expectedToken);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

function isHtml(contentType: string | string[] | undefined): boolean {
  if (typeof contentType !== "string") return false;
  return contentType.split(";", 1)[0].trim().toLowerCase() === "text/html";
}

async function readBody(request: IncomingMessage, maxBytes: number): Promise<string> {
  const declaredLength = Number(request.headers["content-length"]);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    request.resume();
    throw new BodyTooLargeError();
  }

  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > maxBytes) throw new BodyTooLargeError();
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function sendJson(response: ServerResponse, status: number, body: object): void {
  const json = `${JSON.stringify(body)}\n`;
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(json),
    "X-Content-Type-Options": "nosniff",
  }).end(json);
}
