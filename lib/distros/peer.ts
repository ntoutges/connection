import { ChannelBase, ClientBase, ConnectionBase } from "../connBase.js";

export class PeerConnection extends ConnectionBase<PeerClient> {
  readonly Peer: any;
  readonly prefix: string;

  constructor(Peer: any, prefix: string) {
    super();
    this.Peer = Peer;
    this.prefix = prefix;
  }

  protected createNewClient(id: string, heartbeatInterval: number): PeerClient { return new PeerClient(id,this,heartbeatInterval); }

  getFullId(id: string) { return this.prefix + id; }
  getLocalId(id: string) { return id.replace(this.prefix, ""); } // strip prefix
}

export class PeerClient extends ClientBase<PeerConnection, PeerChannel> {
  readonly peer: any;
  private waitingForPeerOpen: () => void = null;
  private readonly conns = new Map<string,any>(); // maps between client id and peerjs.conn object

  constructor(id: string, connection: PeerConnection, heartbeatInterval: number) {
    super(id, connection,heartbeatInterval);

    this.peer = new connection.Peer(this.fullId);

    this.peer.on("open", (id: string) => {
      this.setReadyState(this.id, true); // self is ready
      console.log("ready to send!")
    });

    this.peer.on('connection', (conn: any) => {
      conn.on('data', (data: string) => {
        data = String(data); // stringify in case not yet
        this.listener.trigger("receive", data);
      });

      this.addPeerConnection(conn);
    });

    this.listener.on("readystatechange", (id: string) => {
      if (id == this.id && this.getReadyState(id) && this.waitingForPeerOpen) {
        this.waitingForPeerOpen();
        this.waitingForPeerOpen = null;
      }
    }, 200); // give high priority
  }

  private addPeerConnection(conn: any) {
    const id = this.conn.getLocalId(conn.peer);
    this.setReadyState(id, true);
    this.conns.set(id, conn);
  }

  createNewChannel(id: string): PeerChannel { return new PeerChannel(id, this); }
  
  connectTo(id: string) {
    return new Promise<boolean>((resolve,reject) => {
      if (this.getReadyState(this.id)) return this.doConnectTo(id,resolve); // already able to connect
      this.waitingForPeerOpen = this.doConnectTo.bind(this, id, resolve); // wait until able to connect
    });
  }

  private doConnectTo(id: string, resolve: (val: boolean) => void) {
    if (this.conns.has(id)) { // connection alrady established
      resolve(true);
      return;
    }
    const conn = this.peer.connect(this.conn.getFullId(id));
    conn.on("open", () => {
      this.conns.set(id, conn);
      this.setReadyState(id, true);
      resolve(true);
    });
    conn.on("data", (data: any) => {
      data = String(data); // stringify, just in case
      this.listener.trigger("receive", data);
    })

    this.conns.set(id, null); // indicate processing
  }

  async disconnectFrom(id: string) {
    if (this.conns.has(id)) {
      this.conns.get(id).close();
      this.conns.delete(id);
    }
    else return false; // error occurred
  }

  get fullId() { return this.conn.getFullId(this.id); }

  getConn(id: string) {
    return this.conns.get(id) ?? null;
  }
}

export class PeerChannel extends ChannelBase<PeerConnection, PeerClient> {
  protected doSend(msg: string, recipientId: string) {
    const conn = this.client.getConn(recipientId);
    if (conn) {
      conn.send(msg);
    }
  }
}
