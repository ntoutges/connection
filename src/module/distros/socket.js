import { ClientBase, ConnectionBase } from "../connBase.js";
export class SocketConnection extends ConnectionBase {
    socket;
    constructor({ socket }) {
        super();
        this.socket = socket;
    }
    createNewClient(id, protocol, heartbeatInterval) { return new SocketClient(id, this, protocol, heartbeatInterval); }
}
export class SocketClient extends ClientBase {
    socket;
    onSocketConnect = null;
    constructor(id, connection, protocol, heartbeatInterval) {
        super(id, connection, protocol, heartbeatInterval);
        this.socket = connection.socket;
        // Set ready state of self
        if (this.socket.connected)
            setTimeout(() => { this.setReadyState(this.id, true); });
        this.socket.on("connect", () => {
            this.setReadyState(this.id, true);
            // Run callback, if available
            if (this.onSocketConnect !== null) {
                this.onSocketConnect();
                this.onSocketConnect = null;
            }
        });
        this.socket.on("message", (data) => {
            data = String(data); // Stringify in case not yet
            this.listener.trigger("receive", data);
        });
    }
    connectTo(id, callback) {
        if (this.getReadyState(id))
            return callback(true); // Already connected
        if (this.getReadyState(this.id))
            this.doConnectTo(id, callback);
        else
            this.onSocketConnect = this.doConnectTo.bind(this, id, callback);
    }
    doConnectTo(id, callback) {
        // Attempt to connect
        this.setReadyState(id, true, false); // Allow for message to be sent
        this.dmChannel.echo("", id, 1000, "init").then((response) => {
            callback(true);
        }).catch(() => {
            callback(false);
        }); // Failed to connect
        this.setReadyState(id, false, false); // Reset ready state
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