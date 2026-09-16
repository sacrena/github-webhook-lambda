import { timingSafeEqual } from "node:crypto";
import { respond, type FunctionUrlRequest } from "../shared/http.js";
import { log } from "../shared/Logger.js";

/**
 * Receives EventBridge deliveries for the placeholder provisioning workflow.
 * The connection and Lambda share an API key supplied by CloudFormation;
 * authentication must succeed before any delivery data enters the logs.
 * Accepted bodies are logged as decoded text, preserving the event envelope
 * without imposing a provisioning schema. This endpoint acknowledges receipt
 * only: it starts no work and does not deduplicate EventBridge retries.
 */
export function handleProvision(event: FunctionUrlRequest) {
  const expected = process.env.PROVISION_API_KEY;
  if (!expected) return respond(500, { message: "Provisioning API key unavailable" });

  const supplied = Object.entries(event.headers ?? {})
    .find(([name]) => name.toLowerCase() === "x-api-key")?.[1] ?? "";

  const actualBytes = Buffer.from(supplied);
  const expectedBytes = Buffer.from(expected);

  if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes))
    return respond(401, { message: "Unauthorized" });

  const data = event.isBase64Encoded
    ? Buffer.from(event.body ?? "", "base64")
      .toString("utf8") : event.body ?? "";

  log("info", "provision.received", { data });
  return respond(202, { message: "Provisioning event received" });
}
