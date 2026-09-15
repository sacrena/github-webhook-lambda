import { respond, type FunctionUrlRequest } from "../shared/http.js";
import { log } from "../shared/Logger.js";
import { parseGitHubDelivery } from "./GithubWebhookParser.js";
import { verifyGitHubWebhook } from "./GithubWebhookSignature.js";
import type {
  GitHubUserPayload,
  GitHubRepositoryPayload,
  GitHubIssuePayload,
  GitHubPullRequestPayload,
  GitHubCommentPayload,
} from "./GithubTypes.js";
import type {
  GitHubUser,
  GitHubRepository,
  GitHubIssueData,
  GitHubPullRequestData,
  GitHubCommentData,
  GitHubWebhook,
} from "./GithubTypes.js";

/**
 * Selects the identity exposed for senders and content authors.
 * Input has already passed payload validation, so callers receive
 * the same account representation across all supported events.
 * GitHub's profile URL spelling is translated at this boundary.
 * Other account metadata is intentionally absent from the response.
 */
const user = (data: GitHubUserPayload): GitHubUser => ({
  id: data.id,
  login: data.login,
  htmlUrl: data.html_url,
});

/**
 * Preserves repository context in the endpoint's response format.
 * Every supported delivery uses this mapping after validation,
 * keeping repository identity independent of its content category.
 * The visibility flag reflects the delivery rather than a live lookup.
 * Owner-qualified names and URLs are translated to camelCase here.
 */
const repository = (data: GitHubRepositoryPayload): GitHubRepository => ({
  id: data.id,
  name: data.name,
  fullName: data.full_name,
  htmlUrl: data.html_url,
  private: data.private,
});

/**
 * Maps validated issue content into the public response contract.
 * It also handles issue-shaped parents of PR conversation comments,
 * where full branch and merge information is unavailable.
 * Label objects become names while assignees use the identity mapper.
 * Lifecycle values are preserved as delivered without API enrichment.
 */
const issue = (data: GitHubIssuePayload): GitHubIssueData => ({
  id: data.id,
  number: data.number,
  title: data.title,
  body: data.body,
  state: data.state,
  htmlUrl: data.html_url,
  user: user(data.user),
  labels: data.labels.map((label) => label.name),
  assignees: data.assignees.map(user),
  comments: data.comments,
  createdAt: data.created_at,
  updatedAt: data.updated_at,
  closedAt: data.closed_at,
});

/**
 * Exposes full PR details from a validated incoming PR object.
 * PR activity and inline review comments both provide this shape,
 * including source and target branches and merge information.
 * Ordinary conversation comments instead use the issue mapper.
 * No additional GitHub request is needed to construct these fields.
 */
const pullRequest = (
  data: GitHubPullRequestPayload,
): GitHubPullRequestData => ({
  id: data.id,
  number: data.number,
  title: data.title,
  body: data.body,
  state: data.state,
  draft: data.draft,
  merged: data.merged,
  htmlUrl: data.html_url,
  user: user(data.user),
  head: { ref: data.head.ref, sha: data.head.sha },
  base: { ref: data.base.ref, sha: data.base.sha },
  createdAt: data.created_at,
  updatedAt: data.updated_at,
  closedAt: data.closed_at,
  mergedAt: data.merged_at,
});

/**
 * Maps validated comment text and available review coordinates.
 * Both conversation and inline review events share this response
 * shape, with location fields left undefined when not supplied.
 * A null position is retained for comments without a diff position.
 * The parent issue or PR is attached by the event mapper separately.
 */
const comment = (data: GitHubCommentPayload): GitHubCommentData => ({
  id: data.id,
  body: data.body,
  htmlUrl: data.html_url,
  user: user(data.user),
  createdAt: data.created_at,
  updatedAt: data.updated_at,
  path: data.path,
  diffHunk: data.diff_hunk,
  position: data.position,
  commitId: data.commit_id,
});

