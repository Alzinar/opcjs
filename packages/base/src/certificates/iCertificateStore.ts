/**
 * Subject fields used to generate a self-signed OPC UA application instance
 * certificate (OPC 10000-6 §6.2).
 */
export type CertificateSubject = {
  /** Application URI encoded into the certificate's Subject Alternative Name (URI entry). */
  applicationUri: string
  /** Common Name (CN) of the certificate subject. */
  commonName: string
  /** Organization (O) of the certificate subject. */
  organization?: string
  /** DNS names encoded into the Subject Alternative Name (DNS entries). */
  dnsNames?: string[]
  /** Validity period in days. Default: 365. */
  validityDays?: number
}

/** Outcome of {@link ICertificateStore.validate}. */
export type CertificateValidationResult = {
  status: 'trusted' | 'rejected'
  /** Human-readable explanation, present when `status` is `'rejected'`. */
  reason?: string
}

/**
 * Persistent PKI certificate store (OPC 10000-6 §6.2 — Security Admin – Certificate
 * Management conformance unit).
 *
 * Implementations lay out the standard OPC UA PKI directory structure (own,
 * trusted, rejected, issuers) on top of a platform-specific storage backend
 * (`FileSystemCertificateStore` for Node.js, `IndexedDbCertificateStore` for
 * browsers). Use `createDefaultCertificateStore()` to obtain the implementation
 * appropriate for the current environment.
 */
export interface ICertificateStore {
  /** Adds a DER-encoded certificate to the trusted list (CA or peer application certificate). */
  addTrusted(cert: Uint8Array): Promise<void>

  /** Removes a certificate from the trusted list by its SHA-1 thumbprint (lowercase hex, no separators). */
  removeTrusted(thumbprint: string): Promise<void>

  /** Returns all DER-encoded certificates currently in the trusted list. */
  listTrusted(): Promise<Uint8Array[]>

  /** Moves a DER-encoded certificate into the rejected category for manual review. */
  reject(cert: Uint8Array): Promise<void>

  /** Returns all DER-encoded certificates currently in the rejected list. */
  listRejected(): Promise<Uint8Array[]>

  /** Returns this application's own certificate and private key, or `null` if none has been generated yet. */
  getOwn(): Promise<{ certificate: Uint8Array; privateKey: CryptoKey } | null>

  /** Generates a self-signed application instance certificate + key pair and stores it as "own". */
  generateOwn(subject: CertificateSubject): Promise<void>

  /** Regenerates the own certificate (same subject as the previous one) before it expires. */
  renewOwn(validityDays?: number): Promise<void>

  /**
   * Validates a DER-encoded certificate against the OPC 10000-6 §6.2 procedure:
   * syntactic X.509 check, SubjectAlternativeName vs. `expectedApplicationUri`,
   * chain building to a trusted CA, CRL and expiry checks, and finally the
   * `unknownCertificatePolicy` when the chain cannot be completed.
   */
  validate(certificate: Uint8Array, expectedApplicationUri?: string): Promise<CertificateValidationResult>
}
