import { respond } from "../shared/http.js";
import { log } from "../shared/Logger.js";

/**
 * Answers the health check used to verify that the Lambda is reachable.
 * This endpoint performs no downstream dependency checks, so a successful
 * response confirms routing and execution rather than GitHub readiness.
 * Its diagnostic event uses debug severity to limit routine health traffic.
 * The entry point separately records the request's status and duration.
 */
export function handlePing() {
  log("debug", "ping.responded");
  return respond(200, { message: "pong" });
}
