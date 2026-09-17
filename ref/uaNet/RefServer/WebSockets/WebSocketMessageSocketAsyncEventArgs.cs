#pragma warning disable CS8600 // Converting null literal or possible null value to non-nullable type.
#pragma warning disable CS8767 // Nullability mismatch in implicitly implemented interface member.

using System;
using Opc.Ua.Bindings;

namespace RefServer.WebSockets;

/// <summary>
/// Handles async event callbacks from a WebSocket
/// </summary>
public class WebSocketMessageSocketAsync : IMessageSocketAsyncEventArgs
{
    /// <summary>
    /// Create the event args for the async WebSocket message socket.
    /// </summary>
#pragma warning disable CS8618 // Non-nullable field must contain a non-null value when exiting constructor. Consider adding the 'required' modifier or declaring as nullable.
#pragma warning disable CS8618 // Non-nullable field must contain a non-null value when exiting constructor. Consider adding the 'required' modifier or declaring as nullable.
#pragma warning disable CS8618 // Non-nullable field must contain a non-null value when exiting constructor. Consider adding the 'required' modifier or declaring as nullable.
#pragma warning disable CS8618 // Non-nullable field must contain a non-null value when exiting constructor. Consider adding the 'required' modifier or declaring as nullable.
    public WebSocketMessageSocketAsync()
#pragma warning restore CS8618 // Non-nullable field must contain a non-null value when exiting constructor. Consider adding the 'required' modifier or declaring as nullable.
#pragma warning restore CS8618 // Non-nullable field must contain a non-null value when exiting constructor. Consider adding the 'required' modifier or declaring as nullable.
#pragma warning restore CS8618 // Non-nullable field must contain a non-null value when exiting constructor. Consider adding the 'required' modifier or declaring as nullable.
#pragma warning restore CS8618 // Non-nullable field must contain a non-null value when exiting constructor. Consider adding the 'required' modifier or declaring as nullable.
    {
        UserToken = this;
    }

    /// <inheritdoc/>
    public void Dispose()
    {
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc/>
    public object UserToken { get; set; }

    /// <inheritdoc/>
    public void SetBuffer(byte[] buffer, int offset, int count)
    {
        Buffer = buffer;
        Offset = offset;
        Count = count;
    }

    /// <inheritdoc/>
    public bool IsSocketError { get; set; }

    /// <inheritdoc/>
    public string SocketErrorString { get; set; }

    /// <inheritdoc/>
    public event EventHandler<IMessageSocketAsyncEventArgs> Completed;

    /// <inheritdoc/>
    public int BytesTransferred { get; set; }

    /// <inheritdoc/>
    public byte[] Buffer { get; set; }

    /// <inheritdoc/>
    public BufferCollection BufferList { get; set; }

    /// <summary>
    /// Offset in buffer.
    /// </summary>
    public int Offset { get; set; }

    /// <summary>
    /// Count of bytes.
    /// </summary>
    public int Count { get; set; }

    /// <summary>
    /// Invoke completed event.
    /// </summary>
    internal void OnCompleted()
    {
        Completed?.Invoke(this, this);
    }
}
