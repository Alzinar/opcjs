import type { MessageSecurityModeEnum, UserTokenTypeEnum } from 'opcjs-base'

/** URI for the SecurityPolicy None profile. */
export const SECURITY_POLICY_NONE_URI = 'http://opcfoundation.org/UA/SecurityPolicy#None'

/**
 * How the client should handle a server certificate it cannot verify.
 *
 * - `'reject'` — abort the connection (secure default when `trustedCAs` is configured).
 * - `'trust'`  — accept any certificate without verification (development convenience;
 *                **insecure in production**).
 *
 * @note Enforcement is deferred until certificate-based security policies are
 *       implemented. The value is stored and will be honoured when that support lands.
 */
export type UnknownCertificatePolicy = 'reject' | 'trust'

/**
 * OPC UA client security configuration (OPC UA Part 2, Security Administration CU).
 *
 * Restricts which security options the client will accept when connecting to or
 * negotiating with a server. All fields are optional; omitting a field applies
 * the permissive default so that existing callers need no changes.
 *
 * @example
 * ```ts
 * const config = ConfigurationClient.getSimple('MyApp', 'MyCompany')
 * config.securityConfiguration = {
 *   allowedUserTokenTypes: [UserTokenTypeEnum.UserName],
 *   allowSecurityPolicyNone: false,   // require an encrypted channel
 * }
 * ```
 */
export type SecurityConfiguration = {
  /**
   * User-identity-token types the client is willing to accept.
   *
   * When set, `connect()` will throw if:
   * - The supplied `UserIdentity`'s token type is not in this list, OR
   * - The server endpoint does not offer any type from this list.
   *
   * Default: all token types are accepted (no restriction).
   */
  allowedUserTokenTypes?: UserTokenTypeEnum[]

  /**
   * Allow connecting when the negotiated SecurityPolicy is `None` (unencrypted,
   * unsigned channel).
   *
   * Set to `false` to require a secure channel — `connect()` will throw rather
   * than establish a cleartext connection.
   *
   * Currently the only supported security policy is `None`. Setting this to `false`
   * will therefore cause `connect()` to always throw until non-None policies are
   * added to this client implementation.
   *
   * Default: `true` (SecurityPolicy None is permitted).
   */
  allowSecurityPolicyNone?: boolean

  /**
   * Required `MessageSecurityMode` for the secure channel.
   *
   * When set, `connect()` verifies that the channel's negotiated mode matches
   * this value and throws otherwise.
   *
   * Currently only `MessageSecurityModeEnum.None` is supported.
   *
   * Default: no requirement (any mode is accepted).
   */
  messageSecurityMode?: MessageSecurityModeEnum

  /**
   * DER-encoded X.509 trusted CA certificates used to verify the server's
   * application instance certificate.
   *
   * @note Reserved for future use. Certificate verification is not yet implemented.
   *       Providing this field has no effect until non-None security policies land.
   */
  trustedCAs?: Uint8Array[]

  /**
   * How to handle a server certificate that cannot be verified against `trustedCAs`.
   *
   * - `'reject'` — refuse the connection (default when `trustedCAs` is provided).
   * - `'trust'`  — accept any certificate (development only; insecure in production).
   *
   * @note Reserved for future use. Has no effect until certificate verification is
   *       implemented alongside non-None security policies.
   */
  unknownCertificatePolicy?: UnknownCertificatePolicy

  /**
   * DER-encoded X.509 ApplicationInstanceCertificate for this client
   * (Security Certificate Administration conformance unit — OPC UA Part 6, §6.2).
   *
   * When set, this certificate is sent proactively as the `clientCertificate` on
   * every `CreateSession` request, allowing a site administrator to replace the
   * client's default (or absent) identity with a site-issued certificate.
   *
   * It is also used as an OPC UA 1.0 compatibility fallback for servers that
   * reject an uncertified `CreateSession`: if none is configured and the server
   * responds with a certificate-related status code (`BadCertificateInvalid`,
   * `BadSecurityChecksFailed`, or `BadNoValidCertificates`), the error propagates
   * to the caller since there is no certificate available to send.
   */
  applicationInstanceCertificate?: Uint8Array

  /**
   * DER-encoded PKCS#8 private key matching `applicationInstanceCertificate`
   * (Security Certificate Administration conformance unit).
   *
   * Stored alongside the certificate so both halves of the site-issued
   * key pair are available together in the client's certificate store.
   *
   * @note Reserved for future use. This client only supports SecurityPolicy
   *       None, which does not sign requests, so the private key is not yet
   *       used to compute `ActivateSessionRequest.clientSignature` /
   *       `userTokenSignature`. It will be used once non-None security
   *       policies are implemented.
   */
  privateKey?: Uint8Array
}
