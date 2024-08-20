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
    if (this.socket.connected) setTimeout(() => { this.setReadyState(this.id, true); });
    this.socket.on("connect", () => {
      this.setReadyState(this.id, true);

      // Run callback, if available
      if (this.onSocketConnect !== null) {
        this.onSocketConnect();
        this.onSocketConnect = null;
      }
    });

    this.socket.on("message", (data: string) => {
      data = String(data); // Stringify in case not yet
      this.listener.trigger("receive", data);
    });
  }

  connectTo(id: string, callback: (success: boolean) => void) {
    if (this.getReadyState(id)) return callback(true); // Already connected
    
    if (this.getReadyState(this.id)) this.doConnectTo(id, callback);
    else this.onSocketConnect = this.doConnectTo.bind(this, id, callback);
  }

  private doConnectTo(id: string, callback: (success: boolean) => void) {
    // Attempt to connect
    this.setReadyState(id, true, false); // Allow for message to be sent
    this.dmChannel.echo("", id, 1000, "init").then((response) => {
      callback(true);
    }).catch(() => {
      callback(false);
    }); // Failed to connect
    this.setReadyState(id, false, false); // Reset ready state
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
