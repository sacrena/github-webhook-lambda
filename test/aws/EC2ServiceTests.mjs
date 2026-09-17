import assert from "node:assert/strict";
import test from "node:test";
import { EC2Client, RunInstancesCommand, DescribeInstancesCommand, TerminateInstancesCommand } from "@aws-sdk/client-ec2";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import { EC2Service } from "../../dist/aws/EC2Service.js";
import {
  EC2_DELIVERY_ID_TAG_KEY, EC2_LAUNCH_REQUEST_ID_TAG_KEY,
  EC2_MANAGEMENT_TAG_KEY, EC2_MANAGEMENT_TAG_VALUE,
  EC2_TIMEOUT_AT_TAG_KEY,
} from "../../dist/provision/ProvisioningConstants.js";

const config = {
  deliveryId: "delivery-1",
  timeoutAt: "2099-01-01T00:00:00.000Z",
};
const instance = { InstanceId: "i-test", State: { Name: "pending" } };

/**
 * Models independent request storage and an idempotent EC2 launch.
 * Failure switches exercise boundaries before and after AWS accepts work.
 * EC2 retains an instance independently of the journal, and token reuse
 * must carry identical parameters rather than merely the same identifier.
 * Saved results allow repeated creation calls to return the tracked worker.
 */
function mockAws(t) {
  const state = {
    journal: undefined, commands: [], launched: undefined, launchInput: undefined,
    failJournal: false, failRecord: false, failLaunch: false, loseResponse: false,
    hidden: false, missingRequest: false,
  };
  t.mock.method(DynamoDBDocumentClient.prototype, "send", async (command) => {
    if (command instanceof GetCommand) return { Item: { resourceLaunch: structuredClone(state.journal) } };
    const values = command.input.ExpressionAttributeValues;
    const conflict = Object.assign(new Error("condition failed"), { name: "ConditionalCheckFailedException" });
    if (values[":launch"]) {
      if (state.failJournal) throw new Error("journal unavailable");
      if (state.journal || state.missingRequest) throw conflict;
      state.journal = structuredClone(values[":launch"]);
    } else if (values[":instanceId"]) {
      if (state.failRecord) throw new Error("record unavailable");
      assert.equal(command.input.ConditionExpression, "attribute_exists(resourceLaunch)");
      state.journal.instanceId = values[":instanceId"];
    }
    return {};
  });
  t.mock.method(EC2Client.prototype, "send", async (command) => {
    state.commands.push(command);
    assert.ok(state.journal, "must journal before contacting EC2");
    if (command instanceof RunInstancesCommand) {
      if (state.failLaunch) throw new Error("launch unavailable");
      if (state.launchInput) assert.deepEqual(command.input, state.launchInput, "retries must use identical parameters");
      state.launchInput = structuredClone(command.input);
      state.launched ??= { ...structuredClone(instance), Tags: structuredClone(command.input.TagSpecifications[0].Tags), LaunchTime: new Date("2026-01-01") };
      if (state.loseResponse) throw new Error("launch response lost");
      return { Instances: [state.launched] };
    }
    if (command instanceof DescribeInstancesCommand)
      return { Reservations: [{ Instances: state.launched && !state.hidden ? [state.launched] : [] }] };
    assert.ok(command instanceof TerminateInstancesCommand);
    return {};
  });
  return state;
}

test.beforeEach((t) => {
  const original = { ...process.env };
  t.after(() => { process.env = original; });
  process.env.AWS_REGION = "us-east-1";
  process.env.EC2_SECURITY_GROUP_ID = "sg-test";
});

test("creation tags owned resources, enables root deletion on termination, and tracks one worker", async (t) => {
  const state = mockAws(t);
  const result = await EC2Service.createInstance(config, "requests");
  assert.equal(result.resourceId, "i-test");
  assert.equal(result.status, "provisioning");
  assert.deepEqual(state.journal, { deliveryId: config.deliveryId, token: state.journal.token, instanceId: "i-test" });
  const launch = state.launchInput;
  assert.equal(launch.ClientToken, state.journal.token);
  assert.deepEqual(launch.TagSpecifications.map((spec) => spec.ResourceType), ["instance", "volume", "network-interface"]);
  for (const spec of launch.TagSpecifications) {
    assert.deepEqual(Object.fromEntries(spec.Tags.map((tag) => [tag.Key, tag.Value])), {
      [EC2_MANAGEMENT_TAG_KEY]: EC2_MANAGEMENT_TAG_VALUE, [EC2_DELIVERY_ID_TAG_KEY]: config.deliveryId,
      [EC2_LAUNCH_REQUEST_ID_TAG_KEY]: state.journal.token, [EC2_TIMEOUT_AT_TAG_KEY]: config.timeoutAt,
    });
  }
  assert.deepEqual(launch.BlockDeviceMappings, [{ DeviceName: "/dev/sda1", Ebs: { VolumeSize: 50, VolumeType: "gp3", DeleteOnTermination: true } }]);
  assert.equal(launch.ImageId, "ami-0246d714afcc1d494");
  assert.equal(launch.InstanceType, "m8g.xlarge");
  assert.ok(launch.BlockDeviceMappings.every((mapping) => mapping.Ebs.DeleteOnTermination));
  assert.equal(launch.NetworkInterfaces, undefined);
  assert.deepEqual(launch.SecurityGroupIds, ["sg-test"]);
  const calls = state.commands.length;
  assert.equal((await EC2Service.createInstance(config, "requests")).resourceId, result.resourceId);
  assert.equal(state.commands.length, calls + 1);
});

