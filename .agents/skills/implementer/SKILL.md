---
name: implementer
description: 'Use when implementing OPC UA client features. Delegates to the OpcJsImplementer agent for spec lookup, RefServer binary sync, breaking-change annotation, test execution, backlog/README updates, and sample build verification.'
argument-hint: 'Describe the feature to implement'
---

# OpcJs Implementer

Invoke the `OpcJsImplementer` custom agent as a subagent to handle the task, passing it the user's full description of the feature to implement verbatim. Report back the subagent's final result.
