import assert from "node:assert/strict";
import test from "node:test";
import { handler } from "../../dist/index.js";

test.beforeEach((t) => {
  const original = { ...process.env };
  t.after(() => { process.env = original; });
  process.env.PROVISION_API_KEY = "test-api-key";
  process.env.LOG_LEVEL = "info";
  process.env.AWS_LAMBDA_FUNCTION_NAME = "test-lambda";
});

test("provisioning accepts authenticated events and logs decoded delivery data", async (t) => {
  const output = t.mock.method(console, "info", () => {});
  const data = JSON.stringify({ source: "test.publisher", detail: { job: 42 } });
  const response = await handler({
    rawPath: "/provision", headers: { "X-Api-Key": "test-api-key" },
    body: Buffer.from(data).toString("base64"), isBase64Encoded: true,
    requestContext: { requestId: "test-request", http: { method: "POST" } },
  });
  assert.equal(response.statusCode, 202);
  const records = output.mock.calls.map((call) => JSON.parse(call.arguments[0]));
  const received = records.find((record) => record.event === "provision.received");
  assert.equal(received.data, data);
  assert.equal(received.requestId, "test-request");
  assert.ok(records.every((record) => !JSON.stringify(record).includes("test-api-key")));
});

test("provisioning rejects invalid credentials without logging delivery data", async (t) => {
  const output = t.mock.method(console, "info", () => {});
  for (const key of [undefined, "incorrect", "wrong-key-12"]) {
    const response = await handler({
      rawPath: "/provision", headers: { "x-api-key": key }, body: "private-data",
      requestContext: { http: { method: "POST" } },
    });
    assert.equal(response.statusCode, 401);
  }
  assert.ok(output.mock.calls.every((call) => !call.arguments[0].includes("private-data")));
});

test("provisioning requires configuration and only supports POST", async () => {
  process.env.PROVISION_API_KEY = "";
  const event = { rawPath: "/provision", requestContext: { http: { method: "POST" } } };
  assert.equal((await handler(event)).statusCode, 500);
  event.requestContext.http.method = "GET";
  assert.equal((await handler(event)).statusCode, 404);
});
