# Lambda developer guide

The Lambda exposes a Function URL with two routes. `GET /ping` checks reachability, and `POST /github/webhooks` verifies and extracts GitHub delivery data. The endpoint currently returns normalized data in its response; it does not persist deliveries or schedule jobs.

## Routing and HTTP responses

`handler(event)` in `src/index.ts` is the Lambda entry point. It selects a handler using the HTTP method and path, returning 404 for other combinations. `handlePing()` in `src/ping/PingEndpoint.ts` returns a 200 JSON response containing `message: "pong"` so a caller can check reachability without constructing a webhook.

`src/shared/http.ts` defines the Function URL request fields used by the application. Its `respond(statusCode, payload)` helper serializes an object and sets the JSON content type so both endpoints use the same response format.

## GitHub deliveries

`handleGitHub(event)` in `src/github/GithubWebhook.ts` reads `X-GitHub-Event`, asks `verifyGitHubWebhook(event)` to authenticate the delivery, then passes its verified bytes to extraction. `src/github/GithubWebhookSignature.ts` restores base64 Function URL bodies, verifies `X-Hub-Signature-256` with HMAC-SHA256 and `GITHUB_WEBHOOK_SECRET`, and uses a timing-safe comparison. This follows GitHub's [validating webhook deliveries](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries) contract. A missing or invalid signature produces 401, an unavailable secret produces 500, and a parsing or payload-validation failure produces 400. Successful extraction returns 202 with a `webhook` object; unsupported authenticated events with valid JSON return 202 without requiring issue/PR delivery context.

`extractGitHubWebhook(sourceEvent, payload)` accepts a signature-verified `unknown` body and calls `parseGitHubDelivery` in `src/github/GithubWebhookParser.ts` before mapping it. Validation checks the fields consumed by extraction, including nested authors, labels, assignees, branches, and optional review coordinates. It allows extra GitHub metadata and preserves action strings; it does not validate the entire GitHub schema, URL/date formats, or the delivery actor's authorization. Invalid supported payloads throw from the extractor and become HTTP 400 responses in the handler.

`src/github/GithubTypes.ts` contains both incoming snake_case payload types and normalized response types. `GitHubPayloadBase` supplies action, repository, and sender. Issue and PR event interfaces extend it; conversation and review comment events extend their corresponding parent event with a comment. `GitHubDelivery` pairs each literal event name with its payload, so narrowing `sourceEvent` selects the correct body type. Content objects also share base interfaces for author/text/timestamps and issue/PR lifecycle fields.

The private `user`, `repository`, `issue`, `pullRequest`, and `comment` mapping helpers accept validated payload types and convert snake_case fields to the camelCase types in `src/github/GithubTypes.ts`. All GitHub types are exported from `src/index.ts`.

GitHub sends ordinary issue and PR conversation comments as `issue_comment`. The presence of `issue.pull_request` identifies a PR conversation comment. That payload contains issue-shaped PR information, so it cannot supply the full PR branch and merge data available in a `pull_request` delivery. Inline review comments arrive as `pull_request_review_comment` and include a PR object. Both comment forms normalize to `pull_request_comment`; `sourceEvent` preserves the distinction. See GitHub's [webhook events and payloads](https://docs.github.com/en/webhooks/webhook-events-and-payloads#issue_comment) for the source contract.

## Operational logging

`src/shared/Logger.js` supplies the shared JSON logger for the Lambda and deployment scripts. It uses Node's built-in APIs and is checked through JSDoc types; TypeScript copies it into `dist/shared/Logger.js` during the build. Each record contains `timestamp`, `level`, and a stable `event` name, plus explicitly selected operational fields. Records are written to stderr, which Lambda captures in CloudWatch and which leaves deployment command stdout available for results.

Set `LOG_LEVEL` to `debug`, `info`, `warn`, `error`, or `silent`; the default and fallback for unknown values is `info`. For example, `LOG_LEVEL=debug npm run package` includes subprocess timing. To change Lambda verbosity, set `LOG_LEVEL` in the function's environment. Request lifecycle logs include method, path, request ID, status, and elapsed milliseconds. An absent transport request ID is replaced with a UUID, and asynchronous context keeps nested logs associated with the current invocation.

Webhook logs cover authentication failures, invalid payloads, ignored events, and accepted deliveries; debug logging adds verification, parsing, and mapping steps. Accepted deliveries include the GitHub delivery ID when supplied and the numeric repository ID. Payload bodies, signatures, secrets, and raw errors are never passed to the logger. This is a caller contract, not automatic redaction: new call sites must select safe scalar metadata explicitly. Pure field mappers and type declarations need no individual log statements.

Packaging, validation, upload, and deployment scripts log stage outcomes and durations. Subprocess failures include the executable and available exit status or system error code, without logging arguments or raw exception messages. Command output still follows each call's stdio settings. Failed script stages exit unsuccessfully so parent workflows stop.

## Build and repository conventions

Run `npm test` to compile TypeScript and execute the route tests. `npm run package` includes the compiled modules in the Lambda ZIP; adding a runtime module requires keeping packaging aligned with its import path. The existing extraction function and type exports remain available from `index.ts` for compatibility.

The repository skills in `.agents/skills/code-documentation` and `.agents/skills/code-structure` capture the conventions used here: concise developer-facing paragraphs and methods documented by purpose, with routing, endpoint logic, shared helpers, and domain types separated by responsibility.
