# Lambda developer guide

The Lambda exposes a Function URL with three routes. `GET /ping` checks reachability, `POST /github/webhooks` verifies and extracts GitHub delivery data, and `POST /provision` logs authenticated EventBridge deliveries. The GitHub endpoint currently returns normalized data in its response; it does not persist deliveries or schedule jobs.

## Routing and HTTP responses

`handler(event)` in `src/index.ts` is the Lambda entry point. It selects a handler using the HTTP method and path, returning 404 for other combinations. `handlePing()` in `src/ping/PingEndpoint.ts` returns a 200 JSON response containing `message: "pong"` so a caller can check reachability without constructing a webhook.

`src/shared/http.ts` defines the Function URL request fields used by the application. Its `respond(statusCode, payload)` helper serializes an object and sets the JSON content type so all endpoints use the same response format.

## EventBridge provisioning intake

`cloudformation/agent-setup.yaml` describes four source components: `SecretsSetup`, `DynamoSetup`, `LambdaSetup`, and `EventSetup`. `scripts/CloudFormationTemplate.mjs` combines them into one deployment template for the existing `agentic-setup-lambda` stack. Resource logical IDs remain unchanged; no nested stacks are created. Component parameters and output references resolve to direct resource references. Lambda supplies EventBridge's Function URL; the destination appends `provision` to its trailing slash. The deployed stack exposes the bus name, table name, and endpoint URLs.

`cloudformation/agentic-event-setup.yaml` creates a dedicated bus, an API-key connection, a POST API destination, and a rule matching every event with a source (including all PutEvents events). The target receives the complete event envelope. Its IAM role can invoke only that destination. Publishers must have `events:PutEvents` permission on the bus named by the root stack's `EventBusName` output.

`cloudformation/agentic-secrets-setup.yaml` stores the supplied GitHub webhook secret and a separately supplied API key shared by the connection and Lambda's `PROVISION_API_KEY` environment variable. The root passes secret ARNs to consumers without exposing secret values as outputs. `handleProvision(event)` requires the `X-Api-Key` header, returns 401 on mismatch or 500 when configuration is missing, and logs the decoded body as `data` in a `provision.received` record before returning 202. This dummy endpoint starts no provisioning work and does not deduplicate retries. Key rotation requires updating both consumers; changing the secret alone does not refresh their stored values.

`src/aws/EventBridgeService.ts` provides the static `EventBridgeService.putEvent(source, detailType, detail, busName?)` operation. It resolves the bus from `EVENT_BUS_NAME` at call time unless the fourth argument supplies one, serializes the detail object, and returns the event ID. Missing bus configuration, serialization, transport, and per-entry rejection errors propagate as failures; acceptance does not guarantee destination delivery. A shared SDK client is created once when the module loads and reused across warm Lambda invocations. The Lambda template configures `agentic-events` and grants Lambda `events:PutEvents` only on that bus. This fixed name must match the EventBridge template; referencing its output from Lambda would create a dependency cycle through the Lambda URL. Applications must wait for stack deployment to finish before publishing.

Event resources have fixed names: `agentic-events` (bus), `agentic-provision-auth` (connection), `agentic-provision-api` (destination), `agentic-provision-rule` (rule), and `agentic-events-role` (IAM role). These names and the `/provision` path are not parameters. Only `LambdaFunctionUrl` and `ApiKeySecretArn` cross into the event template from the root; callers do not configure a separate destination URL. Fixed names require avoiding duplicate deployments within each resource's naming scope; IAM role names are account-wide.

```ts
import { EventBridgeService } from "./aws/EventBridgeService.js";

await EventBridgeService.putEvent("agentic.setup", "ProvisionRequested", { deliveryId: "delivery-1" });
```

`npm run lambda:deploy` builds `output/v<version>/agent-setup.json` and deploys it to `agentic-setup-lambda`. The script uploads the ZIP, reads its S3 version ID, and passes that as `CodeVersion` so same-key uploads update Lambda code. `npm run validate` checks the combined template and all four component templates after local tests. Do not deploy the source root YAML directly: its component declarations are inputs to the builder. The S3 artifact stack remains a separate bootstrap prerequisite.

