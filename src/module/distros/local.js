import { ClientBase, ConnectionBase } from "../connBase.js";
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
    createNewClient(id, protocol, heartbeatInterval) {
        const client = new LocalClient(id, this, protocol, heartbeatInterval);
        connWorlds.get(this.worldId).set(id, client);
        return client;
    }
}
export class LocalClient extends ClientBase {
    constructor(id, connection, protocol, heartbeatInterval) {
        super(id, connection, protocol, heartbeatInterval);
        setTimeout(() => { this.setReadyState(this.id, true); }, 0); // allow other events to happen before running this
    }
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
    doSend(msg, recipientId) {
        const recipient = connWorlds.get(this.conn.worldId).get(recipientId);
        if (!recipient)
            return; // Ignore
        // Allow other events to happen before message "sends"
        setTimeout(() => {
            recipient.listener.trigger("receive", msg);
        }, 0);
    }
}
//# sourceMappingURL=local.js.map