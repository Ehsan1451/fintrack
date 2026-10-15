import app from "./server.js";
import prisma from "./prisma.js";
import { generateRecurringTransactionsPass } from "./services/recurring-generation.js";
import {
  parseRecurringGenerationInterval,
  startRecurringGenerationWorker,
} from "./services/recurring-generation-worker.js";
import {
  closeHttpServer,
  createGracefulShutdown,
  handleHttpServerFailure,
} from "./services/server-shutdown.js";

const port = Number(process.env.PORT) || 5000;
const intervalMs = parseRecurringGenerationInterval(
  process.env.RECURRING_GENERATION_INTERVAL_MS,
);
let stopWorker = async (): Promise<void> => {};
let shutdownRequested = false;
let serverStartupFailed = false;
let serverClosed = false;
let continuationCursor: string | null = null;
const server = app.listen(port);

server.once("close", () => {
  serverClosed = true;
});

server.once("listening", () => {
  if (shutdownRequested) return;
  console.info(`FinTrack API listening on port ${port}`);

  stopWorker = startRecurringGenerationWorker({
    intervalMs,
    runPass: async () => {
      const result = await generateRecurringTransactionsPass(
        prisma,
        new Date(),
        continuationCursor,
      );
      continuationCursor = result.continuationCursor;
      return result;
    },
  });
});

const shutdown = createGracefulShutdown({
  stopWorker: async () => {
    shutdownRequested = true;
    await stopWorker();
  },
  closeServer: () =>
    closeHttpServer(server, serverStartupFailed, serverClosed),
  disconnectPrisma: () => prisma.$disconnect(),
});

server.on("error", (error: NodeJS.ErrnoException) => {
  const isStartupFailure = !server.listening;
  shutdownRequested = true;
  if (isStartupFailure) serverStartupFailed = true;
  void handleHttpServerFailure(error, isStartupFailure, shutdown);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    shutdownRequested = true;
    console.info(`Received ${signal}; shutting down`);
    void shutdown();
  });
}
