import { getLogger } from 'opcjs-base'
import { WebSocketServer } from 'ws'
import type { WebSocket as WsWebSocket, AddressInfo } from 'ws'

/**
 * Listens for incoming OPC UA WebSocket connections.
 *
 * Uses the `ws` npm package to create a WebSocket server bound to the given
 * port. For each accepted connection, the {@link onConnection} callback is
 * invoked with the raw `ws.WebSocket` instance; the caller is responsible for
 * creating a {@link ConnectionHandler} from it.
 */
export class WebSocketListener {
  private readonly logger = getLogger('transport.WebSocketListener')
  private server?: WebSocketServer
  private _boundPort = 0

  /**
   * The actual TCP port the server is listening on.
   * Equals the configured port once {@link start} resolves; when the configured
   * port is `0` the OS-assigned port is returned.
   */
  get boundPort(): number {
    return this._boundPort
  }

  /**
   * Starts listening. Resolves when the server is bound and ready to accept
   * connections.
   */
  public start(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.server = new WebSocketServer({ port: this.port, path: this.path })

      this.server.on('connection', (ws: WsWebSocket) => {
        this.logger.info(`Accepted WebSocket connection`)
        this.onConnection(ws)
      })

      this.server.on('error', (err: Error) => {
        this.logger.error('WebSocket server error:', err)
        reject(err)
      })

      this.server.on('listening', () => {
        const addr = this.server?.address() as AddressInfo | null
        if (addr != null) {
          this._boundPort = addr.port
        }
        this.logger.info(`WebSocket server listening on port ${this._boundPort}, path ${this.path}`)
        resolve()
      })
    })
  }

  /** Abruptly terminates every open client connection while the listener keeps accepting new ones. */
  public dropAllConnections(): void {
    for (const client of this.server?.clients ?? []) {
      client.terminate()
    }
  }

  /**
   * Stops the listener and closes all open server sockets.
   */
  public stop(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (!this.server) {
        resolve()
        return
      }
      this.server.close(err => {
        if (err) {
          reject(err)
        } else {
          this.logger.info('WebSocket server stopped.')
          resolve()
        }
      })
      this.server = undefined
    })
  }

  constructor(
    private readonly port: number,
    private readonly path: string,
    private readonly onConnection: (ws: WsWebSocket) => void,
  ) {}
}
