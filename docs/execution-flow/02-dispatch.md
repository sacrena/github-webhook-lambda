# 2. Saving the request and passing it on

[Index](README.md) · [Previous: intake](01-intake.md) · [Next: starting a worker](03-provision.md)

The comment has passed the intake checks. Before asking for a machine, the application saves enough information to recognize the request later: its delivery ID, receipt time, command text, repository, subject, and sender.

DynamoDB, AWS’s database service, stores this record under the delivery ID. The insert refuses to overwrite an existing record. If the delivery already exists, the handler reads and reuses its original fields, including the original receipt time.

## Giving the request a deadline

The request gets thirty minutes from its saved `receivedAt` time, rounded upward to the next whole second. [requestDeadline](../../src/requests/RequestDeadline.ts) calculates that same deadline for scheduling, provisioning, and timeout handling. Retrying a delivery therefore does not give its worker another thirty minutes.

Scheduler creates a one-time reminder for that deadline. Its name and retry token come from the delivery ID. If a schedule with that name already exists, the application checks that its settings and input match. An expired request is acknowledged without scheduling or publishing more work.

Scheduler delivers with minute-level precision, so the deadline is not a promise that termination happens at an exact second. The one-time schedule deletes itself after completion; there is no early cancellation path.

## Asking for a worker

Once the timeout is registered, the handler publishes a `ProvisionRequested` event to EventBridge. The event carries the same compact request. EventBridge later delivers it to `/provision`, inside an envelope whose `detail` field contains the request.

The order is deliberate:

1. Save the request, or recover the saved copy.
2. Register its timeout.
3. Publish the provisioning event.
4. Return HTTP 202 to GitHub.

Each step waits for the previous one. A failure returns 500 and stops the remaining steps, but earlier AWS operations stay in place. For example, failed publication can leave a saved request and a timeout schedule.

## What a retry does

A repeated delivery resumes with the saved input and checks or reuses the same schedule. It can publish another provisioning event; the worker launch service uses its own stable token to protect against duplicate launches.

There is no single transaction across DynamoDB, Scheduler, and EventBridge, and no stored record of which handoff finished. A successful event publication means EventBridge accepted the message, not that the destination has completed its work.

The sequence lives in [GithubWebhook](../../src/github/GithubWebhook.ts), with AWS calls in [DynamoService](../../src/aws/DynamoService.ts), [SchedulerService](../../src/aws/SchedulerService.ts), and [EventBridgeService](../../src/aws/EventBridgeService.ts). The [data guide](05-data-ledger.md) shows the saved fields.
