---
name: draft-pr
description: Draft or create a GitHub pull request that clearly summarizes a branch's overall changes, motivation, validation, and review considerations.
---

# Draft pull request

Compare the branch with its intended base branch before writing the pull request.
Use a specific, outcome-oriented title. Describe the overall behavior enabled by
the branch and the reason for it, rather than reciting filenames or commit titles.
Call out material design decisions, intentionally excluded behavior, and validation
performed when those details help reviewers assess the change.

Create the pull request only after the branch is pushed and its commits are ready
for review. Set the requested base branch when provided; otherwise use the
repository's default branch. Return the pull request URL and state any external
operation that could not be completed.
