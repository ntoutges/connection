import { ChannelBase, ConnectionBase } from "../connBase.js";
import { PeerlessClient } from "../peerlessClient.js";
export class SocketConnection extends ConnectionBase {
    socket;
    constructor({ socket }) {
        super();
        this.socket = socket;
    }
    createNewClient(id, heartbeatInterval) { return new SocketClient(id, this, heartbeatInterval); }
}
export class SocketClient extends PeerlessClient {
    socket;
    onSocketConnect = null;
    constructor(id, connection, heartbeatInterval) {
        super(id, connection, heartbeatInterval);
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
    createNewChannel(id) { return new SocketChannel(id, this); }
    // Nothing needs to be done to disconnect
    async destroyClient() { }
}
export class SocketChannel extends ChannelBase {
    doSend(msg, recipientId) {
        this.client.socket.send(msg);
    }
}
//# sourceMappingURL=socket.js.map