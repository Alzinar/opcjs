#pragma warning disable CS8600 // Converting null literal or possible null value to non-nullable type.
#pragma warning disable CS8604 // Possible null reference argument.
#pragma warning disable CS8602 // Dereference of a possibly null reference.
#pragma warning disable CS8625 // Cannot convert null literal to non-nullable reference type.
#pragma warning disable ASPDEPR004 // WebHostBuilder is obsolete.
#pragma warning disable ASPDEPR008 // IWebHost is obsolete.
#pragma warning disable CA2000 // OPC UA channel objects have explicit ownership-transfer semantics not tracked by the analyzer.

using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Security.Cryptography.X509Certificates;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;
using Opc.Ua;
using Opc.Ua.Bindings;
using Opc.Ua.Security.Certificates;

namespace RefServer.WebSockets;

/// <summary>
/// Manages the connections for a UA WebSocket server.
/// </summary>
public class WebSocketTransportListener : ITransportListener, ITcpChannelListener
{
    /// <summary>
    /// Raised when a new connection is waiting for a client.
    /// </summary>
    public event ConnectionWaitingHandlerAsync ConnectionWaiting;

    /// <summary>
    /// Raised when a monitored connection's status changed.
    /// </summary>
    public event EventHandler<ConnectionStatusEventArgs> ConnectionStatusChanged;

    private readonly ILogger _logger;
    private readonly ITelemetryContext _telemetry;
    // private IWebHostBuilder m_hostBuilder;
    private IWebHost _host;
    private BufferManager _bufferManager;
    private CertificateTypesProvider _serverCertificateTypesProvider;
    private ChannelQuotas _quotas;
    private ITransportListenerCallback _callback;
    private readonly ConcurrentDictionary<uint, WebSocketListenerChannel> _channelsHash;
    private uint _lastChannelId;
    private readonly object _lock = new object();
    private EndpointDescriptionCollection _descriptions;

    /// <summary>
    /// Initializes a new instance of the <see cref="WebSocketTransportListener"/> class.
    /// </summary>
#pragma warning disable CS8618 // Non-nullable field must contain a non-null value when exiting constructor. Consider adding the 'required' modifier or declaring as nullable.
#pragma warning disable CS8618 // Non-nullable field must contain a non-null value when exiting constructor. Consider adding the 'required' modifier or declaring as nullable.
#pragma warning disable CS8618 // Non-nullable field must contain a non-null value when exiting constructor. Consider adding the 'required' modifier or declaring as nullable.
#pragma warning disable CS8618 // Non-nullable field must contain a non-null value when exiting constructor. Consider adding the 'required' modifier or declaring as nullable.
#pragma warning disable CS8618 // Non-nullable field must contain a non-null value when exiting constructor. Consider adding the 'required' modifier or declaring as nullable.
#pragma warning disable CS8618 // Non-nullable field must contain a non-null value when exiting constructor. Consider adding the 'required' modifier or declaring as nullable.
#pragma warning disable CS8618 // Non-nullable field must contain a non-null value when exiting constructor. Consider adding the 'required' modifier or declaring as nullable.
#pragma warning disable CS8618 // Non-nullable field must contain a non-null value when exiting constructor. Consider adding the 'required' modifier or declaring as nullable.
#pragma warning disable CS8618 // Non-nullable field must contain a non-null value when exiting constructor. Consider adding the 'required' modifier or declaring as nullable.
#pragma warning disable IDE0290 // Use primary constructor
    public WebSocketTransportListener(ITelemetryContext telemetry)
#pragma warning restore IDE0290 // Use primary constructor
#pragma warning restore CS8618 // Non-nullable field must contain a non-null value when exiting constructor. Consider adding the 'required' modifier or declaring as nullable.
#pragma warning restore CS8618 // Non-nullable field must contain a non-null value when exiting constructor. Consider adding the 'required' modifier or declaring as nullable.
#pragma warning restore CS8618 // Non-nullable field must contain a non-null value when exiting constructor. Consider adding the 'required' modifier or declaring as nullable.
#pragma warning restore CS8618 // Non-nullable field must contain a non-null value when exiting constructor. Consider adding the 'required' modifier or declaring as nullable.
#pragma warning restore CS8618 // Non-nullable field must contain a non-null value when exiting constructor. Consider adding the 'required' modifier or declaring as nullable.
#pragma warning restore CS8618 // Non-nullable field must contain a non-null value when exiting constructor. Consider adding the 'required' modifier or declaring as nullable.
#pragma warning restore CS8618 // Non-nullable field must contain a non-null value when exiting constructor. Consider adding the 'required' modifier or declaring as nullable.
#pragma warning restore CS8618 // Non-nullable field must contain a non-null value when exiting constructor. Consider adding the 'required' modifier or declaring as nullable.
#pragma warning restore CS8618 // Non-nullable field must contain a non-null value when exiting constructor. Consider adding the 'required' modifier or declaring as nullable.
    {
        _logger = telemetry.CreateLogger<WebSocketTransportListener>();
        _telemetry = telemetry;
        ListenerId = Guid.NewGuid().ToString();
        _channelsHash = new ConcurrentDictionary<uint, WebSocketListenerChannel>();
    }

