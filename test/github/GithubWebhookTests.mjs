import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import {
  extractGitHubWebhook,
  handleGitHub,
} from "../../dist/github/GithubWebhook.js";

process.env.GITHUB_WEBHOOK_SECRET = "test-webhook-secret";

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
 * The returned Lambda response is left intact for status and body checks.
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

test("handleGitHub acknowledges supported events and accepts base64 bodies", () => {
  const payload = { action: "opened", repository, sender: user, issue };
  const response = githubRequest("issues", payload);
  const json = JSON.stringify(payload);
  const base64Response = githubRequest("issues", payload, {
    body: Buffer.from(json).toString("base64"),
    isBase64Encoded: true,
  });

  assert.equal(response.statusCode, 202);
  assert.equal(JSON.parse(response.body).webhook.type, "issue");
  assert.equal(base64Response.statusCode, 202);
});

test("supported deliveries reject malformed common and nested payload fields", () => {
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
    assert.equal(githubRequest("issues", payload).statusCode, 400);

  const invalidPullRequests = [
    { ...pullRequest, head: null },
    { ...pullRequest, base: { ref: "main" } },
    { ...pullRequest, merged: "false" },
    { ...pullRequest, merged_at: undefined },
  ];
  for (const payload of invalidPullRequests)
    assert.equal(
      githubRequest("pull_request", { ...base, pull_request: payload })
        .statusCode,
      400,
    );

  const invalidComments = [
    { ...comment, body: null },
    { ...comment, user: null },
    { ...comment, path: 42 },
    { ...comment, position: "2" },
  ];
  for (const payload of invalidComments) {
    assert.equal(
      githubRequest("issue_comment", { ...base, issue, comment: payload })
        .statusCode,
      400,
    );
    const review = { ...base, pull_request: pullRequest, comment: payload };
    assert.equal(
      githubRequest("pull_request_review_comment", review).statusCode,
      400,
    );
  }
  const wrongParent = { ...base, issue, comment };
  assert.equal(
    githubRequest("pull_request_review_comment", wrongParent).statusCode,
    400,
  );
  const invalidMarker = {
    ...base,
    issue: { ...issue, pull_request: null },
    comment,
  };
  assert.equal(githubRequest("issue_comment", invalidMarker).statusCode, 400);
});

test("validation preserves open actions, extra metadata, and nullable review positions", () => {
  const payload = {
    action: "future_action",
    repository,
    sender: user,
    pull_request: pullRequest,
    comment: { ...comment, position: null },
    installation: { id: 99 },
  };
  const response = githubRequest("pull_request_review_comment", payload);
  assert.equal(response.statusCode, 202);
  const { webhook } = JSON.parse(response.body);
  assert.equal(webhook.action, "future_action");
  assert.equal(webhook.comment.position, null);
  assert.equal(
    githubRequest("ping", { zen: "Keep it logically awesome." }).statusCode,
    202,
  );
});

test("handleGitHub reports missing headers, invalid payloads, and ignored events", () => {
  const missingHeader = handleGitHub({ body: "{}" });
  const invalidPayload = githubRequest("issues", undefined, { body: "not json" });
  const ignoredEvent = githubRequest("push", {
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

test("handleGitHub rejects missing and invalid webhook signatures", () => {
  const payload = { action: "opened", repository, sender: user, issue };
  const missingSignature = handleGitHub({
    headers: { "x-github-event": "issues" },
    body: JSON.stringify(payload),
  });
  const invalidSignature = handleGitHub({
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
