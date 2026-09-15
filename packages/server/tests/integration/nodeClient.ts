/**
 * Minimal OPC UA test client for Node.js integration tests.
 *
 * Uses the `ws` npm package (unencrypted `ws://`) to connect to the opcjs-server
 * running in the same process.  Bypasses the browser-only `WebSocketFascade`
 * (which always upgrades to `wss://`) so tests can run without TLS.
 *
 * Pipeline (mirrors the browser client but uses ws instead of WebSocketFascade):
 *   ws.WebSocket → NodeWebSocketAdapter
 *     → WebSocketReadableStream / WebSocketWritableStream
 *     → TcpMessageDecoupler → TcpConnectionHandler (Hello/Ack)
 *     → SecureChannel decode/encode stack
 *     → SecureChannelFacade (issueServiceRequest)
 */

import WebSocket from 'ws'
import type { WebSocket as WsWebSocket } from 'ws'
import {
  AnonymousIdentityToken,
  ActivateSessionRequest,
  ActivateSessionResponse,
  BinaryReader,
  BinaryWriter,
  CloseSessionRequest,
  CreateMonitoredItemsRequest,
  CreateMonitoredItemsResponse,
  CreateSessionRequest,
  CreateSessionResponse,
  CreateSubscriptionRequest,
  CreateSubscriptionResponse,
  DataValue,
  Decoder,
  DeleteSubscriptionsRequest,
  DeleteSubscriptionsResponse,
  Encoder,
  ExtensionObject,
  LocalizedText,
  MonitoredItemCreateRequest,
  MonitoringModeEnum,
  MonitoringParameters,
  NodeId,
  PublishRequest,
  PublishResponse,
  QualifiedName,
  ReadRequest,
  ReadResponse,
  ReadValueId,
  RequestHeader,
  SecureChannelChunkReader,
  SecureChannelChunkWriter,
  SecureChannelContext,
  SecureChannelFacade,
  SecureChannelMessageDecoder,
  SecureChannelMessageEncoder,
  SecureChannelTypeDecoder,
  SecureChannelTypeEncoder,
  SignatureData,
  StatusCode,
  SubscriptionAcknowledgement,
  TimestampsToReturnEnum,
  TcpConnectionHandler,
  TcpMessageDecoupler,
  TcpMessageInjector,
  WebSocketReadableStream,
  WebSocketWritableStream,
  registerBinaryDecoders,
  registerEncoders,
  registerTypeDecoders,
  ApplicationDescription,
  ApplicationTypeEnum,
} from 'opcjs-base'

import { NodeWebSocketAdapter } from '../../src/transport/nodeWebSocketAdapter.js'

// ── codec registration ────────────────────────────────────────────────────────

function makeCodecs(): { encoder: Encoder; decoder: Decoder } {
  const encoder = new Encoder()
  encoder.registerWriterFactory('binary', () => new BinaryWriter())
  registerEncoders(encoder)

  const decoder = new Decoder()
  decoder.registerReaderFactory('binary', (data: unknown) => new BinaryReader(data as Uint8Array))
  registerTypeDecoders(decoder)
  registerBinaryDecoders(decoder)

  return { encoder, decoder }
}

let requestHandle = 1

function makeRequestHeader(authToken?: NodeId): RequestHeader {
  const h = new RequestHeader()
  h.authenticationToken = authToken ?? new NodeId()
  h.requestHandle = requestHandle++
  h.timestamp = new Date()
  h.returnDiagnostics = 0
  h.auditEntryId = ''
  h.timeoutHint = 10_000
  h.additionalHeader = ExtensionObject.newEmpty()
  return h
}

// ── NodeClient ────────────────────────────────────────────────────────────────

export class NodeClient {
  private sc?: SecureChannelFacade
  private ws?: WsWebSocket
  private authToken?: NodeId

