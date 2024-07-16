import { ChannelBase, ClientBase, ConnectionBase } from "../connBase.js";
const connWorlds = new Map();
export class LocalConnection extends ConnectionBase {
    worldId;
    constructor({ worldId = "default" }) {
        super();
        this.addInitParams({ worldId });
        this.worldId = worldId;
        if (!connWorlds.has(this.worldId))
            connWorlds.set(this.worldId, new Map());
    }
    createNewClient(id, heartbeatInterval) {
        const client = new LocalClient(id, this, heartbeatInterval);
        connWorlds.get(this.worldId).set(id, client);
        return client;
    }
}
export class LocalClient extends ClientBase {
    constructor(id, connection, heartbeatInterval) {
        super(id, connection, heartbeatInterval);
        setTimeout(() => { this.setReadyState(this.id, true); }, 0); // allow other events to happen before running this
    }
    createNewChannel(id) { return new LocalChannel(id, this); }
    getClient(id) {
        if (this.clients.has(id) || id == this._routerId)
            return this.conn.getClient(id);
        return null;
    }
    connectTo(id, callback) {
        const otherClient = connWorlds.get(this.conn.worldId).get(id);
        if (!otherClient)
            callback(false);
        else {
            otherClient.acceptConnection(this.id);
            callback(true);
        }
    }
    // TODO: make this do something...
    async disconnectFrom(id) { return true; } // always assume success
    acceptConnection(id) { this.setReadyState(id, true); }
    async destroyClient() {
        connWorlds.get(this.conn.worldId).delete(this.id);
    }
}
export class LocalChannel extends ChannelBase {
    doSend(msg, recipientId) {
        const recipient = connWorlds.get(this.client.conn.worldId).get(recipientId);
        if (!recipient) { // no one to send to, so push to queue
            this.sendQueue.add([msg, () => recipientId]);
            return;
        }
        setTimeout(() => {
            recipient.listener.trigger("receive", msg);
        }, 1);
    }
}
//# sourceMappingURL=local.js.map