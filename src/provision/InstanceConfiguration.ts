import type { InstanceLaunch, InstanceLaunchOptions } from "./InstanceLaunch.js";
import { EC2_WORKER_REGION, EC2_WORKER_IMAGE_ID, EC2_WORKER_INSTANCE_TYPE } from "./ProvisioningConstants.js";

/**
 * Supplies the pinned Ubuntu ARM worker configuration for a delivery.
 * The image, instance size, and region are maintained together as deployment
 * constants so retries use the same infrastructure choices. Only delivery
 * identity and expiry vary by request; callers must repeat the same deadline.
 * UTC normalization keeps the expiry tag compatible with recurring cleanup.
 *
 * @throws Missing delivery identity or an invalid deadline.
 */
export function resolveInstanceLaunch(options: InstanceLaunchOptions): InstanceLaunch {
  if (!options.deliveryId?.trim() || !Number.isFinite(Date.parse(options.timeoutAt)))
    throw new Error("Delivery ID and a valid timeout are required");

  return {
    deliveryId: options.deliveryId, timeoutAt: new Date(options.timeoutAt).toISOString(),
    region: workerRegion(), imageId: EC2_WORKER_IMAGE_ID, instanceType: EC2_WORKER_INSTANCE_TYPE,
  };
}

/**
 * Keeps the pinned AMI and stack-owned networking in their supported region.
 * Lambda supplies AWS_REGION automatically, while local service tests may
 * omit it and use the pinned worker region. A mismatched deployment fails
 * before resource operations rather than mixing a regional security group
 * and IAM policy with an EC2 client targeting a different AWS region.
 */
export function workerRegion(): string {
  if (process.env.AWS_REGION && process.env.AWS_REGION !== EC2_WORKER_REGION)
    throw new Error(`Worker deployment requires AWS_REGION=${EC2_WORKER_REGION}`);
  return EC2_WORKER_REGION;
}
