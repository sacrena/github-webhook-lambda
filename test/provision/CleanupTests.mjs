import assert from "node:assert/strict";
import test from "node:test";
import { EC2Client, DescribeInstancesCommand, TerminateInstancesCommand } from "@aws-sdk/client-ec2";
import { EC2Service } from "../../dist/aws/EC2Service.js";
import { InstanceJournal } from "../../dist/provision/InstanceJournal.js";
import { handler } from "../../dist/index.js";
import {
  EC2_DELIVERY_ID_TAG_KEY, EC2_LAUNCH_REQUEST_ID_TAG_KEY,
  EC2_MANAGEMENT_TAG_KEY, EC2_MANAGEMENT_TAG_VALUE,
  EC2_TIMEOUT_AT_TAG_KEY,
} from "../../dist/provision/ProvisioningConstants.js";

/**
 * Builds an EC2 observation with the ownership metadata written at launch.
 * Cleanup tests vary deadlines, state, and tags to distinguish eligible
 * workers from instances that must be retained. Fixture identifiers also
 * serve as delivery identifiers so journal lookups are easy to correlate.
 * The returned object models AWS data rather than an HTTP request body.
 */
function worker(id, timeout = "2020-01-01T00:00:00Z", state = "running") {
  return {
    InstanceId: id, State: { Name: state },
    Tags: [
      { Key: EC2_MANAGEMENT_TAG_KEY, Value: EC2_MANAGEMENT_TAG_VALUE }, { Key: EC2_DELIVERY_ID_TAG_KEY, Value: id },
      { Key: EC2_LAUNCH_REQUEST_ID_TAG_KEY, Value: "launch-token" }, { Key: EC2_TIMEOUT_AT_TAG_KEY, Value: timeout },
    ],
    BlockDeviceMappings: [{ Ebs: { VolumeId: `vol-${id}` } }],
  };
}

test.beforeEach((t) => {
  const original = { ...process.env };
  t.after(() => { process.env = original; });
  process.env.AWS_REGION = "us-east-1";
  process.env.REQUESTS_TABLE_NAME = "requests";
  process.env.PROVISION_API_KEY = "test-key";
});

test("cleanup paginates, rechecks expiry, cleans stopped orphans, and continues after failures", async (t) => {
  const expired = worker("expired");
  const orphan = worker("orphan", undefined, "stopped");
  const extended = worker("extended");
  const foreign = worker("foreign");
  foreign.Tags[0].Value = "another-system";
  const missing = worker("missing");
  missing.Tags = missing.Tags.filter((tag) => tag.Key !== EC2_DELIVERY_ID_TAG_KEY);
  const terminated = [];
  const pages = [];
  const records = [];

  t.mock.method(InstanceJournal, "get", async (id) => {
    if (id === "orphan") throw new Error("journal missing");
    return { deliveryId: id, token: "launch-token" };
  });
  t.mock.method(InstanceJournal, "record", async (id, table, resource) => { records.push({ id, table, resource }); });
  t.mock.method(EC2Client.prototype, "send", async (command) => {
    if (command instanceof TerminateInstancesCommand) {
      const id = command.input.InstanceIds[0];
      if (id === "failure") throw new Error("temporary EC2 error");
      terminated.push(id);
      return {};
    }
    assert.ok(command instanceof DescribeInstancesCommand);
    const id = command.input.InstanceIds?.[0];
    if (id) return { Reservations: [{ Instances: [id === "extended"
      ? worker(id, "2099-01-01T00:00:00Z") : worker(id)] }] };

    assert.deepEqual(command.input.Filters[0], {
      Name: `tag:${EC2_MANAGEMENT_TAG_KEY}`, Values: [EC2_MANAGEMENT_TAG_VALUE],
    });
    assert.ok(command.input.Filters[1].Values.includes("stopped"));
    pages.push(command.input.NextToken);
    return command.input.NextToken
      ? { Reservations: [{ Instances: [worker("failure"), orphan, expired] }] }
      : { NextToken: "second", Reservations: [{ Instances: [
        expired, worker("future", "2099-01-01T00:00:00Z"), worker("invalid", "bad-date"),
        foreign, missing, extended,
      ] }] };
  });

  const result = await EC2Service.cleanupExpiredInstances();
  assert.deepEqual(pages, [undefined, "second"]);
  assert.deepEqual(terminated, ["expired", "orphan"]);
  assert.deepEqual(result.failed, ["failure"]);
  assert.deepEqual(result.trackingFailed, ["orphan"]);
  assert.deepEqual(result.skipped, ["future", "invalid", "foreign", "missing", "extended"]);
  assert.equal(records[0].resource.status, "termination_requested");
  assert.equal(records[0].resource.resourceId, "expired");
  assert.deepEqual(result.queryFailed, []);
});

