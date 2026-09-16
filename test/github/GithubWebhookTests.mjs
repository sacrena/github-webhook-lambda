import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { EventBridgeService } from "../../dist/aws/EventBridgeService.js";

import {
  extractGitHubWebhook,
  handleGitHub,
} from "../../dist/github/GithubWebhook.js";

process.env.GITHUB_WEBHOOK_SECRET = "test-webhook-secret";
process.env.EVENT_BUS_NAME = "test-bus";

const user = {
  id: 1,
  login: "octocat",
  html_url: "https://github.com/octocat",
};
const repository = {
  id: 2,
  name: "hello",
  full_name: "octocat/hello",
  html_url: "https://github.com/octocat/hello",
  private: false,
};
const issue = {
  id: 3,
  number: 4,
  title: "Bug",
  body: null,
  state: "open",
  html_url: "https://github.com/octocat/hello/issues/4",
  user,
  labels: [{ name: "bug" }],
  assignees: [],
  comments: 1,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  closed_at: null,
};
const comment = {
  id: 5,
  body: "Please fix",
  html_url: "https://github.com/octocat/hello/issues/4#issuecomment-5",
  user,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};
const pullRequest = {
  ...issue,
  draft: false,
  merged: false,
  head: { ref: "fix/bug", sha: "head-sha" },
  base: { ref: "main", sha: "base-sha" },
  merged_at: null,
};

/**
 * Sends a serialized delivery through the feature's HTTP boundary.
 * Tests use this helper to exercise parsing and validation together,
 * while direct extractor calls cover normalized output separately.
 * Request overrides allow individual transport cases to share fixtures.
 * The returned promise resolves to the intact Lambda response for checks.
 */
function githubRequest(sourceEvent, payload, options = {}) {
  const body = options.body ?? JSON.stringify(payload);
  const bytes = options.isBase64Encoded
    ? Buffer.from(body, "base64")
    : Buffer.from(body, "utf8");
  const digest = createHmac("sha256", process.env.GITHUB_WEBHOOK_SECRET)
    .update(bytes).digest("hex");
  return handleGitHub({
    headers: {
      "x-github-event": sourceEvent,
      "x-hub-signature-256": `sha256=${digest}`,
    },
    body,
    ...options,
  });
}

test("agent prefixes publish the original payload across supported content types", async (t) => {
  const publish = t.mock.method(EventBridgeService, "putEvent", async () => "event-1");
  const base = { action: "created", repository, sender: user, installation: { id: 99 } };
  for (const body of ["@agent fix this", "/agent\nfix this", "@agent", "/agent"]) {
    const deliveries = {
      issues: { ...base, issue: { ...issue, body } },
      pull_request: { ...base, pull_request: { ...pullRequest, body } },
      issue_comment: { ...base, issue, comment: { ...comment, body } },
      pull_request_review_comment: { ...base, pull_request: pullRequest, comment: { ...comment, body } },
    };
    for (const [sourceEvent, payload] of Object.entries(deliveries)) {
      const before = publish.mock.callCount();
      const response = await githubRequest(sourceEvent, payload, {
        body: Buffer.from(JSON.stringify(payload)).toString("base64"), isBase64Encoded: true,
      });
      assert.equal(response.statusCode, 202);
      assert.equal(publish.mock.callCount(), before + 1);
      assert.deepEqual(publish.mock.calls.at(-1).arguments, ["agentic.setup", "ProvisionRequested", payload]);
    }
  }
});

test("noncommands, invalid deliveries, and parent commands do not publish", async (t) => {
  const publish = t.mock.method(EventBridgeService, "putEvent", async () => "event-1");
  const base = { action: "created", repository, sender: user };
  for (const body of [null, "", "please @agent", " /agent fix", "@Agent fix"]) {
    assert.equal((await githubRequest("issues", { ...base, issue: { ...issue, body } })).statusCode, 202);
  }
  const payload = { ...base, issue: { ...issue, body: "@agent fix" }, comment };
  assert.equal((await githubRequest("issue_comment", payload)).statusCode, 202);
  assert.equal((await githubRequest("push", payload)).statusCode, 202);
  assert.equal((await githubRequest("issues", { ...payload, sender: null })).statusCode, 400);
  assert.equal((await githubRequest("issues", payload, {
    headers: { "x-github-event": "issues", "x-hub-signature-256": "invalid" },
  })).statusCode, 401);
  assert.equal(publish.mock.callCount(), 0);
});

test("publication failures return a server error", async (t) => {
  t.mock.method(EventBridgeService, "putEvent", async () => { throw new Error("AWS failure"); });
  const payload = { action: "opened", repository, sender: user, issue: { ...issue, body: "/agent fix" } };
  const response = await githubRequest("issues", payload);
  assert.equal(response.statusCode, 500);
  assert.equal(JSON.parse(response.body).message, "Failed to publish provisioning request");
});

test("extractGitHubWebhook normalizes issue and pull request events", () => {
  const issueWebhook = extractGitHubWebhook("issues", {
    action: "opened",
    repository,
    sender: user,
    issue,
  });
  const pullRequestWebhook = extractGitHubWebhook("pull_request", {
    action: "opened",
    repository,
    sender: user,
    pull_request: pullRequest,
  });

  assert.equal(issueWebhook.type, "issue");
  assert.deepEqual(issueWebhook.issue.labels, ["bug"]);
  assert.equal(pullRequestWebhook.type, "pull_request");
  assert.deepEqual(pullRequestWebhook.pullRequest.head, {
    ref: "fix/bug",
    sha: "head-sha",
  });
});

