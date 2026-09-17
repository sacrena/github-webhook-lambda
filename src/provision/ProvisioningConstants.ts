/**
 * Defines stable identifiers shared by EC2 provisioning and cleanup flows.
 * These values cross AWS tags, persisted resource records, and operational
 * logs, so changing their spelling would break discovery or observability.
 * Keep new cross-module provisioning identifiers here rather than duplicating
 * string literals at their individual call sites.
 */
export const EC2_MANAGEMENT_TAG_KEY = "ManagedBy";
export const EC2_MANAGEMENT_TAG_VALUE = "agentic-setup";
export const EC2_MANAGEMENT_TAG_FILTER = `tag:${EC2_MANAGEMENT_TAG_KEY}`;
export const EC2_DELIVERY_ID_TAG_KEY = "DeliveryId";
export const EC2_LAUNCH_REQUEST_ID_TAG_KEY = "LaunchRequestId";
export const EC2_TIMEOUT_AT_TAG_KEY = "TimeoutAt";
export const EC2_INSTANCE_RESOURCE_TYPE = "ec2_instance";
export const EC2_CLEANUP_STATE_FILTER = "instance-state-name";

// This AMI and root device are pinned to Canonical Ubuntu 24.04 ARM64 in us-east-1.
export const EC2_WORKER_REGION = "us-east-1";
export const EC2_WORKER_IMAGE_ID = "ami-0246d714afcc1d494";
export const EC2_WORKER_INSTANCE_TYPE = "m8g.xlarge";
export const EC2_WORKER_ROOT_DEVICE = "/dev/sda1";
export const EC2_WORKER_ROOT_VOLUME_SIZE = 50;
export const EC2_WORKER_ROOT_VOLUME_TYPE = "gp3";

export const EC2_INSTANCE_STATE_PENDING = "pending";
export const EC2_INSTANCE_STATE_RUNNING = "running";
export const EC2_INSTANCE_STATE_STOPPING = "stopping";
export const EC2_INSTANCE_STATE_STOPPED = "stopped";
export const EC2_INSTANCE_STATE_SHUTTING_DOWN = "shutting-down";
export const EC2_INSTANCE_STATE_TERMINATED = "terminated";

export const EC2_CLEANUP_INSTANCE_STATES = [
  EC2_INSTANCE_STATE_PENDING, EC2_INSTANCE_STATE_RUNNING, EC2_INSTANCE_STATE_STOPPING,
  EC2_INSTANCE_STATE_STOPPED, EC2_INSTANCE_STATE_SHUTTING_DOWN,
] as const;

export const EC2_INSTANCE_RESOURCE_STATUS = {
  PROVISIONING: "provisioning", ACTIVE: "active", TERMINATION_REQUESTED: "termination_requested",
  TERMINATED: "terminated", STOPPING: "stopping", STOPPED: "stopped",
} as const;

export const INSTANCE_CLEANUP_LOG_EVENT = {
  COMPLETED: "cleanup.completed", FAILED: "cleanup.failed",
} as const;
