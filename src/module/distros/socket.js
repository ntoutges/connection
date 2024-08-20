import { ClientBase, ConnectionBase } from "../connBase.js";
export class SocketConnection extends ConnectionBase {
    socket;
    constructor({ socket }) {
        super();
        this.socket = socket;
    }
    createNewClient(id, protocol, heartbeatInterval) { return new SocketClient(id, this, protocol, heartbeatInterval); }
}
export class SocketClient extends PeerlessClient {
    socket;
    onSocketConnect = null;
    constructor(id, connection, protocol, heartbeatInterval) {
        super(id, connection, protocol, heartbeatInterval);
        this.socket = connection.socket;
        // Set ready state of self
        if (this.socket.connected)
            setTimeout(() => { this.setConnectionStatus(true); });
        this.socket.on("connect", this.setConnectionStatus.bind(this, true));
        this.socket.on("message", (data) => {
            data = String(data); // Stringify in case not yet
            this.listener.trigger("receive", data);
        });
    }
    async disconnectFrom(id) {
        return true;
    }
    // Nothing needs to be done to disconnect
    async destroyClient() { }
    doSend(msg, recipientId) {
        this.socket.send(msg);
    }
}
//# sourceMappingURL=socket.js.map