import { ChannelBase, ClientBase, ConnectionBase } from "../connBase.js";
import { Listener } from "../listener.js";

export class LocalConnection extends ConnectionBase<LocalClient> {
  protected createNewClient(id: string): LocalClient { return new LocalClient(id,this); }
}

export class LocalClient extends ClientBase<LocalConnection, LocalChannel> {
  constructor(id: string, connection: LocalConnection) {
    super(id, connection);

    this.setReadyState(this.id, true)
  }
  
  createNewChannel(id: string): LocalChannel { return new LocalChannel(id, this); }

  getClient(id: string) {
    if (this.clients.has(id) || id == this._routerId) return this.conn.getClient(id);
    return null;
  }

  async connectTo(id: string) {
    const otherClient = this.conn.getClient(id);
    if (!otherClient) return false;

    otherClient.acceptConnection(this.id);
    return true;
  }

  // TODO: make this do something...
  async disconnectFrom(id: string) { return true; } // always assume success

  acceptConnection(id: string) { this.setReadyState(id, true); }
}

export class LocalChannel extends ChannelBase<LocalConnection, LocalClient> {
  protected doSend(msg: string, recipientId: string) {
    const recipient = this.client.getClient(recipientId)
    if (!recipient) { // no one to send to, so push to queue
      this.sendQueue.add([msg, () => recipientId]);
      return;
    }

    setTimeout(() => { // emulate sending over data channel
      recipient.listener.trigger("receive", msg);
    }, 100);
  }
}
