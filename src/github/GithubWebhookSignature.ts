import { createHmac, timingSafeEqual } from "node:crypto";

import type { FunctionUrlRequest } from "../shared/http.js";
import { log } from "../shared/Logger.js";

/**
 * Gives the webhook handler either authenticated bytes or a rejection.
 * The discriminated result keeps signature validation distinct from payload
 * parsing while allowing the handler to return the appropriate HTTP result.
 * A successful result contains only delivery bytes; failures contain only
 * response details safe to send to an unauthenticated caller.
 */
type GitHubWebhookVerification = {
  /** Original decoded bytes authenticated by the signature. */
  body: Buffer;
} | {
  /** HTTP status for failed authentication or missing configuration. */
  statusCode: 401 | 500;
  /** Response message that does not expose secret material. */
  message: string;
};

/**
 * Compares a supplied signature with GitHub's expected SHA-256 digest.
 * Both values include the required sha256= prefix, which forms part of
 * GitHub's header contract. Length is checked before the constant-time
 * comparison because Node requires equal-sized inputs for that operation.
 * Missing and malformed signatures simply fail verification.
 */
function hasValidSignature(body: Buffer, signature: string | undefined, secret: string): boolean {
  if (!signature) return false;

  const digest = createHmac("sha256", secret).update(body).digest("hex");
  const expected = Buffer.from(`sha256=${digest}`);
  const supplied = Buffer.from(signature);

  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

/**
 * Authenticates an incoming GitHub delivery before business handling.
 * It reads the deployment-provided secret and verifies X-Hub-Signature-256
 * over the original request bytes, following GitHub's delivery contract.
 * The caller must use returned bytes rather than reconstructing JSON prior
 * to verification, otherwise signatures could no longer be trusted.
 */
export function verifyGitHubWebhook(event: FunctionUrlRequest): GitHubWebhookVerification {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;

  if (!secret) {
    log("error", "github.signature.secret_unavailable");
    return { statusCode: 500, message: "GitHub webhook secret is unavailable" };
  }

  const encoding = event.isBase64Encoded ? "base64" : "utf8";
  const body = Buffer.from(event.body ?? "", encoding);
  const signature = event.headers?.["x-hub-signature-256"]
    ?? event.headers?.["X-Hub-Signature-256"];

  if (!hasValidSignature(body, signature, secret)) {
    log("warn", "github.signature.rejected", { reason: signature ? "invalid" : "missing" });
    return { statusCode: 401, message: "Invalid GitHub webhook signature" };
  }

  log("debug", "github.signature.verified");

  return { body };
}
