# Provisioning and termination release contract

This release connects the Function URL endpoints to the EC2 services. It allocates Ubuntu ARM64 workers and requests their termination; it supplies no user data, worker instance role or coding-agent execution. The tests and environment audit below concern repository configuration and mocked AWS calls, not a deployed AWS smoke run.

## Connected endpoints

Provisioning and timeout require `X-Api-Key`, source `agentic.setup`, the exact event category and a nonblank `detail.deliveryId`. They read the original request from `REQUESTS_TABLE_NAME`. Caller-supplied timestamps, resource IDs and launch settings are ignored. `requestDeadline(receivedAt)` adds thirty minutes to the stored receipt time and rounds upward to a whole second. Scheduler, provisioning, timeout and EC2 expiry tags use that same deadline. The router awaits both endpoint promises before logging completion.

| Route | Successful operation | Other outcomes |
| --- | --- | --- |
| `POST /provision` | Stored request → shared deadline → `EC2Service.createInstance`; 202 with `{resource}` | Expired: 200 without launch. Missing request: 404. Invalid envelope: 400. Storage/launch/configuration failure: 500. |
| `POST /timeout` | Stored deadline check → journal lookup → `EC2Service.deleteInstance`; 202 with `{resource}` | Premature: 503 for retry. No launch journal: 200. Empty discovery with a journal: 503. Missing request: 404. Invalid envelope: 400. Service/configuration failure: 500. |
| `POST /cleanup` | Regional sweep terminating expired managed instances | Action, tracking or category discovery failure: 500 with partial results. Otherwise 200. Request body cannot select targets. |

All three return 401 for an invalid key or 500 for missing server key configuration. Lifecycle logs contain delivery/resource identities rather than raw callback bodies. Resource status and timestamps remain transient; only `resourceLaunch.deliveryId`, `.token` and `.instanceId` are persisted. The original request remains after termination. An explicit EC2 `InvalidInstanceID.NotFound` response is tolerated on repeated deletion without asserting an observed terminal state.

## Retrying the handoff

Webhook processing remains insert → schedule → publish. A conditional insert conflict now loads the original request and resumes the latter steps. It projects the original nine input fields, excluding the mutable launch journal. Expired replays are acknowledged without new dispatch. Completed service operations are not rolled back.

Schedule names are `timeout-` followed by the first 48 hex characters of SHA-256(deliveryId); the full hash is the create client token. Input and deadline stay stable across retries. A conflict triggers `GetSchedule`: enabled state, expression, timezone, completion action, flexible window, target ARN/role/input, source and detail type must match. Completed schedules delete themselves; there is no early cancellation.

The provision rule now matches `agentic.setup` and `ProvisionRequested`. Timeout and cleanup retain their dedicated buses and rules. EventBridge may retry, including when an API destination times out before Lambda returns. Compatible EC2 client-token retries and saved identity protect against repeated allocation. There is no transactional outbox: dispatch still needs a retry after a partial intake failure. Keep AMI/type/security-group settings stable while launch responses remain uncertain.

## Cleanup coverage and limits

Tags permit independent discovery; mutable AWS metadata cannot guarantee unconditional deletion. Launch tags its instance, root volume and primary interface with `ManagedBy=agentic-setup`, `DeliveryId`, `LaunchRequestId` and UTC `TimeoutAt`. The recurring cleanup schedule defaults to once per minute.

The instance scan paginates through pending, running, stopping, stopped and shutting-down workers, and rechecks ownership/expiry before termination. Missing/unreadable journals enter `trackingFailed` but do not block termination of expired tagged instances. Root EBS deletion is explicitly enabled with `DeleteOnTermination: true`; the automatically created primary interface follows the instance lifecycle.

AWS handles attached resources using their termination settings. The application enables root-volume deletion at launch but does not scan and delete detached attachments. Volumes whose deletion setting is subsequently disabled and resources detached before termination remain outside cleanup coverage.

| Result field | Meaning |
| --- | --- |
| `terminationRequested` | Instance termination accepted, not completion confirmed. |
| `skipped` | Ownership, expiry or instance state made the resource ineligible. |
| `failed` | Resource recheck or deletion failed. |
| `trackingFailed` | Instance journal could not be read, matched or updated. |
| `queryFailed` | Incomplete discovery for `instances`. |

Categories can overlap. Partial successes remain visible even when a later page fails. Each pass restarts discovery; there is no durable pagination cursor, sharding or deletion waiter. A cleanup 200 means this pass reported no failures, not that every AWS resource has disappeared.

Removed/malformed tags, changed deadlines, revoked IAM permissions, disabled scheduling/delivery, AWS outages, eventual consistency, deletion protection and Lambda's 60-second limit can delay or prevent cleanup. A large fleet can exceed a pass's time budget. Inspect failure categories and unexpected skipped resources. Shared VPC/security group, request table, secrets, buses, roles and recurring schedules remain intentionally. Extra regions, snapshots and Elastic IPs are not created or reconciled by this release.

## Environment injection audit

The template test scans runtime source for environment references and verifies each against the composed Lambda configuration or Lambda-provided variables. This checks source/deployment wiring; it does not read a currently deployed function's environment.

| Variable | Injection source |
| --- | --- |
| `GITHUB_WEBHOOK_SECRET` | Secrets Manager dynamic reference to `GitHubWebhookSecret`, bound through the root template. |
| `PROVISION_API_KEY` | Dynamic reference to `ProvisionApiKey`; all three EventBridge connections resolve the same secret. |
| `REQUESTS_TABLE_NAME` | Generated `RequestsTable` reference. |
| `EC2_SECURITY_GROUP_ID` | `WorkerSecurityGroup.GroupId` from the security-group component. |
| `EVENT_BUS_NAME` | `agentic-events`, matching the provision bus. |
| `TIMEOUT_EVENT_BUS_ARN` | Stack region/account ARN for `agentic-timeout-events`. |
| `TIMEOUT_SCHEDULER_ROLE_ARN` | Stack account ARN for `agentic-timeout-scheduler-role`. |
| `TIMEOUT_SCHEDULE_GROUP` | `agentic-timeouts`. |
| `LOG_LEVEL` | Explicit `info`, also the application's fallback. |
| `AWS_REGION` | Automatically supplied by Lambda; conflicting values are rejected by worker operations. |
| `AWS_LAMBDA_FUNCTION_NAME` | Automatically supplied by Lambda; selects Lambda console behavior. |

SDK credentials come from the Lambda execution role; local credentials are not copied into custom environment variables. `CleanupScheduleExpression` is a CloudFormation parameter, not an environment variable. AMI, instance type and root disk settings remain constants. Deployment must use `us-east-1`, where the pinned AMI and configured VPC `vpc-0773cc6f63148e689`/default networking must be available. Secret rotation requires updating resolved consumers as well as Secrets Manager.

IAM includes Scheduler `GetSchedule` and tag-scoped EC2 termination. Separate attachment describe and deletion permissions have been removed. Applying the reduced permissions requires a stack update; uploading the ZIP alone is insufficient.

## Packaging and verification

The ZIP builder copies the complete compiled tree and locked production dependencies. This fixes the omitted `ProvisioningConstants.js` and includes new helpers without a second module list. The validation workflow's worker-policy filename is corrected to `agentic-policy-setup.yaml`.

`npm test` covers endpoint authentication/expiry, signed intake through provisioning and timeout using real handlers with mocked SDK transports, replay after a partial failure, stable schedule conflicts, partial cleanup failures and environment/IAM wiring. `npm run package` builds the artifact; extracting and importing its entry point checks runtime module availability. Actual worker boot and eventual AWS deletion require a later live smoke run.
