import { ChannelBase, ClientBase, ConnectionBase, channelEvents, channelMessage, channelMessageData, channelSendTypes } from "./connBase";
import { Ids } from "./ids";
import { Listener } from "./listener";
import { TimeoutQueue } from "./timeoutQueue";

export class LocalConnection extends ConnectionBase<LocalClient> {
  protected createNewClient(id: string): LocalClient { return new LocalClient(id,this); }
}

export class LocalClient extends ClientBase<LocalConnection, LocalChannel> {
  readonly sender = new Listener<"receive", string>;
  readonly listener = new Listener<"subclientadd", void>

  constructor(id: string, connection: LocalConnection) {
    super(id, connection);

    this.sender.on("receive", this.onReceive.bind(this));
  }
  
  createNewChannel(id: string): LocalChannel { return new LocalChannel(id, this); }
}

export class LocalChannel extends ChannelBase<LocalConnection, LocalClient> {
  protected doSend(msg: string, recipientId: string) {
    const recipient = this.client.getClient(recipientId)
    if (!recipient) { // no one to send to, so push to queue
      this.sendQueue.add([msg, () => recipientId]);
      return;
    }

    setTimeout(() => { // emulate sending over data channel
      recipient.sender.trigger("receive", msg);
    }, 100);
  }
}
