import assert from "node:assert/strict";
import test from "node:test";
import {
  EC2Client, DescribeVolumesCommand, DeleteVolumeCommand,
  DescribeNetworkInterfacesCommand, DeleteNetworkInterfaceCommand, DescribeInstancesCommand,
} from "@aws-sdk/client-ec2";
import { AttachmentCleanup } from "../../dist/provision/AttachmentCleanup.js";
import { EC2Service } from "../../dist/aws/EC2Service.js";
import { handler } from "../../dist/index.js";

/**
 * Provides an independent result accumulator for each cleanup pass.
 * Resource IDs can appear in both accepted-action and failure categories,
 * so tests inspect individual arrays instead of assuming a single status.
 * The fixture mirrors the public endpoint contract including discovery errors.
 * Each call returns new arrays to prevent cross-test state from leaking.
 */
function result() {
  return {
    terminationRequested: [], skipped: [], failed: [], trackingFailed: [],
    deletedVolumes: [], deletedNetworkInterfaces: [], queryFailed: [],
  };
}

/**
 * Builds a tagged detached attachment in the format returned by EC2.
 * The same ownership contract is exercised for disks and interfaces while
 * their distinct AWS property names remain visible to the test transport.
 * Test-specific overrides model retagging, attachment races and service-owned
 * interfaces that must survive a worker cleanup pass without forced deletion.
 */
function attachment(kind, id, overrides = {}) {
  const tags = [
    { Key: "ManagedBy", Value: "agentic-setup" }, { Key: "DeliveryId", Value: "delivery-1" },
    { Key: "LaunchRequestId", Value: "token" }, { Key: "TimeoutAt", Value: "2020-01-01T00:00:00Z" },
  ];
  return kind === "volumes"
    ? { VolumeId: id, State: "available", Attachments: [], Tags: tags, ...overrides }
    : { NetworkInterfaceId: id, Status: "available", RequesterManaged: false, TagSet: tags, ...overrides };
}

for (const kind of ["volumes", "interfaces"]) {
  test(`${kind} cleanup paginates, rechecks detachment/tags, skips unsafe candidates and isolates failures`, async (t) => {
    const volume = kind === "volumes";
    const Describe = volume ? DescribeVolumesCommand : DescribeNetworkInterfacesCommand;
    const Delete = volume ? DeleteVolumeCommand : DeleteNetworkInterfaceCommand;
    const idsKey = volume ? "VolumeIds" : "NetworkInterfaceIds";
    const listKey = volume ? "Volumes" : "NetworkInterfaces";
    const tagKey = volume ? "Tags" : "TagSet";
    const deleted = [];
    const pages = [];
    const accumulator = result();
    const candidates = ["expired", "attached", "future", "foreign", "invalid", "missing-token", "failure", "gone"];
    if (!volume) candidates.push("managed", "associated");
    t.mock.method(EC2Client.prototype, "send", async (command) => {
      if (command instanceof Delete) {
        const id = command.input[volume ? "VolumeId" : "NetworkInterfaceId"];
        if (id === "failure") throw new Error("deletion unavailable");
        deleted.push(id);
        return {};
      }
      assert.ok(command instanceof Describe);
      const id = command.input[idsKey]?.[0];
      if (!id) {
        assert.deepEqual(command.input.Filters[0], { Name: "tag:ManagedBy", Values: ["agentic-setup"] });
        pages.push(command.input.NextToken);
        return command.input.NextToken
          ? { [listKey]: [attachment(kind, "expired"), attachment(kind, "second")] }
          : { NextToken: "page-2", [listKey]: candidates.map((candidate) => attachment(kind, candidate)) };
      }
      if (id === "gone") throw Object.assign(new Error("absent"), {
        name: volume ? "InvalidVolume.NotFound" : "InvalidNetworkInterfaceID.NotFound",
      });
      const current = attachment(kind, id);
      if (id === "attached") Object.assign(current, volume ? { Attachments: [{ InstanceId: "i-live" }] } : { Attachment: { InstanceId: "i-live" } });
      if (id === "future") current[tagKey][3].Value = "2099-01-01T00:00:00Z";
      if (id === "foreign") current[tagKey][0].Value = "another-app";
      if (id === "invalid") current[tagKey][3].Value = "bad-date";
      if (id === "missing-token") current[tagKey] = current[tagKey].filter((tag) => tag.Key !== "LaunchRequestId");
      if (id === "managed") current.RequesterManaged = true;
      if (id === "associated") current.Association = { AllocationId: "eip-foreign" };
      return { [listKey]: [current] };
    });
    await AttachmentCleanup[kind](new EC2Client({ region: "us-east-1" }), accumulator);
    assert.deepEqual(pages, [undefined, "page-2"]);
    assert.deepEqual(deleted, ["expired", "second"]);
    assert.deepEqual(accumulator[volume ? "deletedVolumes" : "deletedNetworkInterfaces"], ["expired", "gone", "second"]);
    assert.deepEqual(accumulator.failed, ["failure"]);
    assert.deepEqual(accumulator.skipped, volume
      ? ["attached", "future", "foreign", "invalid", "missing-token"]
      : ["attached", "future", "foreign", "invalid", "missing-token", "managed", "associated"]);
  });
}

test("failed instance and volume discovery cannot prevent the interface sweep and produce HTTP 500", async (t) => {
  const original = { ...process.env };
  t.after(() => { process.env = original; });
  Object.assign(process.env, { AWS_REGION: "us-east-1", REQUESTS_TABLE_NAME: "requests", PROVISION_API_KEY: "key" });
  const commands = [];
  t.mock.method(EC2Client.prototype, "send", async (command) => {
    commands.push(command);
    if (command instanceof DescribeInstancesCommand || command instanceof DescribeVolumesCommand) throw new Error("query unavailable");
    return { NetworkInterfaces: [] };
  });
  const response = await handler({
    rawPath: "/cleanup", headers: { "X-Api-Key": "key" }, requestContext: { http: { method: "POST" } },
  });
  assert.equal(response.statusCode, 500);
  assert.deepEqual(JSON.parse(response.body).queryFailed, ["instances", "volumes"]);
  assert.ok(commands.at(-1) instanceof DescribeNetworkInterfacesCommand);
  assert.deepEqual((await EC2Service.cleanupExpiredInstances()).failed, []);
});
