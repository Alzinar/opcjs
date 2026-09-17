import * as fsp from 'node:fs/promises'
import * as pathMod from 'node:path'

import {
  exportPrivateKeyPkcs8,
  generateSelfSignedCertificate,
  getThumbprintHex,
  importPrivateKeyPkcs8,
  parseCertificate,
  renewOwnCertificate,
  validateCertificateChain,
} from './certificateCrypto.js'
import type { CertificateSubject, CertificateValidationResult, ICertificateStore } from './iCertificateStore.js'

/**
 * Node.js `ICertificateStore` implementation backed by the standard OPC UA PKI
 * directory layout (OPC 10000-6 §6.2):
 *
 * ```
 * <baseDir>/own/certs, <baseDir>/own/private,
 * <baseDir>/trusted/certs, <baseDir>/trusted/crl,
 * <baseDir>/rejected/certs,
 * <baseDir>/issuers/certs, <baseDir>/issuers/crl
 * ```
 *
 * One DER file per certificate/CRL; the own private key is stored as PKCS#8 DER.
 * Only usable in Node.js (relies on `node:fs/promises`) — use
 * `createDefaultCertificateStore()` to pick this implementation automatically.
 */
export class FileSystemCertificateStore implements ICertificateStore {
  private readonly ownCertsDir: string
  private readonly ownPrivateDir: string
  private readonly trustedCertsDir: string
  private readonly trustedCrlDir: string
  private readonly rejectedCertsDir: string
  private readonly issuersCertsDir: string
  private readonly issuersCrlDir: string

  private static readonly OWN_CERT_FILE = 'own.der'
  private static readonly OWN_KEY_FILE = 'own.key'

  constructor(
    private readonly baseDir: string,
    private readonly options: { unknownCertificatePolicy?: 'reject' | 'trust' } = {},
  ) {
    this.ownCertsDir = pathMod.join(baseDir, 'own', 'certs')
    this.ownPrivateDir = pathMod.join(baseDir, 'own', 'private')
    this.trustedCertsDir = pathMod.join(baseDir, 'trusted', 'certs')
    this.trustedCrlDir = pathMod.join(baseDir, 'trusted', 'crl')
    this.rejectedCertsDir = pathMod.join(baseDir, 'rejected', 'certs')
    this.issuersCertsDir = pathMod.join(baseDir, 'issuers', 'certs')
    this.issuersCrlDir = pathMod.join(baseDir, 'issuers', 'crl')
  }

  private async ensureDirs(): Promise<void> {
    await Promise.all(
      [
        this.ownCertsDir,
        this.ownPrivateDir,
        this.trustedCertsDir,
        this.trustedCrlDir,
        this.rejectedCertsDir,
        this.issuersCertsDir,
        this.issuersCrlDir,
      ].map((dir) => fsp.mkdir(dir, { recursive: true })),
    )
  }

  private async readDerFiles(dir: string, extension = '.der'): Promise<Uint8Array[]> {
    let entries: string[]
    try {
      entries = await fsp.readdir(dir)
    } catch {
      return []
    }
    const files = entries.filter((name) => name.endsWith(extension))
    return Promise.all(files.map(async (name) => new Uint8Array(await fsp.readFile(pathMod.join(dir, name)))))
  }

  async addTrusted(cert: Uint8Array): Promise<void> {
    await this.ensureDirs()
    const thumbprint = await getThumbprintHex(parseCertificate(cert))
    await fsp.writeFile(pathMod.join(this.trustedCertsDir, `${thumbprint}.der`), cert)
  }

  async removeTrusted(thumbprint: string): Promise<void> {
    try {
      await fsp.rm(pathMod.join(this.trustedCertsDir, `${thumbprint}.der`))
    } catch {
      // Already absent; removeTrusted is idempotent.
    }
  }

  async listTrusted(): Promise<Uint8Array[]> {
    return this.readDerFiles(this.trustedCertsDir)
  }

  async reject(cert: Uint8Array): Promise<void> {
    await this.ensureDirs()
    const thumbprint = await getThumbprintHex(parseCertificate(cert))
    await fsp.writeFile(pathMod.join(this.rejectedCertsDir, `${thumbprint}.der`), cert)
  }

  async listRejected(): Promise<Uint8Array[]> {
    return this.readDerFiles(this.rejectedCertsDir)
  }

  async getOwn(): Promise<{ certificate: Uint8Array; privateKey: CryptoKey } | null> {
    let certificate: Uint8Array
    try {
      certificate = new Uint8Array(await fsp.readFile(pathMod.join(this.ownCertsDir, FileSystemCertificateStore.OWN_CERT_FILE)))
    } catch {
      return null
    }
    const keyDer = new Uint8Array(await fsp.readFile(pathMod.join(this.ownPrivateDir, FileSystemCertificateStore.OWN_KEY_FILE)))
    const privateKey = await importPrivateKeyPkcs8(keyDer)
    return { certificate, privateKey }
  }

  async generateOwn(subject: CertificateSubject): Promise<void> {
    await this.ensureDirs()
    const { certificateDer, keyPair } = await generateSelfSignedCertificate(subject)
    const keyDer = await exportPrivateKeyPkcs8(keyPair.privateKey)
    await fsp.writeFile(pathMod.join(this.ownCertsDir, FileSystemCertificateStore.OWN_CERT_FILE), certificateDer)
    await fsp.writeFile(pathMod.join(this.ownPrivateDir, FileSystemCertificateStore.OWN_KEY_FILE), keyDer)
  }

  async renewOwn(validityDays?: number): Promise<void> {
    await renewOwnCertificate(this, validityDays)
  }

  async validate(certificate: Uint8Array, expectedApplicationUri?: string): Promise<CertificateValidationResult> {
    const [trustedDers, trustedCrlDers, issuersCrlDers] = await Promise.all([
      this.listTrusted(),
      this.readDerFiles(this.trustedCrlDir, '.crl'),
      this.readDerFiles(this.issuersCrlDir, '.crl'),
    ])

    return validateCertificateChain({
      certificateDer: certificate,
      expectedApplicationUri,
      trustedDers,
      crlDers: [...trustedCrlDers, ...issuersCrlDers],
      unknownCertificatePolicy: this.options.unknownCertificatePolicy ?? 'reject',
    })
  }
}