test("extractGitHubWebhook distinguishes issue and pull request comments", () => {
  const issueComment = extractGitHubWebhook("issue_comment", {
    action: "created",
    repository,
    sender: user,
    issue,
    comment,
  });
  const pullRequestComment = extractGitHubWebhook("issue_comment", {
    action: "created",
    repository,
    sender: user,
    issue: { ...issue, pull_request: {} },
    comment,
  });
  const reviewComment = extractGitHubWebhook("pull_request_review_comment", {
    action: "created",
    repository,
    sender: user,
    pull_request: pullRequest,
    comment: { ...comment, path: "src/index.ts", position: 2 },
  });

  assert.equal(issueComment.type, "issue_comment");
  assert.equal(pullRequestComment.type, "pull_request_comment");
  assert.equal(reviewComment.type, "pull_request_comment");
  assert.equal(reviewComment.comment.path, "src/index.ts");
});

test("handleGitHub acknowledges supported events and accepts base64 bodies", async () => {
  const payload = { action: "opened", repository, sender: user, issue };
  const response = await githubRequest("issues", payload);
  const json = JSON.stringify(payload);
  const base64Response = await githubRequest("issues", payload, {
    body: Buffer.from(json).toString("base64"),
    isBase64Encoded: true,
  });

  assert.equal(response.statusCode, 202);
  assert.equal(JSON.parse(response.body).webhook.type, "issue");
  assert.equal(base64Response.statusCode, 202);
});

test("supported deliveries reject malformed common and nested payload fields", async () => {
  const base = { action: "opened", repository, sender: user };
  const invalidRepository = { ...repository, private: "false" };
  const invalidSender = { ...user, id: "1" };
  const missingTitle = { ...issue, title: undefined };
  const invalidLabels = { ...issue, labels: [null] };
  const invalidAssignees = { ...issue, assignees: [{ login: "octocat" }] };
  const invalidClosedAt = { ...issue, closed_at: false };
  const invalidIssues = [
    null,
    [],
    {},
    { ...base, issue, action: 3 },
    { ...base, issue, repository: invalidRepository },
    { ...base, issue, sender: invalidSender },
    { ...base, issue: missingTitle },
    { ...base, issue: invalidLabels },
    { ...base, issue: invalidAssignees },
    { ...base, issue: invalidClosedAt },
  ];
  for (const payload of invalidIssues)
    assert.equal((await githubRequest("issues", payload)).statusCode, 400);

  const invalidPullRequests = [
    { ...pullRequest, head: null },
    { ...pullRequest, base: { ref: "main" } },
    { ...pullRequest, merged: "false" },
    { ...pullRequest, merged_at: undefined },
  ];
  for (const payload of invalidPullRequests)
    assert.equal(
      (await githubRequest("pull_request", { ...base, pull_request: payload })).statusCode, 400,
    );

  const invalidComments = [
    { ...comment, body: null },
    { ...comment, user: null },
    { ...comment, path: 42 },
    { ...comment, position: "2" },
  ];
  for (const payload of invalidComments) {
    assert.equal(
      (await githubRequest("issue_comment", { ...base, issue, comment: payload })).statusCode, 400,
    );
    const review = { ...base, pull_request: pullRequest, comment: payload };
    assert.equal(
      (await githubRequest("pull_request_review_comment", review)).statusCode, 400,
    );
  }
  const wrongParent = { ...base, issue, comment };
  assert.equal(
    (await githubRequest("pull_request_review_comment", wrongParent)).statusCode, 400,
  );
  const invalidMarker = {
    ...base,
    issue: { ...issue, pull_request: null },
    comment,
  };
  assert.equal((await githubRequest("issue_comment", invalidMarker)).statusCode, 400);
});

test("validation preserves open actions, extra metadata, and nullable review positions", async () => {
  const payload = {
    action: "future_action",
    repository,
    sender: user,
    pull_request: pullRequest,
    comment: { ...comment, position: null },
    installation: { id: 99 },
  };
  const response = await githubRequest("pull_request_review_comment", payload);
  assert.equal(response.statusCode, 202);
  const { webhook } = JSON.parse(response.body);
  assert.equal(webhook.action, "future_action");
  assert.equal(webhook.comment.position, null);
  assert.equal(
    (await githubRequest("ping", { zen: "Keep it logically awesome." })).statusCode, 202,
  );
});

test("handleGitHub reports missing headers, invalid payloads, and ignored events", async () => {
  const missingHeader = await handleGitHub({ body: "{}" });
  const invalidPayload = await githubRequest("issues", undefined, { body: "not json" });
  const ignoredEvent = await githubRequest("push", {
    action: "created",
    repository,
    sender: user,
  });

  assert.deepEqual(JSON.parse(missingHeader.body), {
    message: "Missing X-GitHub-Event header",
  });
  assert.deepEqual(JSON.parse(invalidPayload.body), {
    message: "Invalid GitHub webhook payload",
  });
  assert.deepEqual(JSON.parse(ignoredEvent.body), {
    message: "Ignored unsupported GitHub event",
    sourceEvent: "push",
  });
});

test("handleGitHub rejects missing and invalid webhook signatures", async () => {
  const payload = { action: "opened", repository, sender: user, issue };
  const missingSignature = await handleGitHub({
    headers: { "x-github-event": "issues" },
    body: JSON.stringify(payload),
  });
  const invalidSignature = await handleGitHub({
    headers: {
      "x-github-event": "issues",
      "x-hub-signature-256": "sha256=not-a-valid-digest",
    },
    body: JSON.stringify(payload),
  });

  assert.equal(missingSignature.statusCode, 401);
  assert.equal(invalidSignature.statusCode, 401);
  assert.deepEqual(JSON.parse(invalidSignature.body), {
    message: "Invalid GitHub webhook signature",
  });
});