/**
 * Validates a GitHub delivery before mapping it into domain data.
 * The parsed HTTP body stays unknown until its consumed fields have
 * passed the event-specific guards. Conversation comments on PRs
 * use the issue.pull_request marker; inline review comments carry
 * a full PR object. No additional GitHub API request is made.
 *
 * @returns Normalized content, or undefined for an unsupported header.
 * @throws {Error} When a supported delivery has invalid consumed fields.
 */
export function extractGitHubWebhook(
  sourceEvent: string,
  payload: unknown,
): GitHubWebhook | undefined {
  const delivery = parseGitHubDelivery(sourceEvent, payload);
  if (!delivery) return undefined;
  log("debug", "github.delivery.mapping", { sourceEvent, repositoryId: delivery.payload.repository.id });
  const base = {
    action: delivery.payload.action,
    repository: repository(delivery.payload.repository),
    sender: user(delivery.payload.sender),
  };

  switch (delivery.sourceEvent) {
    case "issues":
      return {
        ...base,
        type: "issue",
        sourceEvent: "issues",
        issue: issue(delivery.payload.issue),
      };
    case "pull_request":
      return {
        ...base,
        type: "pull_request",
        sourceEvent: "pull_request",
        pullRequest: pullRequest(delivery.payload.pull_request),
      };
    case "issue_comment":
      return delivery.payload.issue.pull_request !== undefined
        ? {
            ...base,
            type: "pull_request_comment",
            sourceEvent: "issue_comment",
            pullRequest: issue(delivery.payload.issue),
            comment: comment(delivery.payload.comment),
          }
        : {
            ...base,
            type: "issue_comment",
            sourceEvent: "issue_comment",
            issue: issue(delivery.payload.issue),
            comment: comment(delivery.payload.comment),
          };
    case "pull_request_review_comment":
      return {
        ...base,
        type: "pull_request_comment",
        sourceEvent: delivery.sourceEvent,
        pullRequest: pullRequest(delivery.payload.pull_request),
        comment: comment(delivery.payload.comment),
      };
  }
}

/**
 * Acknowledges authenticated GitHub deliveries after payload validation.
 * Verification supplies trusted bytes before this handler reads event
 * content, while extraction stays responsible for domain validation.
 * Missing or invalid signatures receive 401; malformed supported payloads
 * receive 400 and accepted deliveries return 202.
 */
export function handleGitHub(event: FunctionUrlRequest) {
  const sourceEvent =
    event.headers?.["x-github-event"] ?? event.headers?.["X-GitHub-Event"];
  if (!sourceEvent) {
    log("warn", "github.event_header.missing");
    return respond(400, { message: "Missing X-GitHub-Event header" });
  }

  log("debug", "github.delivery.received", {
    sourceEvent,
    deliveryId: event.headers?.["x-github-delivery"] ?? event.headers?.["X-GitHub-Delivery"],
  });

  const verification = verifyGitHubWebhook(event);
  if ("statusCode" in verification)
    return respond(verification.statusCode, { message: verification.message });

  try {
    const body = verification.body.toString("utf8");
    const payload: unknown = body.length ? JSON.parse(body) : undefined;
    const webhook = extractGitHubWebhook(sourceEvent, payload);
    if (!webhook) {
      log("info", "github.delivery.ignored", { sourceEvent });
      return respond(202, {
        message: "Ignored unsupported GitHub event",
        sourceEvent,
      });
    }
    log("info", "github.delivery.accepted", {
      sourceEvent, type: webhook.type, action: webhook.action,
      repositoryId: webhook.repository.id,
      deliveryId: event.headers?.["x-github-delivery"] ?? event.headers?.["X-GitHub-Delivery"],
    });
    return respond(202, { message: "GitHub webhook received", webhook });
  } catch {
    log("warn", "github.payload.invalid", { sourceEvent });
    return respond(400, { message: "Invalid GitHub webhook payload" });
  }
}
