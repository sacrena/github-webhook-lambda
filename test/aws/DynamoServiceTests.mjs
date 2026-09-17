import assert from "node:assert/strict";
import test from "node:test";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { DynamoService } from "../../dist/aws/DynamoService.js";

test("create writes the request conditionally and propagates duplicate and storage failures", async (t) => {
  const request = {
    deliveryId: "delivery-1", receivedAt: "2026-09-16T00:00:00Z",
    webhook_type: "issue_comment", id: 123, value: "/agent fix the failing test",
    repositoryId: 10, repositoryFullName: "octocat/hello",
    issueOrPullRequestNumber: 42, senderId: 30,
  };
  const duplicate = new Error("duplicate delivery");
  duplicate.name = "ConditionalCheckFailedException";
  let failure;
  t.mock.method(DynamoDBDocumentClient.prototype, "send", async (command) => {
    assert.ok(command instanceof PutCommand);
    assert.equal(command.input.TableName, "requests");
    assert.deepEqual(command.input.Item, request);
    assert.equal(command.input.ConditionExpression, "attribute_not_exists(deliveryId)");
    if (failure) throw failure;
    return {};
  });
  assert.equal(await DynamoService.create("requests", request), undefined);
  failure = duplicate;
  await assert.rejects(DynamoService.create("requests", request), duplicate);
  failure = new Error("storage unavailable");
  await assert.rejects(DynamoService.create("requests", request), failure);
});

test("get reads consistently and distinguishes missing records from AWS failures", async (t) => {
  const request = {
    deliveryId: "delivery-1", receivedAt: "2026-09-16T00:00:00Z",
    webhook_type: "pull_request", id: 456, value: null,
    repositoryId: 10, repositoryFullName: "octocat/hello",
    issueOrPullRequestNumber: 42, senderId: 30,
  };
  let result = { Item: request };
  const failure = new Error("storage unavailable");
  t.mock.method(DynamoDBDocumentClient.prototype, "send", async (command) => {
    assert.ok(command instanceof GetCommand);
    assert.deepEqual(command.input, {
      TableName: "requests", Key: { deliveryId: "delivery-1" }, ConsistentRead: true,
    });
    if (result instanceof Error) throw result;
    return result;
  });
  assert.deepEqual(await DynamoService.get("requests", "delivery-1"), request);
  result = {};
  assert.equal(await DynamoService.get("requests", "delivery-1"), undefined);
  result = failure;
  await assert.rejects(DynamoService.get("requests", "delivery-1"), failure);
});
