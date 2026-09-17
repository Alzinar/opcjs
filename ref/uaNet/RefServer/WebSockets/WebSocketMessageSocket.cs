#pragma warning disable CS8600 // Converting null literal or possible null value to non-nullable type.
#pragma warning disable CS8602 // Dereference of a possibly null reference.
#pragma warning disable CS8604 // Possible null reference argument.
#pragma warning disable CS8625 // Cannot convert null literal to non-nullable reference type.

using System;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.WebSockets;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;
using Opc.Ua;
using Opc.Ua.Bindings;

namespace RefServer.WebSockets;


/// <summary>
/// Handles reading and writing of message chunks over a WebSocket.
/// </summary>
public class WebSocketMessageSocket : IMessageSocket
{
    /// <summary>
    /// Creates an unconnected socket.
    /// </summary>
#pragma warning disable CS8618 // Non-nullable field must contain a non-null value when exiting constructor. Consider adding the 'required' modifier or declaring as nullable.
    public WebSocketMessageSocket(
#pragma warning restore CS8618 // Non-nullable field must contain a non-null value when exiting constructor. Consider adding the 'required' modifier or declaring as nullable.
        IMessageSink sink,
        BufferManager bufferManager,
        int receiveBufferSize,
        ITelemetryContext telemetry)
    {
        _logger = telemetry.CreateLogger<WebSocketMessageSocket>();
        _sink = sink;
        _bufferManager = bufferManager;
        _receiveBufferSize = receiveBufferSize;
    }
    /// <summary>
    /// Creates an unconnected socket.
    /// </summary>
#pragma warning disable CS8618 // Non-nullable field must contain a non-null value when exiting constructor. Consider adding the 'required' modifier or declaring as nullable.
#pragma warning disable CS8618 // Non-nullable field must contain a non-null value when exiting constructor. Consider adding the 'required' modifier or declaring as nullable.
    public WebSocketMessageSocket(
#pragma warning restore CS8618 // Non-nullable field must contain a non-null value when exiting constructor. Consider adding the 'required' modifier or declaring as nullable.
#pragma warning restore CS8618 // Non-nullable field must contain a non-null value when exiting constructor. Consider adding the 'required' modifier or declaring as nullable.
        WebSocket socket,
        IMessageSink sink,
        BufferManager bufferManager,
        int receiveBufferSize,
        ITelemetryContext telemetry)
    {
        _webSocket = socket;
        _logger = telemetry.CreateLogger<WebSocketMessageSocket>();
        _sink = sink;
        _bufferManager = bufferManager;
        _receiveBufferSize = receiveBufferSize;
    }

    /// <summary>
    /// Frees any unmanaged resources.
    /// </summary>
    public void Dispose()
    {
        Dispose(true);
        GC.SuppressFinalize(this);
    }

    /// <summary>
    /// An overrideable version of the Dispose.
    /// </summary>
    protected virtual void Dispose(bool disposing)
    {
        if (disposing)
        {
            Close();
        }
    }

    /// <summary>
    /// Gets the socket handle.
    /// </summary>
    /// <value>The socket handle.</value>
    public int Handle => _webSocket?.GetHashCode() ?? -1;

    /// <summary>
    /// Gets the local endpoint.
    /// </summary>
    public EndPoint LocalEndpoint => _localEndpoint;

    /// <summary>
    /// Gets the remote endpoint.
    /// </summary>
    public EndPoint RemoteEndpoint => _remoteEndpoint;

    /// <summary>
    /// Gets the transport channel features implemented by this message socket.
    /// </summary>
    /// <value>The transport channel feature.</value>
    public TransportChannelFeatures MessageSocketFeatures =>
        TransportChannelFeatures.Reconnect;

    public Task ConnectAsync(Uri endpointUrl, CancellationToken ct = default)
    {
        throw new NotImplementedException();
    }

    /// <summary>
    /// Connects to an endpoint.
    /// </summary>
    public bool BeginConnect(
        Uri endpointUrl,
        EventHandler<IMessageSocketAsyncEventArgs> callback,
        object state)
    {
        _logger.LogInformation("BeginConnect called for endpoint URL: {EndpointUrl}", endpointUrl);
        ArgumentNullException.ThrowIfNull(endpointUrl);

