# 4. Ending the worker’s lifetime

[Index](README.md) · [Previous: provisioning](03-provision.md) · [Next: saved data](05-data-ledger.md)

The worker has a deadline even if nothing inside it runs successfully. Two paths can end its lifetime: the request’s scheduled timeout and a recurring cleanup check.

## When the timeout arrives

Scheduler publishes `TimeoutRequested`, which EventBridge sends to `POST /timeout`. After checking the API key and event envelope, the endpoint loads the original request and recalculates its deadline.

An early callback receives 503 so it can be retried later. Once the deadline passes, the endpoint checks the launch record. If no launch was recorded, it returns 200 because there is no recorded worker to remove.

If a launch exists, `deleteInstance` uses its saved instance ID or searches by launch token. Unfinished discovery receives 503. Otherwise, the service asks EC2 to terminate the worker and the endpoint returns 202. A missing request receives 404; service failures receive 500.

The saved instance identity remains after termination. Retaining it helps repeated calls refer to the same worker.

## When the normal path misses something

A separate recurring schedule calls `POST /cleanup`, once a minute by default. This endpoint finds resources from AWS tags, so its body cannot select arbitrary instances or change their deadlines.

Cleanup searches all pages of managed instances, including stopped machines whose disks can still cost money. Before terminating each candidate, it reads the instance again and rechecks ownership and expiry. A missing or mismatched database launch record is reported, but does not prevent termination of an expired tagged worker.

Cleanup also searches for detached disks and network interfaces. It rechecks their tags, deadline, and current attachment state before deletion. Attached resources are left alone; interfaces managed by another AWS requester or carrying an address association are also skipped.

Each resource category is handled separately. A failed instance query does not prevent an attempt to clean detached disks and interfaces.

## Reading the result

| Result field | Meaning |
| --- | --- |
| `terminationRequested` | AWS accepted a request to terminate these instances |
| `deletedVolumes`, `deletedNetworkInterfaces` | Deletion succeeded, or the resource was already absent |
| `skipped` | The resource did not qualify when checked |
| `failed` | A resource check or operation failed |
| `trackingFailed` | The instance’s database tracking could not be read, matched, or saved |
| `queryFailed` | Discovery was incomplete for a resource category |

An instance can appear in both `terminationRequested` and `trackingFailed`: AWS may accept termination even when saving its identity fails. Any reported failure makes the endpoint return 500 with the accumulated result; a clean pass returns 200.

AWS finishes termination asynchronously. The application does not wait for a confirmed terminal state. The root disk is configured to disappear with the instance, and the primary network interface follows EC2’s lifecycle. Shared infrastructure, such as the database and security group, remains.

See [timeout handling](../../src/timeout/TimeoutEndpoint.ts), [cleanup handling](../../src/provision/CleanupEndpoint.ts), [EC2 operations](../../src/aws/EC2Service.ts), and [detached-resource cleanup](../../src/provision/AttachmentCleanup.ts).
