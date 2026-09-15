/** The Function URL fields consumed by the feature handlers. */
export interface FunctionUrlRequest {
  rawPath?: string;
  body?: string;
  isBase64Encoded?: boolean;
  headers?: Record<string, string | undefined>;
  requestContext?: { http?: { method?: string } };
}

/** Build a JSON response in the format expected by Lambda Function URLs. */
export const respond = (statusCode: number, payload: object) => ({
  statusCode,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(payload),
});
