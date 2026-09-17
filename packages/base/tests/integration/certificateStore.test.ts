/**
 * Integration test: round-trips certificate management through
 * `FileSystemCertificateStore` end-to-end (real filesystem, real WebCrypto —
 * no mocking), covering the Security Admin – Certificate Management
 * conformance unit (OPC 10000-6 §6.2).
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { FileSystemCertificateStore } from '../../src/certificates/fileSystemCertificateStore.js'
import { generateSelfSignedCertificate, getThumbprintHex, parseCertificate } from '../../src/certificates/certificateCrypto.js'

let baseDir: string
let store: FileSystemCertificateStore

beforeEach(async () => {
  baseDir = await mkdtemp(join(tmpdir(), 'opcjs-cert-store-'))
  store = new FileSystemCertificateStore(baseDir)
})

afterEach(async () => {
  await rm(baseDir, { recursive: true, force: true })
})

describe('FileSystemCertificateStore', () => {
  it('generateOwn() then getOwn() returns a certificate and a non-null private key', async () => {
    await store.generateOwn({ applicationUri: 'urn:test:client', commonName: 'Test Client' })

    const own = await store.getOwn()

    expect(own).not.toBeNull()
    expect(own?.certificate.byteLength).toBeGreaterThan(0)
    expect(own?.privateKey).toBeDefined()
    expect(own?.privateKey.type).toBe('private')
  })

  it('addTrusted() then listTrusted() contains the added certificate', async () => {
    const { certificateDer: caCert } = await generateSelfSignedCertificate({
      applicationUri: 'urn:test:ca',
      commonName: 'Test CA',
    })

    await store.addTrusted(caCert)
    const trusted = await store.listTrusted()

    expect(trusted).toHaveLength(1)
    expect(Buffer.from(trusted[0])).toEqual(Buffer.from(caCert))
  })

  it('validate() returns "trusted" for a certificate added directly to the trust list', async () => {
    const { certificateDer: peerCert } = await generateSelfSignedCertificate({
      applicationUri: 'urn:test:peer',
      commonName: 'Test Peer',
    })

    await store.addTrusted(peerCert)
    const result = await store.validate(peerCert, 'urn:test:peer')

    expect(result.status).toBe('trusted')
  })

  it('validate() returns "rejected" for a certificate that is not in the trust list', async () => {
    const { certificateDer: strangerCert } = await generateSelfSignedCertificate({
      applicationUri: 'urn:test:stranger',
      commonName: 'Stranger',
    })

    const result = await store.validate(strangerCert, 'urn:test:stranger')

    expect(result.status).toBe('rejected')
    expect(result.reason).toBeDefined()
  })

  it('reject() moves a certificate into the rejected store and listRejected() reflects it', async () => {
    const { certificateDer: strangerCert } = await generateSelfSignedCertificate({
      applicationUri: 'urn:test:stranger',
      commonName: 'Stranger',
    })

    await store.reject(strangerCert)
    const rejected = await store.listRejected()

    expect(rejected).toHaveLength(1)
    expect(Buffer.from(rejected[0])).toEqual(Buffer.from(strangerCert))
  })

  it('removeTrusted() removes a previously-trusted certificate, after which validate() rejects it', async () => {
    const { certificateDer: peerCert } = await generateSelfSignedCertificate({
      applicationUri: 'urn:test:peer',
      commonName: 'Test Peer',
    })

    await store.addTrusted(peerCert)
    expect((await store.validate(peerCert, 'urn:test:peer')).status).toBe('trusted')

    const thumbprint = await getThumbprintHex(parseCertificate(peerCert))
    await store.removeTrusted(thumbprint)

    const result = await store.validate(peerCert, 'urn:test:peer')
    expect(result.status).toBe('rejected')
  })

  it('renewOwn() replaces the own certificate with a new serial number while keeping it functional', async () => {
    await store.generateOwn({ applicationUri: 'urn:test:client', commonName: 'Test Client' })
    const before = await store.getOwn()

    await store.renewOwn()
    const after = await store.getOwn()

    expect(after).not.toBeNull()
    expect(Buffer.from(after!.certificate)).not.toEqual(Buffer.from(before!.certificate))

    const beforeCert = parseCertificate(before!.certificate)
    const afterCert = parseCertificate(after!.certificate)
    expect(afterCert.serialNumber).not.toBe(beforeCert.serialNumber)
    // The subject (applicationUri) is preserved across renewal.
    expect(afterCert.subjectName.getField('CN')).toEqual(beforeCert.subjectName.getField('CN'))
  })
})
