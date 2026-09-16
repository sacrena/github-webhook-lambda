import type { GitHubWebhookType } from "../github/GithubTypes.js";

/**
 * Supplies a compact text input for a future request processing script.
 * The type and object ID identify the content represented by value, without
 * retaining the surrounding webhook payload. Both conversation comments on
 * PRs and inline review comments use the pull_request_comment category.
 * Delivery identity remains separate from object identity because multiple
 * events can refer to the same object. Receipt time records local acceptance.
 */
export interface TrackedRequest {
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
}
