import {
  generateSelfSignedCertificate,
  getThumbprintHex,
  parseCertificate,
  renewOwnCertificate,
  validateCertificateChain,
} from './certificateCrypto.js'
import type { CertificateSubject, CertificateValidationResult, ICertificateStore } from './iCertificateStore.js'

const STORE_OWN = 'own'
const STORE_TRUSTED = 'trusted'
const STORE_REJECTED = 'rejected'
const DB_VERSION = 1
const OWN_RECORD_KEY = 'own'

type OwnRecord = { certificate: Uint8Array; privateKey: CryptoKey }

/**
 * Browser `ICertificateStore` implementation backed by IndexedDB. Mirrors the
 * `own` / `trusted` / `rejected` PKI categories as object stores. Relies on the
 * global `indexedDB` (same convention as `WebSocketFascade` relying on the
 * global `WebSocket`) — only usable in browsers. Use
 * `createDefaultCertificateStore()` to pick this implementation automatically.
 *
 * The own private key is stored as a `CryptoKey` via IndexedDB's structured
 * clone support instead of exported raw key bytes, keeping the key material
 * inside the WebCrypto boundary.
 */
export class IndexedDbCertificateStore implements ICertificateStore {
  constructor(
    private readonly databaseName: string,
    private readonly options: { unknownCertificatePolicy?: 'reject' | 'trust' } = {},
  ) {}

  private openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.databaseName, DB_VERSION)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(STORE_OWN)) db.createObjectStore(STORE_OWN)
        if (!db.objectStoreNames.contains(STORE_TRUSTED)) db.createObjectStore(STORE_TRUSTED)
        if (!db.objectStoreNames.contains(STORE_REJECTED)) db.createObjectStore(STORE_REJECTED)
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB database'))
    })
  }

  private async withStore<T>(
    storeName: string,
    mode: IDBTransactionMode,
    fn: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const db = await this.openDb()
    try {
      return await new Promise<T>((resolve, reject) => {
        const tx = db.transaction(storeName, mode)
        const store = tx.objectStore(storeName)
        const request = fn(store)
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
      })
    } finally {
      db.close()
    }
  }

  private async getAllEntries(storeName: string): Promise<Uint8Array[]> {
    const entries = await this.withStore<Uint8Array[]>(storeName, 'readonly', (store) => store.getAll())
    return entries ?? []
  }

  async addTrusted(cert: Uint8Array): Promise<void> {
    const thumbprint = await getThumbprintHex(parseCertificate(cert))
    await this.withStore(STORE_TRUSTED, 'readwrite', (store) => store.put(cert, thumbprint))
  }

  async removeTrusted(thumbprint: string): Promise<void> {
    await this.withStore(STORE_TRUSTED, 'readwrite', (store) => store.delete(thumbprint))
  }

  async listTrusted(): Promise<Uint8Array[]> {
    return this.getAllEntries(STORE_TRUSTED)
  }

  async reject(cert: Uint8Array): Promise<void> {
    const thumbprint = await getThumbprintHex(parseCertificate(cert))
    await this.withStore(STORE_REJECTED, 'readwrite', (store) => store.put(cert, thumbprint))
  }

  async listRejected(): Promise<Uint8Array[]> {
    return this.getAllEntries(STORE_REJECTED)
  }

  async getOwn(): Promise<{ certificate: Uint8Array; privateKey: CryptoKey } | null> {
    const record = await this.withStore<OwnRecord | undefined>(STORE_OWN, 'readonly', (store) =>
      store.get(OWN_RECORD_KEY),
    )
    return record ?? null
  }

  async generateOwn(subject: CertificateSubject): Promise<void> {
    const { certificateDer, keyPair } = await generateSelfSignedCertificate(subject)
    const record: OwnRecord = { certificate: certificateDer, privateKey: keyPair.privateKey }
    await this.withStore(STORE_OWN, 'readwrite', (store) => store.put(record, OWN_RECORD_KEY))
  }

  async renewOwn(validityDays?: number): Promise<void> {
    await renewOwnCertificate(this, validityDays)
  }

  async validate(certificate: Uint8Array, expectedApplicationUri?: string): Promise<CertificateValidationResult> {
    const trustedDers = await this.listTrusted()
    return validateCertificateChain({
      certificateDer: certificate,
      expectedApplicationUri,
      trustedDers,
      // No CRL management API is exposed yet (OPC 10000-6 §6.2.5 revocation via
      // CRL is future work); treat as "no known revocations".
      crlDers: [],
      unknownCertificatePolicy: this.options.unknownCertificatePolicy ?? 'reject',
    })
  }
}
