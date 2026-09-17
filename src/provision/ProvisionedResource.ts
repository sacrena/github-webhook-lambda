import {
  EC2_INSTANCE_RESOURCE_STATUS, EC2_INSTANCE_RESOURCE_TYPE,
} from "./ProvisioningConstants.js";

/**
 * Describes the infrastructure lifecycle independently of request processing.
 * The service distinguishes allocated, running, stopped, and terminating
 * workers without inferring whether their coding jobs succeeded. A running
 * instance does not establish that guest bootstrapping completed, and an
 * accepted termination request is not confirmation that deletion finished.
 */
export type ProvisionedResourceStatus = typeof EC2_INSTANCE_RESOURCE_STATUS[
  keyof typeof EC2_INSTANCE_RESOURCE_STATUS
];

/**
 * Describes one infrastructure resource observed for an accepted request.
 * The delivery ID links it to the durable request, while launchRequestId
 * supplies the stable idempotency key required when provisioning is retried.
 * Resource identity and region provide the coordinates needed for cleanup.
 * State and timestamps are transient EC2 observations and may be absent
 * when discovery is empty and only the persisted identity is available.
 */
export interface ProvisionedResource {
  /** GitHub delivery ID linking the resource to its tracked request. */
  deliveryId: string;
  /** Stable client token reused across retries of the same resource launch. */
  launchRequestId: string;
  /** Cloud provider identifier, such as an EC2 instance ID. */
  resourceId: string;
  /** Resource category used to select provisioning and cleanup operations. */
  resourceType: typeof EC2_INSTANCE_RESOURCE_TYPE;
  /** AWS region containing the resource. */
  region: string;
  /** Observed infrastructure lifecycle state, when EC2 returned the worker. */
  status?: ProvisionedResourceStatus;
  /** EC2 launch time when available from the observation. */
  createdAt?: string;
  /** ISO 8601 time of the latest EC2 observation or termination request. */
  updatedAt?: string;
  /** Observed expiry tag used by timeout cleanup, when available. */
  timeoutAt?: string;
  /** ISO 8601 time when termination was requested, when applicable. */
  terminationRequestedAt?: string;
}
