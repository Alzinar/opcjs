/**
 * Unit tests for SecurityConfiguration enforcement.
 *
 * Two distinct enforcement points are tested:
 *
 * 1. Channel-level security (client.ts `enforceChannelSecurityConfig`):
 *    `allowSecurityPolicyNone` and `messageSecurityMode` are checked after the
 *    SecureChannel is established.  Tested by calling the private method directly
 *    through `(client as any).enforceChannelSecurityConfig(sc)`.
 *
 * 2. User-token validation (sessionHandler.ts `validateUserTokenPolicy`):
 *    `allowedUserTokenTypes` is checked just before `ActivateSession`.  Tested by
 *    calling the private method directly through `(handler as any).validateUserTokenPolicy`.
 */

import { describe, expect, it } from 'vitest'

import {
  EndpointDescription,
  type ICertificateStore,
  type IOpcType,
  MessageSecurityModeEnum,
  UserTokenPolicy,
  UserTokenTypeEnum,
} from 'opcjs-base'

import { Client } from '../../src/client.js'
import { ConfigurationClient } from '../../src/configuration/configurationClient.js'
import { SECURITY_POLICY_NONE_URI } from '../../src/securityConfiguration.js'
import { SessionHandler } from '../../src/sessions/sessionHandler.js'
import { UserIdentity } from '../../src/userIdentity.js'

// ---------------------------------------------------------------------------
// Helpers – channel-level tests
// ---------------------------------------------------------------------------

/**
 * Minimal ISecureChannel-shaped object with configurable security properties,
 * used to test `enforceChannelSecurityConfig` without a real network connection.
 */
function makeChannel(
  policy: string = SECURITY_POLICY_NONE_URI,
  mode: MessageSecurityModeEnum = MessageSecurityModeEnum.None,
) {
  return {
    getSecurityPolicy: () => policy,
    getSecurityMode: () => mode,
    getEndpointUrl: () => 'opc.wss://test',
    issueServiceRequest: () => Promise.reject(new Error('not used')) as Promise<IOpcType>,
  }
}

function makeClient(cfg: Partial<ConfigurationClient> = {}): Client {
  const config = ConfigurationClient.getSimple('TestClient', 'test')
  Object.assign(config, cfg)
  return new Client('wss://test-host/ua', config, UserIdentity.newAnonymous())
}

function callEnforceChannelSecurityConfig(client: Client, channel: ReturnType<typeof makeChannel>): void {
  // Access private method through type erasure for unit-testing purposes.
  ;(client as unknown as Record<string, (c: unknown) => void>)['enforceChannelSecurityConfig'](channel)
}

// ---------------------------------------------------------------------------
// Helpers – token-type validation tests
// ---------------------------------------------------------------------------

function makeSessionHandler(cfg: Partial<ConfigurationClient> = {}): SessionHandler {
  const config = ConfigurationClient.getSimple('TestClient', 'test')
  Object.assign(config, cfg)
  return new SessionHandler(
    makeChannel() as ReturnType<typeof makeChannel>,
    config,
    makeFakeCertificateStore(),
  )
}

/** Fake `ICertificateStore` with no own certificate — sufficient for these tests. */
function makeFakeCertificateStore(): ICertificateStore {
  return {
    addTrusted: async () => {},
    removeTrusted: async () => {},
    listTrusted: async () => [],
    reject: async () => {},
    listRejected: async () => [],
    getOwn: async () => null,
    generateOwn: async () => {},
    renewOwn: async () => {},
    validate: async () => ({ status: 'trusted' as const }),
  }
}

function makeEndpointWith(...tokenTypes: UserTokenTypeEnum[]): EndpointDescription {
  const endpoint = new EndpointDescription()
  endpoint.userIdentityTokens = tokenTypes.map((t) => {
    const policy = new UserTokenPolicy()
    policy.tokenType = t
    policy.policyId = `policy-${t}`
    return policy
  })
  return endpoint
}

function callValidateUserTokenPolicy(
  handler: SessionHandler,
  identity: UserIdentity,
  endpoint: EndpointDescription,
): void {
  ;(handler as unknown as Record<string, (i: UserIdentity, e: EndpointDescription) => void>)['validateUserTokenPolicy'](identity, endpoint)
}

// ---------------------------------------------------------------------------
// Tests – channel-level security enforcement
// ---------------------------------------------------------------------------

