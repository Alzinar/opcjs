/**
 * Thrown when the server's certificate (received in `CreateSessionResponse.endpoint.serverCertificate`)
 * fails the OPC 10000-6 §6.2 validation procedure (via `SecurityConfiguration.validateServerCertificate`
 * or the default `ICertificateStore.validate()`), so the session is not activated.
 */
export class ServerCertificateRejectedError extends Error {
  readonly reason?: string

  constructor(reason?: string) {
    super(`Server certificate was rejected${reason ? `: ${reason}` : '.'}`)
    this.name = 'ServerCertificateRejectedError'
    this.reason = reason
  }
}
