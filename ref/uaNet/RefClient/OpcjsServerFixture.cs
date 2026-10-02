using System.Diagnostics;
using System.Net.Http.Json;
using System.Security.Cryptography.X509Certificates;
using Opc.Ua;
using Opc.Ua.Bindings;
using Opc.Ua.Client;
using Opc.Ua.Configuration;

namespace RefClient;

/// <summary>
/// Starts the opcjs RefServer (ref/opcjs/RefServer, <c>node dist/index.js</c>) plus a TLS proxy in
/// front of it, and builds a UA-.NETStandard client configuration, once for the whole test run.
/// Set <c>OPCUA_EXTERNAL_SERVER=1</c> to use an already running RefServer instead.
/// </summary>
public sealed class OpcjsServerFixture : IAsyncLifetime
{
    public const int ServerPort = 62547;
    public const int ControlPort = 62548;
    public const string NamespaceUri = "http://opcjs.dev/UA/RefServer/";

    private Process? _server;
    private TlsTerminatingProxy? _proxy;
    private X509Certificate2? _trustedProxyCertificate;

    public ITelemetryContext Telemetry { get; } = DefaultTelemetry.Create(_ => { });

    public ApplicationConfiguration Configuration { get; private set; } = null!;

    /// <summary>The URL the client dials: the TLS proxy in front of opcjs-server's plain ws:// listener.</summary>
    public string EndpointUrl => $"opc.wss://localhost:{_proxy!.Port}/RefServer";

    public async Task InitializeAsync()
    {
        string repoRoot = FindRepoRoot();

        if (Environment.GetEnvironmentVariable("OPCUA_EXTERNAL_SERVER") != "1")
        {
            _server = await StartServerAsync(Path.Combine(repoRoot, "ref", "opcjs", "RefServer"));
        }

        _proxy = new TlsTerminatingProxy(ServerPort);

        // The SDK's WebSocket transport (ClientWebSocket) validates the proxy's self-signed certificate
        // against the system trust store and offers no hook to override that, so trust it there
        // (current user only; removed again in DisposeAsync).
        _trustedProxyCertificate = X509CertificateLoader.LoadCertificate(_proxy.CertificateDer);
        using (var store = new X509Store(StoreName.Root, StoreLocation.CurrentUser))
        {
            store.Open(OpenFlags.ReadWrite);
            store.Add(_trustedProxyCertificate);
        }

        string pkiRoot = Path.Combine(repoRoot, "tmp", "ref", "uaNet", "RefClient", "pki");

        ((ITransportBindings<ITransportChannelFactory>)TransportBindings.Channels)
            .SetBinding(new WebSocketTransportChannelFactory());

        const string applicationName = "RefClient";
        var application = new ApplicationInstance(Telemetry)
        {
            ApplicationName = applicationName,
            ApplicationType = ApplicationType.Client,
        };
        var applicationCertificate = new CertificateIdentifier
        {
            StoreType = "Directory",
            StorePath = Path.Combine(pkiRoot, "own"),
            SubjectName = $"CN={applicationName}, O=opcjs, DC=localhost",
            CertificateTypeString = "RsaSha256",
        };

        Configuration = await application
            .Build($"urn:localhost:opcjs:{applicationName}", "uri:opcjs.dev:RefClient")
            .AsClient()
            .AddSecurityConfiguration([applicationCertificate], pkiRoot)
            // Sample convenience only; never auto-accept untrusted certificates in production.
            .SetAutoAcceptUntrustedCertificates(true)
            .CreateAsync();

        await application.CheckApplicationInstanceCertificatesAsync(silent: true);
    }

    public Task DisposeAsync()
    {
        if (_trustedProxyCertificate != null)
        {
            using var store = new X509Store(StoreName.Root, StoreLocation.CurrentUser);
            store.Open(OpenFlags.ReadWrite);
            store.Remove(_trustedProxyCertificate);
            _trustedProxyCertificate.Dispose();
        }
        _proxy?.Dispose();
        if (_server is { HasExited: false })
        {
            _server.Kill(entireProcessTree: true);
            _server.WaitForExit();
        }
        _server?.Dispose();
        return Task.CompletedTask;
    }

    /// <summary>Discovers the server's endpoints through the proxy.</summary>
    public async Task<EndpointDescriptionCollection> GetEndpointsAsync(CancellationToken ct = default)
    {
        using DiscoveryClient discovery = await DiscoveryClient.CreateAsync(
            Configuration, new Uri(EndpointUrl), DiagnosticsMasks.None, ct);
        return await discovery.GetEndpointsAsync(null, ct);
    }

    /// <summary>Opens an anonymous, security-policy-None session to the server.</summary>
    public async Task<ISession> ConnectAsync(CancellationToken ct = default)
    {
        EndpointDescription description = (await GetEndpointsAsync(ct))
            .First(e => e.SecurityMode == MessageSecurityMode.None);
        // The server advertises its own (plain ws://) port; dial the TLS proxy instead.
        description.EndpointUrl = EndpointUrl;

        var endpoint = new ConfiguredEndpoint(null, description, EndpointConfiguration.Create(Configuration));
        return await new DefaultSessionFactory(Telemetry).CreateAsync(
            Configuration, endpoint, false, "RefClient", 60_000, new UserIdentity(), null, ct);
    }

    /// <summary>Flips the server's reported <c>Server/ServerStatus/State</c> via its test-only HTTP control endpoint.</summary>
    public async Task SetServerStateAsync(string state, DateTimeOffset? estimatedReturnTime = null)
    {
        using var http = new HttpClient();
        var body = new
        {
            state,
            estimatedReturnTime = estimatedReturnTime?.ToUnixTimeMilliseconds(),
        };
        using HttpResponseMessage response = await http.PostAsJsonAsync(
            $"http://127.0.0.1:{ControlPort}/server-state", body);
        response.EnsureSuccessStatusCode();
    }

    private static string FindRepoRoot()
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir != null; dir = dir.Parent)
        {
            if (File.Exists(Path.Combine(dir.FullName, "nx.json")))
            {
                return dir.FullName;
            }
        }
        throw new InvalidOperationException("Could not locate the repository root (nx.json).");
    }

    private static async Task<Process> StartServerAsync(string serverDir)
    {
        var started = new TaskCompletionSource();
        var process = new Process
        {
            StartInfo = new ProcessStartInfo("node", Path.Combine(serverDir, "dist", "index.js"))
            {
                WorkingDirectory = serverDir,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            },
            EnableRaisingEvents = true,
        };
        process.OutputDataReceived += (_, e) =>
        {
            if (e.Data?.Contains("Server started.") == true) started.TrySetResult();
        };
        process.ErrorDataReceived += (_, _) => { };
        process.Exited += (_, _) => started.TrySetException(
            new InvalidOperationException("opcjs RefServer exited before it started."));

        process.Start();
        process.BeginOutputReadLine();
        process.BeginErrorReadLine();

        await started.Task.WaitAsync(TimeSpan.FromSeconds(60));
        return process;
    }
}

[CollectionDefinition(Name)]
public sealed class OpcjsServerCollection : ICollectionFixture<OpcjsServerFixture>
{
    public const string Name = "opcjs RefServer";
}
