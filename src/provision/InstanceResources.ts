import type { Instance } from "@aws-sdk/client-ec2";
import type { InstanceLaunchJournal } from "./InstanceLaunch.js";
import type { InstanceLaunch } from "./InstanceLaunch.js";
import type { ProvisionedResource } from "./ProvisionedResource.js";
import {
  EC2_INSTANCE_RESOURCE_STATUS, EC2_INSTANCE_RESOURCE_TYPE,
  EC2_DELIVERY_ID_TAG_KEY, EC2_LAUNCH_REQUEST_ID_TAG_KEY,
  EC2_INSTANCE_STATE_RUNNING, EC2_INSTANCE_STATE_STOPPED,
  EC2_INSTANCE_STATE_STOPPING, EC2_INSTANCE_STATE_SHUTTING_DOWN,
  EC2_INSTANCE_STATE_TERMINATED,
  EC2_MANAGEMENT_TAG_KEY, EC2_MANAGEMENT_TAG_VALUE,
  EC2_TIMEOUT_AT_TAG_KEY, EC2_WORKER_REGION,
} from "./ProvisioningConstants.js";

/**
 * Identifies an expired worker using the ownership tags written at launch.
 * Cleanup uses this check both during discovery and just before termination
 * so a fresh deadline or removed ownership tag prevents deletion. Delivery
 * identity is required for audit correlation; missing or malformed deadlines
 * are never treated as expired. Terminated workers need no termination call.
 */
export function expiredInstanceTags(instance: Instance, now: number) {
  if (!instance.InstanceId || instance.State?.Name === EC2_INSTANCE_STATE_TERMINATED) return undefined;
  const tags = Object.fromEntries((instance.Tags ?? []).map((tag) => [tag.Key, tag.Value]));
  if (tags[EC2_MANAGEMENT_TAG_KEY] !== EC2_MANAGEMENT_TAG_VALUE || !tags[EC2_DELIVERY_ID_TAG_KEY]?.trim()
    || !tags[EC2_TIMEOUT_AT_TAG_KEY] || !/^\d{4}-\d{2}-\d{2}T.*Z$/.test(tags[EC2_TIMEOUT_AT_TAG_KEY])) return undefined;

  const deadline = Date.parse(tags[EC2_TIMEOUT_AT_TAG_KEY]);
  if (!Number.isFinite(deadline) || deadline > now) return undefined;
  return {
    deliveryId: tags[EC2_DELIVERY_ID_TAG_KEY], timeoutAt: tags[EC2_TIMEOUT_AT_TAG_KEY],
    token: tags[EC2_LAUNCH_REQUEST_ID_TAG_KEY],
  };
}

/**
 * Converts EC2 observations to the resource contract used by consumers.
 * AWS state determines whether termination is confirmed or still pending;
 * accepting a terminate request alone never marks a worker terminated.
 * Identity, region, deadline, and state are sufficient to manage the worker.
 * AWS manages attached resources according to their termination settings;
 * this contract retains no disk or interface identities for separate cleanup.
 */
export function instanceResource(
  instance: Instance, config: Pick<InstanceLaunch, "deliveryId" | "region" | "timeoutAt">,
  token: string, createdAt?: string,
): ProvisionedResource {
  if (!instance.InstanceId) throw new Error("EC2 response missing instance ID; recover using the launch journal");

  // Map observed EC2 state without treating a termination request as confirmed cleanup.
  let status: ProvisionedResource["status"] = EC2_INSTANCE_RESOURCE_STATUS.PROVISIONING;
  switch (instance.State?.Name) {
    case EC2_INSTANCE_STATE_STOPPING: status = EC2_INSTANCE_RESOURCE_STATUS.STOPPING; break;
    case EC2_INSTANCE_STATE_STOPPED: status = EC2_INSTANCE_RESOURCE_STATUS.STOPPED; break;
    case EC2_INSTANCE_STATE_RUNNING: status = EC2_INSTANCE_RESOURCE_STATUS.ACTIVE; break;
    case EC2_INSTANCE_STATE_SHUTTING_DOWN: status = EC2_INSTANCE_RESOURCE_STATUS.TERMINATION_REQUESTED; break;
    case EC2_INSTANCE_STATE_TERMINATED: status = EC2_INSTANCE_RESOURCE_STATUS.TERMINATED; break;
  }

  return {
    deliveryId: config.deliveryId,
    launchRequestId: token,
    resourceId: instance.InstanceId,
    resourceType: EC2_INSTANCE_RESOURCE_TYPE,
    region: config.region,
    status: status,
    createdAt: createdAt,
    updatedAt: new Date().toISOString(),
    timeoutAt: config.timeoutAt || undefined,
  };
}

/**
 * Exposes a saved worker identity when no current observation is available.
 * Recovery uses this fallback for empty EC2 pages, and deletion uses it to
 * terminate a known instance without depending on discovery availability.
 * The journal does not retain lifecycle state, so this result leaves status
 * and timestamps absent instead of inferring them from a previous operation.
 */
export function savedInstanceResource(journal: InstanceLaunchJournal): ProvisionedResource | undefined {
  if (!journal.instanceId) return undefined;
  return {
    deliveryId: journal.deliveryId, launchRequestId: journal.token, resourceId: journal.instanceId,
    resourceType: EC2_INSTANCE_RESOURCE_TYPE, region: EC2_WORKER_REGION,
  };
}
