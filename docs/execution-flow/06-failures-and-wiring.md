# 6. When something goes wrong

[Index](README.md) · [Previous: saved data](05-data-ledger.md)

The journey crosses several AWS services. Each can finish its part before the next one fails, so an error response does not always mean nothing happened.

For example, a request may be saved and its timeout registered before event publication fails. Retrying the GitHub delivery reads the original request and resumes the handoff. Its receipt time stays the same, so the retry does not extend the deadline.

## Follow the last successful step

| Where it fails | What may already exist | What helps recovery |
| --- | --- | --- |
| Signature or payload validation | No new request | Correct the delivery or server configuration |
| Saving the request | The write may have succeeded despite a lost response | Retry uses the delivery ID to find the saved request |
| Timeout registration | The saved request, possibly the schedule | Stable schedule name and settings checks |
| Event publication or delivery | Request and timeout; possibly an accepted event | Repeated publication and launch-token reuse |
| EC2 launch response | Launch token and possibly a running instance | Retry with unchanged settings or search by token |
| Saving the instance ID | The worker can already be running | Token discovery and tagged-resource cleanup |
| Termination or cleanup | Some resources may already have been removed | Retry the remaining operations and inspect the result |

There is no automatic rollback across these steps. EventBridge acceptance also does not prove that the HTTP destination succeeded. The services do not create their own retry loops; callers, delivery mechanisms, and recurring cleanup provide the later attempts.

## Configuration that connects the journey

| Setting | Why it is needed |
| --- | --- |
| `GITHUB_WEBHOOK_SECRET` | Verify incoming GitHub signatures |
| `PROVISION_API_KEY` | Authenticate provisioning, timeout, and cleanup calls |
| `REQUESTS_TABLE_NAME` | Find the original request and launch identity |
| `EVENT_BUS_NAME` | Publish immediate provisioning events |
| `TIMEOUT_EVENT_BUS_ARN` | Select where Scheduler sends timeout events |
| `TIMEOUT_SCHEDULER_ROLE_ARN` | Let Scheduler publish those events |
| `TIMEOUT_SCHEDULE_GROUP` | Hold the one-time timeout schedules |
| `EC2_SECURITY_GROUP_ID` | Attach the stack’s network rules to new workers |
| `CleanupScheduleExpression` | Set the recurring cleanup frequency; default is once a minute |

The Function URL is public at the transport level. Application code checks GitHub signatures and internal API keys; `/ping` is public.

The worker uses a fixed image and region. Deploy in `us-east-1`, with the configured default VPC and security group available in that account. The runtime rejects a conflicting AWS region. Fixed resource names also need to remain unique in their AWS naming scopes.

Secrets are resolved into the Lambda and EventBridge connection configurations during deployment. Changing a value in Secrets Manager alone does not refresh all consumers; key rotation needs their configuration updated too.

## What the infrastructure owns

The [root template](../../cloudformation/agent-setup.yaml) connects the policy, secrets, database, security group, Lambda, and event components. The deployment builder combines them into one stack. The artifact bucket is created separately.

The Lambda role supplies AWS permissions for request storage, scheduling, event publication, and worker management. Those permissions do not give software inside EC2 access to GitHub. The current worker has no attached instance role or credential delivery mechanism.

The [developer guide](../development.md) covers local checks. Tests use mocked AWS interactions: they can verify request construction and failure handling, but cannot prove a live worker boots or finishes termination.
