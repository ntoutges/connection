import { Ids } from "./ids";
import { Listener } from "./listener";
import { TimeoutQueue } from "./timeoutQueue";

export type channelSendTypes = "send" | "request" | "response" | "control";
export type channelEvents = "request" | "message" | "_control" | "_forward";
export type channelMessage = {
  header: {
    id?: number
    type: channelSendTypes
    sender?: {
      origin: string
      path: string // string version of array containing id of all routers and original sender
    }
    recipient?: string // id of recipient // leave empty to broadcast to all
    channel?: string
  },
  data: string
};

export type channelMessageData = {
  req: {
    header: channelMessage["header"]
    data: channelMessage["data"]
    body: Record<string,any> // middleware will (eventually) modify this
  }
  res: {
    send: (data: string) => void
  } | null
}

export abstract class ConnectionBase<ClientType extends ClientBase<ChannelType>, ChannelType extends ChannelBase> {
  protected readonly clients = new Map<string, ClientType>();
  protected readonly middleware = new Map<string, (data: channelMessage) => any>()

  protected abstract createNewClient(id: string): ClientType;
  
  buildClient(id: string): ClientType {
    if (!this.clients.has(id)) this.clients.set(id, this.createNewClient(id));
    return this.clients.get(id);
  }
  getClient(id: string) {
    return this.clients.get(id) ?? null;
  }

  addMiddleware(name: string, middlewareCallback: (message: channelMessage) => any) {
    this.middleware.set(name, middlewareCallback);
  }

  runMiddleware(message: channelMessage) {
    const body: Record<string,any> = {};
    for (const [name, callback] of this.middleware) {
      try {
        body[name] = callback(message);
      }
      catch(err) {
        body[name] = null;
        // TODO: store these errors somewhere
      }
    }
    return body;
  }
}

export abstract class ClientBase<ChannelType extends ChannelBase> {
  readonly id: string;
  readonly conn: ConnectionBase<ClientBase<ChannelType>, ChannelType>;
  protected readonly channels = new Map<string, ChannelType>();
  // readonly sender = new Listener<"receive", string>;
  protected _routerId: string = null;
  
  readonly clients = new Map<string, Map<string, number>>();
  readonly subclientDist = new Map<string, {dist: number, client: string}>();
  readonly dmChannel: ChannelType;

  readonly listener = new Listener<"subclientadd", void>

  constructor(id: string, connection: ConnectionBase<ClientBase<ChannelType>, ChannelType>) {
    this.id = id;
    this.conn = connection;

    // this.sender.on("receive", this.onReceive.bind(this));
    this.dmChannel = this.buildChannel(`_${id}`);
  }

  set routerId(routerId: string) {
    if (!routerId) { this._routerId = null; }
    if (routerId == this._routerId) return; // unchanged

    // tell old router that this router is disconnecting
    if (this._routerId) {
      this.dmChannel.sendControlMessage({
        disconnect: this.id
      });
    }

    this._routerId = routerId;

    // tell new router about this router's connections
    if (this._routerId) {
      this.dmChannel.sendControlMessage({
        client: {
          id: this.id,
          mode: "set",
          subclients: Object.fromEntries(this.subclientDist)
        }
      });
    }
  }
  get routerId() { return this._routerId ?? null; }
  hasRouter() { return this._routerId != null; }

  abstract createNewChannel(id: string): ChannelType;
  buildChannel(id: string) {
    if (!this.channels.has(id)) this.channels.set(id, this.createNewChannel(id));   
    return this.channels.get(id);
  }

  private onReceive(msg: string) {
    try {
      const message = JSON.parse(msg) as channelMessage;

      if (!message.header) return; // no header
      const type = message.header.type as channelSendTypes;
      const channelId = message.header.channel as string;

      if (!type || !channelId) return; // ignore malformed message
      
      const messageData: channelMessageData = {
        req: {
          header: message.header,
          data: message.data,
          body: this.conn.runMiddleware(message)
        },
        res: null
      };

      switch (type) {
        case "control":
          try {
            this.handleControl(JSON.parse(message.data), message.header);
          }
          catch(err) {} // catch error to not stop program because of malformed message
          this.dmChannel.listener.trigger("_control", messageData);
          return;
        default:
          if ("recipient" in message.header && message.header.recipient != "" && message.header.recipient != this.id) {
            this.dmChannel.forward(message);
            this.dmChannel.listener.trigger("_forward", messageData);
            return;
          }
          break;
      }
      
      if (!this.channels.has(channelId)) return; // invalid channel (when it matters)

      const channel = this.channels.get(channelId);

      switch (type) {
        case "request":
          if (message?.header?.id) { // only do if non-malformed id
            // set "response" object of message data
            messageData.res = {
              send: channel.sendResponse.bind(channel, message)
            };

            channel.listener.trigger("request", messageData);
          }
          break;
        case "response":
          channel.respond(messageData);
          break;
        case "send":
          channel.listener.trigger("message", messageData);
          if (!("recipient" in message.header) || message.header.recipient == "") this.rebroadcast(message); // recipient doesn't matter
      }
      
      // channel.listener.trigger("all", messageData);
    }
    catch(err) {}; // ignore malformed message
  }

