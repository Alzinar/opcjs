import 'reflect-metadata'
import * as x509 from '@peculiar/x509'

import type { CertificateSubject, CertificateValidationResult, ICertificateStore } from './iCertificateStore.js'

// `@peculiar/x509` works isomorphically on top of WebCrypto but needs a provider
// wired in once; the global `crypto` is available in both browsers and Node >= 19.
x509.cryptoProvider.set(crypto)

/** WebCrypto key-generation parameters used for all OPC UA application instance certificates. */
export const CERTIFICATE_KEY_GEN_ALGORITHM: RsaHashedKeyGenParams = {
  name: 'RSASSA-PKCS1-v1_5',
  modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]),
  hash: 'SHA-256',
}

/** WebCrypto signing/import algorithm matching {@link CERTIFICATE_KEY_GEN_ALGORITHM}. */
export const CERTIFICATE_SIGNING_ALGORITHM: RsaHashedImportParams = {
  name: 'RSASSA-PKCS1-v1_5',
  hash: 'SHA-256',
}

/** Parses a DER-encoded X.509 certificate. Throws if the bytes are not a valid certificate. */
export function parseCertificate(der: Uint8Array): x509.X509Certificate {
  return new x509.X509Certificate(der as Uint8Array<ArrayBuffer>)
}

/** Returns the DER encoding of a parsed certificate. */
export function certificateToDer(cert: x509.X509Certificate): Uint8Array {
  return new Uint8Array(cert.rawData)
}

function bufferToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** Returns the lowercase-hex SHA-1 thumbprint of a certificate, used as its store identifier. */
export async function getThumbprintHex(cert: x509.X509Certificate): Promise<string> {
  return bufferToHex(await cert.getThumbprint())
}

/** Checks whether `cert` is outside its `notBefore`/`notAfter` validity window. */
export function isCertificateExpired(cert: x509.X509Certificate, at: Date = new Date()): boolean {
  return at < cert.notBefore || at > cert.notAfter
}

/** Checks whether the certificate's SubjectAlternativeName contains `applicationUri` as a URI entry. */
export function certificateMatchesApplicationUri(cert: x509.X509Certificate, applicationUri: string): boolean {
  const san = cert.getExtension(x509.SubjectAlternativeNameExtension)
  if (!san) return false
  return san.names.items.some((entry) => entry.type === 'url' && entry.value === applicationUri)
}

/** Recovers the subject fields used to (re-)generate a certificate, for use by `renewOwn()`. */
export function extractSubjectFromCertificate(cert: x509.X509Certificate): CertificateSubject {
  const commonName = cert.subjectName.getField('CN')[0] ?? ''
  const organization = cert.subjectName.getField('O')[0]
  const san = cert.getExtension(x509.SubjectAlternativeNameExtension)
  const applicationUri = san?.names.items.find((entry) => entry.type === 'url')?.value ?? ''
  const dnsNames = san?.names.items.filter((entry) => entry.type === 'dns').map((entry) => entry.value)

  return {
    applicationUri,
    commonName,
    organization,
    dnsNames: dnsNames && dnsNames.length > 0 ? dnsNames : undefined,
  }
}

function randomSerialNumberHex(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  // Clear the high bit of the first byte so the value is never misread as a
  // negative ASN.1 INTEGER.
  bytes[0] &= 0x7f
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Generates a self-signed OPC UA application instance certificate + RSA key pair
 * (OPC 10000-6 §6.2). Used by both `FileSystemCertificateStore.generateOwn` and
 * `IndexedDbCertificateStore.generateOwn` so the generation logic exists once.
 */
export async function generateSelfSignedCertificate(
  subject: CertificateSubject,
): Promise<{ certificateDer: Uint8Array; keyPair: CryptoKeyPair }> {
  const keyPair = (await crypto.subtle.generateKey(CERTIFICATE_KEY_GEN_ALGORITHM, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair

  const validityDays = subject.validityDays ?? 365
  const notBefore = new Date()
  const notAfter = new Date(notBefore.getTime() + validityDays * 24 * 60 * 60 * 1000)

  const sanEntries: x509.JsonGeneralNames = [
    { type: 'url', value: subject.applicationUri },
    ...(subject.dnsNames ?? []).map((dns) => ({ type: 'dns' as const, value: dns })),
  ]

  const name = subject.organization
    ? `CN=${subject.commonName}, O=${subject.organization}`
    : `CN=${subject.commonName}`

  const cert = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: randomSerialNumberHex(),
    name,
    notBefore,
    notAfter,
    signingAlgorithm: CERTIFICATE_SIGNING_ALGORITHM,
    keys: keyPair,
    extensions: [
      new x509.BasicConstraintsExtension(false, undefined, true),
      new x509.KeyUsagesExtension(
        x509.KeyUsageFlags.digitalSignature |
          x509.KeyUsageFlags.nonRepudiation |
          x509.KeyUsageFlags.keyEncipherment |
          x509.KeyUsageFlags.dataEncipherment,
        true,
      ),
      new x509.ExtendedKeyUsageExtension(
        [x509.ExtendedKeyUsage.clientAuth, x509.ExtendedKeyUsage.serverAuth],
        false,
      ),
      await x509.SubjectKeyIdentifierExtension.create(keyPair.publicKey),
      new x509.SubjectAlternativeNameExtension(sanEntries),
    ],
  })

  return { certificateDer: certificateToDer(cert), keyPair }
}

/** Exports a private key as PKCS#8 DER bytes (e.g. for writing to `pki/own/private`). */
export async function exportPrivateKeyPkcs8(key: CryptoKey): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.exportKey('pkcs8', key))
}

