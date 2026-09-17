import {
  EC2Client, DescribeInstancesCommand, RunInstancesCommand,
  TerminateInstancesCommand, type BlockDeviceMapping,
} from "@aws-sdk/client-ec2";
import { expiredInstanceTags, instanceResource, savedInstanceResource } from "../provision/InstanceResources.js";
import { resolveInstanceLaunch, workerRegion } from "../provision/InstanceConfiguration.js";
import { InstanceJournal } from "../provision/InstanceJournal.js";
import {
  EC2_CLEANUP_INSTANCE_STATES, EC2_CLEANUP_STATE_FILTER, EC2_INSTANCE_RESOURCE_STATUS,
  EC2_DELIVERY_ID_TAG_KEY, EC2_LAUNCH_REQUEST_ID_TAG_KEY, EC2_MANAGEMENT_TAG_FILTER,
  EC2_MANAGEMENT_TAG_KEY, EC2_MANAGEMENT_TAG_VALUE,
  EC2_TIMEOUT_AT_TAG_KEY, EC2_WORKER_REGION, EC2_WORKER_ROOT_DEVICE,
  EC2_WORKER_ROOT_VOLUME_SIZE, EC2_WORKER_ROOT_VOLUME_TYPE,
} from "../provision/ProvisioningConstants.js";
import type { InstanceLaunchJournal, InstanceLaunchOptions } from "../provision/InstanceLaunch.js";
import type { CleanupResult } from "../provision/CleanupResult.js";
import type { ProvisionedResource } from "../provision/ProvisionedResource.js";

/**
 * Creates and terminates request-owned workers using a durable launch journal.
 * The existing request item retains launch intent before EC2 is contacted,
 * allowing callers to recover a lost response by its stable client token.
 * AWS tags identify every created instance, disk, and network interface.
 * Callers must retry failed operations and reconcile unfinished journals;
 * this service does not itself run a background cleanup process.
 */
export class EC2Service {
  /**
   * Requests termination of expired managed instances in the worker region.
   * Ownership and deadline tags allow discovery independently of launch IDs
   * in the request database. Stopped workers retain billable disks and remain
   * eligible. AWS handles attached resources using their termination settings.
   * Instance failures preserve partial results so callers can retry cleanup;
   * accepted requests do not confirm completion of asynchronous termination.
   */
  static async cleanupExpiredInstances(): Promise<CleanupResult> {
    const region = workerRegion();
    const tableName = process.env.REQUESTS_TABLE_NAME;
    if (!region?.trim() || !tableName?.trim()) throw new Error("Cleanup region and requests table are required");

    const client = new EC2Client({ region });
    const result: CleanupResult = {
      terminationRequested: [], skipped: [], failed: [], trackingFailed: [],
      queryFailed: [],
    };
    try {
      const seen = new Set<string>();
      let nextToken: string | undefined;

      // Search every page, including stopped instances with billable EBS volumes.
      do {
        const page = await client.send(new DescribeInstancesCommand({
          Filters: [
            { Name: EC2_MANAGEMENT_TAG_FILTER, Values: [EC2_MANAGEMENT_TAG_VALUE] },
            { Name: EC2_CLEANUP_STATE_FILTER, Values: [...EC2_CLEANUP_INSTANCE_STATES] },
          ], NextToken: nextToken,
        }));

        const instances = (page.Reservations ?? [])
          .flatMap((reservation) => reservation.Instances ?? []);

        for (const instance of instances) {
          const id = instance.InstanceId;
          if (!id || seen.has(id)) continue;
          seen.add(id);

          if (!expiredInstanceTags(instance, Date.now())) {
            result.skipped.push(id);
            continue;
          }

          try {
            // Re-read ownership and expiry before taking action; never use HTTP-supplied resource IDs.
            const fresh = await client.send(new DescribeInstancesCommand({ InstanceIds: [id] }));

            const current = fresh.Reservations
              ?.flatMap((reservation) => reservation.Instances ?? [])
              .find((instance) => instance.InstanceId === id);

            const ownership = current && expiredInstanceTags(current, Date.now());
            if (!current || !ownership) {
              result.skipped.push(id);
              continue;
            }

            // Load matching tracking when available; tagged workers can be cleaned without it.
            let journal: InstanceLaunchJournal | undefined;
            try {
              const saved = await InstanceJournal.get(ownership.deliveryId, tableName);
              if (!saved || saved.deliveryId !== ownership.deliveryId || saved.token !== ownership.token)
                throw new Error("Instance tags do not match the launch journal");
              journal = saved;
            } catch {
              result.trackingFailed.push(id);
            }

            await client.send(new TerminateInstancesCommand({ InstanceIds: [id] }));
            result.terminationRequested.push(id);

            // Save the discovered identity after EC2 accepts termination.
            if (journal) {
              const resource = instanceResource(
                current, { ...ownership, region: EC2_WORKER_REGION },
                journal.token, current.LaunchTime?.toISOString(),
              );
              resource.status = EC2_INSTANCE_RESOURCE_STATUS.TERMINATION_REQUESTED;
              resource.terminationRequestedAt = new Date().toISOString();
              try {
                await InstanceJournal.record(ownership.deliveryId, tableName, resource);
              } catch {
                result.trackingFailed.push(id);
              }
            }
          } catch {
            // Continue cleaning other workers if this instance cannot be rechecked or terminated.
            result.failed.push(id);
          }
        }

        nextToken = page.NextToken;
      } while (nextToken);
    } catch {
      result.queryFailed.push("instances");
    }

    return result;
  }

