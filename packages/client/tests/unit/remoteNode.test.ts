/**
 * Unit tests for Base Info Client Remote Nodes (OPC UA Part 3, §8.2 / Part 4, §5.8.2.2):
 * recognising `ExpandedNodeId` values that reference a Node on a different server.
 */

import { describe, expect, it } from 'vitest'

import { ExpandedNodeId, LocalizedText, NodeClassEnum, NodeId, QualifiedName } from 'opcjs-base'

import { BrowseNodeResult } from '../../src/browseNodeResult.js'
import { isRemoteNode, resolveLocalNodeId, RemoteNodeError } from '../../src/remoteNode.js'

function makeBrowseResult(nodeId: ExpandedNodeId, typeDefinition = new ExpandedNodeId(NodeId.newNumeric(0, 0))): BrowseNodeResult {
  return new BrowseNodeResult(
    NodeId.newNumeric(0, 33),
    true,
    nodeId,
    new QualifiedName(1, 'Test'),
    new LocalizedText('en', 'Test'),
    NodeClassEnum.Variable,
    typeDefinition,
  )
}

describe('isRemoteNode', () => {
  it('returns false for a local NodeId with no serverIndex/namespaceUri', () => {
    const expanded = new ExpandedNodeId(NodeId.newNumeric(2, 123))
    expect(isRemoteNode(expanded)).toBe(false)
  })

  it('returns false when serverIndex is explicitly 0', () => {
    const expanded = new ExpandedNodeId(NodeId.newNumeric(2, 123), undefined, 0)
    expect(isRemoteNode(expanded)).toBe(false)
  })

  it('returns true when serverIndex is greater than 0', () => {
    const expanded = new ExpandedNodeId(NodeId.newNumeric(2, 123), undefined, 1)
    expect(isRemoteNode(expanded)).toBe(true)
  })

  it('returns true when a non-empty namespaceUri is set', () => {
    const expanded = new ExpandedNodeId(NodeId.newNumeric(0, 123), 'http://example.com/UA/')
    expect(isRemoteNode(expanded)).toBe(true)
  })
})

describe('resolveLocalNodeId', () => {
  it('returns the wrapped NodeId for a local node', () => {
    const nodeId = NodeId.newNumeric(2, 123)
    const expanded = new ExpandedNodeId(nodeId)
    expect(resolveLocalNodeId(expanded)).toBe(nodeId)
  })

  it('throws RemoteNodeError for a remote node', () => {
    const expanded = new ExpandedNodeId(NodeId.newNumeric(2, 123), undefined, 2)
    expect(() => resolveLocalNodeId(expanded)).toThrow(RemoteNodeError)
  })
})

describe('BrowseNodeResult.isRemote', () => {
  it('returns false for an ordinary local browse result', () => {
    const result = makeBrowseResult(new ExpandedNodeId(NodeId.newNumeric(2, 1)))
    expect(result.isRemote()).toBe(false)
  })

  it('returns true when nodeId references a remote server', () => {
    const result = makeBrowseResult(new ExpandedNodeId(NodeId.newNumeric(2, 1), undefined, 3))
    expect(result.isRemote()).toBe(true)
  })

  it('returns true when typeDefinition references a remote server', () => {
    const result = makeBrowseResult(
      new ExpandedNodeId(NodeId.newNumeric(2, 1)),
      new ExpandedNodeId(NodeId.newNumeric(0, 58), 'http://example.com/UA/'),
    )
    expect(result.isRemote()).toBe(true)
  })
})
