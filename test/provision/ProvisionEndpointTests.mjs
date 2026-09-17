import assert from "node:assert/strict";
import test from "node:test";
import { handler } from "../../dist/index.js";
import { DynamoService } from "../../dist/aws/DynamoService.js";
import { EC2Service } from "../../dist/aws/EC2Service.js";

test.beforeEach((t) => {
  const original = { ...process.env };
  t.after(() => { process.env = original; });
  Object.assign(process.env, {
    PROVISION_API_KEY: "test-api-key", REQUESTS_TABLE_NAME: "requests",
    LOG_LEVEL: "info", AWS_LAMBDA_FUNCTION_NAME: "test-lambda",
  });
  t.mock.method(Date, "now", () => Date.parse("2026-09-17T10:00:10Z"));
});

/**
 * Supplies a real Function URL envelope to exercise routing and validation.
 * Caller overrides model malformed transport and configuration independently
 * of the stored request, whose timestamp must control the worker deadline.
 * The fixture includes a forged timeout to verify it is never trusted.
 * Base64 encoding exercises the same body boundary used by AWS delivery.
 */
function provisionEvent() {
  return {
    rawPath: "/provision", headers: { "X-Api-Key": "test-api-key" },
    body: Buffer.from(JSON.stringify({
      source: "agentic.setup", "detail-type": "ProvisionRequested",
      detail: { deliveryId: "delivery-1", timeoutAt: "2099-01-01", receivedAt: "2099-01-01" },
    })).toString("base64"), isBase64Encoded: true,
    requestContext: { requestId: "test-request", http: { method: "POST" } },
  };
}

test("provision awaits EC2 allocation using the original stored deadline and logs metadata only", async (t) => {
  const output = t.mock.method(console, "info", () => {});
  const read = t.mock.method(DynamoService, "get", async () => ({ receivedAt: "2026-09-17T10:00:00.250Z" }));
  const resource = { resourceId: "i-worker", status: "provisioning" };
  const create = t.mock.method(EC2Service, "createInstance", async () => {
    await new Promise((resolve) => setImmediate(resolve));
    return resource;
  });
  const response = await handler(provisionEvent());
  assert.equal(response.statusCode, 202);
  assert.deepEqual(JSON.parse(response.body), { resource });
  assert.deepEqual(read.mock.calls[0].arguments, ["requests", "delivery-1"]);
  assert.deepEqual(create.mock.calls[0].arguments, [
    { deliveryId: "delivery-1", timeoutAt: "2026-09-17T10:30:01.000Z" }, "requests",
  ]);
  const records = output.mock.calls.map((call) => JSON.parse(call.arguments[0]));
  assert.equal(records.find((record) => record.event === "provision.completed").requestId, "test-request");
  assert.equal(records.at(-1).statusCode, 202);
  assert.ok(records.every((record) => !JSON.stringify(record).includes("test-api-key") && !("data" in record)));
});

test("provision rejects unauthenticated and malformed events before storage or EC2", async (t) => {
  const read = t.mock.method(DynamoService, "get", async () => { throw new Error("must not read"); });
  for (const key of [undefined, "incorrect", "wrong-key-12"]) {
    const event = provisionEvent();
    event.headers["X-Api-Key"] = key;
    assert.equal((await handler(event)).statusCode, 401);
  }
  for (const body of ["", "{", "null", "[]", '{"source":"other","detail":{"deliveryId":"x"}}',
    '{"source":"agentic.setup","detail-type":"TimeoutRequested","detail":{"deliveryId":"x"}}',
    '{"source":"agentic.setup","detail-type":"ProvisionRequested","detail":{"deliveryId":" "}}']) {
    assert.equal((await handler({ ...provisionEvent(), body, isBase64Encoded: false })).statusCode, 400);
  }
  assert.equal(read.mock.callCount(), 0);
  process.env.PROVISION_API_KEY = "";
  assert.equal((await handler(provisionEvent())).statusCode, 500);
  const event = provisionEvent();
  event.requestContext.http.method = "GET";
  assert.equal((await handler(event)).statusCode, 404);
});

test("provision handles missing, corrupt, expired and unavailable stored requests without launching", async (t) => {
  const create = t.mock.method(EC2Service, "createInstance", async () => { throw new Error("must not launch"); });
  const read = t.mock.method(DynamoService, "get", async () => undefined);
  assert.equal((await handler(provisionEvent())).statusCode, 404);
  read.mock.mockImplementation(async () => ({ receivedAt: "invalid" }));
  assert.equal((await handler(provisionEvent())).statusCode, 500);
  read.mock.mockImplementation(async () => ({ receivedAt: "2020-01-01" }));
  assert.equal((await handler(provisionEvent())).statusCode, 200);
  read.mock.mockImplementation(async () => { throw new Error("database unavailable"); });
  assert.equal((await handler(provisionEvent())).statusCode, 500);
  delete process.env.REQUESTS_TABLE_NAME;
  assert.equal((await handler(provisionEvent())).statusCode, 500);
  assert.equal(create.mock.callCount(), 0);
});

test("provision exposes allocation failures as retryable server errors", async (t) => {
  t.mock.method(DynamoService, "get", async () => ({ receivedAt: "2026-09-17T10:00:00Z" }));
  t.mock.method(EC2Service, "createInstance", async () => { throw new Error("EC2 failed"); });
  assert.equal((await handler(provisionEvent())).statusCode, 500);
});
