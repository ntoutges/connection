"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LocalChannel = exports.LocalClient = exports.LocalConnection = void 0;
const connBase_1 = require("./connBase");
const listener_1 = require("./listener");
class LocalConnection extends connBase_1.ConnectionBase {
    createNewClient(id) { return new LocalClient(id, this); }
}
exports.LocalConnection = LocalConnection;
class LocalClient extends connBase_1.ClientBase {
    sender = new listener_1.Listener;
    listener = new listener_1.Listener;
    constructor(id, connection) {
        super(id, connection);
        this.sender.on("receive", this.onReceive.bind(this));
    }
    createNewChannel(id) { return new LocalChannel(id, this); }
}
exports.LocalClient = LocalClient;
class LocalChannel extends connBase_1.ChannelBase {
    doSend(msg, recipientId) {
        const recipient = this.client.getClient(recipientId);
        if (!recipient) { // no one to send to, so push to queue
            this.sendQueue.add([msg, () => recipientId]);
            return;
        }
        setTimeout(() => {
            recipient.sender.trigger("receive", msg);
        }, 100);
    }
}
exports.LocalChannel = LocalChannel;
//# sourceMappingURL=conn.js.map