  private handleControl(control: Record<string, any>, header: channelMessage["header"]) {
    if (
      "client" in control
      && "id" in control.client
      && "mode" in control.client
      && "subclients" in control.client && typeof control.client.subclients == "object"
    ) {
      this.handleSubclientDiscovery(control, header);
    }

    if ("disconnect" in control) {
      const id = control.disconnect;
      if (this.clients.has(id)) this.clients.delete(id);
      this.recalculateMinDist();
    }
  }

  private handleSubclientDiscovery(control: Record<string, any>, header: channelMessage["header"]) {
    const clientId = control.client.id;
      if (!this.clients.has(clientId)) this.clients.set(clientId, new Map<string, number>());
      
      const subclientMap = this.clients.get(clientId);
      const mode = control.client.mode;
      const subclientsObj = control.client.subclients as Record<string,number>;
      
      let didAdd = false;
      switch (mode) {
        case "set":
          subclientMap.clear(); // empty out
          subclientMap.set(clientId, 1);
          // nobreak;
        case "add":
          for (const subclientId in subclientsObj) {
            const distance = subclientsObj[subclientId]+1;
            if (Number.isNaN(distance) || !Number.isFinite(distance)) continue; // ignore useless values
            subclientMap.set(subclientId, distance);
          }
          didAdd = true;
          break;
        case "del":
          for (const subclientId in subclientsObj) {
            subclientMap.delete(subclientId);
          }
          break;
      }

      this.recalculateMinDist();
      
      if (this._routerId) {
        const forwardedSubclients: Record<string,number> = {};
        forwardedSubclients[clientId] = 1;
        for (const subclientId in subclientsObj) {
          forwardedSubclients[subclientId] = subclientMap.get(subclientId);
        }

        this.dmChannel.sendControlMessage({
          client: {
            id: this.id,
            mode: mode,
            subclients: forwardedSubclients
          }
        }, header);
      }

      if (didAdd) this.listener.trigger("subclientadd");
  }

  protected recalculateMinDist() {
    const subclientMinDist = this.subclientDist;
    subclientMinDist.clear();

    for (const [clientId, subclients] of this.clients) {
      subclientMinDist.set(clientId, { dist: 1, client: clientId }); // add in direct clients

      // add in subclients
      for (const [subclientId, distance] of subclients) {
        if (!subclientMinDist.has(subclientId)) subclientMinDist.set(subclientId, { client: clientId, dist: distance });
        else {
          const oldDist = subclientMinDist.get(subclientId).dist;
          if (oldDist < distance) { // new distance is lesser
            subclientMinDist.set(subclientId, { dist: distance, client: clientId });
          }
        }
      }
    }
  }

  protected rebroadcast(message: channelMessage) {
    let pathArr = [];
    try {
      pathArr = JSON.parse(message.header.sender.path);
    }
    catch(err){}
    
    if (!Array.isArray(pathArr)) pathArr = []; // reset to empty array if not array

    if (this._routerId && !pathArr.includes(this._routerId)) {
      this.dmChannel.sendRaw(message, this._routerId);
    }
    for (const [clientId, subClients] of this.clients) {
      if (pathArr.includes(clientId)) continue; // ignore anyone in send path
      this.dmChannel.sendRaw(message, clientId);
    }
  }

  getClient(id: string) {
    if (this.clients.has(id) || id == this._routerId) return this.conn.getClient(id);
    return null;
  }

  // returns router and client ids
  static debug_getStructure<ChannelType extends ChannelBase>(client: ClientBase<ChannelType>) {
    const id = client.id;
    const clients = Object.keys(Object.fromEntries(client.subclientDist)).join(", ");

    const router = client.routerId ?? "null";

    let spaces = "".padEnd(id.length+2, " ");

    return `(${id}) router: ${router}\n${spaces} clients:[${clients}]`;
  }

  getSendClient(recipientId: string): string { // see if current client is a router whose clients (or their clients, etc)
    // comments go on structure of:
    //    A
    //   / \
    //  B  [C] <- recipientId
    
    if (recipientId == this.id) return this.id; // don't do anything; message is meant for self
    if (this.subclientDist.has(recipientId)) { // FOLLOW; A -> C
      return this.subclientDist.get(recipientId).client;
    }
    return this.routerId; // DISCOVERY; B -> A -> C
  }
}

export abstract class ChannelBase {
  protected readonly requestIds = new Ids();
  protected readonly requestResolves = new Map<number, (msg:channelMessageData) => void>();
  readonly id: string;
  readonly client: ClientBase<ChannelBase>;

  protected readonly sendQueue = new TimeoutQueue<[msg: string, recipientFunc: () => string]>(5000, (a,b) => a[0] === b[0] && a[1] === b[1] );

  readonly listener = new Listener<channelEvents, channelMessageData>();

