import { authenticateApiKey } from "../shared/ApiKeyAuthentication.js";
import { respond, type FunctionUrlRequest } from "../shared/http.js";
import { log } from "../shared/Logger.js";
import { DynamoService } from "../aws/DynamoService.js";
import { EC2Service } from "../aws/EC2Service.js";
import { requestDeadline } from "../requests/RequestDeadline.js";
import { lifecycleDeliveryId } from "./LifecycleEvent.js";

/**
 * Allocates the worker belonging to an authenticated provisioning delivery.
 * Only the delivery identity is accepted from the event; the stored request
 * supplies the original timestamp used to derive a repeatable deadline.
 * Expired deliveries are acknowledged without launching a new worker, while
 * service failures return a retryable response and retain launch recovery data.
 * Allocation acceptance does not imply that the guest has completed booting.
 *
 * @param event Function URL request containing the API key and event body.
 * @returns An allocation response, an expired acknowledgement, or a validation/service error.
 */
export async function handleProvision(event: FunctionUrlRequest) {
  const denied = authenticateApiKey(event);
  if (denied) return denied;

  const deliveryId = lifecycleDeliveryId(event, "ProvisionRequested");
  if (!deliveryId) return respond(400, { message: "Invalid provisioning event" });

  try {
    const tableName = process.env.REQUESTS_TABLE_NAME;
    if (!tableName?.trim()) throw new Error("Requests table is required");
    const request = await DynamoService.get(tableName, deliveryId);
    if (!request) return respond(404, { message: "Tracked request not found" });
    const timeoutAt = requestDeadline(request.receivedAt);
    if (Date.parse(timeoutAt) <= Date.now())
      return respond(200, { message: "Provisioning deadline has passed", deliveryId, timeoutAt });

    const resource = await EC2Service.createInstance({ deliveryId, timeoutAt }, tableName);
    log("info", "provision.completed", { deliveryId, resourceId: resource.resourceId });
    return respond(202, { resource });
  } catch {
    log("error", "provision.failed", { deliveryId });
    return respond(500, { message: "Failed to provision worker" });
  }
}
