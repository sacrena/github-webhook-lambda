# 3. Preparing a fresh machine

[Overview](../README.md) · [Previous: GitHub access](../02-github-access/README.md) · [Next: the runner](../04-kotlin-runner/README.md)

A newly launched worker has an operating system, but no coding workspace. The proposed setup process turns that empty machine into a place where one job can run.

The current code launches Ubuntu 24.04 ARM64 in `us-east-1`. It does not yet provide a startup script, worker role, Ansible bundle, or Kotlin runner. Earlier diagrams proposed Amazon Linux; installation commands must match the image actually used.

## From boot to a ready worker

EC2 can run a small startup script, called user-data, when the machine boots. That script should fetch a specific setup release from S3, AWS’s object storage service, and run Ansible.

Ansible installs the tools and runner from that release. Pinning a release makes two workers for the same setup version easier to compare and diagnose. An operating-system service then starts the runner once, under a dedicated account.

| Tool | Its job |
| --- | --- |
| Git and HTTPS certificates | Fetch and publish repository content |
| Java and Kotlin | Run the Kotlin script and support JVM projects |
| Project build tools | Run the target repository’s checks, preferably through its wrapper |
| Docker, where needed | Run test containers or supporting services |
| Coding-agent CLI | Carry out the requested coding task |
| Runner and log upload support | Coordinate the attempt and preserve its output |

Choose versions from the target repository’s build requirements. Test the selected tools, agent, and container images on ARM64 before relying on them.

## Give setup only the access it needs

The future worker role should allow access to its setup bundle, assigned inputs, and result storage. GitHub and agent credentials should arrive through their own controlled paths, rather than being embedded in user-data.

A worker needs outbound access to download code and dependencies. It does not need inbound SSH for normal operation. A private network with a NAT gateway is another option, with additional cost.

The current launch already requires metadata session tokens and configures its root disk for deletion on termination. Verify disk encryption and the remaining network and permission settings when implementing setup.

## Prove setup before running real tasks

The first runner can simply record “setup complete.” Launch a fresh machine and check that it reaches that point without manual intervention, then confirm timeout cleanup removes it.

Measure setup time as part of the job’s cost and deadline. Installation uses paid machine time just as coding does. Include disks, public IPv4, retained output, and any network services in cost estimates. A limit on simultaneous Lambda calls does not cap the number of live workers; that needs job reservations.

See the [current launch guide](../../../execution-flow/03-provision.md) and AWS’s [startup-script documentation](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/user-data.html).