  constructor(id: string, client: ClientBase<ChannelBase>) {
    this.id = id;
    this.client = client;
    this.client.listener.on("subclientadd", this.attemptEmptySendQueue.bind(this));
  }

  protected abstract doSend(msg: string, recipientId: string): void;

  // if recipientId is null, will send to ALL
  protected doSendTo(header: channelMessage["header"], data: channelMessage["data"], finalRecipientId: string) {
    if (finalRecipientId === null) {
      this.sendToRouter(header, data);
      this.sendToClients(header, data);
      return;
    }

    if (!("recipient" in header) || header.recipient != null) header.recipient = finalRecipientId; // set recipientId
    
    const recipientId = this.client.getSendClient(finalRecipientId);

    const msg = this.constructMessageString(header, data);
    if (recipientId === null) { // finalRecipient cannot be reached
      this.sendQueue.add([msg, this.client.getSendClient.bind(this.client, finalRecipientId)]); // undefined recipientId indicates to queue that value needs to be generated based on 
      return;
    }

    this.doSend(msg, recipientId);
  }

  protected constructMessageString(header: channelMessage["header"], data: channelMessage["data"]) {
    header = JSON.parse(JSON.stringify(header)); // create copy
    if (!header.sender) header.sender = { origin: null, path: "[]" };

    let senderArr = [];
    
    try { // try converting path string to array
      senderArr = JSON.parse(header.sender.path);
    }
    catch(err){}
    
    if (!Array.isArray(senderArr)) senderArr = []; // not array, so reset to empty array
    senderArr.push(this.client.id);
    header.sender.path = JSON.stringify(senderArr); // convert back to string, and save in path

    if (header.sender.origin == null) header.sender.origin = this.client.id; // set origin if not already
    if (!header.channel) header.channel = this.id;

    return JSON.stringify({
      header,
      data
    });
  }

  private sendToRouter(header: channelMessage["header"], data: channelMessage["data"]) {
    if (this.client.routerId) this.doSendTo(header, data, this.client.routerId); // only send if router exists 
  }

  private sendToClients(header: channelMessage["header"], data: channelMessage["data"]) {
    for (const [clientId, subClients] of this.client.clients) {
      this.doSendTo(header, data, clientId);
    }
  }

  // doSendTo, but stops if current client id already in header.sender.path
  protected doForwardTo(header: channelMessage["header"], data: channelMessage["data"], finalRecipientId: string = null) {
    const path = header?.sender?.path ?? null;
    if (path) {
      try {
        const pathArr = JSON.parse(path);
        if (Array.isArray(pathArr) && pathArr.includes(this.client.id)) return; // don't send, as it would be a repeat
      }
      catch(err) {}
    }
    this.doSendTo(header, data, finalRecipientId);
  }

  forward(message: channelMessage) {
    if (!("header" in message && "data" in message && "recipient" in message.header)) return; // invalid message
    this.doForwardTo(message.header, message.data, message.header.recipient);
  }

  sendRaw(message: channelMessage, recipientId?: string) {
    this.doSendTo(message.header, message.data, recipientId);
  }

  sendControlMessage(data: Record<string, any>, lastHeader?: channelMessage["header"]) {
    const header = lastHeader ?? {} as channelMessage["header"];
    header.type = "control";

    if (!lastHeader) this.doSendTo(header, JSON.stringify(data), this.client.routerId ?? undefined);
    else this.doForwardTo(header, JSON.stringify(data), this.client.routerId ?? undefined);
  }

  broadcast(data: string) {
    this.doSendTo({ type: "send", recipient: null }, data, null);
  }

  sendTo(data: string, finalRecipientId: string) {
    this.doSendTo({ type: "send" }, data, finalRecipientId);
  }

  request(data: string, finalRecipientId: string) {
    return new Promise<channelMessageData>((resolve, reject) => {
      const id = this.requestIds.generateId();
      
      this.doSendTo({ type: "request", id }, data, finalRecipientId);
      
      this.requestResolves.set(id, resolve);
    });
  }

  respond(message: channelMessageData) {
    if (!message.req.header.id) return; // no id, so invalid response
    
    const id = message.req.header.id;
    if (!this.requestIds.isInUse(id)) return; // id not in use

    this.requestResolves.get(id).call(this, message);
    this.requestResolves.delete(id);
  }

  sendResponse(message: channelMessage, data: string) {
    const finalRecipient = message.header.sender.origin;
    this.doSendTo({ type: "response", id: message.header.id }, data, finalRecipient);
  }

  private attemptEmptySendQueue() {
    this.sendQueue.forEach(([msg, recipientFunc]) => {
      const recipientId = recipientFunc();
      if (recipientId == null) return; // invalid id, so try again later

      // id is assumed valid
      this.sendQueue.delete([msg,recipientFunc]); // remove value from queue, as send is being attempted (and if failed, value will be added automatically again)
      this.doSend(msg, recipientId); // TODO: fix [recipientId] being undefined
    });
  }
}
