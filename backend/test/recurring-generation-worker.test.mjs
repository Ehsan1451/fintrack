import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_RECURRING_GENERATION_INTERVAL_MS,
  parseRecurringGenerationInterval,
  startRecurringGenerationWorker,
} from "../src/services/recurring-generation-worker.ts";
import {
  closeHttpServer,
  createGracefulShutdown,
  handleHttpServerFailure,
} from "../src/services/server-shutdown.ts";
import { EventEmitter } from "node:events";

function makeResult(overrides = {}) {
  return {
    handledDates: 0,
    deactivatedRules: 0,
    issues: [],
    continuationCursor: null,
    ...overrides,
  };
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createScheduler() {
  let callback;
  const state = { intervalMs: null, cleared: false };
  return {
    state,
    scheduler: {
      setInterval(run, intervalMs) {
        callback = run;
        state.intervalMs = intervalMs;
        return "worker-timer";
      },
      clearInterval(handle) {
        assert.equal(handle, "worker-timer");
        state.cleared = true;
      },
    },
    tick() {
      callback();
    },
  };
}

test("uses a safe default interval and rejects invalid configuration", () => {
  assert.equal(parseRecurringGenerationInterval(undefined), 60_000);
  assert.equal(parseRecurringGenerationInterval(""), 60_000);
  assert.equal(parseRecurringGenerationInterval("2500"), 2500);
  assert.throws(() => parseRecurringGenerationInterval("0"), RangeError);
  assert.throws(() => parseRecurringGenerationInterval("-1"), RangeError);
  assert.throws(() => parseRecurringGenerationInterval("invalid"), RangeError);
  assert.equal(DEFAULT_RECURRING_GENERATION_INTERVAL_MS, 60_000);
});

test("runs immediately, prevents overlap, and awaits the active pass when stopped", async () => {
  const deferredPass = createDeferred();
  const passStarted = createDeferred();
  const { scheduler, state, tick } = createScheduler();
  const messages = [];
  let passCount = 0;
  const stop = startRecurringGenerationWorker({
    intervalMs: 2500,
    scheduler,
    logger: {
      info: (message) => messages.push(message),
      error: (message) => messages.push(message),
    },
    runPass: () => {
      passCount += 1;
      passStarted.resolve();
      return deferredPass.promise;
    },
  });

  await passStarted.promise;
  tick();
  assert.equal(passCount, 1);
  assert.equal(state.intervalMs, 2500);

  let stopped = false;
  const stopping = stop().then(() => {
    stopped = true;
  });
  tick();
  assert.equal(passCount, 1);
  assert.equal(state.cleared, true);
  assert.equal(stopped, false);

  deferredPass.resolve(makeResult({ handledDates: 1 }));
  await stopping;
  tick();
  assert.equal(passCount, 1);
  assert.equal(stopped, true);
  assert.match(messages[0], /handled=1/);
});

test("a failed pass is logged safely and later scheduled passes continue", async () => {
  const { scheduler, tick } = createScheduler();
  const errors = [];
  let passCount = 0;
  const stop = startRecurringGenerationWorker({
    scheduler,
    logger: { info() {}, error: (message) => errors.push(message) },
    runPass: async () => {
      passCount += 1;
      if (passCount === 1) throw new Error("sensitive detail must not be logged");
      return makeResult({ handledDates: 2 });
    },
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(passCount, 1);
  assert.deepEqual(errors, ["Recurring generation pass failed"]);

  tick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(passCount, 2);
  await stop();
});

test("graceful shutdown stops worker before server and Prisma, once", async () => {
  const order = [];
  const shutdown = createGracefulShutdown({
    stopWorker: async () => order.push("worker"),
    closeServer: async () => order.push("server"),
    disconnectPrisma: async () => order.push("prisma"),
    logger: { error: () => assert.fail("unexpected shutdown failure") },
  });

  await Promise.all([shutdown(), shutdown()]);
  assert.deepEqual(order, ["worker", "server", "prisma"]);
});

test("graceful shutdown continues cleanup after a shutdown step fails", async () => {
  const order = [];
  const errors = [];
  const shutdown = createGracefulShutdown({
    stopWorker: async () => {
      order.push("worker");
      throw new Error("sensitive detail must not be logged");
    },
    closeServer: async () => order.push("server"),
    disconnectPrisma: async () => order.push("prisma"),
    logger: { error: (message) => errors.push(message) },
  });

  await shutdown();
  assert.deepEqual(order, ["worker", "server", "prisma"]);
  assert.deepEqual(errors, ["Recurring worker stop failed during graceful shutdown"]);
});

test("HTTP startup failure logs only a safe code and exits after shutdown", async () => {
  const events = [];
  let resolveShutdown;
  const shutdownFinished = new Promise((resolve) => {
    resolveShutdown = resolve;
  });
  const shutdown = async () => {
    events.push("shutdown-started");
    await shutdownFinished;
    events.push("shutdown-finished");
  };
  const failure = handleHttpServerFailure(
    {
      code: "EADDRINUSE",
      message: "sensitive details must not be logged",
    },
    true,
    shutdown,
    { error: (message) => events.push(message) },
    (code) => events.push(`exit=${code}`),
  );

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, [
    "FinTrack HTTP server startup failure (code=EADDRINUSE)",
    "shutdown-started",
  ]);
  resolveShutdown();
  await failure;
  assert.deepEqual(events, [
    "FinTrack HTTP server startup failure (code=EADDRINUSE)",
    "shutdown-started",
    "shutdown-finished",
    "exit=1",
  ]);
});

test("HTTP server failure omits unsafe error codes", async () => {
  const events = [];
  await handleHttpServerFailure(
    { code: "secret token" },
    false,
    async () => {},
    { error: (message) => events.push(message) },
    (code) => events.push(`exit=${code}`),
  );
  assert.deepEqual(events, [
    "FinTrack HTTP server runtime failure (code=unknown)",
    "exit=1",
  ]);
});

test("HTTP close wait settles when the server closes before listening", async () => {
  const server = new EventEmitter();
  server.listening = false;
  server.close = () => {
    throw new Error("close must not be called before the server listens");
  };

  const closed = closeHttpServer(server, false);
  server.emit("close");
  await closed;

  assert.equal(server.listenerCount("listening"), 0);
  assert.equal(server.listenerCount("error"), 0);
  assert.equal(server.listenerCount("close"), 0);
});

test("HTTP close wait settles on a pending startup failure", async () => {
  const server = new EventEmitter();
  server.listening = false;
  server.close = () => {
    throw new Error("close must not be called before the server listens");
  };

  const closing = closeHttpServer(server, false);
  const error = new Error("bind failure");
  server.emit("error", error);
  await assert.rejects(closing, (caught) => caught === error);

  assert.equal(server.listenerCount("listening"), 0);
  assert.equal(server.listenerCount("error"), 0);
  assert.equal(server.listenerCount("close"), 0);
});
