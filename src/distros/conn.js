import { ChannelBase, ClientBase, ConnectionBase } from "../connBase.js";
import { Listener } from "../listener.js";
export class LocalConnection extends ConnectionBase {
    createNewClient(id) { return new LocalClient(id, this); }
}
export class LocalClient extends ClientBase {
    sender = new Listener;
    listener = new Listener;
    constructor(id, connection) {
        super(id, connection);
        this.sender.on("receive", this.onReceive.bind(this));
    }
    createNewChannel(id) { return new LocalChannel(id, this); }
}
export class LocalChannel extends ChannelBase {
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
//# sourceMappingURL=conn.js.map