# Base Info SemanticChange Bit

**Facet**: Embedded DataChange Subscription 2022 Server Facet  
**Type**: Required  
**Status**: ✅ Implemented

## Description

> Supports setting the SemanticsChanged Bit in the statusCode when a semantic change occurs, such as a change in the engineering unit associated with the Value Attribute.

Per Part 4 §7.39, when a semantic property of a Variable changes (engineering units, definition, etc.), the next reported `DataValue` for that Variable in a Subscription must have the `SemanticsChanged` bit set in its `StatusCode`.

Implementation:

1. `AttributeService.write()` detects writes to a fixed set of "semantic" Property BrowseNames (`EngineeringUnits`, `EURange`, `Definition`, `ValuePrecision`, `CurrencyUnit`) and resolves the owning Variable by walking the inverse `HasProperty` reference.
2. It then calls `SubscriptionManager.notifySemanticChange(ownerNodeId)`, which marks every MonitoredItem (across every Subscription) observing that Variable's `Value` attribute.
3. `MonitoredItem.sample()` forces a notification on the next sampling tick even if the raw value is unchanged, ORing `0x4000` (`SemanticsChanged`) into the reported `StatusCode`.

## Specification References

| Reference | Section | Topic |
|-----------|---------|-------|
| OPC 10000-4 §7.39 | StatusCode | InfoBits incl. `SemanticsChanged` |
| OPC 10000-4 §5.13.1 | Monitored Item model | Semantic change handling |

Online: https://reference.opcfoundation.org/Core/Part4/v105/docs/7.39

## Implementation

- `packages/server/src/services/attributeService.ts` — `notifySemanticChangeIfApplicable()`.
- `packages/server/src/subscription/subscriptionManager.ts` / `subscription.ts` — `notifySemanticChange()`.
- `packages/server/src/subscription/monitoredItem.ts` — `markSemanticsChanged()` / bit-setting in `sample()`.
