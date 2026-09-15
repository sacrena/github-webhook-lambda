---
name: code-structure
description: Organize or refactor repository code into readable modules with clear responsibilities.
---

Before adding code, search the repository for existing implementations, helpers, types, and call sites. Reuse or extend suitable code; do not create a second implementation of the same responsibility.

Keep feature handlers, types, and helpers together; place genuinely shared code in a shared module. Consolidate duplicated logic without introducing unnecessary layers.

Keep the Lambda entry point focused on routing. Preserve behavior during restructuring, update affected imports and packaging, and run relevant checks.
