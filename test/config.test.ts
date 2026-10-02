import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { loadConfig } from "../src/config.ts";

const REQUIRED = {
  PUBLIC_BASE_URL: "https://viz.example.test/",
  VIZ_TOKEN: "a-secret-with-16-characters",
};

describe("configuration", () => {
  test("loads defaults and normalizes the public URL", () => {
    assert.deepEqual(loadConfig(REQUIRED), {
      host: "0.0.0.0",
      port: 5008,
      publicBaseUrl: "https://viz.example.test",
      token: REQUIRED.VIZ_TOKEN,
      dataDir: "/data",
      maxPageBytes: 2 * 1024 * 1024,
      maxAnswerBytes: 64 * 1024,
      resultWaitMs: 25_000,
    });
  });

  test("loads supported overrides", () => {
    const config = loadConfig({
      ...REQUIRED,
      HOST: "127.0.0.1",
      PORT: "9000",
      DATA_DIR: "/tmp/viz",
      MAX_PAGE_BYTES: "4096",
      MAX_ANSWER_BYTES: "2048",
      RESULT_WAIT_MS: "30000",
    });
    assert.equal(config.host, "127.0.0.1");
    assert.equal(config.port, 9000);
    assert.equal(config.dataDir, "/tmp/viz");
    assert.equal(config.maxPageBytes, 4096);
    assert.equal(config.maxAnswerBytes, 2048);
    assert.equal(config.resultWaitMs, 30_000);
  });

  test("rejects missing secrets and invalid URLs or numbers", () => {
    assert.throws(() => loadConfig({ PUBLIC_BASE_URL: REQUIRED.PUBLIC_BASE_URL }), /VIZ_TOKEN is required/);
    assert.throws(() => loadConfig({ VIZ_TOKEN: REQUIRED.VIZ_TOKEN }), /PUBLIC_BASE_URL is required/);
    assert.throws(() => loadConfig({ ...REQUIRED, PUBLIC_BASE_URL: "file:///tmp" }), /HTTP or HTTPS/);
    assert.throws(() => loadConfig({ ...REQUIRED, PORT: "70000" }), /at most 65535/);
    assert.throws(() => loadConfig({ ...REQUIRED, MAX_PAGE_BYTES: "nope" }), /positive integer/);
    assert.throws(() => loadConfig({ ...REQUIRED, MAX_ANSWER_BYTES: "0" }), /positive integer/);
    assert.throws(() => loadConfig({ ...REQUIRED, RESULT_WAIT_MS: "nope" }), /positive integer/);
    assert.throws(() => loadConfig({ ...REQUIRED, VIZ_TOKEN: "too-short" }), /at least 16/);
  });
});