test("fixed defaults ignore environment overrides and normalize deadlines to UTC", async (t) => {
  Object.assign(process.env, {
    EC2_IMAGE_ID: "ami-override", EC2_INSTANCE_TYPE: "t3.small", AWS_REGION: "us-east-1",
  });

  const state = mockAws(t);
  const options = { deliveryId: config.deliveryId, timeoutAt: "2099-01-01T05:30:00+05:30" };
  await EC2Service.createInstance(options, "requests");
  assert.equal(state.launchInput.InstanceType, "m8g.xlarge");
  assert.equal(state.launchInput.TagSpecifications[0].Tags.find((tag) => tag.Key === EC2_TIMEOUT_AT_TAG_KEY).Value, config.timeoutAt);
  delete process.env.EC2_IMAGE_ID;
  assert.equal((await EC2Service.createInstance(options, "requests")).resourceId, "i-test");
});

test("invalid and expired deadlines cannot reserve a launch", async (t) => {
  const state = mockAws(t);
  await assert.rejects(EC2Service.createInstance({ ...config, timeoutAt: "bad" }, "requests"), /valid timeout/);
  await assert.rejects(EC2Service.createInstance({ ...config, timeoutAt: "2000-01-01" }, "requests"), /deadline/);
  assert.equal(state.journal, undefined);
  assert.equal(state.commands.length, 0);
});

test("a deployment outside the pinned worker region cannot allocate resources", async (t) => {
  const state = mockAws(t);
  process.env.AWS_REGION = "eu-west-1";
  await assert.rejects(EC2Service.createInstance(config, "requests"), /requires AWS_REGION=us-east-1/);
  assert.equal(state.journal, undefined);
  assert.equal(state.commands.length, 0);
});

test("repeated timeout deletion tolerates an instance already removed from EC2", async (t) => {
  const state = mockAws(t);
  await EC2Service.createInstance(config, "requests");
  t.mock.method(EC2Client.prototype, "send", async (command) => {
    assert.ok(command instanceof TerminateInstancesCommand);
    throw Object.assign(new Error("already removed"), { name: "InvalidInstanceID.NotFound" });
  });
  assert.equal((await EC2Service.deleteInstance(config.deliveryId, "requests")).status, undefined);
  assert.equal(state.journal.instanceId, "i-test");
});

test("missing shared security group prevents a launch while retaining its token", async (t) => {
  const state = mockAws(t);
  delete process.env.EC2_SECURITY_GROUP_ID;
  await assert.rejects(EC2Service.createInstance(config, "requests"), /security group/);
  assert.ok(state.journal);
  assert.equal(state.launched, undefined);
});

test("missing request and unavailable journal prevent launching", async (t) => {
  const state = mockAws(t);
  state.missingRequest = true;
  await assert.rejects(EC2Service.createInstance(config, "requests"), /request not found/);
  state.missingRequest = false;
  state.failJournal = true;
  await assert.rejects(EC2Service.createInstance(config, "requests"), /journal unavailable/);
  assert.equal(state.commands.length, 0);
});

test("failed RunInstances remains retryable", async (t) => {
  const state = mockAws(t);
  state.failLaunch = true;
  await assert.rejects(EC2Service.createInstance(config, "requests"), /launch unavailable/);
  assert.ok(state.journal);
  assert.equal(state.launched, undefined);
  state.failLaunch = false;
  assert.equal((await EC2Service.createInstance(config, "requests")).resourceId, "i-test");
});

test("lost response retries the same launch even while EC2 discovery is empty", async (t) => {
  const state = mockAws(t);
  state.loseResponse = true;
  await assert.rejects(EC2Service.createInstance(config, "requests"), /response lost/);
  state.loseResponse = false;
  state.hidden = true;
  const resource = await EC2Service.createInstance(config, "requests");
  assert.equal(resource.resourceId, "i-test");
  assert.equal(state.commands.filter((command) => command instanceof RunInstancesCommand).length, 2);
});

test("concurrent retries may repeat the API call but share one EC2 launch", async (t) => {
  const state = mockAws(t);
  const results = await Promise.all([
    EC2Service.createInstance(config, "requests"), EC2Service.createInstance(config, "requests"),
  ]);
  assert.ok(results.every((resource) => resource.resourceId === "i-test"));
  assert.equal(state.launchInput.ClientToken, state.journal.token);
});