  /**
   * Opens the WebSocket transport, performs the OPC UA Hello/Ack handshake,
   * opens a SecureChannel, then creates and activates an anonymous session.
   */
  async connect(endpointUrl: string): Promise<void> {
    // opc.wss://host:port/path → ws://host:port/path (no TLS in tests)
    const wsUrl = endpointUrl.replace(/^opc\.wss?:\/\//, 'ws://')
    const { encoder, decoder } = makeCodecs()

    // ── 1. WebSocket transport ─────────────────────────────────────────────
    const rawWs = new WebSocket(wsUrl, 'opcua+uacp') as unknown as WsWebSocket
    this.ws = rawWs

    await new Promise<void>((resolve, reject) => {
      rawWs.on('open', resolve)
      rawWs.on('error', (err: Error) => reject(err))
    })

    const adapter = new NodeWebSocketAdapter(rawWs)
    const readable = new WebSocketReadableStream(adapter, 1000)
    const writable = new WebSocketWritableStream(adapter)

    // ── 2. SecureChannel pipeline ─────────────────────────────────────────
    const scContext = new SecureChannelContext(endpointUrl)

    const tcpInjector = new TcpMessageInjector()
    const tcpHandler = new TcpConnectionHandler(tcpInjector, scContext)
    const tcpDecoupler = new TcpMessageDecoupler(tcpHandler.onTcpMessage.bind(tcpHandler))

    const scMsgDecoder = new SecureChannelMessageDecoder(scContext)
    const scChunkReader = new SecureChannelChunkReader(scContext)
    const scTypeDecoder = new SecureChannelTypeDecoder(decoder)

    const scTypeEncoder = new SecureChannelTypeEncoder(encoder)
    const scChunkWriter = new SecureChannelChunkWriter(scContext)
    const scMsgEncoder = new SecureChannelMessageEncoder(scContext)

    // inbound
    readable
      .pipeThrough(tcpDecoupler)
      .pipeTo(scMsgDecoder.writable)
    scMsgDecoder.readable.pipeTo(scChunkReader.writable)
    scChunkReader.readable.pipeTo(scTypeDecoder.writable)

    // outbound
    scTypeEncoder.readable.pipeTo(scChunkWriter.writable)
    scChunkWriter.readable.pipeTo(scMsgEncoder.writable)
    scMsgEncoder.readable.pipeTo(tcpInjector.writable)
    tcpInjector.readable.pipeTo(writable)

    this.sc = new SecureChannelFacade(scContext, scTypeDecoder, scTypeEncoder)

    // ── 3. Hello / Ack ───────────────────────────────────────────────────────
    const connected = await tcpHandler.connect(endpointUrl)
    if (!connected) {
      throw new Error(`Hello/Ack handshake failed`)
    }

    // ── 4. OpenSecureChannel ─────────────────────────────────────────────────
    await this.sc.openSecureChannel()

    // ── 5. CreateSession + ActivateSession ───────────────────────────────────
    await this.createAndActivateSession(endpointUrl)
  }

  private async createAndActivateSession(endpointUrl: string): Promise<void> {
    const clientDesc = new ApplicationDescription()
    clientDesc.applicationUri = 'urn:opcjs:testclient'
    clientDesc.productUri = 'urn:opcjs:testclient:product'
    clientDesc.applicationName = new LocalizedText(undefined, 'OpcJs TestClient')
    clientDesc.applicationType = ApplicationTypeEnum.Client
    clientDesc.gatewayServerUri = ''
    clientDesc.discoveryProfileUri = ''
    clientDesc.discoveryUrls = []

    const createReq = new CreateSessionRequest()
    createReq.requestHeader = makeRequestHeader()
    createReq.clientDescription = clientDesc
    createReq.serverUri = ''
    createReq.endpointUrl = endpointUrl
    createReq.sessionName = 'IntegrationTest'
    createReq.clientNonce = null
    createReq.clientCertificate = null
    createReq.requestedSessionTimeout = 60_000
    createReq.maxResponseMessageSize = 0

    const createResp = await this.sc!.issueServiceRequest(createReq) as CreateSessionResponse
    if (createResp.responseHeader?.serviceResult !== StatusCode.Good) {
      throw new Error(`CreateSession failed: ${createResp.responseHeader?.serviceResult}`)
    }

    this.authToken = createResp.authenticationToken as NodeId

    const anonToken = new AnonymousIdentityToken()
    anonToken.policyId = 'anonymous'

    // For SecurityPolicy None, clientSignature and userTokenSignature are empty (no crypto).
    const emptySignature = new SignatureData()

    const activateReq = new ActivateSessionRequest()
    activateReq.requestHeader = makeRequestHeader(this.authToken)
    activateReq.clientSignature = emptySignature
    activateReq.clientSoftwareCertificates = []
    activateReq.localeIds = []
    activateReq.userIdentityToken = ExtensionObject.newBinary(anonToken)
    activateReq.userTokenSignature = emptySignature

    const activateResp = await this.sc!.issueServiceRequest(activateReq) as ActivateSessionResponse
    if (activateResp.responseHeader?.serviceResult !== StatusCode.Good) {
      throw new Error(`ActivateSession failed: ${activateResp.responseHeader?.serviceResult}`)
    }
  }

  /**
   * Reads the Value attribute of one or more nodes.
   * Returns an array of `DataValue` (one per nodeId).
   */
  async read(
    nodeIds: NodeId[],
    timestampsToReturn = TimestampsToReturnEnum.Source,
    opts?: { indexRange?: string; maxAge?: number },
  ): Promise<DataValue[]> {
    const nodesToRead = nodeIds.map(nid => {
      const rvi = new ReadValueId()
      rvi.nodeId = nid
      rvi.attributeId = 13 // Value
      rvi.indexRange = opts?.indexRange ?? ''
      rvi.dataEncoding = new QualifiedName(0, '')
      return rvi
    })

    const req = new ReadRequest()
    req.requestHeader = makeRequestHeader(this.authToken)
    req.maxAge = opts?.maxAge ?? 0
    req.timestampsToReturn = timestampsToReturn
    req.nodesToRead = nodesToRead

    const resp = await this.sc!.issueServiceRequest(req) as ReadResponse
    return resp.results ?? []
  }

  /**
   * Creates a subscription on the server and returns its assigned subscriptionId.
   */
  async createSubscription(opts?: {
    requestedPublishingInterval?: number
    requestedMaxKeepAliveCount?: number
    requestedLifetimeCount?: number
    maxNotificationsPerPublish?: number
    priority?: number
    publishingEnabled?: boolean
  }): Promise<number> {
    const req = new CreateSubscriptionRequest()
    req.requestHeader = makeRequestHeader(this.authToken)
    req.requestedPublishingInterval = opts?.requestedPublishingInterval ?? 100
    req.requestedMaxKeepAliveCount = opts?.requestedMaxKeepAliveCount ?? 10
    req.requestedLifetimeCount = opts?.requestedLifetimeCount ?? 30
    req.maxNotificationsPerPublish = opts?.maxNotificationsPerPublish ?? 100
    req.publishingEnabled = opts?.publishingEnabled ?? true
    req.priority = opts?.priority ?? 1
    const resp = await this.sc!.issueServiceRequest(req) as CreateSubscriptionResponse
    if (resp.responseHeader?.serviceResult !== StatusCode.Good) {
      throw new Error(
        `CreateSubscription failed: 0x${resp.responseHeader?.serviceResult.toString(16)}`,
      )
    }
    return resp.subscriptionId
  }

  /**
   * Creates monitored items for the Value attribute of the given nodes.
   */
  async createMonitoredItems(
    subscriptionId: number,
    items: { nodeId: NodeId; clientHandle: number; attributeId?: number }[],
  ): Promise<CreateMonitoredItemsResponse> {
    const itemsToCreate = items.map(it => {
      const rvi = new ReadValueId()
      rvi.nodeId = it.nodeId
      rvi.attributeId = it.attributeId ?? 13
      rvi.indexRange = ''
      rvi.dataEncoding = new QualifiedName(0, '')

      const params = new MonitoringParameters()
      params.clientHandle = it.clientHandle
      params.samplingInterval = 50
      params.filter = ExtensionObject.newEmpty()
      params.queueSize = 1
      params.discardOldest = true

      const mic = new MonitoredItemCreateRequest()
      mic.itemToMonitor = rvi
      mic.monitoringMode = MonitoringModeEnum.Reporting
      mic.requestedParameters = params
      return mic
    })

    const req = new CreateMonitoredItemsRequest()
    req.requestHeader = makeRequestHeader(this.authToken)
    req.subscriptionId = subscriptionId
    req.timestampsToReturn = TimestampsToReturnEnum.Source
    req.itemsToCreate = itemsToCreate
    return await this.sc!.issueServiceRequest(req) as CreateMonitoredItemsResponse
  }

  /**
   * Sends a Publish request and returns the response.
   */
  async publish(acks: { subscriptionId: number; sequenceNumber: number }[] = []): Promise<PublishResponse> {
    const req = new PublishRequest()
    req.requestHeader = makeRequestHeader(this.authToken)
    req.subscriptionAcknowledgements = acks.map(a => {
      const ack = new SubscriptionAcknowledgement()
      ack.subscriptionId = a.subscriptionId
      ack.sequenceNumber = a.sequenceNumber
      return ack
    })
    return await this.sc!.issueServiceRequest(req) as PublishResponse
  }

  /** Deletes the given subscriptions. */
  async deleteSubscriptions(subscriptionIds: number[]): Promise<DeleteSubscriptionsResponse> {
    const req = new DeleteSubscriptionsRequest()
    req.requestHeader = makeRequestHeader(this.authToken)
    req.subscriptionIds = subscriptionIds
    return await this.sc!.issueServiceRequest(req) as DeleteSubscriptionsResponse
  }

  /**
   * Closes the session and disconnects from the server.
   */
  async disconnect(): Promise<void> {
    if (this.sc && this.authToken) {
      try {
        const closeReq = new CloseSessionRequest()
        closeReq.requestHeader = makeRequestHeader(this.authToken)
        closeReq.deleteSubscriptions = true
        await this.sc.issueServiceRequest(closeReq)
      } catch {
        // Server-side teardown won't respond after close; ignore
      }
    }
    this.sc?.close()
    this.ws?.close()
    this.sc = undefined
    this.ws = undefined
    this.authToken = undefined
  }
}
