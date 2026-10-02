using Opc.Ua;
using Opc.Ua.Client;

namespace RefClient;

/// <summary>
/// The same interop checks as ref/opcjs/RefClientNode/tests/opcjs.test.ts, but driven by the
/// OPC Foundation UA-.NETStandard client against the opcjs RefServer.
/// </summary>
[Collection(OpcjsServerCollection.Name)]
public sealed class OpcjsRefServerTests(OpcjsServerFixture server)
{
    private static readonly TimeSpan s_timeout = TimeSpan.FromSeconds(15);

    [Fact]
    public async Task DiscoversTheEndpointsExposedByTheOpcjsRefServer()
    {
        EndpointDescriptionCollection endpoints = await server.GetEndpointsAsync();

        Assert.NotEmpty(endpoints);
        foreach (EndpointDescription endpoint in endpoints)
        {
            Assert.False(string.IsNullOrEmpty(endpoint.EndpointUrl));
            Assert.False(string.IsNullOrEmpty(endpoint.SecurityPolicyUri));
            Assert.False(string.IsNullOrEmpty(endpoint.Server?.ApplicationUri));
        }
        // The server advertises its own host/port, not the TLS proxy's.
        Assert.Contains(endpoints, e =>
            e.EndpointUrl.Contains($":{OpcjsServerFixture.ServerPort}") && e.EndpointUrl.Contains("/RefServer"));
    }

    [Fact]
    public async Task ReadsTheIntegerVariableFromTheOpcjsRefServer()
    {
        using ISession session = await server.ConnectAsync();
        try
        {
            DataValue value = await session.ReadValueAsync(IntegerNodeId(session));

            Assert.True(StatusCode.IsGood(value.StatusCode));
            Assert.IsType<int>(value.Value);
        }
        finally
        {
            await session.CloseAsync(CancellationToken.None);
        }
    }

    [Fact]
    public async Task ReceivesChangingValuesForTheIntegerVariableFromTheOpcjsRefServer()
    {
        using ISession session = await server.ConnectAsync();
        try
        {
            var received = new HashSet<int>();
            var twoDistinctValues = new TaskCompletionSource();

            var subscription = new Subscription(server.Telemetry, new SubscriptionOptions
            {
                PublishingInterval = 200,
                PublishingEnabled = true,
            })
            {
                FastDataChangeCallback = (_, notification, _) =>
                {
                    lock (received)
                    {
                        foreach (MonitoredItemNotification item in notification.MonitoredItems)
                        {
                            if (item.Value.Value is int number) received.Add(number);
                        }
                        if (received.Count >= 2) twoDistinctValues.TrySetResult();
                    }
                },
            };
            session.AddSubscription(subscription);
            await subscription.CreateAsync();
            subscription.AddItem(new MonitoredItem(server.Telemetry, new MonitoredItemOptions
            {
                StartNodeId = IntegerNodeId(session),
                AttributeId = Attributes.Value,
                SamplingInterval = 200,
            }));
            await subscription.ApplyChangesAsync();

            await twoDistinctValues.Task.WaitAsync(s_timeout);

            Assert.True(received.Count >= 2);
        }
        finally
        {
            await session.CloseAsync(CancellationToken.None);
        }
    }

    [Fact]
    public async Task DetectsAServerShutdownAnnouncementAndCanReadAgainAfterwards()
    {
        using ISession session = await server.ConnectAsync();
        // Poll far faster than the SDK's 5 s default so the test doesn't have to wait that long.
        session.KeepAliveInterval = 200;
        var shutdownDetected = new TaskCompletionSource();
        session.KeepAlive += (_, e) =>
        {
            if (e.CurrentState == ServerState.Shutdown) shutdownDetected.TrySetResult();
        };

        try
        {
            NodeId integerNodeId = IntegerNodeId(session);
            Assert.True(StatusCode.IsGood((await session.ReadValueAsync(integerNodeId)).StatusCode));

            // Announce a shutdown that "returns" 500 ms from now.
            await server.SetServerStateAsync("Shutdown", DateTimeOffset.UtcNow.AddMilliseconds(500));

            await shutdownDetected.Task.WaitAsync(s_timeout);

            await server.SetServerStateAsync("Running");
            Assert.True(StatusCode.IsGood((await session.ReadValueAsync(integerNodeId)).StatusCode));
        }
        finally
        {
            await server.SetServerStateAsync("Running");
            await session.CloseAsync(CancellationToken.None);
        }
    }

    private static NodeId IntegerNodeId(ISession session) =>
        new("Integer", (ushort)session.NamespaceUris.GetIndex(OpcjsServerFixture.NamespaceUri));
}
