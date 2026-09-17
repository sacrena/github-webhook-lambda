import { timingSafeEqual } from "node:crypto";
import { respond, type FunctionUrlRequest } from "./http.js";

/**
 * Authenticates API calls using the shared EventBridge connection key.
 * Provisioning, timeout, and cleanup routes use the same header contract.
 * Missing server configuration produces a server error; absent or incorrect
 * caller credentials receive an unauthorized response before side effects.
 * Successful authentication returns undefined for the feature to continue.
 */
export function authenticateApiKey(event: FunctionUrlRequest) {
  const expected = process.env.PROVISION_API_KEY;
  if (!expected) return respond(500, { message: "Provisioning API key unavailable" });

  const supplied = Object.entries(event.headers ?? {})
    .find(([name]) => name.toLowerCase() === "x-api-key")?.[1] ?? "";

  const actualBytes = Buffer.from(supplied);
  const expectedBytes = Buffer.from(expected);

  if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes))
    return respond(401, { message: "Unauthorized" });
}
