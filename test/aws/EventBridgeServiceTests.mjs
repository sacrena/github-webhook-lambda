import assert from "node:assert/strict";
import test from "node:test";
import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";
import { EventBridgeService } from "../../dist/aws/EventBridgeService.js";

test("putEvent publishes serialized detail to the configured bus and returns its ID", async (t) => {
  const original = process.env.EVENT_BUS_NAME;
  t.after(() => {
    if (original === undefined) delete process.env.EVENT_BUS_NAME;
    else process.env.EVENT_BUS_NAME = original;
  });
  process.env.EVENT_BUS_NAME = "configured-bus";
  t.mock.method(EventBridgeClient.prototype, "send", async (command) => {
    assert.ok(command instanceof PutEventsCommand);
    assert.deepEqual(command.input.Entries, [{
      EventBusName: "configured-bus", Source: "agentic.setup",
      DetailType: "ProvisionRequested", Detail: '{"deliveryId":"delivery-1"}',
    }]);
    return { FailedEntryCount: 0, Entries: [{ EventId: "event-1" }] };
  });
  assert.equal(await EventBridgeService.putEvent("agentic.setup", "ProvisionRequested", { deliveryId: "delivery-1" }), "event-1");
});

test("putEvent surfaces entry rejection, missing results, and transport failures", async (t) => {
  let result = { FailedEntryCount: 1, Entries: [{ ErrorCode: "InternalFailure" }] };
  t.mock.method(EventBridgeClient.prototype, "send", async () => {
    if (result instanceof Error) throw result;
    return result;
  });
  await assert.rejects(EventBridgeService.putEvent("source", "type", {}, "bus"), /InternalFailure/);
  result = {};
  await assert.rejects(EventBridgeService.putEvent("source", "type", {}, "bus"), /MissingEventId/);
  result = new Error("transport unavailable");
  await assert.rejects(EventBridgeService.putEvent("source", "type", {}, "bus"), result);
});

test("publisher rejects missing configuration and unserializable detail before sending", async (t) => {
  t.mock.method(EventBridgeClient.prototype, "send", async () => assert.fail("must not send invalid detail"));
  await assert.rejects(EventBridgeService.putEvent("source", "type", {}, ""), /bus name is required/);
  const detail = {};
  detail.circular = detail;
  await assert.rejects(EventBridgeService.putEvent("source", "type", detail, "bus"), TypeError);
});
