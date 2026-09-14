/**
 * Regression tests for how `SecureChannelFacade` handles the inbound stream ending.
 *
 * There are two distinct cases:
 * - Unexpected: the transport (WebSocket) closes on its own — i.e. without an
 *   explicit error — the underlying stream pipeline ends via a normal `done`
 *   signal rather than a rejection (see `WebSocketReadableStream.sourceOnPull`,
 *   which calls `controller.close()` on `ws.setOnClose`). `routeFrames()` must
 *   treat that `done` the same as a thrown error and reject every pending
 *   request (in particular a long-poll Publish request), otherwise the caller
 *   hangs forever and the client never learns the connection is gone — which is
 *   what caused the Publish loop to stop resuming after a reconnect (it never
 *   even *tried* to reconnect, its in-flight Publish promise never settled).
 * - Graceful: the application calls `close()` itself. That's not a failure, so
 *   nothing is rejected — any in-flight request is simply abandoned.
 */
import { describe, expect, it } from 'vitest'

import { SecureChannelFacade } from '../../src/secureChannel/secureChannelFacade'
import { SecureChannelContext } from '../../src/secureChannel/secureChannelContext'
import { ChannelClosedError } from '../../src/secureChannel/pendingRequests'
import type { MsgBase } from '../../src/secureChannel/messages/msgBase'
import type { IOpcType } from '../../src/types/iOpcType'

describe('SecureChannelFacade - connection loss', () => {
  it('rejects pending requests when the inbound stream closes cleanly (no thrown error)', async () => {
    const context = new SecureChannelContext('opc.wss://localhost:4840')
    const readerTransform = new TransformStream<MsgBase, MsgBase>()
    const writerTransform = new TransformStream<MsgBase, MsgBase>()

    const facade = new SecureChannelFacade(context, readerTransform, writerTransform)

    // Drain the outbound side so `writer.write()` resolves (mirrors production,
    // where the outbound pipe chain always drains synchronously into `ws.send()`).
    void writerTransform.readable.pipeTo(new WritableStream())

    const pending = facade.issueServiceRequest({} as IOpcType)

    // Simulate the transport closing cleanly: the readable side ends via `done`,
    // not via an error — matching WebSocketReadableStream's onClose behaviour.
    await readerTransform.writable.getWriter().close()

    await expect(pending).rejects.toThrow(ChannelClosedError)
  }, 2000)

  it('does not reject pending requests when close() is called explicitly (graceful shutdown)', async () => {
    const context = new SecureChannelContext('opc.wss://localhost:4840')
    const readerTransform = new TransformStream<MsgBase, MsgBase>()
    const writerTransform = new TransformStream<MsgBase, MsgBase>()

    const facade = new SecureChannelFacade(context, readerTransform, writerTransform)
    void writerTransform.readable.pipeTo(new WritableStream())

    const pending = facade.issueServiceRequest({} as IOpcType)

    facade.close()

    const settled = await Promise.race([
      pending.then(() => 'resolved', () => 'rejected'),
      new Promise<'unsettled'>((resolve) => setTimeout(() => resolve('unsettled'), 20)),
    ])

    expect(settled).toBe('unsettled')
  }, 2000)
})
