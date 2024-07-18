import { ChannelBase, ClientBase, ConnectionBase } from "../connBase.js";
import { PeerlessClient } from "../peerlessClient.js";

export class SocketConnection extends ConnectionBase<SocketClient> {
  readonly socket: any;

  constructor({
    socket
  }: {
    socket: any
  }) {
    super();
    this.socket = socket;
  }

  protected createNewClient(id: string, heartbeatInterval: number) { return new SocketClient(id, this, heartbeatInterval); }
}

export class SocketClient extends PeerlessClient<SocketConnection, SocketChannel> {
  readonly socket: any;
  private onSocketConnect: () => void = null;

  constructor(id: string, connection: SocketConnection, heartbeatInterval: number) {
    super(id, connection, heartbeatInterval);

    this.socket = connection.socket;

    // Set ready state of self
    if (this.socket.connected) setTimeout(() => { this.setConnectionStatus(true); });
    this.socket.on("connect", this.setConnectionStatus.bind(this, true));

    this.socket.on("message", (data: string) => {
      data = String(data); // Stringify in case not yet
      this.listener.trigger("receive", data);
    });
  }

  async disconnectFrom(id: string) {
    return true;
  }

  createNewChannel(id: string): SocketChannel { return new SocketChannel(id, this); }

  // Nothing needs to be done to disconnect
  async destroyClient() {}
}

export class SocketChannel extends ChannelBase<SocketClient> {
  protected doSend(msg: string, recipientId: string): void {
    this.client.socket.send(msg);
  }
}
