import { Ids } from "./ids.js";
import { Listener } from "./listener.js";

export type channelSendTypes = "send" | "request" | "echo" | "response" | "control";
export type connProtocolReceive =  {
  header: {
    id?: number;
    type: channelSendTypes;
    sender?: {
        origin: string;
        path: string;
    };
    recipient?: string;
    channel?: string;
    tags?: string;
  }
  data: string;
};

export type channelMessageData = {
  req: {
    header: connProtocolReceive["header"]
    data: connProtocolReceive["data"]
    body: Record<string,any> // middleware will (eventually) modify this
  }
  res: {
    send: (data: string) => void
  } | null
}

export abstract class ProtocolBase {
  protected readonly requestIds = new Ids();
  protected readonly requestResolves = new Map<number, (msg: channelMessageData) => void>();
  readonly listener = new Listener<"serialize" | "deserialize", connProtocolReceive | [msg: string, recipientId: string]>();
  
  /**
   * Call to serialize message object into a string, which can be sent over the connection.\
   * This should trigger a 'serialize' event whne finished.
   * @param message           The data to be transmitted
   * @param finalRecipientIds The client to send data to
   */
  abstract serialize(message: connProtocolReceive, recipientId: string): void;
  
  /**
   * Call to convert a message string back into a message object.\
   * This should trigger a "deserialize" event to indicate deserialization has finished
   * @param msg The data received from the connection
   */
  abstract deserialize(msg: string): void;
}