test("failed result persistence can be retried without allocating a different worker", async (t) => {
  const state = mockAws(t);
  state.failRecord = true;
  await assert.rejects(EC2Service.createInstance(config, "requests"), /record unavailable/);
  state.failRecord = false;
  assert.equal((await EC2Service.createInstance(config, "requests")).resourceId, "i-test");
});

test("explicit cleanup uses the saved ID without discovery and blocks future launches", async (t) => {
  const state = mockAws(t);
  await EC2Service.createInstance(config, "requests");
  state.hidden = true;
  const resource = await EC2Service.deleteInstance(config.deliveryId, "requests");
  assert.equal(resource.status, "termination_requested");
  assert.ok(resource.terminationRequestedAt);
  assert.equal(state.commands.some((command) => command instanceof DescribeInstancesCommand), false);
  assert.equal((await EC2Service.createInstance(config, "requests")).resourceId, resource.resourceId);
});

test("cleanup discovers a lost launch response and tolerates an empty lookup", async (t) => {
  const state = mockAws(t);
  state.loseResponse = true;
  await assert.rejects(EC2Service.createInstance(config, "requests"), /response lost/);
  assert.equal((await EC2Service.deleteInstance(config.deliveryId, "requests")).resourceId, "i-test");
  state.journal.instanceId = undefined;
  state.hidden = true;
  assert.equal(await EC2Service.deleteInstance(config.deliveryId, "requests"), undefined);
});

test("failed result persistence leaves termination to cleanup", async (t) => {
  const state = mockAws(t);
  state.failRecord = true;
  await assert.rejects(EC2Service.createInstance(config, "requests"), /record unavailable/);
  assert.equal(state.journal.instanceId, undefined);
  assert.equal(state.commands.some((command) => command instanceof TerminateInstancesCommand), false);
});

test("expired unallocated launch is rejected without cleanup", async (t) => {
  const state = mockAws(t);
  state.failLaunch = true;
  await assert.rejects(EC2Service.createInstance(config, "requests"), /launch unavailable/);

  const calls = state.commands.length;
  await assert.rejects(EC2Service.createInstance({ ...config, timeoutAt: "2000-01-01" }, "requests"), /deadline/);
  assert.equal(state.commands.length, calls);
});

test("repeat creation after the deadline returns the tracked worker without deletion", async (t) => {
  const state = mockAws(t);
  const resource = await EC2Service.createInstance(config, "requests");

  assert.equal((await EC2Service.createInstance({ ...config, timeoutAt: "2000-01-01" }, "requests")).resourceId, resource.resourceId);
  assert.equal(state.commands.some((command) => command instanceof TerminateInstancesCommand), false);
});

test("recovery paginates, observes stopped states, and preserves IDs across empty observations", async (t) => {
  const state = mockAws(t);
  await EC2Service.createInstance(config, "requests");
  state.launched.State.Name = "stopped";
  assert.equal((await EC2Service.recoverInstance(config.deliveryId, "requests")).status, "stopped");
  state.hidden = true;
  assert.equal((await EC2Service.recoverInstance(config.deliveryId, "requests")).resourceId, "i-test");
  t.mock.method(EC2Client.prototype, "send", async (command) => {
    if (command instanceof TerminateInstancesCommand) return {};
    assert.ok(command instanceof DescribeInstancesCommand);
    if (!command.input.NextToken) return { NextToken: "second", Reservations: [] };
    assert.equal(command.input.NextToken, "second");
    return { Reservations: [{ Instances: [{ ...instance, State: { Name: "terminated" } }] }] };
  });
  assert.equal((await EC2Service.recoverInstance(config.deliveryId, "requests")).status, "terminated");
  assert.equal((await EC2Service.deleteInstance(config.deliveryId, "requests")).resourceId, "i-test");
});

test("recovery reports current EC2 state without persisting observations", async (t) => {
  const state = mockAws(t);
  await EC2Service.createInstance(config, "requests");
  const requested = await EC2Service.deleteInstance(config.deliveryId, "requests");
  const recovered = await EC2Service.recoverInstance(config.deliveryId, "requests");
  assert.equal(requested.status, "termination_requested");
  assert.equal(recovered.status, "provisioning");
  assert.equal(state.journal.status, undefined);
  state.launched.State.Name = "terminated";
  assert.equal((await EC2Service.recoverInstance(config.deliveryId, "requests")).status, "terminated");
});

test("failed tracking cannot prevent terminating a discovered worker", async (t) => {
  const state = mockAws(t);
  state.failRecord = true;
  await assert.rejects(EC2Service.createInstance(config, "requests"), /record unavailable/);
  await assert.rejects(EC2Service.deleteInstance(config.deliveryId, "requests"), /record unavailable/);
  assert.ok(state.commands.at(-1) instanceof TerminateInstancesCommand);
  assert.deepEqual(state.commands.at(-1).input.InstanceIds, ["i-test"]);
});