test("instance discovery failures return partial results without attachment scans", async (t) => {
  const calls = t.mock.method(EC2Client.prototype, "send", async () => { throw new Error("query unavailable"); });
  const response = await handler({
    rawPath: "/cleanup", headers: { "X-Api-Key": "test-key" }, requestContext: { http: { method: "POST" } },
  });
  assert.equal(response.statusCode, 500);
  assert.deepEqual(JSON.parse(response.body), {
    terminationRequested: [], skipped: [], failed: [], trackingFailed: [], queryFailed: ["instances"],
  });
  assert.equal(calls.mock.callCount(), 1);
  assert.ok(calls.mock.calls[0].arguments[0] instanceof DescribeInstancesCommand);
});

test("cleanup endpoint authenticates before querying and ignores caller resource selectors", async (t) => {
  const result = {
    terminationRequested: ["i-expired"], skipped: [], failed: [], trackingFailed: [],
    queryFailed: [],
  };
  const cleanup = t.mock.method(EC2Service, "cleanupExpiredInstances", async () => result);
  const event = { rawPath: "/cleanup", requestContext: { http: { method: "POST" } },
    body: '{"instanceId":"i-unmanaged","timeoutAt":"2000-01-01"}', headers: {} };
  assert.equal((await handler(event)).statusCode, 401);
  assert.equal(cleanup.mock.callCount(), 0);
  event.headers["X-Api-Key"] = "test-key";
  const response = await handler(event);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), result);
  assert.deepEqual(cleanup.mock.calls[0].arguments, []);
  result.failed.push("i-failed");
  assert.equal((await handler(event)).statusCode, 500);
  event.requestContext.http.method = "GET";
  assert.equal((await handler(event)).statusCode, 404);
});

test("timeout cleanup still terminates when journal lookup fails", async (t) => {
  const expired = worker("expired");
  t.mock.method(InstanceJournal, "get", async () => { throw new Error("database unavailable"); });
  const terminated = [];
  t.mock.method(EC2Client.prototype, "send", async (command) => {
    if (command instanceof TerminateInstancesCommand) {
      terminated.push(...command.input.InstanceIds);
      return {};
    }
    return { Reservations: [{ Instances: [expired] }] };
  });
  const result = await EC2Service.cleanupExpiredInstances();
  assert.deepEqual(terminated, ["expired"]);
  assert.deepEqual(result.terminationRequested, ["expired"]);
  assert.deepEqual(result.trackingFailed, ["expired"]);
  assert.deepEqual(result.failed, []);
});

test("cleanup endpoint returns server errors for missing authentication config and query failures", async (t) => {
  const cleanup = t.mock.method(EC2Service, "cleanupExpiredInstances", async () => { throw new Error("AWS failure"); });
  const event = { rawPath: "/cleanup", requestContext: { http: { method: "POST" } }, headers: { "x-api-key": "test-key" } };
  delete process.env.PROVISION_API_KEY;
  assert.equal((await handler(event)).statusCode, 500);
  assert.equal(cleanup.mock.callCount(), 0);
  process.env.PROVISION_API_KEY = "test-key";
  assert.equal((await handler(event)).statusCode, 500);
});
