import { EC2Service } from "../aws/EC2Service.js";
import { authenticateApiKey } from "../shared/ApiKeyAuthentication.js";
import { respond, type FunctionUrlRequest } from "../shared/http.js";
import { log } from "../shared/Logger.js";
import { INSTANCE_CLEANUP_LOG_EVENT } from "./ProvisioningConstants.js";

/**
 * Reconciles expired managed workers when an authenticated caller requests cleanup.
 * The server's region and durable tags determine scope; the request body
 * cannot supply resource IDs or shorten a deadline. Instances and detached
 * volumes and interfaces are rechecked before their deletion requests.
 * Partial action, tracking and discovery failures return 500 with their IDs
 * or categories so recurring passes can retry without hiding prior progress.
 */
export async function handleCleanup(event: FunctionUrlRequest) {
  const denied = authenticateApiKey(event);
  if (denied) return denied;

  try {
    const result = await EC2Service.cleanupExpiredInstances();
    log("info", INSTANCE_CLEANUP_LOG_EVENT.COMPLETED, {
      terminationRequested: result.terminationRequested.length, skipped: result.skipped.length,
      failed: result.failed.length, trackingFailed: result.trackingFailed.length,
      deletedVolumes: result.deletedVolumes.length, deletedNetworkInterfaces: result.deletedNetworkInterfaces.length,
      queryFailed: result.queryFailed.length,
    });
    const hasFailures = result.failed.length > 0 || result.trackingFailed.length > 0 || result.queryFailed.length > 0;
    return respond(hasFailures ? 500 : 200, result);
  } catch {
    log("error", INSTANCE_CLEANUP_LOG_EVENT.FAILED);
    return respond(500, { message: "Failed to query managed instances for cleanup" });
  }
}
