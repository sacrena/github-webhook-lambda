# 6. Building the remaining workflow

[Overview](../README.md) · [Previous: completion](../05-completion-cleanup/README.md)

The project already connects GitHub commands to temporary worker launch and deadline cleanup. The next milestone is one permitted request producing a checked, reviewable result before its worker disappears.

Build toward that milestone in small stages. Each stage should leave evidence that the next one can rely on.

## Choose one supported job

Start with one repository, maintainer-only commands, one live worker, and a named coding-agent CLI. Decide the output branch rules, tool versions, deadline, and result retention.

This stage is ready when an example request has a clear assignment and defined success, no-change, and failure outcomes. Requester authorization and worker capacity limits still need implementation.

## Prove the machine can prepare itself

Create a versioned Ansible bundle and a placeholder Kotlin script that records “setup complete.” Add the startup script and required worker access, then launch a fresh machine.

Check the real tool versions, CPU compatibility, output upload, and startup duration. This stage is ready when the machine becomes usable without manual SSH work, and an intentionally broken setup is still removed by deadline cleanup.

## Add identity and completion

Implement the worker-to-job check, GitHub token issuing, saved outcomes, and completion endpoint. Build on the existing launch and cleanup services.

Prove that the worker can access only its assigned active job, publish an intentional test branch, save the result, and request termination. Confirm actual termination as well as the API’s acceptance of the request.

## Run one real coding task

Add context gathering, agent invocation, project checks, diff review, and controlled publication to the Kotlin runner. Bound external commands and preserve their output.

This stage is ready when a manually submitted task creates a useful PR, keeps its test evidence, and leaves no running worker. A no-change task should also finish cleanly.

Then connect the approved GitHub command path to the complete assignment flow. Reuse the existing request identity and deadline when retrying.

## Exercise the failures people will encounter

| Scenario | Evidence to look for |
| --- | --- |
| Invalid signature or unapproved requester | No worker launch |
| Repeated delivery or lost launch response | Original request and one worker |
| All worker slots are occupied | Saved work waits without exceeding the limit |
| Setup, agent, or tests fail | Useful failure output and eventual cleanup |
| A worker claims another job | No job data or repository token |
| Token expires or publishing is rejected | Clear failure or authorized renewal; no force push |
| Push succeeds but PR creation fails | Saved branch reused by a later attempt |
| Completion is unavailable or the worker crashes | Independent cleanup still removes resources |

These checks include planned capabilities. Passing the current local tests does not establish that the complete workflow exists.

## Enable gradually

Begin with one concurrent worker. Measure setup time, coding time, total instance lifetime, success rate, cleanup delay, and cost. Include storage, IPv4, retained output, and network services.

Increase capacity after recovery and cleanup are dependable. The operational goal is simple: someone can find a job’s request, result, and cleanup status without logging into its machine.
