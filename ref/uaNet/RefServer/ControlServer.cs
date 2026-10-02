using System.Net;
using System.Net.Sockets;
using System.Text;

namespace RefServer;

/// <summary>
/// Minimal, localhost-only, raw-TCP control listener used exclusively by the ref test suite
/// (ref/opcjs/RefClientNode/tests/uaNet.test.ts). Not part of the OPC UA protocol: a client
/// connects, sends a single line (<c>"Shutdown &lt;estimatedReturnTimeEpochMs&gt;"</c>, <c>"Running"</c>,
/// <c>"DropConnections"</c>, <c>"CloseSessions"</c>, <c>"SessionCount"</c>, <c>"AddNamespace &lt;uri&gt;"</c>,
/// <c>"SetMaxSessions &lt;n&gt;"</c> or <c>"SetMaxSessionTimeout &lt;ms&gt;"</c>),
/// and receives <c>"OK"</c> (optionally followed by a payload) once the command has been applied, or
/// <c>"ERROR ..."</c>. The shutdown commands simulate a server shutdown announcement for the Session
/// Client Detect Shutdown conformance unit.
///
/// Unlike the (purely cosmetic) opcjs/open62541 RefServer simulations, the real SDK's
/// <see cref="RefServerHost.SimulateShutdown"/> makes the server genuinely reject every
/// in-flight service request with Bad_ServerHalted (OPC UA Part 4, §5.13.5) — matching real
/// spec-conformant behaviour. So that the ref test can still observe a successful reconnect
/// afterwards, "Shutdown" auto-reverts back to Running once the given estimated-return-time
/// has elapsed, mirroring a real server that comes back up on schedule.
/// </summary>
internal static class ControlServer
{
    public static async Task RunAsync(RefServerHost host, int port, CancellationToken cancellationToken)
    {
        var listener = new TcpListener(IPAddress.Loopback, port);
        listener.Start();
        try
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                using TcpClient client = await listener.AcceptTcpClientAsync(cancellationToken);
                using NetworkStream stream = client.GetStream();
                using var reader = new StreamReader(stream, Encoding.ASCII);
                using var writer = new StreamWriter(stream, Encoding.ASCII) { AutoFlush = true };

                string? line = await reader.ReadLineAsync(cancellationToken);
                try
                {
                    string payload = Execute(host, line ?? string.Empty);
                    await writer.WriteLineAsync(payload.Length == 0 ? "OK" : $"OK {payload}");
                }
                catch (Exception ex)
                {
                    await writer.WriteLineAsync($"ERROR {ex.Message}");
                }
            }
        }
        catch (OperationCanceledException)
        {
            // Expected on shutdown.
        }
        finally
        {
            listener.Stop();
        }
    }

    /// <summary>Executes one control-protocol line (see "Control channel" in ref/README.md) and returns its payload (may be empty).</summary>
    private static string Execute(RefServerHost host, string line)
    {
        string[] parts = line.Split(' ', 2, StringSplitOptions.RemoveEmptyEntries);
        switch (parts.FirstOrDefault())
        {
            case "Shutdown":
                host.SimulateShutdown();
                ScheduleAutoRevert(host, line);
                return string.Empty;
            case "Running":
                host.SimulateRunning();
                return string.Empty;
            case "DropConnections":
                host.DropConnections();
                return string.Empty;
            case "CloseSessions":
                host.CloseSessions();
                return string.Empty;
            case "SessionCount":
                return host.SessionCount.ToString();
            case "AddNamespace" when parts.Length == 2:
                return host.AddNamespace(parts[1]).ToString();
            case "SetMaxSessions" when parts.Length == 2 && int.TryParse(parts[1], out int maxSessions) && maxSessions > 0:
                host.SetMaxSessions(maxSessions);
                return string.Empty;
            case "SetMaxSessionTimeout" when parts.Length == 2 && int.TryParse(parts[1], out int maxTimeoutMs) && maxTimeoutMs > 0:
                host.SetMaxSessionTimeout(maxTimeoutMs);
                return string.Empty;
            default:
                throw new InvalidOperationException($"unknown command: {line}");
        }
    }

    /// <summary>
    /// Parses the epoch-milliseconds argument off a <c>"Shutdown &lt;epochMs&gt;"</c> command
    /// and, if it names a moment in the future, schedules <see cref="RefServerHost.SimulateRunning"/>
    /// to run then (fire-and-forget).
    /// </summary>
    private static void ScheduleAutoRevert(RefServerHost host, string line)
    {
        string[] parts = line.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length < 2 || !long.TryParse(parts[1], out long estimatedReturnTimeMs))
        {
            return;
        }

        long delayMs = estimatedReturnTimeMs - DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        if (delayMs <= 0)
        {
            host.SimulateRunning();
            return;
        }

        _ = Task.Delay((int) Math.Min(delayMs, int.MaxValue)).ContinueWith(_ => host.SimulateRunning());
    }
}
