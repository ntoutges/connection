import { ChannelBase, ClientBase, ConnectionBase } from "../connBase.js";
export class LocalConnection extends ConnectionBase {
    createNewClient(id, heartbeatInterval) { return new LocalClient(id, this, heartbeatInterval); }
}
export class LocalClient extends ClientBase {
    constructor(id, connection, heartbeatInterval) {
        super(id, connection, heartbeatInterval);
        this.setReadyState(this.id, true);
    }
    createNewChannel(id) { return new LocalChannel(id, this); }
    getClient(id) {
        if (this.clients.has(id) || id == this._routerId)
            return this.conn.getClient(id);
        return null;
    }
    async connectTo(id) {
        const otherClient = this.conn.getClient(id);
        if (!otherClient)
            return false;
        otherClient.acceptConnection(this.id);
        return true;
    }
    // TODO: make this do something...
    async disconnectFrom(id) { return true; } // always assume success
    acceptConnection(id) { this.setReadyState(id, true); }
}
export class LocalChannel extends ChannelBase {
    doSend(msg, recipientId) {
        const recipient = this.client.getClient(recipientId);
        if (!recipient) { // no one to send to, so push to queue
            this.sendQueue.add([msg, () => recipientId]);
            return;
        }
        setTimeout(() => {
            recipient.listener.trigger("receive", msg);
        }, 100);
    }
}
//# sourceMappingURL=local.js.map