The combined template keeps the existing `GitHubWebhookSecret` logical ID in the existing stack. Its value is reused through the previous `GitHubWebhookSecretValue` parameter. Initial provisioning API configuration requires `PROVISION_API_KEY`; later updates omit it to reuse `ProvisionApiKeyValue`. Both consumers resolve the same secret ARN. Changing a secret value alone does not refresh existing dynamic-reference consumers; rotation must also update their configuration.

## GitHub deliveries

`handleGitHub(event)` in `src/github/GithubWebhook.ts` reads `X-GitHub-Event`, asks `verifyGitHubWebhook(event)` to authenticate the delivery, then passes its verified bytes to extraction. `src/github/GithubWebhookSignature.ts` restores base64 Function URL bodies, verifies `X-Hub-Signature-256` with HMAC-SHA256 and `GITHUB_WEBHOOK_SECRET`, and uses a timing-safe comparison. This follows GitHub's [validating webhook deliveries](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries) contract. A missing or invalid signature produces 401, an unavailable secret produces 500, and a parsing or payload-validation failure produces 400. Successful extraction returns 202 with a `webhook` object; unsupported authenticated events with valid JSON return 202 without requiring issue/PR delivery context.

`extractGitHubWebhook(sourceEvent, payload)` accepts a signature-verified `unknown` body and calls `parseGitHubDelivery` in `src/github/GithubWebhookParser.ts` before mapping it. Validation checks the fields consumed by extraction, including nested authors, labels, assignees, branches, and optional review coordinates. It allows extra GitHub metadata and preserves action strings; it does not validate the entire GitHub schema, URL/date formats, or the delivery actor's authorization. Invalid supported payloads throw from the extractor and become HTTP 400 responses in the handler.

`src/github/GithubTypes.ts` contains both incoming snake_case payload types and normalized response types. `GitHubPayloadBase` supplies action, repository, and sender. Issue and PR event interfaces extend it; conversation and review comment events extend their corresponding parent event with a comment. `GitHubDelivery` pairs each literal event name with its payload, so narrowing `sourceEvent` selects the correct body type. Content objects also share base interfaces for author/text/timestamps and issue/PR lifecycle fields.

The private `user`, `repository`, `issue`, `pullRequest`, and `comment` mapping helpers accept validated payload types and convert snake_case fields to the camelCase types in `src/github/GithubTypes.ts`. All GitHub types are exported from `src/index.ts`.

GitHub sends ordinary issue and PR conversation comments as `issue_comment`. The presence of `issue.pull_request` identifies a PR conversation comment. That payload contains issue-shaped PR information, so it cannot supply the full PR branch and merge data available in a `pull_request` delivery. Inline review comments arrive as `pull_request_review_comment` and include a PR object. Both comment forms normalize to `pull_request_comment`; `sourceEvent` preserves the distinction. See GitHub's [webhook events and payloads](https://docs.github.com/en/webhooks/webhook-events-and-payloads#issue_comment) for the source contract.

## Request storage foundation

`src/requests/TrackedRequest.ts` defines a compact script input with `webhook_type` (`pull_request`, `issue`, `pull_request_comment` or `issue_comment`), the GitHub object's numeric `id`, and `value` containing its description or comment body. An absent description is represented by `null`. Both PR conversation and inline review comments use `pull_request_comment`. The object ID is not an issue/PR number. `deliveryId` remains the storage/deduplication key, and `receivedAt` records acceptance time; the full webhook is not stored.

`DynamoService` in `src/aws/DynamoService.ts` exposes static operations backed by a shared DynamoDB document client, created once when the module loads and reused across warm Lambda invocations. `DynamoService.create(tableName, request)` conditionally inserts a record without overwriting an existing delivery; duplicate writes raise the SDK's `ConditionalCheckFailedException`. `DynamoService.get(tableName, deliveryId)` uses a strongly consistent read and returns the record or `undefined`. Table selection is local to each operation, and other storage errors propagate to the caller. Its tests in `test/aws/DynamoServiceTests.mjs` cover successful writes, duplicate and other write failures, consistent reads, missing records, and read failures. Mapping webhook content to this input and executing a processing script remain future work.

