/**
 * Identifies an actor in GitHub's incoming delivery format.
 * Senders and content authors share this contract, allowing the same
 * mapper to handle both without accepting arbitrary properties.
 * Only fields consumed by this service are modeled; GitHub may send
 * additional identity details which extraction deliberately ignores.
 */
export interface GitHubUserPayload {
  /** GitHub's numeric account identifier. */
  id: number;
  /** Account name supplied with the delivery. */
  login: string;
  /** Public profile URL when supplied. */
  html_url?: string;
}

/**
 * Supplies repository context before a delivery is normalized.
 * These fields identify the repository independently of an issue or PR,
 * so every supported event includes the same repository contract.
 * Names retain GitHub's JSON spelling at the incoming boundary.
 * This is a consumed-field projection, not GitHub's complete schema.
 */
export interface GitHubRepositoryPayload {
  /** Stable repository identifier. */
  id: number;
  /** Repository name without its owner. */
  name: string;
  /** Owner-qualified repository name. */
  full_name: string;
  /** Browser URL for the repository. */
  html_url: string;
  /** Whether the repository has private visibility. */
  private: boolean;
}

/**
 * Collects content fields shared by issues, PRs, and comments.
 * Incoming timestamps and URLs keep their original JSON names until
 * the feature mapper translates them into the public response format.
 * A null body represents content without a description; comment
 * payloads narrow that field to the text their mapper requires.
 */
export interface GitHubContentPayload {
  /** Stable identifier for this piece of content. */
  id: number;
  /** Description text, or null when absent. */
  body: string | null;
  /** Browser URL for this content. */
  html_url: string;
  /** Account that authored the content. */
  user: GitHubUserPayload;
  /** Creation timestamp supplied by GitHub. */
  created_at: string;
  /** Most recent update timestamp supplied by GitHub. */
  updated_at: string;
}

/**
 * Adds the lifecycle fields shared by issues and pull requests.
 * Keeping these separate from comment content allows event-specific
 * payloads to reuse their actual common structure without requiring
 * issue labels on PR objects or branch information on issues.
 * State remains a string because extraction preserves the supplied value.
 */
export interface GitHubIssueLikePayload extends GitHubContentPayload {
  /** Repository-local issue or PR number. */
  number: number;
  /** Current title of the issue or PR. */
  title: string;
  /** Lifecycle state supplied by GitHub. */
  state: string;
  /** Closing timestamp, or null for content not closed. */
  closed_at: string | null;
}

/**
 * Describes an issue object received in issue and conversation events.
 * GitHub also sends this shape for ordinary PR conversation comments,
 * identifying those parents with the optional pull_request object.
 * That marker does not provide full branch or merge information.
 * See https://docs.github.com/en/webhooks/webhook-events-and-payloads#issue_comment.
 */
export interface GitHubIssuePayload extends GitHubIssueLikePayload {
  /** Labels whose names are included in normalized output. */
  labels: { /** Label text retained by extraction. */ name: string }[];
  /** Accounts currently assigned to the issue. */
  assignees: GitHubUserPayload[];
  /** Conversation comment count supplied by GitHub. */
  comments: number;
  /** Presence identifies a PR conversation; marker fields are not consumed. */
  pull_request?: Record<string, unknown>;
}

/**
 * Represents the branch information consumed from a full PR object.
 * Both head and base carry a ref name alongside a commit SHA,
 * allowing callers to distinguish branch identity from its revision.
 * Other GitHub branch metadata is irrelevant to current extraction.
 * The validator checks strings without resolving refs against GitHub.
 */
export interface GitHubBranchPayload {
  /** Branch reference name. */
  ref: string;
  /** Commit revision associated with this reference. */
  sha: string;
}

/**
 * Provides full PR details for PR and inline review comment events.
 * It extends shared issue-like content with branch and merge fields
 * that ordinary conversation payloads cannot guarantee.
 * The mapper reads these values directly from the delivery without
 * making another GitHub request to refresh or supplement them.
 */
export interface GitHubPullRequestPayload extends GitHubIssueLikePayload {
  /** Whether this PR is a draft. */
  draft: boolean;
  /** Whether this PR has been merged. */
  merged: boolean;
  /** Source branch and revision. */
  head: GitHubBranchPayload;
  /** Target branch and revision. */
  base: GitHubBranchPayload;
  /** Merge timestamp, or null when not merged. */
  merged_at: string | null;
}

