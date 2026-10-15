import type { GenerationPassResult } from "./recurring-generation.js";

export const DEFAULT_RECURRING_GENERATION_INTERVAL_MS = 60_000;

type WorkerLogger = Pick<Console, "info" | "error">;

type WorkerScheduler = {
  setInterval: (callback: () => void, delay: number) => unknown;
  clearInterval: (handle: unknown) => void;
};

type RecurringGenerationWorkerOptions = {
  runPass: () => Promise<GenerationPassResult>;
  intervalMs?: number;
  logger?: WorkerLogger;
  scheduler?: WorkerScheduler;
};

export function parseRecurringGenerationInterval(
  value: string | undefined,
): number {
  if (value === undefined || value.trim() === "") {
    return DEFAULT_RECURRING_GENERATION_INTERVAL_MS;
  }

  const intervalMs = Number(value);
  if (!Number.isSafeInteger(intervalMs) || intervalMs <= 0) {
    throw new RangeError(
      "RECURRING_GENERATION_INTERVAL_MS must be a positive integer",
    );
  }
  return intervalMs;
}

export function startRecurringGenerationWorker({
  runPass,
  intervalMs = DEFAULT_RECURRING_GENERATION_INTERVAL_MS,
  logger = console,
  scheduler = {
    setInterval: (callback, delay) => setInterval(callback, delay),
    clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
  },
}: RecurringGenerationWorkerOptions): () => Promise<void> {
  if (!Number.isSafeInteger(intervalMs) || intervalMs <= 0) {
    throw new RangeError("Recurring generation interval must be a positive integer");
  }

  let stopped = false;
  let activePass: Promise<void> | null = null;

  const run = (): Promise<void> | null => {
    if (stopped || activePass !== null) return activePass;

    const pass = Promise.resolve()
      .then(runPass)
      .then((result) => {
        logger.info(
          `Recurring generation completed: handled=${result.handledDates}, deactivated=${result.deactivatedRules}, issues=${result.issues.length}`,
        );
      })
      .catch(() => {
        logger.error("Recurring generation pass failed");
      });
    activePass = pass;
    void pass.then(() => {
      if (activePass === pass) activePass = null;
    });
    return pass;
  };

  const timer = scheduler.setInterval(() => {
    void run();
  }, intervalMs);
  void run();

  return async () => {
    stopped = true;
    scheduler.clearInterval(timer);
    const pass = activePass;
    if (pass !== null) await pass;
  };
}
