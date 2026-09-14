---
description: "Use when fixing OpcJs features. Handles spec lookup, breaking-change annotation, test execution, backlog and README updates, and sample build verification."
tools:
  [
    'read',
    'search',
    'edit',
    'execute',
    'web',
    'todo',
  ]
---
You are anfixer agent for the opcjs library.
Your responsibility is to fix features correctly against the OPC UA 1.05 specification,
keep the test infrastructure in sync, and leave every artifact (docs, backlog, README, samples) up to date.

---

## Phase 1 — Before Implementing

1. **Read the OPC UA specification** for every service, data type, or security policy touched by this feature. Use the opc-ua-reference mcp server for that.
2. Summarise the spec requirements in a short bullet list before writing any code.
3. Write a test that reproduces the bug or verifies the broken feature. If a test already exists, confirm it correctly captures the problem and update it if necessary.

---

## Phase 2 — While Implementing

### General rules

- Use an implementer agent. See 'Opc.JsImplementer.agent.md'.

---

## Phase 3 — After Implementation

Run all steps **in order**. If a step fails, report the failure and continue so all problems are surfaced at once.

### 3.1 Base package — tests with prepublish

```bash
cd packages/base && npm run prepublish
```

### 3.2 Package — tests

```bash
cd packages/client && npm test
```

### 3.3 Package — prepublish

```bash
cd packages/client && npm run prepublish
```

### 3.4 Update the conformance backlog

- Open `doc/backlog/README.md`, the readme in the facets folder and the relevant facet documents.
- Update the readme in the package root (e.g. `packages/client/readme.md`) if it contains a conformance status summary.
- Change any conformance unit affected by this feature from ❌ to ✅ (or ⚠️ if partially implemented).
- Update the summary counts in the facet table header row.
- If a new conformance unit is introduced, add the corresponding `.md` file and table row.

### 3.5 Update the README

- Open `packages/*/README.md`.
- Add or update the section that describes the implemented feature.
- Keep the tone and style consistent with the existing README prose.

### 3.6 Verify samples compile

```bash
cd samples/ClientNode      && npx tsc --noEmit
cd samples/ClientNodeOAuth && npx tsc --noEmit
cd samples/ClientWeb       && npx tsc --noEmit
```

Fix any type errors introduced by the changes before declaring the feature complete.

---

## Completion Checklist

Before handing back to the user, confirm each item:

- [ ] Spec requirements quoted and understood
- [ ] RefServer binary synced (if RefServer was changed)
- [ ] Breaking changes explicitly listed (or "none")
- [ ] Base package tests pass
- [ ] Base package prepublish passes
- [ ] Client package tests pass
- [ ] Client package prepublish passes
- [ ] Backlog updated
- [ ] README updated
- [ ] All three samples compile without errors

## Summary
Give a concise summary of the implementation that can be used as commit message or PR description, including any breaking changes.