import { authenticateApiKey } from "../shared/ApiKeyAuthentication.js";
import { respond, type FunctionUrlRequest } from "../shared/http.js";
import { log } from "../shared/Logger.js";
import { DynamoService } from "../aws/DynamoService.js";
import { EC2Service } from "../aws/EC2Service.js";
import { InstanceJournal } from "../provision/InstanceJournal.js";
import { lifecycleDeliveryId } from "../provision/LifecycleEvent.js";
import { requestDeadline } from "../requests/RequestDeadline.js";

/**
 * Terminates the recorded worker once its persisted request deadline passes.
 * Event identity selects the request, while stored intake time prevents an
 * authenticated but premature callback from shortening the worker lifetime.
 * Requests with no launch intent need no deletion; uncertain discovery stays
 * retryable and the independent tagged-resource sweep remains a fallback.
 * Successful termination acceptance is distinct from confirmed EC2 deletion.
 *
 * @param event Function URL request containing the API key and event body.
 * @returns Termination acceptance, a no-launch acknowledgement, or a validation/service error.
 */
export async function handleTimeout(event: FunctionUrlRequest) {
  const denied = authenticateApiKey(event);
  if (denied) return denied;

  const deliveryId = lifecycleDeliveryId(event, "TimeoutRequested");
  if (!deliveryId) return respond(400, { message: "Invalid timeout event" });

  try {
    const tableName = process.env.REQUESTS_TABLE_NAME;
    if (!tableName?.trim()) throw new Error("Requests table is required");
    const request = await DynamoService.get(tableName, deliveryId);
    if (!request) return respond(404, { message: "Tracked request not found" });
    const timeoutAt = requestDeadline(request.receivedAt);
    if (Date.parse(timeoutAt) > Date.now())
      return respond(503, { message: "Worker deadline has not passed", deliveryId, timeoutAt });

    const journal = await InstanceJournal.get(deliveryId, tableName);
    if (!journal) return respond(200, { message: "No worker launch recorded", deliveryId });
    const resource = await EC2Service.deleteInstance(deliveryId, tableName);
    if (!resource) return respond(503, { message: "Worker discovery incomplete; retry required", deliveryId });

    log("info", "timeout.completed", { deliveryId, resourceId: resource.resourceId });
    return respond(202, { resource });
  } catch {
    log("error", "timeout.failed", { deliveryId });
    return respond(500, { message: "Failed to terminate worker" });
  }
}