/**
 * Carries comment text and optional inline review coordinates.
 * Conversation comments reuse the content fields alone, while
 * review comments may also supply a path, diff, and commit location.
 * Optional coordinates match the mapper's existing output contract;
 * the service does not require a comment to refer to a current line.
 */
export interface GitHubCommentPayload extends GitHubContentPayload {
  /** Comment text as supplied in the delivery. */
  body: string;
  /** Reviewed file path when present. */
  path?: string;
  /** Diff excerpt containing the reviewed location. */
  diff_hunk?: string;
  /** Diff position, or null when no position is available. */
  position?: number | null;
  /** Commit associated with the review comment. */
  commit_id?: string;
}

/**
 * Establishes common context for each supported GitHub event payload.
 * Event extensions add the issue, PR, or comment objects they require.
 * The event name arrives separately in the HTTP header and is paired
 * with this body after validation. Actions remain open strings so
 * extraction preserves them without introducing an action allowlist.
 */
export interface GitHubPayloadBase {
  /** Event action preserved in the normalized response. */
  action: string;
  /** Repository in which the event occurred. */
  repository: GitHubRepositoryPayload;
  /** Account responsible for triggering the event. */
  sender: GitHubUserPayload;
}

/**
 * Supplies the body associated with an issues event header.
 * Shared delivery context comes from the payload base, while the
 * issue field provides the content selected by the issue mapper.
 * No comment or full PR object is required for this event family.
 * Validation checks consumed fields and tolerates additional metadata.
 */
export interface GitHubIssueEventPayload extends GitHubPayloadBase {
  /** Issue affected by the supplied action. */
  issue: GitHubIssuePayload;
}

/**
 * Supplies the body associated with a pull_request event header.
 * It extends delivery context with the full PR object used to expose
 * branch references and merge details in the normalized response.
 * The action is inherited unchanged for all supported PR deliveries.
 * Additional fields supplied by GitHub are outside this projection.
 */
export interface GitHubPullRequestEventPayload extends GitHubPayloadBase {
  /** Pull request affected by the supplied action. */
  pull_request: GitHubPullRequestPayload;
}

/**
 * Adds a conversation comment to an issue-shaped event body.
 * This extension covers both issue and PR conversation comments,
 * because GitHub uses the same event and parent shape for both.
 * The issue's pull_request marker determines the normalized category.
 * Consumers must not infer full PR details from that marker alone.
 */
export interface GitHubIssueCommentEventPayload
  extends GitHubIssueEventPayload {
  /** Conversation comment affected by the action. */
  comment: GitHubCommentPayload;
}

/**
 * Adds an inline review comment to a full PR event body.
 * Unlike a PR conversation comment, this event supplies branch and
 * merge information through its pull_request object.
 * The common comment mapper also preserves available review coordinates.
 * Review submissions without a comment are a different, unsupported event.
 */
export interface GitHubReviewCommentEventPayload
  extends GitHubPullRequestEventPayload {
  /** Inline review comment affected by the action. */
  comment: GitHubCommentPayload;
}

/**
 * Pairs each supported header value with its validated body shape.
 * Narrowing sourceEvent also narrows payload, preventing the mapper
 * from accessing a PR body through an issue event or vice versa.
 * The discriminant is added locally and is not part of GitHub's JSON.
 * Unsupported event headers do not produce a member of this union.
 */
export type GitHubDelivery =
  | {
      /** Header identifying issue activity. */
      sourceEvent: "issues";
      /** Validated issue event body. */
      payload: GitHubIssueEventPayload;
    }
  | {
      /** Header identifying PR activity. */
      sourceEvent: "pull_request";
      /** Validated full PR event body. */
      payload: GitHubPullRequestEventPayload;
    }
  | {
      /** Header shared by issue and PR conversation comments. */
      sourceEvent: "issue_comment";
      /** Validated conversation comment and issue-shaped parent. */
      payload: GitHubIssueCommentEventPayload;
    }
  | {
      /** Header identifying inline PR review comments. */
      sourceEvent: "pull_request_review_comment";
      /** Validated inline comment and full PR parent. */
      payload: GitHubReviewCommentEventPayload;
    };

/**
 * Identifies the normalized content category returned by the endpoint.
 * This discriminator lets consumers select the relevant issue, PR, or
 * comment fields after a delivery has crossed the HTTP boundary.
 * PR conversation and inline review comments share one category because
 * callers handle both as comments attached to a pull request.
 */