/** Imports a PKCS#8 DER-encoded private key generated by {@link generateSelfSignedCertificate}. */
export async function importPrivateKeyPkcs8(der: Uint8Array, extractable = false): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'pkcs8',
    der as Uint8Array<ArrayBuffer>,
    CERTIFICATE_SIGNING_ALGORITHM,
    extractable,
    ['sign'],
  )
}

/**
 * Builds a certification path from `leaf` towards a certificate in `trusted`
 * (OPC 10000-6 §6.2 step 3). A leaf that is itself present in `trusted` (e.g. a
 * self-signed peer certificate added directly via `addTrusted`) is anchored
 * without further chain building.
 */
export async function buildCertificateChain(
  leaf: x509.X509Certificate,
  trusted: x509.X509Certificate[],
): Promise<{ chain: x509.X509Certificate[]; anchored: boolean }> {
  const leafThumbprint = await getThumbprintHex(leaf)
  const trustedThumbprints = await Promise.all(trusted.map((cert) => getThumbprintHex(cert)))

  if (trustedThumbprints.includes(leafThumbprint)) {
    return { chain: [leaf], anchored: true }
  }

  const builder = new x509.X509ChainBuilder({ certificates: trusted })
  const chain = Array.from(await builder.build(leaf))

  const top = chain[chain.length - 1]
  if (top && top !== leaf) {
    const topThumbprint = await getThumbprintHex(top)
    const anchored = trustedThumbprints.includes(topThumbprint) && (await top.isSelfSigned())
    return { chain, anchored }
  }

  return { chain, anchored: false }
}

/** Checks whether any certificate in `chain` appears in one of the given CRLs (OPC 10000-6 §6.2 step 4). */
export function isCertificateRevoked(chain: x509.X509Certificate[], crls: x509.X509Crl[]): boolean {
  return chain.some((cert) => crls.some((crl) => crl.findRevoked(cert) !== null))
}

/** Input to {@link validateCertificateChain}. */
export type CertificateValidationInput = {
  certificateDer: Uint8Array
  expectedApplicationUri?: string
  trustedDers: Uint8Array[]
  /** DER-encoded CRLs found under `trusted/crl` and `issuers/crl`. */
  crlDers: Uint8Array[]
  unknownCertificatePolicy: 'reject' | 'trust'
}

/**
 * Implements the full OPC 10000-6 §6.2 certificate validation procedure shared
 * by every `ICertificateStore` implementation.
 */
export async function validateCertificateChain(input: CertificateValidationInput): Promise<CertificateValidationResult> {
  let leaf: x509.X509Certificate
  try {
    leaf = parseCertificate(input.certificateDer)
  } catch {
    return { status: 'rejected', reason: 'Certificate is not a syntactically valid X.509 v3 certificate.' }
  }

  if (input.expectedApplicationUri && !certificateMatchesApplicationUri(leaf, input.expectedApplicationUri)) {
    return {
      status: 'rejected',
      reason: `Certificate SubjectAlternativeName does not contain the expected applicationUri '${input.expectedApplicationUri}'.`,
    }
  }

  const trusted = input.trustedDers.map((der) => parseCertificate(der))
  const { chain, anchored } = await buildCertificateChain(leaf, trusted)

  if (chain.some((cert) => isCertificateExpired(cert))) {
    return { status: 'rejected', reason: 'One or more certificates in the chain have expired.' }
  }

  const crls = input.crlDers
    .map((der) => {
      try {
        return new x509.X509Crl(der as Uint8Array<ArrayBuffer>)
      } catch {
        return null
      }
    })
    .filter((crl): crl is x509.X509Crl => crl !== null)

  if (isCertificateRevoked(chain, crls)) {
    return { status: 'rejected', reason: 'Certificate (or an issuer in its chain) is present in a CRL.' }
  }

  if (!anchored) {
    return input.unknownCertificatePolicy === 'trust'
      ? { status: 'trusted' }
      : { status: 'rejected', reason: 'Certificate chain could not be built to a trusted CA.' }
  }

  return { status: 'trusted' }
}

/**
 * Shared implementation of `ICertificateStore.renewOwn`: re-derives the subject
 * of the current own certificate and regenerates it, so this logic is written
 * once instead of being duplicated in every store implementation.
 */
export async function renewOwnCertificate(
  store: Pick<ICertificateStore, 'getOwn' | 'generateOwn'>,
  validityDays?: number,
): Promise<void> {
  const current = await store.getOwn()
  if (!current) {
    throw new Error('Cannot renew: no own certificate has been generated yet. Call generateOwn() first.')
  }
  const subject = extractSubjectFromCertificate(parseCertificate(current.certificate))
  await store.generateOwn({ ...subject, validityDays })
}
