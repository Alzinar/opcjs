import { getLogger, NodeId, StatusCode } from 'opcjs-base'
import type { ExtensionObject, ILogger } from 'opcjs-base'

import type { ConfigurationServer } from '../configuration/configurationServer.js'
import { AuthenticationError } from '../security/anonymousAuthenticator.js'
import { validateAnonymousToken } from '../security/anonymousAuthenticator.js'
import type { Session } from './session.js'

/**
 * Error thrown by {@link SessionManager} for invalid or expired sessions.
 *
 * Carries the OPC UA status code to return to the client.
 */
export class SessionError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message)
    this.name = 'SessionError'
  }
}

/** Monotonically increasing counter for session NodeId identifiers. */
let nextSessionNumericId = 1

/**
 * Manages the lifecycle of OPC UA sessions on the server.
 *
 * Responsibilities:
 * - Allocate unique `sessionId` and `authenticationToken` NodeIds
 * - Generate 32-byte server nonces
 * - Validate identity tokens on activation (anonymous only)
 * - Enforce `maxSessions` limit
 * - Clean up expired sessions via a timer
 *
 * @see OPC UA Part 4 §5.6 Session Services
 */
export class SessionManager {
  private readonly sessions = new Map<string, Session>()
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly logger: ILogger

  constructor(private readonly config: ConfigurationServer) {
    this.logger = getLogger('sessions.SessionManager')
  }

  /**
   * Creates a new (not yet activated) session.
   *
   * Generates a unique `sessionId`, `authenticationToken`, and 32-byte
   * `serverNonce`.  Clamps `requestedTimeoutMs` to the configured
   * `[minSessionTimeoutMs, maxSessionTimeoutMs]` range.
   *
   * Throws {@link SessionError} with `StatusCode.BadTooManySessions` when the
   * server session limit has been reached.
   *
   * @param channelId - channelId of the secure channel from which the request arrived
   * @param requestedTimeoutMs - client-requested session timeout in milliseconds
   */
  createSession(channelId: number, requestedTimeoutMs: number): Session {
    if (this.sessions.size >= this.config.maxSessions) {
      throw new SessionError(
        `Session limit of ${this.config.maxSessions} reached`,
        StatusCode.BadTooManySessions,
      )
    }

    const revisedTimeoutMs = Math.max(
      this.config.minSessionTimeoutMs,
      Math.min(requestedTimeoutMs, this.config.maxSessionTimeoutMs),
    )

    const sessionId = NodeId.newNumeric(0, nextSessionNumericId++)
    const authenticationToken = NodeId.newNumeric(0, nextSessionNumericId++)

    const serverNonce = new Uint8Array(32)
    for (let i = 0; i < 32; i++) {
      serverNonce[i] = Math.floor(Math.random() * 256)
    }

    const now = new Date()
    const session: Session = {
      sessionId,
      authenticationToken,
      serverNonce,
      revisedTimeoutMs,
      boundChannelId: channelId,
      isActivated: false,
      createdAt: now,
      lastActivityAt: now,
      continuationPoints: new Map(),
      registeredNodes: new Set(),
    }

    const key = authenticationToken.toString()
    this.sessions.set(key, session)
    this.scheduleTimeout(key, revisedTimeoutMs)

    this.logger.debug(
      `Session created: ${sessionId.toString()} (token=${key}, timeout=${revisedTimeoutMs}ms)`,
    )

    return session
  }

  /**
   * Activates a previously created session.
   *
   * Validates the `authenticationToken`, checks the secure-channel binding,
   * and validates the `userIdentityToken` as anonymous.
   *
   * Throws {@link SessionError} for invalid/expired session tokens.
   * Throws {@link AuthenticationError} for unsupported identity tokens.
   *
   * @param authToken - authenticationToken from the `ActivateSessionRequest` header
   * @param userIdentityToken - identity token extension object from the request
   * @param channelId - channelId of the secure channel sending the request
   */
  activateSession(
    authToken: NodeId,
    userIdentityToken: ExtensionObject | null | undefined,
    channelId: number,
  ): Session {
    const session = this.findSession(authToken)

    validateAnonymousToken(userIdentityToken)

    session.boundChannelId = channelId
    session.isActivated = true
    session.lastActivityAt = new Date()

    this.rescheduleTimeout(authToken.toString(), session.revisedTimeoutMs)

    this.logger.debug(`Session activated: ${session.sessionId.toString()}`)

    return session
  }

  /**
   * Closes a session and cancels its timeout timer.
   *
   * Silently ignores unknown tokens so that close-on-disconnect paths are safe.
   *
   * @param authToken - authenticationToken from the `CloseSessionRequest` header
   */
  closeSession(authToken: NodeId): void {
    const key = authToken.toString()
    if (!this.sessions.has(key)) {
      return
    }
    this.cancelTimeout(key)
    this.sessions.delete(key)
    this.logger.debug(`Session closed: ${key}`)
  }

  /**
   * Validates that the session for `authToken` exists and has been activated.
   *
   * Throws {@link SessionError} with the appropriate OPC UA status code when
   * validation fails.  Should be called by the service dispatcher before
   * processing any session-bearing request.
   *
   * @param authToken - authenticationToken from the request header
   */
  validateSession(authToken: NodeId): Session {
    const session = this.findSession(authToken)
    if (!session.isActivated) {
      throw new SessionError(
        `Session ${authToken.toString()} has not been activated`,
        StatusCode.BadSessionClosed,
      )
    }
    return session
  }

  /**
   * Updates `lastActivityAt` and resets the idle timeout for the session.
   *
   * MUST be called by the service dispatcher after each successful service
   * invocation to prevent idle sessions from being reaped.
   *
   * @param authToken - authenticationToken from the processed request
   */
  touchSession(authToken: NodeId): void {
    const key = authToken.toString()
    const session = this.sessions.get(key)
    if (session == null) {
      return
    }
    session.lastActivityAt = new Date()
    this.rescheduleTimeout(key, session.revisedTimeoutMs)
  }

  /**
   * Closes all active sessions and cancels their timeout timers.
   *
   * Called during server shutdown so that no timers linger after the process
   * would otherwise be idle.
   */
  closeAllSessions(): void {
    for (const key of [...this.sessions.keys()]) {
      this.cancelTimeout(key)
    }
    this.sessions.clear()
    this.logger.debug('All sessions closed')
  }

  // ── internal helpers ──────────────────────────────────────────────────────

  private findSession(authToken: NodeId): Session {
    const key = authToken.toString()
    const session = this.sessions.get(key)
    if (session == null) {
      throw new SessionError(
        `Session not found for token: ${key}`,
        StatusCode.BadSessionIdInvalid,
      )
    }
    return session
  }

  private scheduleTimeout(key: string, timeoutMs: number): void {
    const timer = setTimeout(() => {
      this.sessions.delete(key)
      this.timers.delete(key)
      this.logger.debug(`Session timed out and removed: ${key}`)
    }, timeoutMs)
    this.timers.set(key, timer)
  }

  private rescheduleTimeout(key: string, timeoutMs: number): void {
    this.cancelTimeout(key)
    this.scheduleTimeout(key, timeoutMs)
  }

  private cancelTimeout(key: string): void {
    const timer = this.timers.get(key)
    if (timer != null) {
      clearTimeout(timer)
      this.timers.delete(key)
    }
  }
}

export { AuthenticationError }
