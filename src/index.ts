import { handleGitHub } from "./github/GithubWebhook.js";
import { handlePing } from "./ping/PingEndpoint.js";
import { respond, type FunctionUrlRequest } from "./shared/http.js";
import { randomUUID } from "node:crypto";
import { log, withLogContext } from "./shared/Logger.js";

// Preserve the existing public extraction and type exports.
export { extractGitHubWebhook } from "./github/GithubWebhook.js";
export type * from "./github/GithubTypes.js";

/**
 * Routes Function URL requests to the feature responsible for their path.
 * HTTP method and path must both match a supported endpoint before
 * the request is delegated. Each feature owns its body parsing and
 * response handling, keeping transport routing independent of payloads.
 * Unknown method and path combinations receive a JSON 404 response.
 */
export async function handler(event: FunctionUrlRequest) {
  const method = event.requestContext?.http?.method;
  const requestId = event.requestContext?.requestId ?? randomUUID();
  return withLogContext({ requestId, method, path: event.rawPath }, () => {
    const started = performance.now();
    log("info", "http.request.started");
    try {
      let response;
      if (method === "GET" && event.rawPath === "/ping") response = handlePing();
      else if (method === "POST" && event.rawPath === "/github/webhooks")
        response = handleGitHub(event);
      else {
        log("warn", "http.route.not_found");
        response = respond(404, { message: "Not found" });
      }
      log("info", "http.request.completed", {
        statusCode: response.statusCode, durationMs: performance.now() - started,
      });
      return response;
    } catch (error) {
      log("error", "http.request.failed", { durationMs: performance.now() - started });
      throw error;
    }
  });
}