        if (_webSocket != null)
        {
            throw new InvalidOperationException("The WebSocket is already connected.");
        }

        Task.Run(async () =>
        {
            var eventArgs = new WebSocketMessageSocketAsync { UserToken = state };

            try
            {
                var clientWebSocket = new ClientWebSocket();

#if NET8_0_OR_GREATER
                // Skip certificate validation for development/testing (only available in .NET 8+)
#pragma warning disable CA5359 // Do Not Disable Certificate Validation
                clientWebSocket.Options.RemoteCertificateValidationCallback =
                    (sender, certificate, chain, sslPolicyErrors) => true;
#pragma warning restore CA5359 // Do Not Disable Certificate Validation
#endif

                // Convert opc.wss:// to wss://
                _logger.LogInformation("Original endpoint URL: {OriginalUrl}", endpointUrl);
                var wsUri = new UriBuilder(endpointUrl)
                {
                    Scheme = "wss"
                };

                _logger.LogInformation("Connecting to WebSocket endpoint: {EndpointUrl}", wsUri.Uri);

                await clientWebSocket.ConnectAsync(wsUri.Uri, CancellationToken.None).ConfigureAwait(false);

                _logger.LogInformation("WebSocket connection established. Setting m_webSocket.");
                _webSocket = clientWebSocket;
                _remoteEndpoint = new DnsEndPoint(endpointUrl.DnsSafeHost, endpointUrl.Port);
                _localEndpoint = new DnsEndPoint("localhost", 0);

                eventArgs.IsSocketError = false;
                _logger.LogInformation("WebSocket connected successfully");
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to connect WebSocket");
                eventArgs.IsSocketError = true;
                eventArgs.SocketErrorString = ex.Message;
            }

            callback?.Invoke(this, eventArgs);
        });

        return true;
    }

    /// <summary>
    /// Forcefully closes the socket.
    /// </summary>
    public void Close()
    {
        _logger.LogInformation("Closing WebSocketMessageSocket");
        lock (_socketLock)
        {
            _closed = true;

            if (_webSocket != null)
            {
                try
                {
                    if (_webSocket.State == WebSocketState.Open)
                    {
                        _webSocket.CloseAsync(
                            WebSocketCloseStatus.NormalClosure,
                            "Closing",
                            CancellationToken.None).Wait(1000);
                    }
                }
                catch (Exception e)
                {
                    _logger.LogError(e, "Unexpected error closing WebSocket.");
                }
                finally
                {
                    _logger.LogInformation("Disposing WebSocket and setting it to null.");
                    _webSocket.Dispose();
                    _webSocket = null;
                }
            }
        }
    }

