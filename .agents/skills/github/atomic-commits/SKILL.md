---
name: atomic-commits
description: Create an ordered series of focused Git commits for a completed repository change, with titles and bodies that explain the intent of each independently reviewable step.
---

# Atomic commits

Inspect the working tree, staged changes, recent history, and file timestamps when
available to identify the logical sequence in which the work was made. Preserve
that sequence when it can be determined; otherwise order commits so prerequisites
precede consumers. Do not rewrite, discard, or mix unrelated user changes.

Stage only the files that belong to one independently reviewable change. Give each
commit an imperative title and a concise body explaining both the change and its
reason. Before committing, review the staged diff and run the relevant focused
checks. After every commit, confirm the remaining worktree still contains only
the intended later changes.
