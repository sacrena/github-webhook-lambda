# 5. Saving the result and removing the worker

[Overview](../README.md) · [Previous: runner](../04-kotlin-runner/README.md) · [Next: build plan](../06-build-plan/README.md)

The coding attempt is over. It may have produced a PR, found nothing to change, or failed a test. In every case, the useful outcome should survive and the temporary worker should end.

Timeout handling and recurring resource cleanup already exist. This chapter proposes the missing completion flow and richer job reporting.

## Save first, then terminate

The runner should upload its output and report completion using its verified job identity. The control service checks that the caller owns the assignment, saves the outcome, and asks EC2 to terminate the instance recorded for that job.

The completion request should describe the result and where to find it. It should not choose an arbitrary instance ID to terminate.

Keep the job outcome separate from cleanup progress. A successful coding task can still have a worker awaiting termination. A later check should confirm that EC2 finished termination before releasing a reserved worker slot.

## If completion never arrives

A crash, failed boot, or broken network can prevent the runner from reporting. That is why the deadline is enforced outside the machine.

The current recurring cleanup finds expired resources through tags, even when saving an instance ID failed. The proposed job reporting should also record an unknown outcome as timed out or lost. Resource disappearance alone does not prove coding success.

Guest shutdown can provide another path to termination; the current launch enables that behavior. It still depends on software inside the machine running, so it cannot replace external cleanup.

## What remains afterward

GitHub branches and PRs should remain for review. Saved logs and artifacts should remain until their retention policy removes them. Temporary disks configured for deletion should disappear with the worker, and cleanup should catch eligible detached leftovers.

Remove temporary credentials and revoke the repository token when possible. A token-revocation error should not keep a machine running indefinitely.

A later review request starts a new attempt. Cancellation should use the same cleanup path, with only a bounded opportunity to save output.

The [current termination guide](../../../execution-flow/04-termination.md) explains what is implemented. AWS’s [termination documentation](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/terminating-instances.html) explains the asynchronous resource lifecycle.
