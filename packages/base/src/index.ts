/**
 * @opcjs-base - OPC UA base package
 *
 * Exports builtin types and codec APIs.
 */

export type { IOpcType } from './types/iOpcType.js';
export type { IReader} from './codecs/interfaces/iReader.js';
export type { IWriter } from './codecs/interfaces/iWriter.js';
export {Encoder} from './codecs/encoder.js';
export {Decoder} from './codecs/decoder.js';
export { BinaryReader } from './codecs/binary/binaryReader.js';
export { BinaryWriter } from './codecs/binary/binaryWriter.js';
export { SecureChannelTypeEncoder as BinaryEncoderTransform } from './secureChannel/secureChannelTypeEncoder.js';
export { SecureChannelTypeDecoder as BinaryDecoderTransform } from './secureChannel/secureChannelTypeDecoder.js';
export { DataValue } from './types/dataValue.js';
export { StatusCode, StatusCodeFlagBits, StatusCodeGetFlagBits, StatusCodeIs, StatusCodeToString, StatusCodeToStringNumber } from './types/statusCode.js';
export { DiagnosticInfo } from './types/diagnosticInfo.js';
export { ExpandedNodeId } from './types/expandedNodeId.js';
export { ExtensionObject } from './types/extensionObject.js';
export { LocalizedText } from './types/localizedText.js';
export { NodeIdType, NodeId } from './types/nodeId.js';
export { QualifiedName } from './types/qualifiedName.js';
export { Variant } from './types/variant.js';
export type { VariantValue, VariantArrayValue } from './types/variant.js';
export { NumericRange } from './types/numericRange.js';
export type { NumericRangeDimension } from './types/numericRange.js';
export { XmlElement } from './types/xmlElement.js';
export type { UaBoolean, UaSbyte, UaByte, UaInt16, UaUint16, UaInt32, UaUint32, UaInt64, UaUint64, UaFloat, UaDouble, UaString, UaDateTime, UaGuid, UaByteString, UaPrimitive } from './types/primitives.js';
export { uaSbyte, uaByte, uaInt16, uaUint16, uaInt32, uaUint32, uaInt64, uaUint64, uaFloat, uaDouble, uaGuid } from './types/primitives.js';
//export { SecureChannel } from './secureChannel/secureChannel.js';
export type { ISecureChannel } from './secureChannel/iSecureChannel.js';
export { Configuration } from './configuration/configuration.js';
export { registerEncoders } from './schema/encoderRegistrations.js';
export { registerTypeDecoders } from './schema/decoderRegistrations.js';
export { registerBinaryDecoders } from './schema/decoderRegistrations.js';
export { registerXmlDecoders } from './schema/decoderRegistrations.js';
export { registerJsonDecoders } from './schema/decoderRegistrations.js';
export * from './schema/types.js';
export * from './schema/enums.js';

export { LoggerFactory } from './utils/logger/loggerFactory.js';
export type { ILoggerFactory } from './utils/logger/iLoggerFactory.js';
export type { ILogger } from './utils/logger/iLogger.js';
export type { ISink } from './utils/logger/iSink.js';
export { LogRecord } from './utils/logger/logRecord.js';
export { ConsoleSink } from './utils/logger/consoleSink.js';
export { LevelName } from './utils/logger/levelName.js';
export { getLogger, initLoggerProvider } from './utils/logger/loggerProvider.js';
export { isNodeLike } from './utils/environment.js';

export { WebSocketFascade } from './transports/ws/webSocketFascade.js';
export type { WebSocketLike } from './transports/ws/webSocketLike.js';
export { WebSocketReadableStream } from './transports/ws/WebSocketReadableStream.js';
export { WebSocketWritableStream } from './transports/ws/WebSocketWritableStream.js';
export { TcpMessageDecoupler } from './transports/ws/tcpMessageDecoupler.js';
export { TcpMessageInjector } from './transports/ws/tcpMessageInjector.js';
export { TcpConnectionHandler } from './transports/ws/tcpConnectionHandler.js';
export { SecureChannelFacade } from './secureChannel/secureChannelFacade.js';
export { ChannelClosedError } from './secureChannel/pendingRequests.js';
export { SecureChannelContext } from './secureChannel/secureChannelContext.js';
export { SecureChannelMessageDecoder } from './secureChannel/secureChannelMessageDecoder.js';
export { SecureChannelMessageEncoder } from './secureChannel/secureChannelMessageEncoder.js';
export { SecureChannelTypeDecoder } from './secureChannel/secureChannelTypeDecoder.js';
export { SecureChannelTypeEncoder } from './secureChannel/secureChannelTypeEncoder.js';
export {SecureChannelChunkReader} from './secureChannel/secureChannelChunkReader.js';
export {SecureChannelChunkWriter} from './secureChannel/secureChannelChunkWriter.js';

// Transport-layer message types (needed by server for TCP handshake)
export { MsgAck } from './transports/messages/msgAck.js';
export { MsgHello } from './transports/messages/msgHello.js';
export { MsgHeader as TcpMsgHeader } from './transports/messages/msgHeader.js';

// SecureChannel message types (needed by server for channel handling)
export type { MsgBase as ScMsgBase } from './secureChannel/messages/msgBase.js';
export { MsgAsymmetric } from './secureChannel/messages/msgAsymmetric.js';
export { MsgSymmetric } from './secureChannel/messages/msgSymmetric.js';
export { MsgSecurityHeaderAsymmetric } from './secureChannel/messages/msgSecurityHeaderAsymmetric.js';
export { MsgSecurityHeaderSymmetric } from './secureChannel/messages/msgSecurityHeaderSymmetric.js';
export { MsgSequenceHeader } from './secureChannel/messages/msgSequenceHeader.js';
export { MsgHeader as ScMsgHeader } from './secureChannel/messages/msgHeader.js';
export {
  MsgTypeOpenFinal,
  MsgTypeOpenChunk,
  MsgTypeAbort,
  MsgTypeChunk,
  MsgTypeFinal,
  MsgTypeCloseFinal,
} from './secureChannel/messages/msgType.js';

// Certificate (needed by server for SecurityPolicy.getAlgorithmSymmetric)
export { Certificate } from './certificates/certificate.js';

// Certificate Management (Security Admin – Certificate Management conformance unit)
export type { ICertificateStore, CertificateSubject, CertificateValidationResult } from './certificates/iCertificateStore.js';
export { createDefaultCertificateStore } from './certificates/createDefaultCertificateStore.js';
export type { CreateDefaultCertificateStoreOptions } from './certificates/createDefaultCertificateStore.js';
export { IndexedDbCertificateStore } from './certificates/indexedDbCertificateStore.js';
// FileSystemCertificateStore is intentionally NOT re-exported here: it is Node-only
// (imports node:fs/promises) and reaching it from this barrel breaks browser bundlers
// (e.g. Vite fails hard on the named import of 'path' via its browser-external shim).
// Node consumers get it through `createDefaultCertificateStore()`.


