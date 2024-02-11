import { ChannelBase, ClientBase, ConnectionBase } from "../connBase.js";
export class PeerConnection extends ConnectionBase {
    Peer;
    prefix;
    constructor(Peer, prefix) {
        super();
        this.Peer = Peer;
        this.prefix = prefix;
    }
    createNewClient(id, heartbeatInterval) { return new PeerClient(id, this, heartbeatInterval); }
    getFullId(id) { return this.prefix + id; }
    getLocalId(id) { return id.replace(this.prefix, ""); } // strip prefix
}
export class PeerClient extends ClientBase {
    peer;
    waitingForPeerOpen = null;
    conns = new Map(); // maps between client id and peerjs.conn object
    constructor(id, connection, heartbeatInterval) {
        super(id, connection, heartbeatInterval);
        this.peer = new connection.Peer(this.fullId);
        this.peer.on("open", (id) => {
            this.setReadyState(this.id, true); // self is ready
            console.log("ready to send!");
        });
        this.peer.on("connection", (conn) => {
            conn.on("data", (data) => {
                data = String(data); // stringify in case not yet
                this.listener.trigger("receive", data);
            });
            this.addPeerConnection(conn);
        });
        this.peer.on("error", (err) => {
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
        });
        this.listener.on("readystatechange", (id) => {
            if (id == this.id && this.getReadyState(id) && this.waitingForPeerOpen) {
                this.waitingForPeerOpen();
                this.waitingForPeerOpen = null;
            }
        }, 200); // give high priority
    }
    addPeerConnection(conn) {
        const id = this.conn.getLocalId(conn.peer);
        this.toggleReadyStateTo(id, true);
        this.conns.set(id, conn);
    }
    createNewChannel(id) { return new PeerChannel(id, this); }
    connectTo(id, callback) {
        if (this.getReadyState(this.id))
            return this.doConnectTo(id, callback); // already able to connect
        this.waitingForPeerOpen = this.doConnectTo.bind(this, id, callback); // wait until able to connect
    }
    doConnectTo(id, resolve) {
        if (this.conns.has(id) && this.conns.get(id)) { // connection alrady established
            resolve(true);
            return;
        }
        const conn = this.peer.connect(this.conn.getFullId(id));
        conn.on("open", () => {
            this.conns.set(id, conn);
            this.toggleReadyStateTo(id, true);
            console.log("open");
            resolve(true);
        });
        conn.on("data", (data) => {
            data = String(data); // stringify, just in case
            this.listener.trigger("receive", data);
        });
        this.conns.set(id, null); // indicate processing
    }
    async disconnectFrom(id) {
        if (this.conns.has(id) && this.conns.get(id)) {
            this.conns.get(id).close();
            this.conns.delete(id);
        }
        else
            return false; // error occurred
    }
    get fullId() { return this.conn.getFullId(this.id); }
    getConn(id) {
        return this.conns.get(id) ?? null;
    }
}
export class PeerChannel extends ChannelBase {
    doSend(msg, recipientId) {
        const conn = this.client.getConn(recipientId);
        if (conn) {
            conn.send(msg);
        }
    }
}
//# sourceMappingURL=peer.js.map