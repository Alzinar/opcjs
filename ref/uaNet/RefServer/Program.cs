using Microsoft.Extensions.Logging;
using Opc.Ua;
using Opc.Ua.Bindings;
using Opc.Ua.Configuration;
using RefServer;

const string applicationName = "RefServer";
const int tcpPort = 62543;
const int wssPort = 62544;
string tcpEndpointUrl = $"opc.tcp://localhost:{tcpPort}/RefServer";
string wssEndpointUrl = $"opc.wss://localhost:{wssPort}/RefServer";
string? userName = Environment.GetEnvironmentVariable("OPCUA_REF_USERNAME");
string? password = Environment.GetEnvironmentVariable("OPCUA_REF_PASSWORD");
if (string.IsNullOrEmpty(userName) != string.IsNullOrEmpty(password))
{
    throw new InvalidOperationException("Set both OPCUA_REF_USERNAME and OPCUA_REF_PASSWORD, or neither.");
}
if (string.IsNullOrWhiteSpace(userName))
{
    userName = null;
    password = null;
}

// Shared, easily-gitignored location for every ref/ implementation's generated/received
// certificates (see /tmp/ in .gitignore). Assumes the working directory is this project's
// own folder (ref/uaNet/RefServer), as documented in ref/README.md.
string repoRoot = Path.GetFullPath(Path.Combine(Directory.GetCurrentDirectory(), "..", "..", ".."));
string pkiRoot = Path.Combine(repoRoot, "tmp", "ref", "uaNet", "RefServer", "pki");

ITelemetryContext telemetry = DefaultTelemetry.Create(logging => logging.AddConsole());

var application = new ApplicationInstance(telemetry)
{
    ApplicationName = applicationName,
    ApplicationType = ApplicationType.Server,
};

var applicationCertificate = new CertificateIdentifier
{
    StoreType = "Directory",
    StorePath = Path.Combine(pkiRoot, "own"),
    SubjectName = $"CN={applicationName}, O=opcjs, DC=localhost",
    CertificateTypeString = "RsaSha256",
};

// Plug the WebSocket (opc.wss://) listener/channel into the SDK's transport binding
// registry — the classic ApplicationInstance/StandardServer stack only ships opc.tcp
// support out of the box.
((ITransportBindings<ITransportListenerFactory>)TransportBindings.Listeners)
    .SetBinding(new WebSocketTransportListenerFactory());
((ITransportBindings<ITransportChannelFactory>)TransportBindings.Channels)
    .SetBinding(new WebSocketTransportChannelFactory());

var serverConfigurationBuilder = application
    .Build($"urn:localhost:opcjs:{applicationName}", "uri:opcjs.dev:RefServer")
    .AsServer([tcpEndpointUrl, wssEndpointUrl])
    .AddUnsecurePolicyNone()
    .AddSignAndEncryptPolicies()
    .AddUserTokenPolicy(UserTokenType.Anonymous);
if (userName is not null)
{
    serverConfigurationBuilder = serverConfigurationBuilder.AddUserTokenPolicy(new UserTokenPolicy
    {
        PolicyId = "username",
        TokenType = UserTokenType.UserName,
        SecurityPolicyUri = SecurityPolicies.None,
    });
}

await serverConfigurationBuilder
    .AddSecurityConfiguration([applicationCertificate], pkiRoot)
    // Sample convenience only; never auto-accept untrusted certificates in production.
    .SetAutoAcceptUntrustedCertificates(true)
    .CreateAsync();

await application.CheckApplicationInstanceCertificatesAsync(silent: true);

// Lowered from the 10 s default so tests can exercise session expiry quickly.
application.ApplicationConfiguration.ServerConfiguration.MinSessionTimeout = 1000;

var refServerHost = new RefServerHost(userName, password);
await application.StartAsync(refServerHost);

// Test-only control channel for ref/opcjs/RefClientNode/tests/uaNet.test.ts (Session Client Detect
// Shutdown conformance unit) — see ControlServer.cs.
const int controlPort = 62549;
using var controlServerCts = new CancellationTokenSource();
_ = ControlServer.RunAsync(refServerHost, controlPort, controlServerCts.Token);

Console.WriteLine("Server started.");
Console.WriteLine($"  {tcpEndpointUrl}");
Console.WriteLine($"  {wssEndpointUrl}");
Console.WriteLine("Press Ctrl+C to exit...");

var exitEvent = new TaskCompletionSource();
Console.CancelKeyPress += (_, e) =>
{
    e.Cancel = true;
    exitEvent.TrySetResult();
};
await exitEvent.Task;

controlServerCts.Cancel();
await application.StopAsync();
