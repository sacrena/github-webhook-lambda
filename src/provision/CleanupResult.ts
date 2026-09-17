/**
 * Reports what a regional cleanup pass requested and what needs attention.
 * Termination requests are asynchronous, so their IDs do not imply that EC2
 * has finished removing instances or attached storage. Invalid ownership or
 * deadline tags cause an instance to be skipped rather than guessed expired.
 * Failures are reported per resource or discovery category so cleanup can retry.
 */
export interface CleanupResult {
  /** Instance discovery failures requiring a later sweep. */
  queryFailed: string[];
  /** Instances for which EC2 accepted a termination request. */
  terminationRequested: string[];
  /** Instance IDs retained because their metadata or state is ineligible. */
  skipped: string[];
  /** Instance IDs whose recheck or termination failed and should be retried. */
  failed: string[];
  /** Instances whose request journal could not be read, matched, or updated. */
  trackingFailed: string[];
}
