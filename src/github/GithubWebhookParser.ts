import { log } from "../shared/Logger.js";
import type {
  GitHubContentPayload,
  GitHubIssueLikePayload,
  GitHubIssuePayload,
  GitHubPullRequestPayload,
  GitHubCommentPayload,
  GitHubUserPayload,
  GitHubRepositoryPayload,
  GitHubDelivery,
} from "./GithubTypes.js";

/**
 * Opens an unknown JSON value for safe property inspection.
 * All payload guards start here before reading nested fields,
 * excluding null and arrays even though JavaScript calls them objects.
 * Values remain unknown until the relevant field guard succeeds.
 * This helper does not assign a GitHub-specific meaning to an object.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Checks nullable text used by descriptions and lifecycle timestamps.
 * A missing field is distinct from GitHub's explicit null value,
 * so undefined fails this guard for required nullable properties.
 * Timestamp strings are preserved without date-format validation.
 * Callers use this only where the incoming contract permits null.
 */
function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

/**
 * Verifies the account fields read by the identity mapper.
 * The same guard covers delivery senders and nested content authors,
 * keeping their accepted shapes consistent across event families.
 * An omitted profile URL is permitted by the normalized contract.
 * Extra account metadata has no effect on whether validation succeeds.
 */
function isUser(value: unknown): value is GitHubUserPayload {
  return (
    isRecord(value) &&
    typeof value.id === "number" &&
    typeof value.login === "string" &&
    (value.html_url === undefined || typeof value.html_url === "string")
  );
}

/**
 * Checks repository context before constructing a typed delivery.
 * All supported event bodies require the identity and visibility
 * fields consumed by the repository mapper, regardless of action.
 * This validates their JSON types without verifying access rights
 * or looking up the repository through an external API.
 */
function isRepository(value: unknown): value is GitHubRepositoryPayload {
  return (
    isRecord(value) &&
    typeof value.id === "number" &&
    typeof value.name === "string" &&
    typeof value.full_name === "string" &&
    typeof value.html_url === "string" &&
    typeof value.private === "boolean"
  );
}

/**
 * Validates the content fields shared by issues, PRs, and comments.
 * Event-specific guards build on this check so nested authors and
 * timestamps receive the same treatment in each mapper.
 * The description may be null here; comments narrow it to text.
 * URL and timestamp strings are copied without semantic validation.
 */
function isContent(value: unknown): value is GitHubContentPayload {
  return (
    isRecord(value) &&
    typeof value.id === "number" &&
    isNullableString(value.body) &&
    typeof value.html_url === "string" &&
    isUser(value.user) &&
    typeof value.created_at === "string" &&
    typeof value.updated_at === "string"
  );
}

/**
 * Checks lifecycle information common to issue and PR objects.
 * This layer avoids treating labels or branches as universal content
 * while still requiring the title, number, state, and closing value
 * used by both mappings. It deliberately leaves state values open
 * because the endpoint preserves them rather than filtering actions.
 */
function isIssueLike(value: unknown): value is GitHubIssueLikePayload {
  return (
    isRecord(value) &&
    isContent(value) &&
    typeof value.number === "number" &&
    typeof value.title === "string" &&
    typeof value.state === "string" &&
    isNullableString(value.closed_at)
  );
}

/**
 * Checks issue-specific collections and the PR conversation marker.
 * Labels and assignees must contain the fields their mappers read,
 * preventing malformed array entries from entering normalized output.
 * The marker, when present, must be an object but needs no particular
 * fields because extraction uses only its presence to classify a PR.
 */
function isIssue(value: unknown): value is GitHubIssuePayload {
  return (
    isRecord(value) &&
    isIssueLike(value) &&
    Array.isArray(value.labels) &&
    value.labels.every(
      (label: unknown) => isRecord(label) && typeof label.name === "string",
    ) &&
    Array.isArray(value.assignees) &&
    value.assignees.every(isUser) &&
    typeof value.comments === "number" &&
    (value.pull_request === undefined || isRecord(value.pull_request))
  );
}

/**
 * Verifies the full PR fields required by branch and merge mapping.
 * Both branch objects must provide a ref and SHA before the mapper
 * can expose them as typed data. Nullable merge timestamps remain
 * distinct from omitted values, matching the existing output contract.
 * The check applies equally to PR events and inline review comments.
 */
function isPullRequest(value: unknown): value is GitHubPullRequestPayload {
  return (
    isRecord(value) &&
    isIssueLike(value) &&
    typeof value.draft === "boolean" &&
    typeof value.merged === "boolean" &&
    [value.head, value.base].every(
      (branch: unknown) =>
        isRecord(branch) &&
        typeof branch.ref === "string" &&
        typeof branch.sha === "string",
    ) &&
    isNullableString(value.merged_at)
  );
}

/**
 * Checks comment text and any review location fields that are present.
 * Ordinary conversation comments need no location data, while inline
 * review deliveries may include each optional coordinate independently.
 * Null is accepted for position because outdated comments can lack one.
 * Present fields of the wrong type fail instead of reaching the mapper.
 */
function isComment(value: unknown): value is GitHubCommentPayload {
  return (
    isRecord(value) &&
    isContent(value) &&
    typeof value.body === "string" &&
    [value.path, value.diff_hunk, value.commit_id].every(
      (field: unknown) => field === undefined || typeof field === "string",
    ) &&
    (value.position === undefined ||
      value.position === null ||
      typeof value.position === "number")
  );
}

/**
 * Converts an untrusted JSON body into an event-specific delivery.
 * Common context is checked once, followed by the content required
 * by the event header. Only consumed fields are validated; additional
 * GitHub metadata remains acceptable. Unsupported headers are ignored
 * without imposing a supported event's schema on their bodies.
 *
 * @returns A discriminated delivery, or undefined for an unsupported event.
 * @throws {Error} When a supported event lacks valid consumed fields.
 */
export function parseGitHubDelivery(
  sourceEvent: string,
  payload: unknown,
): GitHubDelivery | undefined {
  log("debug", "github.payload.validating", { sourceEvent });
  if (
    ![
      "issues", "pull_request",
      "issue_comment", "pull_request_review_comment",
    ].includes(sourceEvent)
  )
    return undefined;
  if (
    !isRecord(payload) ||
    typeof payload.action !== "string" ||
    !isRepository(payload.repository) ||
    !isUser(payload.sender)
  ) {
    log("debug", "github.payload.context_invalid", { sourceEvent });
    throw new Error("Invalid GitHub delivery context");
  }

  const base = {
    action: payload.action,
    repository: payload.repository,
    sender: payload.sender,
  };
  switch (sourceEvent) {
    case "issues":
      if (isIssue(payload.issue))
        return { sourceEvent, payload: { ...base, issue: payload.issue } };
      break;
    case "pull_request":
      if (isPullRequest(payload.pull_request))
        return {
          sourceEvent,
          payload: { ...base, pull_request: payload.pull_request },
        };
      break;
    case "issue_comment":
      if (isIssue(payload.issue) && isComment(payload.comment))
        return {
          sourceEvent,
          payload: { ...base, issue: payload.issue, comment: payload.comment },
        };
      break;
    case "pull_request_review_comment":
      if (isPullRequest(payload.pull_request) && isComment(payload.comment))
        return {
          sourceEvent,
          payload: {
            ...base,
            pull_request: payload.pull_request,
            comment: payload.comment,
          },
        };
  }
  log("debug", "github.payload.content_invalid", { sourceEvent });
  throw new Error("Invalid GitHub event content");
}
