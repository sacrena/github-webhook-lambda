---
name: code-documentation
description: Write developer-facing documentation when adding or changing code in this repository.
---

Immediately above every type, interface, class, method, and function (including private helpers), write a cohesive JSDoc description of 5–9 non-empty prose lines, excluding delimiters and tags. These are naturally wrapped lines, not five to nine separate sentences. Use one or two connected paragraphs; never pad the block with checklists, slogans, or obvious statements.

Lead with the declaration's purpose in its caller's workflow. Explain why it is needed, where it is used, and the constraints a maintainer needs to preserve. Include behavior only when it clarifies that context or the caller contract; do not narrate the implementation.

Add accurate @param, @returns, and @throws tags where inputs, results, or failures need explanation. Tags supplement the contextual prose and do not count toward its line range. Document actual guarantees, not intended safeguards.

Document each type/interface property and class field with a single-line comment describing its contextual role. The field rule overrides the longer declaration rule for fields; methods still require 5–9 lines.

Read each block as standalone developer documentation, then verify it against the implementation and call sites. Remove repetition and unsupported claims; link authoritative sources when explaining external protocol rules.
