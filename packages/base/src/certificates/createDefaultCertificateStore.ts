import { isNodeLike } from '../utils/environment.js'
import type { ICertificateStore } from './iCertificateStore.js'

export type CreateDefaultCertificateStoreOptions = {
  /** Base PKI directory for the Node.js `FileSystemCertificateStore`. Default: `'./pki'`. */
  pkiBaseDir?: string
  /** IndexedDB database name for the browser `IndexedDbCertificateStore`. Default: `'opcjs-certificate-store'`. */
  databaseName?: string
}

/**
 * Creates the `ICertificateStore` implementation appropriate for the current
 * environment: `FileSystemCertificateStore` under Node.js, `IndexedDbCertificateStore`
 * in a browser (decided via `isNodeLike()`).
 *
 * Each implementation is loaded via a dynamic `import()` so that a browser
 * bundler never needs to statically resolve `node:fs/promises` when only the
 * browser code path is reachable.
 */
export async function createDefaultCertificateStore(
  options: CreateDefaultCertificateStoreOptions = {},
): Promise<ICertificateStore> {
  if (isNodeLike()) {
    const { FileSystemCertificateStore } = await import('./fileSystemCertificateStore.js')
    return new FileSystemCertificateStore(options.pkiBaseDir ?? './pki')
  }

  const { IndexedDbCertificateStore } = await import('./indexedDbCertificateStore.js')
  return new IndexedDbCertificateStore(options.databaseName ?? 'opcjs-certificate-store')
}