`cloudformation/agentic-dynamodb-setup.yaml` defines one on-demand table with a string `deliveryId` partition key and no sort key. The root provisions it through `DynamoSetup` and passes its generated name and ARN to `LambdaSetup` as parameters. Lambda uses them for `REQUESTS_TABLE_NAME` and its `PutItem` and `GetItem` permissions; the root also exposes `RequestsTableName`. The table is retained on stack deletion or replacement. The default client uses standard AWS region/credential resolution and omits undefined optional fields. Callers must provide validated data that fits DynamoDB's 400 KB item limit.

Deployment preserves the Lambda, execution role, Function URL, and GitHub secret in their original stack. New resources, including request storage and EventBridge intake, join that same stack. The builder rejects duplicate logical IDs to prevent one source component from overwriting another's resource definition.

## Infrastructure warning decisions

The request table and both shared secrets have `DeletionPolicy: Retain` and `UpdateReplacePolicy: Retain` to preserve data and credentials when resources are removed or replaced. Retained resources require manual cleanup and can continue incurring charges; recreating a stack with the fixed GitHub secret name requires resolving that retained resource first. EventBridge and stateless Lambda resources keep their normal deletion behavior.

Encryption settings explicitly preserve the service defaults: Secrets Manager uses `alias/aws/secretsmanager`, and DynamoDB uses AWS-owned-key encryption (`SSEEnabled: false`). False selects the key ownership model; it does not turn off table encryption. Checks requiring customer-managed keys or `SSEEnabled: true` are additional policy requirements, not evidence of unencrypted storage. Lambda's environment encryption also retains its service default.

Public Function URL permissions are intentional for GitHub and EventBridge API destination access; handlers authenticate their respective requests, while `/ping` is public. Service trust principals allow AWS services to assume their roles. Replacing these principals with an account ID would change access. Resource-scoped inline IAM policies remain attached to their owning role. A VPC is not required for this Lambda's public AWS API calls, and automatic secret rotation would require coordinated updates to GitHub, Lambda, and the EventBridge connection.

The source root's local `TemplateURL` entries are resolved by `CloudFormationTemplate.mjs`. They are not submitted to AWS. The combined JSON contains only service resources and is the artifact validated and deployed by the scripts.

## Operational logging

`src/shared/Logger.js` supplies the shared JSON logger for the Lambda and deployment scripts. It uses Node's built-in APIs and is checked through JSDoc types; TypeScript copies it into `dist/shared/Logger.js` during the build. Each record contains `timestamp`, `level`, and a stable `event` name, plus explicitly selected operational fields. When `AWS_LAMBDA_FUNCTION_NAME` is set, records use the matching console method (`debug`, `info`, `warn`, or `error`) so CloudWatch severity agrees with the JSON level. Outside Lambda, all records use stderr to leave deployment command stdout available for results.

Set `LOG_LEVEL` to `debug`, `info`, `warn`, `error`, or `silent`; the default and fallback for unknown values is `info`. For example, `LOG_LEVEL=debug npm run package` includes subprocess timing. To change Lambda verbosity, set `LOG_LEVEL` in the function's environment. Request lifecycle logs include method, path, request ID, status, and elapsed milliseconds. An absent transport request ID is replaced with a UUID, and asynchronous context keeps nested logs associated with the current invocation.

Webhook logs cover authentication failures, invalid payloads, ignored events, and accepted deliveries; debug logging adds verification, parsing, and mapping steps. Accepted deliveries include the GitHub delivery ID when supplied and the numeric repository ID. Webhook bodies, signatures, secrets, and raw errors are never passed to the logger. The provisioning placeholder explicitly logs authenticated delivery bodies as text. This is a caller contract, not automatic redaction: publishers must account for event data appearing in CloudWatch. Pure field mappers and type declarations need no individual log statements.

Packaging, validation, upload, and deployment scripts log stage outcomes and durations. Subprocess failures include the executable and available exit status or system error code, without logging arguments or raw exception messages. Command output still follows each call's stdio settings. Failed script stages exit unsuccessfully so parent workflows stop.

## Build and repository conventions

Run `npm test` to compile TypeScript and execute the route tests. `npm run package` includes the compiled modules in the Lambda ZIP; adding a runtime module requires keeping packaging aligned with its import path. The existing extraction function and type exports remain available from `index.ts` for compatibility.

The repository skills in `.agents/skills/code-documentation` and `.agents/skills/code-structure` capture the conventions used here: concise developer-facing paragraphs and methods documented by purpose, with routing, endpoint logic, shared helpers, and domain types separated by responsibility.
