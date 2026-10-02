using System.Net;
using System.Net.Security;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;

namespace RefClient;

/// <summary>
/// Minimal TLS-terminating TCP proxy. The UA-.NETStandard WebSocket transport always dials
/// <c>wss://</c>, while opcjs-server only speaks plain <c>ws://</c>; this proxy bridges the two.
/// </summary>
internal sealed class TlsTerminatingProxy : IDisposable
{
    private readonly TcpListener _listener;
    private readonly X509Certificate2 _certificate;
    private readonly int _targetPort;
    private readonly CancellationTokenSource _cts = new();

    public int Port { get; }

    /// <summary>Public part (DER) of the self-signed certificate; must be trusted by the client.</summary>
    public byte[] CertificateDer { get; }

    public TlsTerminatingProxy(int targetPort)
    {
        _targetPort = targetPort;

        using var key = RSA.Create(2048);
        var request = new CertificateRequest("CN=localhost", key, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        var san = new SubjectAlternativeNameBuilder();
        san.AddDnsName("localhost");
        san.AddIpAddress(IPAddress.Loopback);
        request.CertificateExtensions.Add(san.Build());
        request.CertificateExtensions.Add(new X509BasicConstraintsExtension(true, false, 0, true));
        request.CertificateExtensions.Add(new X509EnhancedKeyUsageExtension(
            [new Oid("1.3.6.1.5.5.7.3.1")], false));
        using var selfSigned = request.CreateSelfSigned(DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow.AddDays(1));
        CertificateDer = selfSigned.Export(X509ContentType.Cert);
        // Round-trip through PFX so the private key is usable by SslStream on every platform.
        _certificate = X509CertificateLoader.LoadPkcs12(selfSigned.Export(X509ContentType.Pfx), null);

        _listener = new TcpListener(IPAddress.Loopback, 0);
        _listener.Start();
        Port = ((IPEndPoint)_listener.LocalEndpoint).Port;
        _ = AcceptLoopAsync(_cts.Token);
    }

    private async Task AcceptLoopAsync(CancellationToken ct)
    {
        try
        {
            while (!ct.IsCancellationRequested)
            {
                TcpClient client = await _listener.AcceptTcpClientAsync(ct);
                _ = HandleAsync(client, ct);
            }
        }
        catch (OperationCanceledException)
        {
        }
    }

    private async Task HandleAsync(TcpClient client, CancellationToken ct)
    {
        using var downstream = client;
        using var upstream = new TcpClient();
        try
        {
            await upstream.ConnectAsync(IPAddress.Loopback, _targetPort, ct);
            using var tls = new SslStream(client.GetStream(), false);
            await tls.AuthenticateAsServerAsync(_certificate);
            var plain = upstream.GetStream();
            await Task.WhenAny(tls.CopyToAsync(plain, ct), plain.CopyToAsync(tls, ct));
        }
        catch (Exception) when (ct.IsCancellationRequested || !downstream.Connected || !upstream.Connected)
        {
        }
        catch (IOException)
        {
        }
    }

    public void Dispose()
    {
        _cts.Cancel();
        _listener.Stop();
        _certificate.Dispose();
        _cts.Dispose();
    }
}
