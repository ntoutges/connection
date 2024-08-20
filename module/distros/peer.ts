import { ClientBase, ConnectionBase } from "../connBase.js";
import { ProtocolBase } from "../protocolBase.js";

export class PeerConnection extends ConnectionBase<PeerClient> {
  readonly Peer: any;
  readonly prefix: string;

  constructor({
    Peer,
    prefix
  }: {
    Peer: any,
    prefix: string
  }) {
    super();
    this.Peer = Peer;
    this.prefix = prefix;

    this.addInitParams({ prefix });
  }

  protected createNewClient(id: string, protocol: ProtocolBase, heartbeatInterval: number): PeerClient { return new PeerClient(id, this, protocol, heartbeatInterval); }

  getFullId(id: string) { return this.prefix + id; }
  getLocalId(id: string) { return id.replace(this.prefix, ""); } // strip prefix
}

type error_t = "browser-incompatible" | "disconnected" | "invalid-id" | "invalid-key" | "network" | "peer-unavailable" | "ssl-unavailable" | "server-error" | "socket-closed" | "unavailable-id" | "webrtc";
export class PeerClient extends ClientBase<PeerConnection> {
  readonly peer: any;
  private waitingForPeerOpen: () => void = null;
  private readonly conns = new Map<string,any>(); // maps between client id and peerjs.conn object

  constructor(id: string, connection: PeerConnection, protocol: ProtocolBase, heartbeatInterval: number) {
    super(id, connection, protocol, heartbeatInterval);

    this.peer = new connection.Peer(this.fullId);

    this.peer.on("open", (id: string) => {
      this.setReadyState(this.id, true); // self is ready
    });

    this.peer.on("connection", (conn: any) => {
      conn.on("data", (data: string) => {
        data = String(data); // stringify in case not yet
        this.listener.trigger("receive", data);
      });
      
      this.addPeerConnection(conn);
    });

    this.peer.on("error", (err: { name: string, type: error_t, message: string }) => {
      switch (err.type) {
        // general connection errors
        case "browser-incompatible":
        case "disconnected": // (from server)
        case "invalid-key":
        case "network":
        case "ssl-unavailable":
        case "server-error":
        case "socket-closed":
        case "webrtc":
          this.errListener.trigger("connection", { message: err.message, type: err.type });
          break;

        // peer doesn't exist
        case "peer-unavailable":
          this.errListener.trigger("unavailable", { message: err.message, type: err.type });
          break;
        
        // invalid peer id on construct
        case "invalid-id":
        case "unavailable-id":
          this.errListener.trigger("id", { message: err.message, type: err.type });
          break;
        }
    })

    this.listener.on("readystatechange", (id: string) => {
      if (id == this.id && this.getReadyState(id) && this.waitingForPeerOpen) {
        this.waitingForPeerOpen();
        this.waitingForPeerOpen = null;
      }
    }, 200); // give high priority
  }

  private addPeerConnection(conn: any) {
    const id = this.conn.getLocalId(conn.peer);
    this.toggleReadyStateTo(id, true);
    this.conns.set(id, conn);
  }
  
  connectTo(id: string, callback: (success: boolean) => void) {
    if (this.getReadyState(this.id)) return this.doConnectTo(id,callback); // already able to connect
    this.waitingForPeerOpen = this.doConnectTo.bind(this, id, callback); // wait until able to connect
  }

  private doConnectTo(id: string, resolve: (val: boolean) => void) {
    if (this.conns.has(id) && this.conns.get(id)) { // connection alrady established
      resolve(true);
      return;
    }
    const conn = this.peer.connect(this.conn.getFullId(id));
    conn.on("open", () => {
      this.conns.set(id, conn);
      this.toggleReadyStateTo(id, true);
      resolve(true);
    });
    conn.on("data", (data: any) => {
      data = String(data); // stringify, just in case
      this.listener.trigger("receive", data);
    })

    this.conns.set(id, null); // indicate processing
  }

  async disconnectFrom(id: string) {
    if (this.conns.has(id) && this.conns.get(id)) {
      this.conns.get(id).close();
      this.conns.delete(id);
    }
    else return false; // error occurred
  }

  get fullId() { return this.conn.getFullId(this.id); }

  getConn(id: string) {
    return this.conns.get(id) ?? null;
  }

  protected async destroyClient() {
    this.peer.destroy();
  }
   
  protected doSend(msg: string, recipientId: string) {
    const conn = this.getConn(recipientId);
    if (conn) {
      conn.send(msg);
    }
  }
}