  /**
   * Provisions one worker and saves its identity for subsequent requests.
   * Retries reuse fixed deployment settings and the EC2 client token; the
   * caller must repeat the original deadline after a lost response or crash.
   * Existing workers are discovered by token; expired requests cannot launch
   * new workers. Timeout and cleanup callers own instance termination.
   * A saved result describes allocation, not successful guest bootstrapping.
   */
  static async createInstance(options: InstanceLaunchOptions, tableName = process.env.REQUESTS_TABLE_NAME): Promise<ProvisionedResource> {
    if (!tableName?.trim()) throw new Error("Requests table is required");
    const journal = await InstanceJournal.reserve(options, tableName);
    const token = journal.token;
    if (journal.instanceId) return (await findInstance(journal))!;
    const config = resolveInstanceLaunch(options);
    if (Date.parse(config.timeoutAt) <= Date.now()) throw new Error("Launch deadline has passed");

    const securityGroupId = process.env.EC2_SECURITY_GROUP_ID?.trim();
    if (!securityGroupId) throw new Error("Worker security group is required");

    const client = new EC2Client({ region: config.region });

    const tags = [
      { Key: EC2_MANAGEMENT_TAG_KEY, Value: EC2_MANAGEMENT_TAG_VALUE }, { Key: EC2_DELIVERY_ID_TAG_KEY, Value: config.deliveryId },
      { Key: EC2_LAUNCH_REQUEST_ID_TAG_KEY, Value: token }, { Key: EC2_TIMEOUT_AT_TAG_KEY, Value: config.timeoutAt },
    ];

    const blockDeviceMappings: BlockDeviceMapping[] = [{
      DeviceName: EC2_WORKER_ROOT_DEVICE,
      Ebs: { VolumeSize: EC2_WORKER_ROOT_VOLUME_SIZE, VolumeType: EC2_WORKER_ROOT_VOLUME_TYPE, DeleteOnTermination: true },
    }];

    const result = await client.send(new RunInstancesCommand({
      ImageId: config.imageId, InstanceType: config.instanceType, ClientToken: token,
      MinCount: 1, MaxCount: 1, InstanceInitiatedShutdownBehavior: "terminate",
      MetadataOptions: { HttpTokens: "required" },
      SecurityGroupIds: [securityGroupId],
      BlockDeviceMappings: blockDeviceMappings,
      TagSpecifications: [
        { ResourceType: "instance", Tags: tags }, { ResourceType: "volume", Tags: tags },
        { ResourceType: "network-interface", Tags: tags },
      ],
    }));
    if (result.Instances?.length !== 1) throw new Error("Unexpected launch response; retry with the saved launch token");
    const resource = instanceResource(
      result.Instances[0], config, token, result.Instances[0].LaunchTime?.toISOString(),
    );

    return InstanceJournal.record(config.deliveryId, tableName, resource);
  }