    /// <inheritdoc/>
    public string ListenerId { get; }

    /// <inheritdoc/>
    public string UriScheme => Utils.UriSchemeOpcWss;

    /// <inheritdoc/>
    public Uri EndpointUrl { get; private set; }

    /// <summary>
    /// The maximum number of secure channels
    /// </summary>
    public int MaxChannelCount { get; private set; }


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
            lock (_lock)
            {
                _host?.Dispose();
                _host = null;

                foreach (var channel in _channelsHash.Values)
                {
                    Utils.SilentDispose(channel);
                }

                _channelsHash.Clear();
            }
        }
    }

    /// <summary>
    /// Opens the listener and starts accepting connections.
    /// </summary>
    public void Open(
        Uri baseAddress,
        TransportListenerSettings settings,
        ITransportListenerCallback callback)
    {
        _logger.LogInformation("Opening WebSocket listener on {EndpointUrl}", baseAddress);
        _bufferManager = new BufferManager(
            "Server",
            Math.Max(settings.Configuration.MaxBufferSize, settings.Configuration.MaxMessageSize), _telemetry);
        _descriptions = settings.Descriptions;
        _serverCertificateTypesProvider = settings.ServerCertificateTypesProvider;

        EndpointUrl = baseAddress;
        EndpointConfiguration configuration = settings.Configuration;
        _quotas = new ChannelQuotas(new ServiceMessageContext(_telemetry)
        {
            MaxArrayLength = configuration.MaxArrayLength,
            MaxByteStringLength = configuration.MaxByteStringLength,
            MaxMessageSize = configuration.MaxMessageSize,
            MaxStringLength = configuration.MaxStringLength,
            MaxEncodingNestingLevels = configuration.MaxEncodingNestingLevels,
            MaxDecoderRecoveries = configuration.MaxDecoderRecoveries,
            NamespaceUris = settings.NamespaceUris,
            ServerUris = new StringTable(),
            Factory = settings.Factory
        })
        {
            MaxBufferSize = configuration.MaxBufferSize,
            MaxMessageSize = configuration.MaxMessageSize,
            ChannelLifetime = configuration.ChannelLifetime,
            SecurityTokenLifetime = configuration.SecurityTokenLifetime,
            CertificateValidator = settings.CertificateValidator
        };
        MaxChannelCount = settings.MaxChannelCount;

        // save the callback to the server.
        _callback = callback;
        // EndpointUrl = baseAddress;
        // m_callback = callback;
        // m_serverCertificateTypesProvider = settings.ServerCertificateTypesProvider;
        // m_endpoints = settings.Descriptions;

        Start();
    }

    /// <inheritdoc/>
    public void CertificateUpdate(
        ICertificateValidator validator,
        CertificateTypesProvider serverCertificateTypes)
    {
        _quotas.CertificateValidator = validator;
        _serverCertificateTypesProvider = serverCertificateTypes;
        foreach (EndpointDescription description in _descriptions)
        {
            // TODO: why only if SERVERCERT != null
            if (description.ServerCertificate != null)
            {
                X509Certificate2 serverCertificate = serverCertificateTypes
                    .GetInstanceCertificate(
                        description.SecurityPolicyUri);
                if (serverCertificateTypes.SendCertificateChain)
                {
                    description.ServerCertificate = serverCertificateTypes
                        .LoadCertificateChainRaw(
                            serverCertificate);
                }
                else
                {
                    description.ServerCertificate = serverCertificate.RawData;
                }
            }
        }
    }

    /// <summary>
    /// Closes the listener and stops accepting connections.
    /// </summary>
    public void Close()
    {
        _logger.LogInformation("Closing WebSocket listener");
        Stop();
    }

    /// <summary>
    /// Starts listening at the specified port.
    /// </summary>
    public void Start()
    {
        WebSocketStartup.Listener = this;
        var m_hostBuilder = new WebHostBuilder();

        // Get server certificate for TLS
        var serverCertificate = _serverCertificateTypesProvider?.GetInstanceCertificate(
            SecurityPolicies.Basic256Sha256);

        UriHostNameType hostType = Uri.CheckHostName(EndpointUrl.Host);
        if (hostType is UriHostNameType.Dns or UriHostNameType.Unknown or UriHostNameType.Basic)
        {
            // bind to any address
            m_hostBuilder.UseKestrel(options =>
            {
                if (serverCertificate != null)
                {
                    options.ListenAnyIP(EndpointUrl.Port, listenOptions =>
                    {
                        listenOptions.UseHttps(serverCertificate);
                    });
                }
                else
                {
                    options.ListenAnyIP(EndpointUrl.Port);
                }
            });
        }
        else
        {
            // bind to specific address
            var ipAddress = IPAddress.Parse(EndpointUrl.Host);
            m_hostBuilder.UseKestrel(options =>
            {
                if (serverCertificate != null)
                {
                    options.Listen(ipAddress, EndpointUrl.Port, listenOptions =>
                    {
                        listenOptions.UseHttps(serverCertificate);
                    });
                }
                else
                {
                    options.Listen(ipAddress, EndpointUrl.Port);
                }
            });
        }

        m_hostBuilder.UseContentRoot(Directory.GetCurrentDirectory());
        m_hostBuilder.UseStartup<WebSocketStartup>();
        _host = m_hostBuilder.Start(Utils.ReplaceLocalhost(EndpointUrl.ToString()));

        _logger.LogInformation("WebSocket listener started on {EndpointUrl}", EndpointUrl);
    }

    /// <summary>
    /// Stops listening.
    /// </summary>
    public void Stop()
    {
        Dispose();
    }

    /// <inheritdoc/>
    public void CreateReverseConnection(Uri url, int timeout)
    {
        ConnectionWaiting = null;
        ConnectionStatusChanged = null;
        _logger.LogInformation("Creating reverse connection to {Url} with timeout {Timeout}", url, timeout);
        // Suppress warnings
        ConnectionWaiting = null;
        ConnectionWaiting?.Invoke(null, null);
        ConnectionStatusChanged = null;
        ConnectionStatusChanged?.Invoke(null, null);
        throw new NotImplementedException("Reverse connect not implemented for WebSocket transport.");
    }

    /// <inheritdoc/>
    public void UpdateChannelLastActiveTime(string globalChannelId)
    {
        _logger.LogDebug("Updating last active time for channel {GlobalChannelId}", globalChannelId);
        // intentionally not implemented
    }

    /// <summary>
    /// Handles a new WebSocket connection.
    /// </summary>
    public async Task HandleWebSocketConnectionAsync(HttpContext context, System.Net.WebSockets.WebSocket webSocket)
    {
        _logger.LogInformation("Handling new WebSocket connection from {RemoteIpAddress}", context.Connection.RemoteIpAddress);

        WebSocketListenerChannel channel = null;
        System.Net.WebSockets.WebSocket activeWebSocket = null;
        bool isBlocked = false;

        // Compute origin before the lock — context is available on this thread only.
        // RemoteIpAddress comes from the TCP socket and cannot be spoofed by the caller.
        var remoteIp = context.Connection.RemoteIpAddress;
        bool isLocal = remoteIp is not null &&
            IPAddress.IsLoopback(remoteIp.IsIPv4MappedToIPv6 ? remoteIp.MapToIPv4() : remoteIp);

        // Holds the GlobalChannelId so the origin can be deregistered after the WebSocket closes.
        string? globalChannelId = null;

        //repeatAccept = false;
        lock (_lock)
        {
            ConcurrentDictionary<uint, WebSocketListenerChannel> channels = _channelsHash;
            if (channels != null && !isBlocked)
            {
                // TODO: .Count is flagged as hotpath, implement separate counter
                int channelCount = channels.Count;

                // Remove oldest channel that does not have a session attached to it
                // before reaching m_maxChannelCount
                if (MaxChannelCount > 0 && MaxChannelCount == channelCount)
                {
                    KeyValuePair<uint, WebSocketListenerChannel>[] snapshot = [.. channels];

                    // Identify channels without established sessions
                    KeyValuePair<uint, WebSocketListenerChannel>[] nonSessionChannels =
                    [
                        .. snapshot.Where(ch => !ch.Value.UsedBySession)
                    ];

                    if (nonSessionChannels.Length != 0)
                    {
                        KeyValuePair<uint, WebSocketListenerChannel> oldestIdChannel
                            = nonSessionChannels.Aggregate(
                            (max, current) =>
                                current.Value.ElapsedSinceLastActiveTime > max.Value
                                    .ElapsedSinceLastActiveTime
                                    ? current
                                    : max);

                        _logger.LogInformation(
                            "TCPLISTENER: Channel Id {Id} scheduled for IdleCleanup - Oldest without established session.",
                            oldestIdChannel.Value.Id);
                        oldestIdChannel.Value.IdleCleanup();
                        _logger.LogInformation(
                            "TCPLISTENER: Channel Id {Id} finished IdleCleanup - Oldest without established session.",
                            oldestIdChannel.Value.Id);

                        channelCount--;
                    }
                }

                bool serveChannel = !(MaxChannelCount > 0 &&
                    MaxChannelCount < channelCount);
                if (!serveChannel)
                {
                    _logger.LogError(
                        "OnAccept: Maximum number of channels {CurrentCount} reached, serving channels is stopped until number is lower or equal than {MaxChannelCount} ",
                        channelCount,
                        MaxChannelCount);
                }

                // check if the accept socket has been created.

                channel = null;
                try
                {

                    channel = new WebSocketServerChannel(
                            ListenerId,
                            this,
                            _bufferManager,
                            _quotas,
                            _serverCertificateTypesProvider,
                            _descriptions,
                            _telemetry);

                    if (_callback != null)
                    {
                        channel.SetRequestReceivedCallback(
                            new WebSocketChannelRequestEventHandler(OnRequestReceivedAsync));
                        channel.SetReportOpenSecureChannelAuditCallback(
                            new WebSocketReportAuditOpenSecureChannelEventHandler(
                                OnReportAuditOpenSecureChannelEvent));
                        channel.SetReportCloseSecureChannelAuditCallback(
                            new WebSocketReportAuditCloseSecureChannelEventHandler(
                                OnReportAuditCloseSecureChannelEvent));
                        channel.SetReportCertificateAuditCallback(
                            new WebSocketReportAuditCertificate(
                                OnReportAuditCertificateEvent));
                    }

                    uint channelId;
                    do
                    {
                        // get channel id
                        channelId = GetNextChannelId();

                        // save the channel for shutdown and reconnects.
                        // retry to get a channel id if it is already in use.
                    } while (!channels.TryAdd(channelId, channel));

                    // start accepting messages on the channel.
                    channel.Attach(channelId, webSocket);

                    // Capture GlobalChannelId before transferring channel ownership (channel = null below).
                    // Register the origin so OpcJwtValidator can look it up via session.SecureChannelId.
                    globalChannelId = channel.GlobalChannelId;
                    OpcChannelOriginTracker.Register(globalChannelId, isLocal);

                    // Keep reference to the active WebSocket to wait outside the lock
                    activeWebSocket = webSocket;

                    channel = null;
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Unexpected error accepting a new connection.");
                }
                finally
                {
                    // Dispose only when ownership was not transferred to the channels dictionary
                    // (channel is set to null after successful Attach + TryAdd).
                    channel?.Dispose();
                }
            }
        }

        // Keep the HTTP context alive while the WebSocket is open (outside the lock)
        if (activeWebSocket != null)
        {
            while (activeWebSocket.State == System.Net.WebSockets.WebSocketState.Open)
            {
                await Task.Delay(100).ConfigureAwait(false);
            }

            _logger.LogInformation("WebSocket connection closed, State: {State}", activeWebSocket.State);
        }

        // Clean up the origin record so the dictionary does not grow unboundedly.
        if (globalChannelId is not null)
        {
            OpcChannelOriginTracker.Remove(globalChannelId);
        }
    }
    /// <summary>
    /// Handles requests arriving from a channel.
    /// </summary>
    private async void OnRequestReceivedAsync(
        WebSocketListenerChannel channel,
        uint requestId,
        IServiceRequest request)
    {
        try
        {
            if (_callback != null)
            {
                var context = new SecureChannelContext(
                    channel.GlobalChannelId,
                    channel.EndpointDescription,
                    RequestEncoding.Binary);

                IServiceResponse response = await _callback.ProcessRequestAsync(
                    context,
                    request).ConfigureAwait(false);

                try
                {
                    ((WebSocketServerChannel)channel).SendResponse(requestId, response);
                }
                catch (ServiceResultException sre) when (sre.StatusCode == Opc.Ua.StatusCodes.BadSecureChannelClosed)
                {
                    // try to find the new channel id for the authentication token to send response over new channel
                    NodeId authenticationToken = request.RequestHeader.AuthenticationToken;
                    if (_callback.TryGetSecureChannelIdForAuthenticationToken(
                            authenticationToken,
                            out uint channelId
                        ) &&
                        _channelsHash.TryGetValue(channelId, out WebSocketListenerChannel newChannel))
                    {
                        var serverChannel = (WebSocketServerChannel)newChannel;

                        // if the channel is not the same as the one we started with, send the response over the new channel
                        if (serverChannel != channel)
                        {
                            serverChannel.SendResponse(requestId, response);
                            return;
                        }
                    }
                    // if we could not find a new channel, just log the error
                    throw;
                }
            }
        }
        catch (Exception e)
        {
            _logger.LogError(e, "TCPLISTENER - Unexpected error processing request.");
        }
    }

    /// <summary>
    /// Callback for reporting the open secure channel audit event
    /// </summary>
    private void OnReportAuditOpenSecureChannelEvent(
        WebSocketServerChannel channel,
        OpenSecureChannelRequest request,
        X509Certificate2 clientCertificate,
        Exception exception)
    {
        try
        {
            _callback?.ReportAuditOpenSecureChannelEvent(
                channel.GlobalChannelId,
                channel.EndpointDescription,
                request,
                clientCertificate,
                exception);
        }
        catch (Exception e)
        {
            _logger.LogError(
                e,
                "TCPLISTENER - Unexpected error sending OpenSecureChannel Audit event.");
        }
    }

    /// <summary>
    /// Callback for reporting the close secure channel audit event
    /// </summary>
    private void OnReportAuditCloseSecureChannelEvent(
        WebSocketServerChannel channel,
        Exception exception)
    {
        try
        {
            _callback?.ReportAuditCloseSecureChannelEvent(channel.GlobalChannelId, exception);
        }
        catch (Exception e)
        {
            _logger.LogError(
                e,
                "TCPLISTENER - Unexpected error sending CloseSecureChannel Audit event.");
        }
    }

    /// <summary>
    /// Callback for reporting the certificate audit events
    /// </summary>
    private void OnReportAuditCertificateEvent(
        X509Certificate2 clientCertificate,
        Exception exception)
    {
        try
        {
            _callback?.ReportAuditCertificateEvent(clientCertificate, exception);
        }
        catch (Exception e)
        {
            _logger.LogError(
                e,
                "TCPLISTENER - Unexpected error sending Certificate Audit event.");
        }
    }

    /// <summary>
    /// Gets the next available channel ID.
    /// </summary>
    private uint GetNextChannelId()
    {
        lock (_lock)
        {
            return ++_lastChannelId;
        }
    }

    /// <inheritdoc/>
    public bool ReconnectToExistingChannel(IMessageSocket socket, uint requestId, uint sequenceNumber, uint channelId,
    X509Certificate2 clientCertificate, ChannelToken token, OpenSecureChannelRequest request)
    {
        throw new NotImplementedException();
    }

    /// <inheritdoc/>
    public async Task<bool> TransferListenerChannel(uint channelId, string serverUri, Uri endpointUrl)
    {
        bool accepted = false;

        // remove it so it does not get cleaned up as an inactive connection.
        if (_channelsHash?.TryRemove(channelId, out WebSocketListenerChannel channel) != true)
        {
            throw ServiceResultException.Create(
                Opc.Ua.StatusCodes.BadTcpSecureChannelUnknown,
                "Could not find secure channel request.");
        }

        // notify the application.
        if (ConnectionWaiting != null)
        {
            var args = new WebSocketConnectionWaitingEventArgs(
                serverUri,
                endpointUrl,
                channel.GetSocket());
            await ConnectionWaiting(this, args).ConfigureAwait(false);
            accepted = args.Accepted;
        }

        if (!accepted)
        {
            // add back in for other connection attempt.
            _channelsHash?.TryAdd(channelId, channel);
        }

        return accepted;
    }

    /// <inheritdoc/>
    public Task<bool> TransferListenerChannelAsync(uint channelId, string serverUri, Uri endpointUrl)
    {
        throw new NotImplementedException();
    }

    /// <inheritdoc/>
    public void ChannelClosed(uint channelId)
    {
        if (_channelsHash?.TryRemove(channelId, out WebSocketListenerChannel channel) == true)
        {
            channel?.Dispose();
            _logger.LogInformation("ChannelId {Id}: closed", channelId);
        }
        else
        {
            _logger.LogInformation("ChannelId {Id}: closed, but channel was not found", channelId);
        }
    }
}

/// <summary>
/// The Tcp specific arguments passed to the ConnectionWaiting event.
/// </summary>
public class WebSocketConnectionWaitingEventArgs : ConnectionWaitingEventArgs
{
    internal WebSocketConnectionWaitingEventArgs(
        string serverUrl,
        Uri endpointUrl,
        IMessageSocket socket)
        : base(serverUrl, endpointUrl)
    {
        Socket = socket;
    }

    /// <inheritdoc/>
    public override object Handle => Socket;

    /// <inheritdoc/>
    internal IMessageSocket Socket { get; }
}
