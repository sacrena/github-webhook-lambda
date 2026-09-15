import { respond } from "../shared/http.js";

/** Answer the health check so callers can verify the Lambda is reachable. */
export function handlePing() {
  return respond(200, { message: "pong" });
}
