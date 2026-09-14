import { createHmac, timingSafeEqual } from "node:crypto";

interface WebhookRequest {
  headers: Record<string, string | undefined>;
  body?: string;
  isBase64Encoded?: boolean;
  requestContext: { http: { method: string } };
}

const actions: Record<string, string> = {
  pull_request: "opened",
  issues: "opened",
  issue_comment: "created", // Includes comments on PRs as well as issues.
  pull_request_review_comment: "created",
};

export async function handler(event: WebhookRequest) {
  const respond = (statusCode: number, body: string) => ({ statusCode, body });
  if (event.requestContext.http.method !== "POST") {
    return respond(405, "Method not allowed");
  }

  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) {
    console.error("WEBHOOK_SECRET is not configured");
    return respond(500, "Webhook not configured");
  }

  const headers = Object.fromEntries(
    Object.entries(event.headers).map(([key, value]) => [key.toLowerCase(), value]),
  );
  const body = Buffer.from(event.body ?? "", event.isBase64Encoded ? "base64" : "utf8");
  const signature = headers["x-hub-signature-256"] ?? "";
  const expected = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  if (!/^sha256=[a-f0-9]{64}$/.test(signature) ||
      !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return respond(401, "Invalid signature");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body.toString("utf8"));
  } catch {
    return respond(400, "Invalid JSON");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return respond(400, "Expected a JSON object");
  }

  const eventType = headers["x-github-event"] ?? "";
  if (eventType === "ping") return respond(200, "pong");
  if (!Object.hasOwn(actions, eventType) ||
      actions[eventType] !== (payload as { action?: unknown }).action) {
    return respond(200, "Ignored");
  }

  console.log(JSON.stringify({
    event: eventType,
    deliveryId: headers["x-github-delivery"],
    payload,
  }));
  return respond(200, "OK");
}
