# 4. Running the coding task

[Overview](../README.md) · [Previous: setup](../03-ec2-setup/README.md) · [Next: completion](../05-completion-cleanup/README.md)

The machine is ready. Now the proposed Kotlin runner takes the saved assignment and carries it through to an outcome people can review. This runner is not implemented yet.

Ansible should install a versioned `run-job.main.kts` script and an operating-system service that starts it once. Pin the script’s dependencies too, and test the exact launch command on a fresh worker. A Kotlin main script needs executable top-level code; declaring a main function alone does not start it.

## Follow one attempt

The runner first claims its assigned job and obtains repository access. It fetches the approved repository into an empty directory, checks out the saved commit, and creates the assigned output branch.

Next it gathers the issue or PR context and calls the agent with the task, working directory, and limits. Repository text and comments provide task material; they do not get to change the destination repository, credentials, or execution limits.

When the agent finishes, the runner runs the required project checks and inspects the diff. If the checks pass, it can ask the agent to draft the commit message and PR description, then commit, push, and open the PR.

The runner owns those publishing steps. It saves logs and the outcome before asking the control service to remove the machine.

## Make failures understandable

| Outcome | What should remain for the requester |
| --- | --- |
| Change passes checks | A branch and PR explaining the change and validation |
| No change is needed | An explanation, without an empty commit or unnecessary PR |
| Agent or checks fail | The failure reason and saved output or patch |
| Push is rejected | The publishing error; no force push |
| Push works but PR creation fails | The saved branch and commit, so PR creation can be retried |

Before retrying publication, look for the job’s existing branch, commit, and PR. Repeated reporting should not create duplicate results.

Start external programs with argument lists, an explicit working directory, captured output, and time limits. Treat a nonzero exit as failure unless that specific outcome is handled. An empty diff should be checked separately from a failed commit.

## Finish even when the attempt fails

The first release should publish only after the required checks pass. On failure, preserve useful evidence and still request completion. A failed log upload should not prevent the completion request or hide the original error.

Some failures kill the runner before its final cleanup can execute. The external timeout and recurring cleanup remain responsible for ending the machine’s lifetime in that case.

References: [Kotlin scripting](https://kotlinlang.org/docs/custom-script-deps-tutorial.html) and [creating a GitHub pull request](https://docs.github.com/en/rest/pulls/pulls#create-a-pull-request).
