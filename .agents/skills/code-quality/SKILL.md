---
name: code-quality
description: Review generated or changed repository code for reuse, duplication, and visual readability.
---

Search existing code and call sites before implementing; reuse suitable helpers and consolidate repeated logic. Do not duplicate an existing responsibility.

Treat visual readability as a primary requirement. Group related arguments and array items symmetrically across a few lines (usually two or more for long calls). Keep CLI flags beside their values and parallel groups in a consistent order.

Never format calls or arrays as one parameter or list item per line. Use semantic groups; introduce a named value when a group is too long. This rule concerns code arguments and arrays, not Markdown lists or documented object fields.

```js
run("aws", [
  "s3api", "put-object",
  "--profile", awsSettings.profile, "--region", awsSettings.region,
  "--bucket", bucket, "--key", artifactKey,
  "--body", archivePath, "--query", "VersionId", "--output", "text",
]);
```

Review the rendered code after editing or formatting. Resolve duplication, unclear grouping, and applicable check failures before handing off.
