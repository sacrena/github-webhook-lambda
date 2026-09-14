# Agentic coding on temporary EC2 workers

A person requests a coding task in GitHub. AWS creates a fresh machine, Ansible installs its tools, and a Kotlin script fetches the code and runs the agent. The script publishes a branch and pull request, saves the result, and reports completion. AWS then removes the worker.

**Status: proposed implementation.** These guides capture the decisions from the project discussion. Repository inspection found earlier architecture diagrams, but no implementation of this intake, worker or cleanup flow. “How it works” below describes the target behavior to build, not a deployed feature.

## Read in this order

Each scope has a short guide and a matching diagram. The guide embeds its diagram, and the SVG links back to the guide.

| Scope | Guide | Diagram |
| --- | --- | --- |
| 1. From GitHub event to coding job | [Read guide](01-job-intake/README.md) | [Open SVG](01-job-intake/flow.svg) |
| 2. GitHub App and repository access | [Read guide](02-github-access/README.md) | [Open SVG](02-github-access/flow.svg) |
| 3. Fresh EC2 setup with Ansible | [Read guide](03-ec2-setup/README.md) | [Open SVG](03-ec2-setup/flow.svg) |
| 4. The Kotlin job runner | [Read guide](04-kotlin-runner/README.md) | [Open SVG](04-kotlin-runner/flow.svg) |
| 5. Completion and EC2 cleanup | [Read guide](05-completion-cleanup/README.md) | [Open SVG](05-completion-cleanup/flow.svg) |
| 6. Steps to deliver the project | [Read guide](06-build-plan/README.md) | [Open SVG](06-build-plan/flow.svg) |

Read the build plan after the overview if you want to start implementation immediately. Read the other scopes when working on that part.

## The choices we have made

- One fresh EC2 instance performs one coding job.
- Use an AWS-managed Amazon Linux image and install tools with Ansible. No custom image or launch template.
- The runner is our Kotlin script: fetch code, run the job, check it and publish the result.
- Lambda handles event processing, saved job definitions, provisioning and termination. These can be separate handlers so accepting an event never waits for a job to finish.
- A GitHub App gives temporary repository access. Its private key stays in the control service.
- Publish to a job branch and open a PR for review. End the worker immediately after its attempt.
- Use an independent deadline check to clean up machines that cannot report completion.

“Control service” means the AWS handlers that track the job, issue credentials and manage EC2. “Bootstrap bundle” means the versioned Ansible files and runner script downloaded during startup.

## One example to keep in mind

A permitted maintainer comments “/agent fix the failing test” on issue 456. The receiver saves job 123 against a specific source commit. A new machine installs the selected tool versions, receives access to that repository, and runs the Kotlin script.

If the task passes its checks, the result is a branch such as agent/job-123 and a PR explaining the change. If the task fails, the result is a failure reason and any saved output. Either way, the worker ends. A later review request starts a separate job.

## Earlier comparison diagrams

The four existing SVGs are preserved as earlier reference material:

- [Shared machine architecture](01-shared-ec2-architecture.svg)
- [Shared machine job flow](02-shared-ec2-job-flow.svg)
- [Earlier temporary-machine architecture](03-ephemeral-ec2-architecture.svg)
- [Earlier temporary-machine job flow](04-ephemeral-ec2-job-flow.svg)

They describe a GitHub Actions runner/prepared-image approach and include earlier pricing assumptions. Their runner registration, GitHub waiting list, prepared-image startup timing and image costs do **not** describe the selected Kotlin-script design. Use the six scope guides above for this project.

## Evidence and remaining choices

The guides were written from this discussion, the existing architecture material and a search of application source, workflows and scripts. Provider documentation is linked where service contracts matter. Package versions, AWS policies and network configuration must be validated during implementation; this documentation does not prove a deployment exists.

Before rollout, select the coding-agent CLI, repository allowlist, AWS region/instance size, verified worker authentication mechanism, time limits and result retention. The [build plan](06-build-plan/README.md) turns these into concrete completion checks.
