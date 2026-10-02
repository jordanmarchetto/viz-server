#!/usr/bin/env node
import { createServer } from "node:http";
import { loadConfig } from "./config.ts";
import { createHandler } from "./server.ts";

async function main(): Promise<void> {
  const config = loadConfig();
  const handler = await createHandler(config);
  const server = createServer(handler);

  server.listen(config.port, config.host, () => {
    console.log(`viz-server listening on http://${config.host}:${config.port}`);
  });

  const shutdown = (signal: string) => {
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
