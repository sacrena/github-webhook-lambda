import assert from "node:assert/strict";
import test from "node:test";
import { handler } from "../../dist/index.js";
import { DynamoService } from "../../dist/aws/DynamoService.js";
import { EC2Service } from "../../dist/aws/EC2Service.js";
import { InstanceJournal } from "../../dist/provision/InstanceJournal.js";

test.beforeEach((t) => {
  const original = { ...process.env };
  t.after(() => { process.env = original; });
  Object.assign(process.env, {
    PROVISION_API_KEY: "test-api-key", REQUESTS_TABLE_NAME: "requests", LOG_LEVEL: "silent",
  });
  t.mock.method(Date, "now", () => Date.parse("2026-09-17T10:30:01Z"));
});

/**
 * Builds the timeout delivery shape consumed by the public router.
 * The detail intentionally contains only request identity because resource
 * selection and deadline checks must come from storage, not event claims.
 * Individual tests override authentication, payloads and HTTP routing while
 * retaining a recognizable timeout event for successful termination paths.
 */
function timeoutEvent() {
  return {
    rawPath: "/timeout", headers: { "X-Api-Key": "test-api-key" },
    body: JSON.stringify({ source: "agentic.setup", "detail-type": "TimeoutRequested", detail: { deliveryId: "delivery-1" } }),
    requestContext: { http: { method: "POST" } },
  };
}

test("timeout awaits termination at the stored deadline and returns the resource", async (t) => {
  t.mock.method(DynamoService, "get", async () => ({ receivedAt: "2026-09-17T10:00:00.250Z" }));
  t.mock.method(InstanceJournal, "get", async () => ({ token: "token", instanceId: "i-worker" }));
  const resource = { resourceId: "i-worker", status: "termination_requested" };
  const remove = t.mock.method(EC2Service, "deleteInstance", async () => resource);
  const response = await handler(timeoutEvent());
  assert.equal(response.statusCode, 202);
  assert.deepEqual(JSON.parse(response.body), { resource });
  assert.deepEqual(remove.mock.calls[0].arguments, ["delivery-1", "requests"]);
});

test("premature timeouts cannot terminate a worker even with a forged old deadline", async (t) => {
  t.mock.method(DynamoService, "get", async () => ({ receivedAt: "2026-09-17T10:20:00Z" }));
  const remove = t.mock.method(EC2Service, "deleteInstance", async () => {});
  const event = timeoutEvent();
  const body = JSON.parse(event.body);
  body.detail.timeoutAt = "2000-01-01";
  event.body = JSON.stringify(body);
  assert.equal((await handler(event)).statusCode, 503);
  assert.equal(remove.mock.callCount(), 0);
});

test("timeout distinguishes no launch, uncertain discovery and service failure", async (t) => {
  t.mock.method(DynamoService, "get", async () => ({ receivedAt: "2020-01-01" }));
  const journal = t.mock.method(InstanceJournal, "get", async () => undefined);
  const remove = t.mock.method(EC2Service, "deleteInstance", async () => undefined);
  assert.equal((await handler(timeoutEvent())).statusCode, 200);
  assert.equal(remove.mock.callCount(), 0);
  journal.mock.mockImplementation(async () => ({ token: "token" }));
  assert.equal((await handler(timeoutEvent())).statusCode, 503);
  remove.mock.mockImplementation(async () => { throw new Error("EC2 unavailable"); });
  assert.equal((await handler(timeoutEvent())).statusCode, 500);
});

test("timeout validates authentication, envelopes, storage and route configuration", async (t) => {
  const read = t.mock.method(DynamoService, "get", async () => undefined);
  const event = timeoutEvent();
  event.headers["X-Api-Key"] = "wrong";
  assert.equal((await handler(event)).statusCode, 401);
  assert.equal(read.mock.callCount(), 0);
  for (const body of ["null", "{", "{}", '{"source":"agentic.setup","detail-type":"ProvisionRequested","detail":{"deliveryId":"x"}}']) {
    assert.equal((await handler({ ...timeoutEvent(), body })).statusCode, 400);
  }
  assert.equal((await handler(timeoutEvent())).statusCode, 404);
  read.mock.mockImplementation(async () => ({ receivedAt: "bad" }));
  assert.equal((await handler(timeoutEvent())).statusCode, 500);
  read.mock.mockImplementation(async () => { throw new Error("storage failed"); });
  assert.equal((await handler(timeoutEvent())).statusCode, 500);
  delete process.env.REQUESTS_TABLE_NAME;
  assert.equal((await handler(timeoutEvent())).statusCode, 500);
  delete process.env.PROVISION_API_KEY;
  assert.equal((await handler(timeoutEvent())).statusCode, 500);
  event.requestContext.http.method = "GET";
  assert.equal((await handler(event)).statusCode, 404);
});
