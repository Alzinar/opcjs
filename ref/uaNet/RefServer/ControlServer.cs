using System.Net;
using System.Net.Sockets;
using System.Text;

namespace RefServer;

/// <summary>
/// Minimal, localhost-only, raw-TCP control listener used exclusively by the ref test suite
/// (ref/opcjs/RefClient/tests/uaNet.test.ts) to simulate a server shutdown announcement for the
/// Session Client Detect Shutdown conformance unit. Not part of the OPC UA protocol: a client
/// connects, sends a single line (<c>"Shutdown &lt;estimatedReturnTimeEpochMs&gt;"</c> or
/// <c>"Running"</c>), and receives <c>"OK"</c> once
/// <see cref="RefServerHost.SimulateShutdown"/>/<see cref="RefServerHost.SimulateRunning"/> has
/// been applied.
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
                if (line is not null && line.StartsWith("Shutdown", StringComparison.Ordinal))
                {
                    host.SimulateShutdown();
                    ScheduleAutoRevert(host, line);
                    await writer.WriteLineAsync("OK");
                }
                else if (line is not null && line.StartsWith("Running", StringComparison.Ordinal))
                {
                    host.SimulateRunning();
                    await writer.WriteLineAsync("OK");
                }
                else
                {
                    await writer.WriteLineAsync($"ERROR unknown command: {line}");
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