  /**
   * Refreshes the worker recorded for a request without creating anything.
   * Client-token discovery recovers an identity after a lost launch response,
   * while a saved ID survives temporarily empty or expired EC2 observations.
   * A launch owns one worker; multiple matches are reported as an invariant
   * violation and remain eligible for independent tag-driven timeout cleanup.
   * Recovery saves only identity; state and timestamps are transient observations.
   */
  static async recoverInstance(deliveryId: string, tableName = process.env.REQUESTS_TABLE_NAME): Promise<ProvisionedResource | undefined> {
    if (!tableName?.trim()) throw new Error("Requests table is required");
    const journal = await InstanceJournal.get(deliveryId, tableName);
    if (!journal) throw new Error("Resource launch journal not found");
    const resource = await findInstance(journal);
    if (!resource) return undefined;
    return InstanceJournal.record(deliveryId, tableName, resource);
  }

  /**
   * Asks EC2 to terminate the worker tracked for a request.
   * A saved instance ID is sufficient even if EC2 discovery is unavailable;
   * otherwise token discovery recovers launches with a lost response.
   * The saved identity remains available to subsequent creation calls.
   * Empty discovery needs a later retry or tag-based timeout sweep; an explicit
   * not-found deletion response is acknowledged without claiming observed state.
   */
  static async deleteInstance(deliveryId: string, tableName = process.env.REQUESTS_TABLE_NAME): Promise<ProvisionedResource | undefined> {
    if (!tableName?.trim()) throw new Error("Requests table is required");
    const journal = await InstanceJournal.get(deliveryId, tableName);
    if (!journal) throw new Error("Resource launch journal not found");

    const resource = savedInstanceResource(journal) ?? await findInstance(journal);
    if (!resource || resource.status === EC2_INSTANCE_RESOURCE_STATUS.TERMINATED) return resource;
    const client = new EC2Client({ region: workerRegion() });
    try {
      await client.send(new TerminateInstancesCommand({ InstanceIds: [resource.resourceId] }));
    } catch (error) {
      if (!(error instanceof Error) || error.name !== "InvalidInstanceID.NotFound") throw error;
      return InstanceJournal.record(deliveryId, tableName, {
        ...resource, status: undefined, updatedAt: new Date().toISOString(),
      });
    }

    const now = new Date().toISOString();
    return InstanceJournal.record(deliveryId, tableName, {
      ...resource, status: EC2_INSTANCE_RESOURCE_STATUS.TERMINATION_REQUESTED,
      terminationRequestedAt: resource.terminationRequestedAt ?? now, updatedAt: now,
    });
  }
}

/**
 * Finds the worker using the fixed region and saved idempotency token.
 * Creation, recovery, and deletion share this lookup, but discovery itself
 * performs no database writes so failed tracking cannot block termination.
 * Empty observations retain a known identity because EC2 can temporarily
 * omit instances. Multiple distinct identities violate the launch contract.
 */
async function findInstance(journal: InstanceLaunchJournal): Promise<ProvisionedResource | undefined> {
  const client = new EC2Client({ region: workerRegion() });
  const observed = new Map<string, ProvisionedResource>();
  let nextToken: string | undefined;
  do {
    const page = await client.send(new DescribeInstancesCommand({
      Filters: [{ Name: "client-token", Values: [journal.token] }], NextToken: nextToken,
    }));
    for (const reservation of page.Reservations ?? [])
      for (const instance of reservation.Instances ?? []) {
        const resource = instanceResource(instance, {
          deliveryId: journal.deliveryId, region: EC2_WORKER_REGION,
          timeoutAt: instance.Tags?.find((tag) => tag.Key === EC2_TIMEOUT_AT_TAG_KEY)?.Value ?? "",
        }, journal.token, instance.LaunchTime?.toISOString());
        observed.set(resource.resourceId, resource);
      }
    nextToken = page.NextToken;
  } while (nextToken);

  if (observed.size > 1) throw new Error("Multiple instances found for one launch");
  const resource = observed.values().next().value;
  return resource ?? savedInstanceResource(journal);
}