describe('SecurityConfiguration – channel enforcement', () => {
  it('does not throw when no security configuration is set', () => {
    const client = makeClient()
    expect(() => callEnforceChannelSecurityConfig(client, makeChannel())).not.toThrow()
  })

  it('does not throw when allowSecurityPolicyNone is true (default)', () => {
    const client = makeClient({ securityConfiguration: { allowSecurityPolicyNone: true } })
    expect(() => callEnforceChannelSecurityConfig(client, makeChannel(SECURITY_POLICY_NONE_URI))).not.toThrow()
  })

  it('throws when allowSecurityPolicyNone is false and channel uses None policy', () => {
    const client = makeClient({ securityConfiguration: { allowSecurityPolicyNone: false } })
    expect(() => callEnforceChannelSecurityConfig(client, makeChannel(SECURITY_POLICY_NONE_URI))).toThrow(
      /SecurityPolicy None is disabled/,
    )
  })

  it('does not throw when allowSecurityPolicyNone is false and channel uses a non-None policy', () => {
    const client = makeClient({ securityConfiguration: { allowSecurityPolicyNone: false } })
    // Hypothetical future non-None policy — should not throw the None-specific error.
    const nonNoneChannel = makeChannel(
      'http://opcfoundation.org/UA/SecurityPolicy#Basic256Sha256',
      MessageSecurityModeEnum.SignAndEncrypt,
    )
    expect(() => callEnforceChannelSecurityConfig(client, nonNoneChannel)).not.toThrow()
  })

  it('throws when messageSecurityMode does not match the negotiated mode', () => {
    const client = makeClient({
      securityConfiguration: { messageSecurityMode: MessageSecurityModeEnum.SignAndEncrypt },
    })
    // Channel negotiated None — does not match the required SignAndEncrypt.
    expect(() => callEnforceChannelSecurityConfig(client, makeChannel())).toThrow(
      /negotiated MessageSecurityMode.*does not match/,
    )
  })

  it('does not throw when messageSecurityMode matches the negotiated mode', () => {
    const client = makeClient({
      securityConfiguration: { messageSecurityMode: MessageSecurityModeEnum.None },
    })
    expect(() => callEnforceChannelSecurityConfig(client, makeChannel())).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// Tests – user-token type validation
// ---------------------------------------------------------------------------

describe('SecurityConfiguration – user-token policy validation', () => {
  it('does not throw when no allowedUserTokenTypes restriction is set', () => {
    const handler = makeSessionHandler()
    const endpoint = makeEndpointWith(UserTokenTypeEnum.Anonymous)
    expect(() =>
      callValidateUserTokenPolicy(handler, UserIdentity.newAnonymous(), endpoint),
    ).not.toThrow()
  })

  it('does not throw when the requested token type is in the allowed list', () => {
    const handler = makeSessionHandler({
      securityConfiguration: { allowedUserTokenTypes: [UserTokenTypeEnum.Anonymous] },
    })
    const endpoint = makeEndpointWith(UserTokenTypeEnum.Anonymous)
    expect(() =>
      callValidateUserTokenPolicy(handler, UserIdentity.newAnonymous(), endpoint),
    ).not.toThrow()
  })

  it('throws when the requested token type is not in the allowed list', () => {
    const handler = makeSessionHandler({
      securityConfiguration: { allowedUserTokenTypes: [UserTokenTypeEnum.UserName] },
    })
    const endpoint = makeEndpointWith(UserTokenTypeEnum.Anonymous, UserTokenTypeEnum.UserName)
    // Anonymous identity — but only UserName is allowed by the client config.
    expect(() =>
      callValidateUserTokenPolicy(handler, UserIdentity.newAnonymous(), endpoint),
    ).toThrow(/not permitted by the client security configuration/)
  })

  it('includes the disallowed token type name in the error message', () => {
    const handler = makeSessionHandler({
      securityConfiguration: { allowedUserTokenTypes: [UserTokenTypeEnum.UserName] },
    })
    const endpoint = makeEndpointWith(UserTokenTypeEnum.UserName)
    let caught: unknown
    try {
      callValidateUserTokenPolicy(handler, UserIdentity.newAnonymous(), endpoint)
    } catch (err) {
      caught = err
    }
    expect((caught as Error).message).toMatch(/Anonymous/)
  })

  it('throws when server endpoint does not offer any allowed token type', () => {
    // allowedUserTokenTypes = [UserName] and identity = UserName, so check #1 passes.
    // Server only offers Anonymous — intersection is empty, so check #2 throws.
    const handler = makeSessionHandler({
      securityConfiguration: { allowedUserTokenTypes: [UserTokenTypeEnum.UserName] },
    })
    const endpoint = makeEndpointWith(UserTokenTypeEnum.Anonymous)
    expect(() =>
      callValidateUserTokenPolicy(handler, UserIdentity.newWithUserName('u', 'p'), endpoint),
    ).toThrow(/Server endpoint does not offer any user token type from the allowed list/)
  })

  it('allows multiple token types in the allowed list', () => {
    const handler = makeSessionHandler({
      securityConfiguration: {
        allowedUserTokenTypes: [UserTokenTypeEnum.Anonymous, UserTokenTypeEnum.UserName],
      },
    })
    const endpoint = makeEndpointWith(UserTokenTypeEnum.Anonymous)
    expect(() =>
      callValidateUserTokenPolicy(handler, UserIdentity.newAnonymous(), endpoint),
    ).not.toThrow()
  })
})