export type GitHubWebhookType =
  | "issue"
  | "pull_request"
  | "issue_comment"
  | "pull_request_comment";

/**
 * Represents an account in the normalized webhook response format.
 * Mappers translate incoming snake_case fields into this camelCase form
 * before returning data to callers of the endpoint or extraction API.
 * It is shared by the delivery sender, issue author, PR author, and
 * comment author, preserving a consistent identity contract.
 */
export interface GitHubUser {
  /** GitHub's numeric account identifier. */
  id: number;
  /** Account name displayed by GitHub. */
  login: string;
  /** Browser profile URL when supplied in the delivery. */
  htmlUrl?: string;
}

/**
 * Supplies repository context in the normalized webhook response.
 * Every supported delivery includes this object, independent of the
 * content type that triggered it. Its values originate in the received
 * delivery rather than a fresh repository lookup. Field names use the
 * camelCase convention adopted by the public endpoint contract.
 */
export interface GitHubRepository {
  /** Stable repository identifier. */
  id: number;
  /** Repository name without its owner. */
  name: string;
  /** Owner-qualified repository name. */
  fullName: string;
  /** Browser URL for the repository. */
  htmlUrl: string;
  /** Whether the repository has private visibility. */
  private: boolean;
}

/**
 * Contains the normalized issue details used by issue-related events.
 * PR conversation comments also use this issue-shaped parent because
 * GitHub does not include full PR branch information in that event.
 * Labels are reduced to names while assignees use the shared account type.
 * Lifecycle strings are preserved as supplied by GitHub.
 */
export interface GitHubIssueData {
  /** Stable issue identifier. */
  id: number;
  /** Repository-local issue number. */
  number: number;
  /** Current issue title. */
  title: string;
  /** Description text, or null when absent. */
  body: string | null;
  /** Lifecycle state supplied by GitHub. */
  state: string;
  /** Browser URL for the issue. */
  htmlUrl: string;
  /** Account that opened the issue. */
  user: GitHubUser;
  /** Label names currently assigned to the issue. */
  labels: string[];
  /** Accounts currently assigned to the issue. */
  assignees: GitHubUser[];
  /** Conversation comment count supplied by GitHub. */
  comments: number;
  /** Creation timestamp supplied by GitHub. */
  createdAt: string;
  /** Most recent update timestamp supplied by GitHub. */
  updatedAt: string;
  /** Closing timestamp, or null when the issue is open. */
  closedAt: string | null;
}

/**
 * Contains full normalized PR details for PR and review comment events.
 * Unlike issue-shaped PR conversation parents, this representation includes
 * source and target branch references alongside merge lifecycle information.
 * The webhook constructs it from the delivery without an extra GitHub call.
 * Consumers can use it when the event guarantees full PR payload data.
 */
export interface GitHubPullRequestData {
  /** Stable pull request identifier. */
  id: number;
  /** Repository-local pull request number. */
  number: number;
  /** Current pull request title. */
  title: string;
  /** Description text, or null when absent. */
  body: string | null;
  /** Lifecycle state supplied by GitHub. */
  state: string;
  /** Whether this pull request is a draft. */
  draft: boolean;
  /** Whether this pull request has been merged. */
  merged: boolean;
  /** Browser URL for the pull request. */
  htmlUrl: string;
  /** Account that opened the pull request. */
  user: GitHubUser;
  /** Source branch name and commit revision. */
  head: {
    /** Source branch name. */ ref: string;
    /** Source revision. */ sha: string;
  };
  /** Target branch name and commit revision. */
  base: {
    /** Target branch name. */ ref: string;
    /** Target revision. */ sha: string;
  };
  /** Creation timestamp supplied by GitHub. */
  createdAt: string;
  /** Most recent update timestamp supplied by GitHub. */
  updatedAt: string;
  /** Closing timestamp, or null when the PR is open. */
  closedAt: string | null;
  /** Merge timestamp, or null when the PR is not merged. */
  mergedAt: string | null;
}

/**
 * Holds normalized comment text and optional inline review coordinates.
 * Conversation comments omit review location fields, while inline review
 * comments may provide a path, diff hunk, position, and commit revision.
 * The parent issue or PR is stored by the webhook event extension instead.
 * Optional fields preserve their availability in the source delivery.
 */
