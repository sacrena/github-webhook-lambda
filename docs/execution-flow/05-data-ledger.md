# 5. What the system remembers

[Index](README.md) · [Previous: termination](04-termination.md) · [Next: failures and configuration](06-failures-and-wiring.md)

Our example comment arrives with far more information than the worker handoff needs. The application returns a mapped webhook to the caller, but saves a smaller record for later processing.

Here is an illustrative request for issue 456:

```json
{
  "deliveryId": "delivery-001",
  "receivedAt": "2026-09-17T10:00:00.000Z",
  "webhook_type": "issue_comment",
  "id": 98765,
  "value": "/agent fix the failing test",
  "repositoryId": 123,
  "repositoryFullName": "example/project",
  "issueOrPullRequestNumber": 456,
  "senderId": 42
}
```

The delivery ID identifies this notification. The content ID, `98765`, identifies the comment. The number `456` identifies the issue within its repository. Keeping these separate lets later calls find both the saved request and its GitHub context.

`senderId` identifies the person who triggered the event, which need not be the original content author. The command text is saved with its prefix intact.

## What changes when a worker starts?

Before contacting EC2, the application adds `resourceLaunch` to the same database item. It holds `deliveryId` and a SHA-256 `token` derived from that ID. After discovering the worker, it also holds `instanceId`.

That is the durable launch history: the request and its worker identity. The database does not gain the resource’s current status, launch settings, or observed termination timestamps.

The deadline is calculated from the original `receivedAt`, thirty minutes later and rounded up to a whole second. For this example, it is `2026-09-17T10:30:00.000Z`. It is stored in Scheduler’s configuration and in resource tags, rather than added as a request field.

## Where the other information lives

| Information | Where it lives |
| --- | --- |
| Original webhook and mapped response | In the HTTP call; the full webhook is not saved to the request table |
| Compact request | DynamoDB, the scheduled timeout input, and provisioning event detail |
| Launch identity | The request’s `resourceLaunch` map |
| Ownership and deadline | Tags on the instance, disk, and network interface |
| Current EC2 status | AWS observations returned by service calls; not a saved job status |
| Schedule settings | AWS Scheduler; the one-time schedule removes itself after completion |
| Request logs | Console output, collected by CloudWatch in Lambda |
| Webhook secret and internal API key | Secrets Manager and the consuming service configuration |

The templates configure no automatic expiry for request records and no explicit log retention period. Instance cleanup does not delete the request. The table is also retained when its stack resource is deleted or replaced.

The coding runner has not been implemented, so there are no saved agent results, output artifacts, or PR links in this runtime yet.

For exact field contracts, see [TrackedRequest](../../src/requests/TrackedRequest.ts), [InstanceJournal](../../src/provision/InstanceJournal.ts), and [ProvisionedResource](../../src/provision/ProvisionedResource.ts). A field in a returned resource object is not necessarily stored in the database.
