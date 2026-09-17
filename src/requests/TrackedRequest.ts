import type { GitHubWebhookType } from "../github/GithubTypes.js";

/**
 * Supplies the durable input used by provisioning and timeout processing.
 * It identifies actionable content plus the repository context needed by
 * provision and timeout consumers. Both conversation comments on PRs and
 * inline review comments use pull_request_comment. Delivery identity remains
 * separate from object identity because multiple events can refer to the
 * same object. Authentication is injected later rather than stored here.
 * The full webhook is not retained.
 */
export interface TrackedRequest extends Record<string, unknown> {
  /** GitHub delivery ID, used as the table's string partition key. */
  deliveryId: string;
  /** ISO 8601 timestamp supplied by the accepting caller. */
  receivedAt: string;
  /** Content category: pull_request, issue, pull_request_comment or issue_comment. */
  webhook_type: GitHubWebhookType;
  /** GitHub object ID of the PR, issue or comment; not the issue/PR number. */
  id: number;
  /** PR/issue description or comment body; null when no description was supplied. */
  value: string | null;
  /** Stable numeric identifier of the repository containing the request. */
  repositoryId: number;
  /** Owner-qualified repository name used for API and checkout operations. */
  repositoryFullName: string;
  /** Repository-local issue or pull request number containing the command. */
  issueOrPullRequestNumber: number;
  /** GitHub account ID of the user who triggered the webhook delivery. */
  senderId: number;
}