export interface GitHubCommentData {
  /** Stable comment identifier. */
  id: number;
  /** Comment text. */
  body: string;
  /** Browser URL for the comment. */
  htmlUrl: string;
  /** Account that authored the comment. */
  user: GitHubUser;
  /** Creation timestamp supplied by GitHub. */
  createdAt: string;
  /** Most recent update timestamp supplied by GitHub. */
  updatedAt: string;
  /** Reviewed file path when present. */
  path?: string;
  /** Diff excerpt containing the reviewed location. */
  diffHunk?: string;
  /** Diff position, or null when unavailable. */
  position?: number | null;
  /** Commit associated with the review comment. */
  commitId?: string;
}

/**
 * Supplies normalized metadata shared by every supported webhook response.
 * Event-specific extensions attach exactly the issue, PR, or comment data
 * their category promises. Source event retains GitHub's delivery family
 * when two source events normalize to the same comment category.
 * This base remains internal because its type field is refined by extensions.
 */
interface GitHubWebhookBase {
  /** Normalized category used to discriminate this response. */
  type: GitHubWebhookType;
  /** GitHub event header responsible for this delivery. */
  sourceEvent:
    | "issues"
    | "pull_request"
    | "issue_comment"
    | "pull_request_review_comment";
  /** GitHub action supplied by the delivery. */
  action: string;
  /** Repository where the event occurred. */
  repository: GitHubRepository;
  /** Account that triggered the event. */
  sender: GitHubUser;
}

/**
 * Represents a normalized issue activity delivery for API consumers.
 * Its literal category and source event identify an issue payload,
 * allowing the attached issue details to be accessed without casting.
 * It contains no comment or full PR data because this event lacks them.
 * The common base supplies action, repository, and sender context.
 */
export interface GitHubIssueWebhook extends GitHubWebhookBase {
  /** Normalized issue category. */
  type: "issue";
  /** Source header for issue activity. */
  sourceEvent: "issues";
  /** Normalized issue affected by the action. */
  issue: GitHubIssueData;
}

/**
 * Represents a normalized full PR activity delivery for API consumers.
 * Its literal source event guarantees branch and merge details in the
 * attached PR object. Consumers can narrow the webhook union using type
 * before reading that object. Shared delivery context comes from the base.
 */
export interface GitHubPullRequestWebhook extends GitHubWebhookBase {
  /** Normalized pull request category. */
  type: "pull_request";
  /** Source header for pull request activity. */
  sourceEvent: "pull_request";
  /** Full normalized pull request affected by the action. */
  pullRequest: GitHubPullRequestData;
}

/**
 * Represents a normalized issue conversation comment delivery.
 * It carries both the parent issue and comment because consumers need
 * the request text alongside the subject under discussion. The literal
 * category distinguishes it from a comment attached to a pull request.
 * Shared action, repository, and sender fields come from the base.
 */
export interface GitHubIssueCommentWebhook extends GitHubWebhookBase {
  /** Normalized issue comment category. */
  type: "issue_comment";
  /** Source header for a conversation comment. */
  sourceEvent: "issue_comment";
  /** Parent issue for the conversation. */
  issue: GitHubIssueData;
  /** Comment affected by the action. */
  comment: GitHubCommentData;
}

/**
 * Represents a PR conversation or inline review comment delivery.
 * Conversation events have only issue-shaped PR context, while inline
 * review events include a full PR object; sourceEvent preserves that fact.
 * Consumers needing branch data must narrow by sourceEvent before reading it.
 * Both forms supply the comment and shared delivery metadata.
 */
export interface GitHubPullRequestCommentWebhook extends GitHubWebhookBase {
  /** Normalized pull request comment category. */
  type: "pull_request_comment";
  /** Source header for a conversation or inline review comment. */
  sourceEvent: "issue_comment" | "pull_request_review_comment";
  /** Full PR or issue-shaped parent context, depending on sourceEvent. */
  pullRequest:
    | GitHubPullRequestData
    | Pick<GitHubIssueData, "id" | "number" | "title" | "htmlUrl">;
  /** Comment affected by the action. */
  comment: GitHubCommentData;
}

/**
 * Unites all normalized webhook responses returned by extraction.
 * The type field selects the attached data, while sourceEvent distinguishes
 * the two GitHub delivery formats that both represent PR comments.
 * Callers can use ordinary discriminated-union narrowing without casts.
 * Unsupported event headers result in undefined rather than this union.
 */
export type GitHubWebhook =
  | GitHubIssueWebhook
  | GitHubPullRequestWebhook
  | GitHubIssueCommentWebhook
  | GitHubPullRequestCommentWebhook;
