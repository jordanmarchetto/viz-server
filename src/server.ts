import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, RequestListener, ServerResponse } from "node:http";
import type { Config } from "./config.ts";
import {
  DuplicateAnswerError,
  DuplicatePageError,
  MissingPageError,
  PageStorage,
  type Answers,
} from "./storage.ts";
import { AnswerWaiters } from "./waiters.ts";

const PROTOCOL_VERSION = 1;
const PAGE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_ANSWER_COUNT = 100;
const MAX_ANSWER_ID_LENGTH = 128;

class BodyTooLargeError extends Error {}
class InvalidAnswersError extends Error {}

export async function createHandler(config: Config): Promise<RequestListener> {
  const storage = new PageStorage(config.dataDir);
  const waiters = new AnswerWaiters();
  await storage.initialize();

  return (request, response) => {
    void handle(request, response, config, storage, waiters).catch((error: unknown) => {
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
  waiters: AnswerWaiters,
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://localhost");

  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, { status: "ok", protocolVersion: PROTOCOL_VERSION });
    return;
  }

  const answerRoute = url.pathname.match(/^\/api\/pages\/([^/]+)\/answers$/);
  if (request.method === "POST" && answerRoute) {
    const id = answerRoute[1];
    if (!validPageId(id, response)) return;
    if (!isContentType(request.headers["content-type"], "application/json")) {
      sendJson(response, 415, { error: "content-type must be application/json" });
      return;
    }

    let answers: Answers;
    try {
      answers = parseAnswers(await readBody(request, config.maxAnswerBytes));
    } catch (error) {
      if (error instanceof BodyTooLargeError) {
        sendJson(response, 413, { error: `answers exceed ${config.maxAnswerBytes} bytes` });
        return;
      }
      if (error instanceof InvalidAnswersError) {
        sendJson(response, 400, { error: error.message });
        return;
      }
      throw error;
    }

    try {
      await storage.submitAnswers(id, answers);
    } catch (error) {
      if (error instanceof MissingPageError) {
        sendJson(response, 404, { error: "page not found" });
        return;
      }
      if (error instanceof DuplicateAnswerError) {
        sendJson(response, 409, { error: "answers already submitted" });
        return;
      }
      throw error;
    }

    waiters.notify(id, answers);
    sendJson(response, 200, { status: "accepted" });
    return;
  }

  const resultRoute = url.pathname.match(/^\/api\/pages\/([^/]+)\/result$/);
  if (request.method === "GET" && resultRoute) {
    if (!requireAuthorization(request, response, config.token)) return;
    const id = resultRoute[1];
    if (!validPageId(id, response)) return;

    // Subscribe before reading durable state. If an answer lands between these
    // operations, either the metadata read sees it or the subscription does.
    const subscription = waiters.subscribe(id, config.resultWaitMs);
    const cancelOnDisconnect = () => subscription.cancel();
    response.once("close", cancelOnDisconnect);
    try {
      const metadata = await storage.readMetadata(id);
      if (metadata.answers) {
        subscription.cancel();
        sendJson(response, 200, { answers: metadata.answers });
        return;
      }

      const answers = await subscription.promise;
      if (response.destroyed) return;
      if (answers) sendJson(response, 200, { answers });
      else response.writeHead(204).end();
    } catch (error) {
      subscription.cancel();
      if (error instanceof MissingPageError) {
        sendJson(response, 404, { error: "page not found" });
        return;
      }
      throw error;
    } finally {
      response.off("close", cancelOnDisconnect);
    }
    return;
  }

  const upload = url.pathname.match(/^\/api\/pages\/([^/]+)$/);
  if (request.method === "PUT" && upload) {
    if (!requireAuthorization(request, response, config.token)) return;

    const id = upload[1];
    if (!validPageId(id, response)) return;
    if (!isContentType(request.headers["content-type"], "text/html")) {
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

function requireAuthorization(
  request: IncomingMessage,
  response: ServerResponse,
  expectedToken: string,
): boolean {
  const authorization = request.headers.authorization;
  if (authorization?.startsWith("Bearer ")) {
    const provided = Buffer.from(authorization.slice("Bearer ".length));
    const expected = Buffer.from(expectedToken);
    if (provided.length === expected.length && timingSafeEqual(provided, expected)) return true;
  }
  response.setHeader("WWW-Authenticate", "Bearer");
  sendJson(response, 401, { error: "unauthorized" });
  return false;
}

function validPageId(id: string, response: ServerResponse): boolean {
  if (PAGE_ID.test(id)) return true;
  sendJson(response, 400, { error: "page ID must be a UUID v4" });
  return false;
}

function isContentType(contentType: string | string[] | undefined, expected: string): boolean {
  if (typeof contentType !== "string") return false;
  return contentType.split(";", 1)[0].trim().toLowerCase() === expected;
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

function parseAnswers(text: string): Answers {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new InvalidAnswersError("body must be valid JSON");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body) || !("answers" in body)) {
    throw new InvalidAnswersError("body must contain an answers object");
  }
  const raw = body.answers;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new InvalidAnswersError("answers must be an object of string values");
  }
  const entries = Object.entries(raw);
  if (entries.length === 0 || entries.length > MAX_ANSWER_COUNT) {
    throw new InvalidAnswersError(`answers must contain between 1 and ${MAX_ANSWER_COUNT} entries`);
  }
  for (const [id, value] of entries) {
    if (!id.trim() || id.length > MAX_ANSWER_ID_LENGTH || typeof value !== "string" || !value.trim()) {
      throw new InvalidAnswersError("answer IDs and values must be non-empty strings");
    }
  }
  // Object.fromEntries creates data properties even for names such as
  // "__proto__", rather than invoking Object.prototype setters.
  return Object.fromEntries(entries) as Answers;
}

function sendJson(response: ServerResponse, status: number, body: object): void {
  const json = `${JSON.stringify(body)}\n`;
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(json),
    "X-Content-Type-Options": "nosniff",
  }).end(json);
}
