export interface Config {
  host: string;
  port: number;
  publicBaseUrl: string;
  token: string;
  dataDir: string;
  maxPageBytes: number;
}

const DEFAULT_PORT = 5008;
const DEFAULT_MAX_PAGE_BYTES = 2 * 1024 * 1024;

function positiveInteger(value: string | undefined, name: string, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function required(value: string | undefined, name: string): string {
  if (!value?.trim()) throw new Error(`${name} is required`);
  return value.trim();
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = positiveInteger(env.PORT, "PORT", DEFAULT_PORT);
  if (port > 65_535) throw new Error("PORT must be at most 65535");

  const publicBaseUrl = required(env.PUBLIC_BASE_URL, "PUBLIC_BASE_URL").replace(/\/+$/, "");
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(publicBaseUrl);
  } catch {
    throw new Error("PUBLIC_BASE_URL must be an absolute HTTP or HTTPS URL");
  }
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error("PUBLIC_BASE_URL must be an absolute HTTP or HTTPS URL");
  }

  const token = required(env.VIZ_TOKEN, "VIZ_TOKEN");
  if (token.length < 16) throw new Error("VIZ_TOKEN must contain at least 16 characters");

  return {
    host: env.HOST?.trim() || "0.0.0.0",
    port,
    publicBaseUrl,
    token,
    dataDir: env.DATA_DIR?.trim() || "/data",
    maxPageBytes: positiveInteger(env.MAX_PAGE_BYTES, "MAX_PAGE_BYTES", DEFAULT_MAX_PAGE_BYTES),
  };
}
