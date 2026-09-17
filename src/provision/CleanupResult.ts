/**
 * Reports what a regional cleanup pass requested and what needs attention.
 * Termination requests are asynchronous, so their IDs do not imply that EC2
 * has finished removing instances or attached storage. Invalid ownership or
 * deadline tags cause an instance to be skipped rather than guessed expired.
 * Failures are reported per resource or discovery category so cleanup can retry.
 */
export interface CleanupResult {
  /** Detached expired volumes whose deletion was accepted or already completed. */
  deletedVolumes: string[];
  /** Detached expired interfaces whose deletion was accepted or already completed. */
  deletedNetworkInterfaces: string[];
  /** Resource categories whose discovery failed and need a later sweep. */
  queryFailed: string[];
  /** Instances for which EC2 accepted a termination request. */
  terminationRequested: string[];
  /** Resource IDs retained because their metadata or attachment state is ineligible. */
  skipped: string[];
  /** Resource IDs whose recheck or deletion failed and should be retried. */
  failed: string[];
  /** Instances whose request journal could not be read, matched, or updated. */
  trackingFailed: string[];
}
