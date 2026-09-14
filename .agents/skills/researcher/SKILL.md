---
name: researcher
description: 'Use when the user asks to create, review, or improve UI related to OPC UA, OPC UA nodes, OPC UA information models, OPC UA companion specifications, address-space browsers, machine model UIs, or operator/engineering UIs for OPC UA data.'
---

# OPC UA UI Skill

Use this skill when the user asks to create, review, or improve UI related to:

- OPC UA
- OPC UA nodes
- OPC UA information models
- OPC UA companion specifications
- address-space browsers
- machine model UIs
- operator or engineering UIs for OPC UA data

## MCP

Use the configured MCP server:

`opc-ua-reference`

for OPC UA reference information.

When the user asks for information related to OPC UA concepts:

1. Look up relevant OPC UA entities using the MCP server.
2. Derive labels, descriptions, hierarchy, required fields, and relations from the reference data.
3. Use descriptions as tooltips/help text where useful.
4. Do not guess type names, reference types, modelling rules, or node semantics.

Do not invent OPC UA semantics.
