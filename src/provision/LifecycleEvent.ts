import { decodeRequestBody, type FunctionUrlRequest } from "../shared/http.js";

/**
 * Selects request identity from an authenticated EventBridge delivery.
 * Lifecycle endpoints use only this identity to load authoritative stored
 * input; caller-supplied deadlines, resource IDs and configuration are ignored.
 * Restricting source and event category prevents other bus traffic from
 * accidentally invoking provisioning or early termination operations.
 *
 * @returns A nonblank delivery identity, or undefined for an invalid envelope.
 */
export function lifecycleDeliveryId(event: FunctionUrlRequest, detailType: string): string | undefined {
  try {
    const envelope = JSON.parse(decodeRequestBody(event));
    const deliveryId = envelope?.detail?.deliveryId;
    if (envelope?.source !== "agentic.setup" || envelope["detail-type"] !== detailType
      || typeof deliveryId !== "string" || !deliveryId.trim()) return undefined;
    return deliveryId;
  } catch {
    return undefined;
  }
}
