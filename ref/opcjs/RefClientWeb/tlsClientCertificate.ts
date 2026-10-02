/**
 * TLS client certificate presented by headless Chromium to ref/uaNet/RefServer.
 *
 * uaNet's opc.wss:// listener (Kestrel) requests an optional TLS client certificate.
 * Chromium cancels a WebSocket opening handshake when a server asks for one and no
 * certificate gets selected ("WebSocket opening handshake was canceled"), so Playwright
 * has to present one. The server validates it like an OPC UA application certificate,
 * so it's generated with opcjs-base's own application-certificate generator.
 */

import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { X509Certificate, createPrivateKey } from 'node:crypto';
import { createDefaultCertificateStore } from 'opcjs-base';

export async function loadTlsClientCertificate(pkiBaseDir: string): Promise<{ cert: Buffer; key: Buffer }> {
    const store = await createDefaultCertificateStore({ pkiBaseDir });
    if (!(await store.getOwn())) {
        await store.generateOwn({
            applicationUri: 'urn:localhost:opcjs:RefClientWeb',
            commonName: 'RefClientWeb',
            organization: 'opcjs',
            dnsNames: ['localhost'],
        });
    }

    // FileSystemCertificateStore layout: own/certs/own.der (DER), own/private/own.key (PKCS#8 DER).
    const certDer = await readFile(path.join(pkiBaseDir, 'own', 'certs', 'own.der'));
    const keyDer = await readFile(path.join(pkiBaseDir, 'own', 'private', 'own.key'));

    return {
        cert: Buffer.from(new X509Certificate(certDer).toString()),
        key: Buffer.from(createPrivateKey({ key: keyDer, format: 'der', type: 'pkcs8' }).export({ format: 'pem', type: 'pkcs8' })),
    };
}
