import { ClientBase, ConnectionBase } from "../connBase.js";
import { ProtocolBase } from "../protocolBase.js";

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

  protected createNewClient(id: string, protocol: ProtocolBase, heartbeatInterval: number) { return new SocketClient(id, this, protocol, heartbeatInterval); }
}

export class SocketClient extends ClientBase<SocketConnection> {
  readonly socket: any;
  private onSocketConnect: () => void = null;

  constructor(id: string, connection: SocketConnection, protocol: ProtocolBase, heartbeatInterval: number) {
    super(id, connection, protocol, heartbeatInterval);

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

  // Nothing needs to be done to disconnect
  async destroyClient() {}
 
  protected doSend(msg: string, recipientId: string): void {
    this.socket.send(msg);
  }
}
