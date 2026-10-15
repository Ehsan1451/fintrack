import type { Server } from "node:http";

type GracefulShutdownOptions = {
  stopWorker: () => Promise<void>;
  closeServer: () => Promise<void>;
  disconnectPrisma: () => Promise<void>;
  logger?: Pick<Console, "error">;
};

export function createGracefulShutdown({
  stopWorker,
  closeServer,
  disconnectPrisma,
  logger = console,
}: GracefulShutdownOptions): () => Promise<void> {
  let shutdownPromise: Promise<void> | null = null;

  return () => {
    if (shutdownPromise !== null) return shutdownPromise;

    shutdownPromise = Promise.resolve().then(async () => {
      const steps: Array<[string, () => Promise<void>]> = [
        ["Recurring worker stop", stopWorker],
        ["HTTP server close", closeServer],
        ["Prisma disconnect", disconnectPrisma],
      ];

      for (const [name, operation] of steps) {
        try {
          await operation();
        } catch {
          logger.error(`${name} failed during graceful shutdown`);
        }
      }
    });
    return shutdownPromise;
  };
}

export function closeHttpServer(
  httpServer: Server,
  startupFailed: boolean,
  alreadyClosed = false,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!httpServer.listening && (startupFailed || alreadyClosed)) {
      resolve();
      return;
    }

    let settled = false;
    const removeListeners = () => {
      httpServer.off("listening", onListening);
      httpServer.off("error", onError);
      httpServer.off("close", onClose);
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      removeListeners();
      if (error) reject(error);
      else resolve();
    };
    const onClose = () => finish();
    const onError = (error: Error) => finish(error);
    const close = () => {
      httpServer.close((error) => finish(error));
    };
    const onListening = () => {
      if (httpServer.listening) close();
      else finish();
    };

    if (httpServer.listening) close();
    else {
      httpServer.once("listening", onListening);
      httpServer.once("error", onError);
      httpServer.once("close", onClose);
      if (startupFailed) finish();
    }
  });
}

export function handleHttpServerFailure(
  error: { code?: unknown },
  isStartupFailure: boolean,
  shutdown: () => Promise<void>,
  logger: Pick<Console, "error"> = console,
  setExitCode: (code: number) => void = (code) => {
    process.exitCode = code;
  },
): Promise<void> {
  const code =
    typeof error.code === "string" && /^[A-Z0-9_]+$/.test(error.code)
      ? error.code
      : "unknown";
  const failureType = isStartupFailure ? "startup" : "runtime";
  logger.error(`FinTrack HTTP server ${failureType} failure (code=${code})`);

  return shutdown().then(
    () => setExitCode(1),
    () => setExitCode(1),
  );
}
