import { handlePing } from "./ping/PingEndpoint.js";
import { respond, type FunctionUrlRequest } from "./shared/http.js";

/**
 * Routes Function URL requests to the feature responsible for their path.
 * HTTP method and path must both match a supported endpoint before
 * the request is delegated. Each feature owns its body parsing and
 * response handling, keeping transport routing independent of payloads.
 * Unknown method and path combinations receive a JSON 404 response.
 */
export async function handler(event: FunctionUrlRequest) {
  const method = event.requestContext?.http?.method;
  if (method === "GET" && event.rawPath === "/ping") return handlePing();
  return respond(404, { message: "Not found" });
}
