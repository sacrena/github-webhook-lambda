# 1. Turning a comment into a job

[Overview](../README.md) · [Next: GitHub access](../02-github-access/README.md)

A maintainer writes “/agent fix the failing test.” The first job of the receiver is to decide whether that request should spend machine time, then save an assignment that a worker can follow.

Today, the application verifies GitHub signatures, recognizes command prefixes, saves requests, and dispatches provisioning. The policy and richer job definition below are planned additions.

## Accepting a deliberate request

The current entry point is a Lambda Function URL. GitHub sends the original event body there, along with its signature and delivery ID.

After verifying the signature, the proposed intake should check the repository, event action, and requester. Start with selected repositories and maintainer-only comment commands. A valid GitHub signature alone does not establish permission to start a paid job.

The receiver should save the assignment before acknowledging it. A duplicate delivery should reuse that assignment. If capacity is full, the job should wait until a worker slot becomes available or its deadline passes.

## Giving the worker a clear starting point

The current request already stores the command, repository, sender, and issue or PR number. The proposed job also needs:

| Information | Why the worker needs it |
| --- | --- |
| Starting branch and exact commit | Work from an agreed code version |
| Assigned output branch | Publish somewhere predictable, such as `agent/job-123` |
| GitHub App installation | Obtain access to the approved repository |
| Setup release | Install the intended tools and runner version |
| Job state and worker assignment | Know who owns the work and whether it is still active |
| Result location | Let people find the outcome after the worker disappears |

Keep tokens and API keys out of the job definition. Repository selection should come from approved configuration, rather than an arbitrary clone URL embedded in the comment.

## What happens after acceptance?

The requester has asked for an attempt, so the acknowledgement should not claim the task succeeded. Later, the result should explain what happened: a PR, no change needed, or a failure with useful output.

The first release should exclude untrusted fork jobs and ignore the agent’s own publishing events to prevent loops. If context changes while a job waits, keep the saved starting commit and record any newer context fetched by the runner.

The current [webhook handler](../../../../src/github/GithubWebhook.ts) is the starting point. GitHub’s [delivery practices](https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks) explain the delivery contract.
