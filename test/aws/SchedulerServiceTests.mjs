import assert from "node:assert/strict";
import test from "node:test";
import { CreateScheduleCommand, GetScheduleCommand, SchedulerClient } from "@aws-sdk/client-scheduler";
import { SchedulerService } from "../../dist/aws/SchedulerService.js";

const detail = { deliveryId: "delivery-1", receivedAt: "2026-09-16T23:45:00.250Z" };

test.beforeEach((t) => {
  const original = { ...process.env };
  t.after(() => { process.env = original; });
  process.env.TIMEOUT_EVENT_BUS_ARN = "arn:aws:events:us-east-1:123456789012:event-bus/agentic-timeout-events";
  process.env.TIMEOUT_SCHEDULER_ROLE_ARN = "arn:aws:iam::123456789012:role/agentic-timeout-scheduler-role";
  process.env.TIMEOUT_SCHEDULE_GROUP = "agentic-timeouts";
  t.mock.method(Date, "now", () => Date.parse("2026-09-16T23:46:00Z"));
});

test("timeout retries retain the original deadline, input, schedule name and client token", async (t) => {
  const inputs = [];
  t.mock.method(SchedulerClient.prototype, "send", async (command) => {
    assert.ok(command instanceof CreateScheduleCommand);
    inputs.push(command.input);
    return {};
  });
  await SchedulerService.scheduleTimeout(detail);
  t.mock.method(Date, "now", () => Date.parse("2026-09-16T23:59:00Z"));
  await SchedulerService.scheduleTimeout(detail);
  assert.deepEqual(inputs[0], inputs[1]);
  const { Name, ClientToken, ...input } = inputs[0];
  assert.match(Name, /^timeout-[a-f0-9]{48}$/);
  assert.match(ClientToken, /^[a-f0-9]{64}$/);
  assert.deepEqual(input, {
    GroupName: "agentic-timeouts", ScheduleExpression: "at(2026-09-17T00:15:01)",
    ScheduleExpressionTimezone: "UTC", FlexibleTimeWindow: { Mode: "OFF" }, ActionAfterCompletion: "DELETE",
    Target: {
      Arn: process.env.TIMEOUT_EVENT_BUS_ARN, RoleArn: process.env.TIMEOUT_SCHEDULER_ROLE_ARN,
      Input: JSON.stringify(detail), EventBridgeParameters: { Source: "agentic.setup", DetailType: "TimeoutRequested" },
    },
  });
});

test("schedule conflicts are accepted only after verifying the existing schedule contract", async (t) => {
  let saved;
  let mismatch = false;
  t.mock.method(SchedulerClient.prototype, "send", async (command) => {
    if (command instanceof CreateScheduleCommand) {
      saved = { ...command.input, State: "ENABLED" };
      throw Object.assign(new Error("already exists"), { name: "ConflictException" });
    }
    assert.ok(command instanceof GetScheduleCommand);
    assert.equal(command.input.Name, saved.Name);
    return mismatch ? { ...saved, State: "DISABLED" } : saved;
  });
  await SchedulerService.scheduleTimeout(detail);
  mismatch = true;
  await assert.rejects(SchedulerService.scheduleTimeout(detail), /does not match/);
});

test("timeout rejects invalid input/configuration and propagates service failures", async (t) => {
  const send = t.mock.method(SchedulerClient.prototype, "send", async () => { throw new Error("Scheduler unavailable"); });
  for (const key of ["TIMEOUT_EVENT_BUS_ARN", "TIMEOUT_SCHEDULER_ROLE_ARN", "TIMEOUT_SCHEDULE_GROUP"]) {
    const value = process.env[key];
    process.env[key] = " ";
    await assert.rejects(SchedulerService.scheduleTimeout(detail), /configuration is required/);
    process.env[key] = value;
  }
  await assert.rejects(SchedulerService.scheduleTimeout({}), /identity and timestamp/);
  await assert.rejects(SchedulerService.scheduleTimeout({ ...detail, receivedAt: "bad" }), /timestamp/);
  await SchedulerService.scheduleTimeout({ ...detail, receivedAt: "2020-01-01" });
  assert.equal(send.mock.callCount(), 0);
  await assert.rejects(SchedulerService.scheduleTimeout(detail), /Scheduler unavailable/);
});
