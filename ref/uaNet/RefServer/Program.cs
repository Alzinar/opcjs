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

await application
    .Build($"urn:localhost:opcjs:{applicationName}", "uri:opcjs.dev:RefServer")
    .AsServer([tcpEndpointUrl, wssEndpointUrl])
    .AddUnsecurePolicyNone()
    .AddSignAndEncryptPolicies()
    .AddUserTokenPolicy(UserTokenType.Anonymous)
    .AddSecurityConfiguration([applicationCertificate], pkiRoot)
    // Sample convenience only; never auto-accept untrusted certificates in production.
    .SetAutoAcceptUntrustedCertificates(true)
    .CreateAsync();

await application.CheckApplicationInstanceCertificatesAsync(silent: true);

await application.StartAsync(new RefServerHost());

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

await application.StopAsync();
