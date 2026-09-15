import type { NodeId } from 'opcjs-base'

import type { ContinuationPointEntry } from '../services/viewService.js'

/**
 * Represents a single server-side OPC UA session.
 *
 * Created by {@link SessionManager.createSession} and activated by
 * {@link SessionManager.activateSession}.  All fields are set at creation
 * time; `isActivated` and `lastActivityAt` are mutated as the session
 * progresses through its lifecycle.
 *
 * @see OPC UA Part 4 §5.6.2 CreateSession / §5.6.3 ActivateSession
 */
export type Session = {
  /** NodeId that uniquely identifies this session within the server. */
  readonly sessionId: NodeId
  /**
   * Token carried in every request header to look up the session.
   * Generated independently of `sessionId` — clients must keep it secret.
   */
  readonly authenticationToken: NodeId
  /** 32-byte random nonce sent to the client in `CreateSessionResponse`. */
  readonly serverNonce: Uint8Array
  /** Negotiated session timeout in milliseconds. */
  readonly revisedTimeoutMs: number
  /** channelId of the secure channel that first activated this session. */
  boundChannelId: number
  /** True once `ActivateSession` has succeeded at least once. */
  isActivated: boolean
  /** When the session was created. */
  readonly createdAt: Date
  /** Timestamp of the most recent service request on this session. */
  lastActivityAt: Date
  /**
   * Outstanding `Browse` / `BrowseNext` continuation points for this
   * session, keyed by a hex token. Session-scoped: discarded when the
   * session ends (OPC UA Part 4 §5.8.2/§5.8.3).
   */
  readonly continuationPoints: Map<string, ContinuationPointEntry>
  /**
   * NodeIds registered via `RegisterNodes` for this session, keyed by their
   * string form. Session-scoped: discarded when the session ends
   * (OPC UA Part 4 §5.8.5).
   */
  readonly registeredNodes: Set<string>
}

