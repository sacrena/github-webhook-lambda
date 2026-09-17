/**
 * Describes the Function URL transport data consumed by the application.
 * Optional fields let handlers reject incomplete requests through their
 * normal response paths and allow small fixtures in endpoint tests.
 * Request identity is used only to correlate operational logs, while the
 * original body and headers remain available for signature verification.
 */
export interface FunctionUrlRequest {
  /** Incoming route used by the Lambda dispatcher. */
  rawPath?: string;
  /** Original body text, possibly encoded by the Function URL transport. */
  body?: string;
  /** Whether the body must be decoded from base64 before authentication. */
  isBase64Encoded?: boolean;
  /** Delivery metadata and signature supplied with the request. */
  headers?: Record<string, string | undefined>;
  /** Transport identity and HTTP details provided by Lambda. */
  requestContext?: {
    /** Request identifier used to correlate logs for this invocation. */
    requestId?: string;
    /** HTTP routing metadata supplied by the Function URL. */
    http?: {
      /** HTTP verb used when selecting an endpoint. */
      method?: string;
    };
  };
}

/**
 * Decodes the request payload into the text consumed by HTTP features.
 * EventBridge endpoints use this at their boundary so their handlers receive
 * the original event envelope regardless of Function URL body encoding.
 * Missing bodies are intentionally represented as empty text for logging.
 * Authentication remains the responsibility of the calling endpoint.
 * Invalid base64 follows Node's Buffer decoding behavior without validation.
 *
 * @param event Function URL request whose body may be base64 encoded.
 * @returns The decoded body text, or an empty string when no body was supplied.
 */
export function decodeRequestBody(event: FunctionUrlRequest) {
  return event.isBase64Encoded
    ? Buffer.from(event.body ?? "", "base64").toString("utf8") : event.body ?? "";
}

/**
 * Builds the JSON transport response shared by all endpoint handlers.
 * Feature code chooses the status and public payload before calling this
 * boundary, keeping serialization separate from authentication and mapping.
 * The content type applies to every outcome, including validation failures.
 * Callers must provide a JSON-serializable payload; serialization can throw.
 */
export const respond = (statusCode: number, payload: object) => ({
  statusCode,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(payload),
});