    /// <summary>
    /// Starts reading messages from the socket.
    /// </summary>
    public void ReadNextMessage()
    {
        _logger.LogInformation("Starting to read messages from WebSocket: {Closed}, State: {State}", _closed, _webSocket?.State);
        Task.Run(async () =>
        {
            _logger.LogInformation("Starting WebSocket read loop");

            while (!_closed && _webSocket?.State == WebSocketState.Open)
            {
                try
                {
                    await ReadNextMessageAsync().ConfigureAwait(false);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Error reading WebSocket message - Type: {ExceptionType}, Message: {Message}, Stack: {StackTrace}",
                        ex.GetType().Name, ex.Message, ex.StackTrace);
                    _sink?.OnReceiveError(this, ServiceResult.Create(ex, StatusCodes.BadTcpInternalError, ex.Message));
                    break;
                }
            }

            _logger.LogInformation("WebSocket read loop ended - Closed: {Closed}, State: {State}", _closed, _webSocket?.State);
        });
    }

    /// <summary>
    /// Reads the next message from the WebSocket.
    /// </summary>
    private async Task ReadNextMessageAsync()
    {
        byte[] buffer = _bufferManager.TakeBuffer(_receiveBufferSize, "ReadNextMessageAsync");

        try
        {
            _logger.LogDebug("Waiting to receive WebSocket message...");
            // Reserve the last byte of the pool buffer so the BufferManager's cookie at
            // buffer[^1] is never overwritten by incoming data (which would cause ReturnBuffer
            // to throw "Buffer has been locked" when the frame fills the buffer exactly).
            var result = await _webSocket.ReceiveAsync(
                new ArraySegment<byte>(buffer, 0, buffer.Length - 1),
                CancellationToken.None).ConfigureAwait(false);

            _logger.LogDebug("Received WebSocket frame - Type: {MessageType}, Count: {Count}, EndOfMessage: {EndOfMessage}",
                result.MessageType, result.Count, result.EndOfMessage);

            if (result.MessageType == WebSocketMessageType.Close)
            {
                _logger.LogInformation("WebSocket close frame received - CloseStatus: {CloseStatus}, CloseDescription: {CloseDescription}",
                    result.CloseStatus, result.CloseStatusDescription);
                _bufferManager.ReturnBuffer(buffer, "ReadNextMessageAsync");
                buffer = null;
                _sink?.OnReceiveError(this, ServiceResult.Create(
                    StatusCodes.BadConnectionClosed,
                    "WebSocket closed by remote endpoint"));
                return;
            }

            // Fast path: entire OPC UA message arrived in a single WebSocket frame.
            if (result.EndOfMessage)
            {
                if (result.Count > 0)
                {
                    if (_sink != null)
                    {
                        var preview = string.Join(" ", buffer.Take(Math.Min(16, result.Count)).Select(b => b.ToString("X2", CultureInfo.InvariantCulture)));
                        _logger.LogDebug("Message bytes (first 16): {Preview}", preview);
                        var toDeliver = buffer;
                        buffer = null; // ownership transferred to sink
                        _sink.OnMessageReceived(this, new ArraySegment<byte>(toDeliver, 0, result.Count));
                    }
                    else
                    {
                        _logger.LogWarning("Received WebSocket message but sink is null, discarding {MessageSize} bytes", result.Count);
                        _bufferManager.ReturnBuffer(buffer, "ReadNextMessageAsync");
                        buffer = null;
                    }
                }
                else
                {
                    _bufferManager.ReturnBuffer(buffer, "ReadNextMessageAsync");
                }
                return;
            }

            // Slow path: message is split across multiple WebSocket frames — reassemble before
            // passing to the OPC UA decoder, which expects a complete message in one buffer.
            using var ms = new MemoryStream();
            ms.Write(buffer, 0, result.Count);
            _bufferManager.ReturnBuffer(buffer, "ReadNextMessageAsync");
            buffer = null;

            while (!result.EndOfMessage)
            {
                byte[] frameBuffer = _bufferManager.TakeBuffer(_receiveBufferSize, "ReadNextMessageAsync-fragment");
                try
                {
                    result = await _webSocket.ReceiveAsync(
                        new ArraySegment<byte>(frameBuffer, 0, frameBuffer.Length - 1),
                        CancellationToken.None).ConfigureAwait(false);

                    _logger.LogTrace("Received continuation frame - Count: {Count}, EndOfMessage: {EndOfMessage}",
                        result.Count, result.EndOfMessage);

                    if (result.MessageType == WebSocketMessageType.Close)
                    {
                        _sink?.OnReceiveError(this, ServiceResult.Create(
                            StatusCodes.BadConnectionClosed,
                            "WebSocket closed by remote endpoint"));
                        return;
                    }

                    if (result.Count > 0)
                    {
                        ms.Write(frameBuffer, 0, result.Count);
                    }
                }
                finally
                {
                    _bufferManager.ReturnBuffer(frameBuffer, "ReadNextMessageAsync-fragment");
                }
            }

            int totalBytes = (int)ms.Length;
            if (totalBytes == 0)
            {
                return;
            }

            _logger.LogDebug("Reassembled fragmented WebSocket message: {TotalBytes} bytes", totalBytes);

            // Allocate from the pool using the exact message size. The pool was created with
            // maxBufferSize = MaxMessageSize so this fits; TakeBuffer internally adds the cookie
            // byte, so messageBuffer[^1] is never overwritten by the ms.Read below.
            byte[] messageBuffer = _bufferManager.TakeBuffer(totalBytes, "ReadNextMessageAsync-assembled");
            ms.Position = 0;
            ms.Read(messageBuffer, 0, totalBytes);

            if (_sink != null)
            {
                var preview = string.Join(" ", messageBuffer.Take(Math.Min(16, totalBytes)).Select(b => b.ToString("X2", CultureInfo.InvariantCulture)));
                _logger.LogDebug("Message bytes (first 16): {Preview}", preview);
                var toDeliver = messageBuffer;
                messageBuffer = null; // ownership transferred to sink
                _sink.OnMessageReceived(this, new ArraySegment<byte>(toDeliver, 0, totalBytes));
            }
            else
            {
                _logger.LogWarning("Received WebSocket message but sink is null, discarding {MessageSize} bytes", totalBytes);
                _bufferManager.ReturnBuffer(messageBuffer, "ReadNextMessageAsync-assembled");
                messageBuffer = null;
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error receiving WebSocket message");
            if (buffer != null)
            {
                _bufferManager.ReturnBuffer(buffer, "ReadNextMessageAsync");
            }
        }
    }

    /// <summary>
    /// Changes the sink used to report reads.
    /// </summary>
    public void ChangeSink(IMessageSink sink)
    {
        lock (_socketLock)
        {
            _sink = sink;
        }
    }

    /// <summary>
    /// Sends a buffer.
    /// </summary>
    public bool Send(IMessageSocketAsyncEventArgs args)
    {
        _logger.LogDebug("Send called to send WebSocket message");
        ArgumentNullException.ThrowIfNull(args);

        Task.Run(async () =>
        {
            var wsArgs = args as WebSocketMessageSocketAsync;

            try
            {
                if (_webSocket?.State == WebSocketState.Open)
                {
                    byte[] buffer = wsArgs.Buffer;
                    int offset = wsArgs.Offset;
                    int count = wsArgs.Count;

                    if (wsArgs.BufferList != null)
                    {
                        // Combine buffer list into single buffer
                        int totalSize = 0;
                        foreach (var buf in wsArgs.BufferList)
                        {
                            totalSize += buf.Count;
                        }

                        buffer = new byte[totalSize];
                        int position = 0;
                        foreach (var buf in wsArgs.BufferList)
                        {
                            System.Buffer.BlockCopy(buf.Array, buf.Offset, buffer, position, buf.Count);
                            position += buf.Count;
                        }
                        offset = 0;
                        count = totalSize;
                    }

                    _logger.LogDebug("Sending WebSocket message of {MessageSize} bytes, State: {State}", count, _webSocket.State);
                    await _webSocket.SendAsync(
                        new ArraySegment<byte>(buffer, offset, count),
                        WebSocketMessageType.Binary,
                        true,
                        CancellationToken.None).ConfigureAwait(false);

                    _logger.LogDebug("WebSocket message sent successfully");
                    wsArgs.BytesTransferred = count;
                    wsArgs.IsSocketError = false;
                }
                else
                {
                    wsArgs.IsSocketError = true;
                    wsArgs.SocketErrorString = "WebSocket not connected";
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error sending WebSocket message");
                wsArgs.IsSocketError = true;
                wsArgs.SocketErrorString = ex.Message;
            }

            wsArgs.OnCompleted();
        });

        return true;
    }

    /// <summary>
    /// Get the message socket event args.
    /// </summary>
    public IMessageSocketAsyncEventArgs MessageSocketEventArgs()
    {
        return new WebSocketMessageSocketAsync();
    }

    private readonly ILogger _logger;
    private IMessageSink _sink;
    private WebSocket _webSocket;
    private readonly BufferManager _bufferManager;
    private readonly int _receiveBufferSize;
    private bool _closed;
    private readonly object _socketLock = new object();
    private EndPoint _localEndpoint;
    private EndPoint _remoteEndpoint;
}
