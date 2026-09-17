# From a coding request to a pull request

Imagine a maintainer comments “/agent fix the failing test” on issue 456. A fresh machine picks up the task, installs its tools, checks out the code, and runs a coding agent. If the checks pass, it publishes a branch and pull request. It saves the outcome and is then removed.

That is the workflow these guides propose. The current application already accepts commands and manages worker launch, timeout, and cleanup. Installing tools, obtaining GitHub access, running the agent, publishing results, and reporting completion are the next pieces to build. Follow [the execution guide](../../execution-flow/README.md) for today’s behavior.

## Follow the planned job

| Chapter | What happens next |
| --- | --- |
| [1. Accepting a job](01-job-intake/README.md) | Decide whether the request is allowed and save a clear assignment |
| [2. Giving it GitHub access](02-github-access/README.md) | Let the assigned worker read and publish to its repository |
| [3. Preparing the machine](03-ec2-setup/README.md) | Install a known set of tools on a fresh worker |
| [4. Running the task](04-kotlin-runner/README.md) | Fetch context, run the agent, check the change, and publish |
| [5. Saving the result and cleaning up](05-completion-cleanup/README.md) | Preserve the outcome before removing the machine |
| [6. Building it in stages](06-build-plan/README.md) | Prove each missing piece before enabling routine jobs |

## One machine for one attempt

Each job gets a fresh EC2 instance. Ansible, a tool for repeatable machine setup, installs the development tools and our Kotlin runner. The runner is the script that guides the job from checkout through publication.

A GitHub App provides temporary repository access. AWS handlers keep the App’s private key, track the assignment, and manage the worker. These handlers are what the guides call the control service.

The worker ends after its attempt, whether the task succeeds or fails. A reviewer declining the PR later does not leave a machine running. Follow-up work starts a new job.

## Earlier design material

The original design considered Amazon Linux; the current launch code uses pinned Ubuntu ARM64. Startup scripts must be tested against the image actually selected for implementation.

The older [shared-machine architecture](01-shared-ec2-architecture.svg), [shared-machine flow](02-shared-ec2-job-flow.svg), [temporary-machine architecture](03-ephemeral-ec2-architecture.svg), and [temporary-machine flow](04-ephemeral-ec2-job-flow.svg) compare a GitHub Actions runner approach. Their prepared-image timing and pricing assumptions are historical references. The chapter diagrams also illustrate proposals, rather than proving deployed behavior.

Before enabling coding jobs, choose the agent CLI, approved repositories and requesters, worker authentication, capacity limit, and result retention. The build plan turns those choices into checks.
