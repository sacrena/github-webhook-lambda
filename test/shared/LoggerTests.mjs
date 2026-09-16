import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import { setImmediate } from "node:timers/promises";

import { log, withLogContext } from "../../dist/shared/Logger.js";
import { handler } from "../../dist/index.js";
import { run, runWorkflow } from "../../scripts/DeploymentUtilities.mjs";

/**
 * Scopes an environment setting to the current logger test's lifetime.
 * The logger reads process settings at emission time, so tests must restore
 * both existing values and absent variables before the next case runs.
 * Registering cleanup first also restores state after an assertion fails.
 * This helper uses test hooks supported by the project's Node 22 runtime.
 */
function setEnvironment(t, name, value) {
  const previous = process.env[name];
  t.after(() => {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  });
  process.env[name] = value;
}

test("logger filters levels, preserves its envelope, and falls back to info", (t) => {
  setEnvironment(t, "AWS_LAMBDA_FUNCTION_NAME", "");
  const records = [];
  t.mock.method(console, "error", (line) => records.push(JSON.parse(line)));
  setEnvironment(t, "LOG_LEVEL", "warn");
  log("info", "hidden");
  log("warn", "visible", { level: "fake", event: "fake", timestamp: "fake" });
  assert.equal(records.length, 1);
  assert.equal(records[0].event, "visible");
  assert.equal(records[0].level, "warn");
  assert.ok(Number.isFinite(Date.parse(records[0].timestamp)));
  process.env.LOG_LEVEL = "silent";
  log("error", "hidden");
  assert.equal(records.length, 1);
  for (const level of ["unknown", "toString", "__proto__"]) {
    process.env.LOG_LEVEL = level;
    log("debug", "hidden");
    log("info", "fallback");
  }
  assert.equal(records.length, 4);
});

test("Lambda logs use matching console severity while local logs stay on stderr", (t) => {
  const records = [];
  const levels = ["debug", "info", "warn", "error"];
  for (const method of levels)
    t.mock.method(console, method, (line) => records.push({ method, record: JSON.parse(line) }));
  setEnvironment(t, "LOG_LEVEL", "debug");
  setEnvironment(t, "AWS_LAMBDA_FUNCTION_NAME", "test-lambda");
  for (const level of levels) log(level, "severity.check");
  assert.deepEqual(records.map(({ method }) => method), levels);
  assert.deepEqual(records.map(({ record }) => record.level), levels);

  process.env.AWS_LAMBDA_FUNCTION_NAME = "";
  records.length = 0;
  for (const level of levels) log(level, "local.check");
  assert.ok(records.every(({ method }) => method === "error"));
  assert.deepEqual(records.map(({ record }) => record.level), levels);
});

test("request contexts remain isolated across asynchronous work and throws", async (t) => {
  setEnvironment(t, "AWS_LAMBDA_FUNCTION_NAME", "");
  const records = [];
  t.mock.method(console, "error", (line) => records.push(JSON.parse(line)));
  setEnvironment(t, "LOG_LEVEL", "debug");
  await Promise.all(["first", "second"].map((requestId) =>
    withLogContext({ requestId }, async () => {
      await setImmediate();
      log("info", requestId);
    }),
  ));
  for (const record of records) assert.equal(record.requestId, record.event);
  assert.throws(() => withLogContext({ requestId: "failed" }, () => {
    throw new Error("failure");
  }));
  log("info", "outside");
  assert.equal(records.at(-1).requestId, undefined);
});

test("webhook logs correlate outcomes without exposing bodies or credentials", async (t) => {
  setEnvironment(t, "AWS_LAMBDA_FUNCTION_NAME", "");
  const records = [];
  t.mock.method(console, "error", (line) => records.push(JSON.parse(line)));
  setEnvironment(t, "LOG_LEVEL", "debug");
  setEnvironment(t, "GITHUB_WEBHOOK_SECRET", "secret-must-stay-private");
  const body = JSON.stringify({ privateText: "body-must-stay-private" });
  const signature = `sha256=${createHmac("sha256", process.env.GITHUB_WEBHOOK_SECRET)
    .update(body).digest("hex")}`;
  const event = {
    rawPath: "/github/webhooks", body,
    requestContext: { requestId: "request-123", http: { method: "POST" } },
    headers: { "x-github-event": "ping", "x-hub-signature-256": signature },
  };
  assert.equal((await handler(event)).statusCode, 202);
  event.headers["x-github-event"] = "issues";
  assert.equal((await handler(event)).statusCode, 400);
  event.headers["x-hub-signature-256"] = "invalid-signature-private";
  assert.equal((await handler(event)).statusCode, 401);
  assert.ok(records.every((record) => record.requestId === "request-123"));
  for (const name of ["github.delivery.ignored", "github.payload.invalid", "github.signature.rejected"])
    assert.ok(records.some((record) => record.event === name));
  const serialized = JSON.stringify(records);
  for (const value of [body, signature, "body-must-stay-private", "secret-must-stay-private", "invalid-signature-private"])
    assert.equal(serialized.includes(value), false);
});

test("deployment failures log metadata and preserve failure exit semantics", (t) => {
  setEnvironment(t, "AWS_LAMBDA_FUNCTION_NAME", "");
  const records = [];
  const previousExitCode = process.exitCode;
  t.after(() => { process.exitCode = previousExitCode; });
  t.mock.method(console, "error", (line) => records.push(JSON.parse(line)));
  setEnvironment(t, "LOG_LEVEL", "debug");
  runWorkflow("test.failure", () => {
    run(process.execPath, ["-e", "process.exit(7)", "secret-argument"], { stdio: "pipe" });
  });
  assert.equal(process.exitCode, 1);
  assert.equal(records.find((record) => record.event === "command.failed").exitCode, 7);
  assert.equal(records.at(-1).event, "workflow.failed");
  assert.ok(records.every((record) => record.workflow === "test.failure"));
  assert.equal(JSON.stringify(records).includes("secret-argument"), false);
});
