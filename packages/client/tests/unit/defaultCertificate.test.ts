/**
 * Unit tests for the Security Default ApplicationInstance Certificate conformance
 * unit (OPC 10000-6 §6.2): `Client.ensureDefaultOwnCertificate()` generates a
 * self-signed ApplicationInstanceCertificate automatically the first time the
 * default certificate store has no "own" certificate yet.
 */

import { describe, expect, it, vi } from 'vitest'

import type { ICertificateStore } from 'opcjs-base'

import { Client } from '../../src/client.js'
import { ConfigurationClient } from '../../src/configuration/configurationClient.js'
import { UserIdentity } from '../../src/userIdentity.js'

function makeFakeCertificateStore(own: { certificate: Uint8Array; privateKey: CryptoKey } | null): ICertificateStore & {
  generateOwn: ReturnType<typeof vi.fn>
  getOwn: ReturnType<typeof vi.fn>
} {
  return {
    addTrusted: vi.fn(async () => {}),
    removeTrusted: vi.fn(async () => {}),
    listTrusted: vi.fn(async () => []),
    reject: vi.fn(async () => {}),
    listRejected: vi.fn(async () => []),
    getOwn: vi.fn(async () => own),
    generateOwn: vi.fn(async () => {}),
    renewOwn: vi.fn(async () => {}),
    validate: vi.fn(async () => ({ status: 'trusted' as const })),
  }
}

function makeClient(): Client {
  const config = ConfigurationClient.getSimple('default-cert-test', 'test-company')
  return new Client('opc.wss://localhost:4840', config, UserIdentity.newAnonymous())
}

function callEnsureDefaultOwnCertificate(client: Client, store: ICertificateStore): Promise<void> {
  return (client as unknown as Record<string, (s: ICertificateStore) => Promise<void>>)['ensureDefaultOwnCertificate'](
    store,
  )
}

describe('Client.ensureDefaultOwnCertificate', () => {
  it('generates a self-signed certificate when the store has no own certificate yet', async () => {
    const client = makeClient()
    const store = makeFakeCertificateStore(null)

    await callEnsureDefaultOwnCertificate(client, store)

    expect(store.generateOwn).toHaveBeenCalledOnce()
    const subject = store.generateOwn.mock.calls[0][0]
    expect(subject.applicationUri).toBe('urn:test-company:default-cert-test')
    expect(subject.commonName).toBe('default-cert-test')
  })

  it('does not regenerate a certificate when the store already has one', async () => {
    const client = makeClient()
    const store = makeFakeCertificateStore({
      certificate: new Uint8Array([1, 2, 3]),
      privateKey: {} as CryptoKey,
    })

    await callEnsureDefaultOwnCertificate(client, store)

    expect(store.generateOwn).not.toHaveBeenCalled()
  })
})
