#!/usr/bin/env node
import { createServer } from "node:http";
import { loadConfig } from "./config.ts";
import { createHandler } from "./server.ts";
import { PageStorage } from "./storage.ts";

const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1_000;

async function main(): Promise<void> {
  const config = loadConfig();
  let pruneTimer: ReturnType<typeof setInterval> | undefined;
  const pageTtlDays = config.pageTtlDays;
  if (pageTtlDays !== null) {
    const storage = new PageStorage(config.dataDir);
    await storage.initialize();
    const prune = async () => {
      const removed = await storage.pruneExpired(pageTtlDays);
      console.log(`viz-server retention removed ${removed} page(s)`);
    };
    await prune();
    pruneTimer = setInterval(() => {
      void prune().catch((error: unknown) => console.error("viz-server retention failed", error));
    }, PRUNE_INTERVAL_MS);
    pruneTimer.unref();
  }

  const handler = await createHandler(config);
  const server = createServer(handler);

  server.listen(config.port, config.host, () => {
    console.log(`viz-server listening on http://${config.host}:${config.port}`);
  });

  const shutdown = (signal: string) => {
    if (pruneTimer) clearInterval(pruneTimer);
    console.log(`viz-server received ${signal}; shutting down`);
    server.close((error) => {
      if (error) {
        console.error(error);
        process.exitCode = 1;
      }
    });
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((error: unknown) => {
  console.error(`viz-server: ${(error as Error).message}`);
  process.exitCode = 1;
});
