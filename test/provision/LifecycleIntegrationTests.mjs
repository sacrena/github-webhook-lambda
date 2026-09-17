import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { SchedulerClient, CreateScheduleCommand } from "@aws-sdk/client-scheduler";
import { EventBridgeClient } from "@aws-sdk/client-eventbridge";
import { EC2Client, RunInstancesCommand, DescribeInstancesCommand, TerminateInstancesCommand } from "@aws-sdk/client-ec2";
import { handler } from "../../dist/index.js";
import { requestDeadline } from "../../dist/requests/RequestDeadline.js";

test("signed intake, replayed dispatch, provisioning retries and timeout execute through the real service chain", async (t) => {
  const original = { ...process.env };
  t.after(() => { process.env = original; });
  Object.assign(process.env, {
    AWS_REGION: "us-east-1", REQUESTS_TABLE_NAME: "requests", PROVISION_API_KEY: "api-key",
    GITHUB_WEBHOOK_SECRET: "webhook-key", EC2_SECURITY_GROUP_ID: "sg-worker", EVENT_BUS_NAME: "agentic-events",
    TIMEOUT_EVENT_BUS_ARN: "arn:aws:events:us-east-1:123456789012:event-bus/agentic-timeout-events",
    TIMEOUT_SCHEDULER_ROLE_ARN: "arn:aws:iam::123456789012:role/agentic-timeout-scheduler-role",
    TIMEOUT_SCHEDULE_GROUP: "agentic-timeouts", LOG_LEVEL: "silent",
  });
  let stored;
  let worker;
  let allocations = 0;
  let terminations = 0;
  let publicationFails = true;
  const schedules = [];
  const publications = [];
  t.mock.method(DynamoDBDocumentClient.prototype, "send", async (command) => {
    if (command instanceof GetCommand) return { Item: structuredClone(stored) };
    if (command instanceof PutCommand) {
      if (stored) throw Object.assign(new Error("duplicate"), { name: "ConditionalCheckFailedException" });
      stored = structuredClone(command.input.Item);
      return {};
    }
    assert.ok(command instanceof UpdateCommand);
    const values = command.input.ExpressionAttributeValues;
    if (values[":launch"]) stored.resourceLaunch = structuredClone(values[":launch"]);
    else stored.resourceLaunch.instanceId = values[":instanceId"];
    return {};
  });
  t.mock.method(SchedulerClient.prototype, "send", async (command) => {
    assert.ok(command instanceof CreateScheduleCommand);
    schedules.push(command.input);
    return {};
  });
  t.mock.method(EventBridgeClient.prototype, "send", async (command) => {
    if (publicationFails) throw new Error("publication temporarily unavailable");
    publications.push(JSON.parse(command.input.Entries[0].Detail));
    return { Entries: [{ EventId: "event-id" }] };
  });
  t.mock.method(EC2Client.prototype, "send", async (command) => {
    if (command instanceof RunInstancesCommand) {
      allocations++;
      assert.equal(command.input.UserData, undefined);
      assert.equal(command.input.ClientToken, stored.resourceLaunch.token);
      worker = { InstanceId: "i-worker", State: { Name: "pending" }, Tags: command.input.TagSpecifications[0].Tags };
      return { Instances: [worker] };
    }
    if (command instanceof DescribeInstancesCommand) return { Reservations: [{ Instances: [worker] }] };
    assert.ok(command instanceof TerminateInstancesCommand);
    assert.deepEqual(command.input.InstanceIds, ["i-worker"]);
    terminations++;
    worker.State.Name = "shutting-down";
    return {};
  });
  const author = { id: 1, login: "octo" };
  const body = JSON.stringify({
    action: "opened", repository: { id: 2, name: "repo", full_name: "octo/repo", html_url: "https://github.com/octo/repo", private: true },
    sender: author, issue: {
      id: 3, number: 4, title: "Fix", body: "/agent fix", state: "open", html_url: "https://github.com/octo/repo/issues/4",
      user: author, created_at: "2026-01-01", updated_at: "2026-01-01", closed_at: null, labels: [], assignees: [], comments: 0,
    },
  });
  const intake = {
    rawPath: "/github/webhooks", requestContext: { http: { method: "POST" } }, body,
    headers: {
      "x-github-event": "issues", "x-github-delivery": "delivery-1",
      "x-hub-signature-256": `sha256=${createHmac("sha256", "webhook-key").update(body).digest("hex")}`,
    },
  };
  assert.equal((await handler(intake)).statusCode, 500);
  const originalTimestamp = stored.receivedAt;
  publicationFails = false;
  assert.equal((await handler(intake)).statusCode, 202);
  assert.equal(stored.receivedAt, originalTimestamp);
  assert.deepEqual(schedules[0], schedules[1]);
  const provision = {
    rawPath: "/provision", headers: { "x-api-key": "api-key" }, requestContext: { http: { method: "POST" } },
    body: JSON.stringify({ source: "agentic.setup", "detail-type": "ProvisionRequested", detail: publications[0] }),
  };
  assert.equal((await handler(provision)).statusCode, 202);
  assert.equal((await handler(provision)).statusCode, 202);
  assert.equal(allocations, 1);
  assert.equal(stored.resourceLaunch.instanceId, "i-worker");
  const deadline = requestDeadline(stored.receivedAt);
  assert.equal(worker.Tags.find((tag) => tag.Key === "TimeoutAt").Value, deadline);
  assert.equal(schedules[0].ScheduleExpression, `at(${deadline.slice(0, 19)})`);
  assert.equal((await handler(intake)).statusCode, 202);
  assert.equal(publications.at(-1).resourceLaunch, undefined);
  t.mock.method(Date, "now", () => Date.parse(deadline));
  const timeout = {
    ...provision, rawPath: "/timeout",
    body: JSON.stringify({ source: "agentic.setup", "detail-type": "TimeoutRequested", detail: JSON.parse(schedules[0].Target.Input) }),
  };
  assert.equal((await handler(timeout)).statusCode, 202);
  assert.equal(terminations, 1);
  assert.equal(stored.resourceLaunch.status, undefined);
  assert.equal((await handler(provision)).statusCode, 200);
  assert.equal(allocations, 1);
});
