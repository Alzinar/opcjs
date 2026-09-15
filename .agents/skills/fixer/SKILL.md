---
name: fixer
description: 'Use when fixing OpcJs features. Delegates to the OpcJsFixer agent for spec lookup, breaking-change annotation, test execution, backlog/README updates, and sample build verification.'
argument-hint: 'Describe the bug or broken feature to fix'
---

# OpcJs Fixer

Be sure to write a test that reproduces the bug or broken feature.
Invoke the `OpcJsImplementer` custom agent as a subagent to handle the task, passing it the user's full description of the bug or broken feature verbatim. Report back the subagent's final result.
