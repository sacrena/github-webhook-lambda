import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, test } from "node:test";

import { handler } from "../../dist/index.js";
import { verifyGitHubWebhook } from "../../dist/github/GithubWebhookSignature.js";

let originalSecret;
beforeEach(() => {
  originalSecret = process.env.GITHUB_WEBHOOK_SECRET;
  process.env.GITHUB_WEBHOOK_SECRET = "Jefe";
});
afterEach(() => {
  if (originalSecret === undefined) delete process.env.GITHUB_WEBHOOK_SECRET;
  else process.env.GITHUB_WEBHOOK_SECRET = originalSecret;
});

// RFC 4231 case 2 gives an expected digest independent of our implementation.
const body = "what do ya want for nothing?";
const signature = "sha256=5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843";
const headers = { "x-hub-signature-256": signature };

test("accepts the published HMAC vector and returns the original bytes", () => {
  const result = verifyGitHubWebhook({ body, headers });
  assert.deepEqual(result, { body: Buffer.from(body) });
});

test("rejects tampering, wrong secrets, and malformed signatures", () => {
  const invalidSignatures = [
    undefined, "", signature.slice(0, -1), `${signature}0`,
    signature.replace("sha256=", "sha1="), `sha256=${"0".repeat(64)}`,
  ];
  for (const supplied of invalidSignatures) {
    const result = verifyGitHubWebhook({
      body, headers: { "x-hub-signature-256": supplied },
    });
    assert.equal(result.statusCode, 401, `signature: ${supplied}`);
  }

  assert.equal(verifyGitHubWebhook({ body: `${body}\n`, headers }).statusCode, 401);
  process.env.GITHUB_WEBHOOK_SECRET = "wrong-secret";
  assert.equal(verifyGitHubWebhook({ body, headers }).statusCode, 401);
});

test("fails closed for missing or empty secret without breaking ping", async () => {
  for (const secret of [undefined, ""]) {
    if (secret === undefined) delete process.env.GITHUB_WEBHOOK_SECRET;
    else process.env.GITHUB_WEBHOOK_SECRET = secret;

    const response = await handler({
      rawPath: "/github/webhooks", requestContext: { http: { method: "POST" } },
      body, headers: { ...headers, "x-github-event": "ping" },
    });
    assert.equal(response.statusCode, 500);
  }

  const ping = await handler({
    rawPath: "/ping", requestContext: { http: { method: "GET" } },
  });
  assert.equal(ping.statusCode, 200);
});

test("authenticates Unicode and whitespace before parsing plain or base64 JSON", async () => {
  const json = '{\n  "zen": "Hello 🌍"\n}';
  const digest = createHmac("sha256", "Jefe").update(json).digest("hex");
  const request = {
    rawPath: "/github/webhooks", requestContext: { http: { method: "POST" } },
    headers: { "X-GitHub-Event": "ping", "X-Hub-Signature-256": `sha256=${digest}` },
  };
  for (const isBase64Encoded of [false, true]) {
    const encoded = isBase64Encoded ? Buffer.from(json).toString("base64") : json;
    const response = await handler({ ...request, body: encoded, isBase64Encoded });
    assert.equal(response.statusCode, 202);
  }

  const tampered = await handler({ ...request, body: json.replace("Hello", "Goodbye") });
  assert.equal(tampered.statusCode, 401);
  const malformed = await handler({ ...request, body: "not json" });
  assert.equal(malformed.statusCode, 401);
  const digestOfMalformed = createHmac("sha256", "Jefe").update("not json").digest("hex");
  const authenticatedMalformed = await handler({
    ...request, body: "not json",
    headers: { "x-github-event": "ping", "x-hub-signature-256": `sha256=${digestOfMalformed}` },
  });
  assert.equal(authenticatedMalformed.statusCode, 400);
});
