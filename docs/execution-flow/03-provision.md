# 3. Starting the worker

[Index](README.md) · [Previous: dispatch](02-dispatch.md) · [Next: termination](04-termination.md)

EventBridge now delivers the provisioning message to `POST /provision`. The endpoint checks its API key and verifies that the envelope names the expected source and event type.

It takes the delivery ID from the message and loads the original request from DynamoDB. The saved receipt time determines the deadline. A deadline or instance ID supplied in the HTTP body cannot replace that stored information.

If the request is missing, the endpoint returns 404. If its deadline has already passed, it returns 200 without launching a machine. Otherwise, it asks `EC2Service.createInstance` to start the worker and returns 202 with the resource information.

## Remembering the launch before making it

An AWS call can succeed even when its response never reaches Lambda. To recover from that situation, the application first adds a small launch record, called `resourceLaunch`, to the saved request.

That record contains the delivery ID and a token derived from it. EC2 receives the same token as `ClientToken`. Retrying with the same token and launch settings lets AWS recognize the original launch.

Once EC2 returns an instance ID, the application saves it in the launch record. A database failure at this point does not undo the launch: the machine may already exist. The token provides a way to find it again.

## The machine it starts

| Setting | Current value |
| --- | --- |
| AWS region | `us-east-1` |
| Image | Ubuntu 24.04 ARM64, `ami-0246d714afcc1d494` |
| Instance size | `m8g.xlarge` |
| Root disk | 50 GiB `gp3`, configured for deletion on termination |
| Networking | The stack’s shared security group; EC2 chooses a default subnet |
| Guest shutdown | Requests instance termination |
| Instance metadata | Requires session tokens |

These settings come from [ProvisioningConstants](../../src/provision/ProvisioningConstants.ts) and [InstanceConfiguration](../../src/provision/InstanceConfiguration.ts). Request callers cannot choose a different image or size. The region check rejects a conflicting `AWS_REGION`. Keep launch settings, including the security group, stable while outstanding launches may be retried.

The instance, disk, and network interface receive tags identifying the application, delivery, launch token, and deadline. Cleanup uses those tags if the database never receives the instance ID.

## Recovering an uncertain result

`recoverInstance` searches EC2 by the saved launch token and saves the discovered ID. If EC2 temporarily returns nothing, a previously saved ID is still returned, without inventing a current status. Finding multiple instances for one launch raises an error.

A successful launch response means AWS allocated the machine. It does not mean tools are installed or a coding job has started. The current launch supplies neither a startup script nor an instance role.

See the [provision endpoint](../../src/provision/ProvisionEndpoint.ts), [launch journal](../../src/provision/InstanceJournal.ts), and [EC2 service](../../src/aws/EC2Service.ts) for the implementation.
