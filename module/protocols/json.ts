import { ProtocolBase, connProtocolReceive } from "../protocolBase.js";

export class JSONProtocol extends ProtocolBase {
  constructor() {
    super();
  }

  serialize(message: connProtocolReceive, recipientId: string) {
    let msg = null;

    // Attempt to convert message object to string
    try { msg = JSON.stringify(message); }
    catch(_) {}

    // Finished serializing
    if (msg != null) this.listener.trigger("serialize", [msg, recipientId]);
  }

  deserialize(msg: string) {
    let message = null;

    // Attempt to convert message string to object
    try { message = JSON.parse(msg); }
    catch(_) {}

    // Invalid message
    if (message == null || typeof message != "object" || !message.hasOwnProperty("data") || !message.hasOwnProperty("header")) return;

    // Force received message into a specific form
    this.listener.trigger("deserialize", {
      data: message.data,
      header: {
        type: message.header.type,
        channel: message.header.channel,
        id: message.header.id,
        recipient: message.header.recipient,
        sender: message.header.sender,
        tags: message.header.tags
      }
    });
  }
}