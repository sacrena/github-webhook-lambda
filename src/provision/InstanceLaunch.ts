import type { _InstanceType } from "@aws-sdk/client-ec2";

/**
 * Supplies the fixed launch configuration for one request-owned EC2 worker.
 * Deployment constants select an EBS-backed image while EC2 selects a default-VPC subnet.
 * The service creates the instance, disks, and its primary interface.
 * The configuration exists only in memory for the launch operation.
 * Credentials must not be stored in this input or the launch journal.
 */
export interface InstanceLaunch {
  /** Request already persisted by webhook intake. */
  deliveryId: string;
  /** AWS region used for both creation and eventual cleanup. */
  region: string;
  /** Existing EBS-backed AMI to boot. */
  imageId: string;
  /** EC2 instance size appropriate for the image architecture. */
  instanceType: _InstanceType;
  /** Absolute UTC deadline used by timeout cleanup. */
  timeoutAt: string;
}

/**
 * Supplies request identity and expiry for the fixed worker configuration.
 * Delivery identity and the absolute deadline remain explicit so retries do
 * not silently extend a worker's lifetime. Region, AMI, and size
 * come from deployment constants. Retries must supply the same deadline;
 * the stack-owned security group is not stored here.
 */
export type InstanceLaunchOptions = Pick<InstanceLaunch, "deliveryId" | "timeoutAt">;

/**
 * Preserves launch intent before an instance identifier is available.
 * The journal lives within the existing tracked request item so recovery
 * can locate the worker by token in the fixed region after a lost response.
 * Once allocation is saved, repeated calls retain that instance identity.
 * Configuration and observed state remain outside this durable record.
 */
export interface InstanceLaunchJournal {
  /** Request identity associated with this worker. */
  deliveryId: string;
  /** Stable EC2 idempotency token derived from the delivery ID. */
  token: string;
  /** EC2 identity, absent until a response or discovery is saved. */
  instanceId?: string;
}
