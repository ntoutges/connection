import { Saveable } from "../saveable/saveable.js";
import { Ids } from "./ids.js";
import { Listener } from "./listener.js";
import { SmartInterval } from "./smartInterval.js";
import { SmartTimeout } from "./smartTimeout.js";
import { TimeoutQueue } from "./timeoutQueue.js";

export type clientEvents = "subclientadd" | "readystatechange" | "receive" | "connect" | "disconnect" | "reconnect";
export type errEvents = "connection" | "unavailable" | "id";
export type channelSendTypes = "send" | "request" | "echo" | "response" | "control";
export type channelEvents = "request" | "message" | "echoA" | "echoB" | "_control" | "_forward";
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
    tags?: string // csv of tags that can indicate how to handle the message
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

export abstract class ConnectionBase<ClientType extends ClientBase<any,any>> extends Saveable<any> {
  protected readonly clients = new Map<string, ClientType>();
  protected readonly middleware = new Map<string, (data: channelMessage) => any>()

  protected abstract createNewClient(id: string, heartbeatInterval: number): ClientType;
  
  buildClient(id: string, heartbeatInterval:number=1000): ClientType {
    if (!this.clients.has(id)) this.clients.set(id, this.createNewClient(id, heartbeatInterval));
    return this.clients.get(id);
  }
  destroyClient(id: string) {
    if (!this.clients.has(id)) return;
    
    const client = this.clients.get(id);
    this.clients.delete(id);
    
    if (!client.isDestroyed) client.destroy();
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

  // loading non-parameters likely not required...
  load(state: Record<string,any>) {}
}

export abstract class ClientBase<ConnectionType extends ConnectionBase<any>, ChannelType extends ChannelBase<any>> {
  readonly id: string;
  readonly conn: ConnectionType;
  protected readonly channels = new Map<string, ChannelType>();
  // readonly sender = new Listener<"receive", string>;
  protected _routerId: string = null;
  
  readonly clients = new Map<string, Map<string, number>>();
  private onConnectCallback: (success: boolean) => void = null;

  private hasBlockedReconnect: boolean = false;
  readonly subclientDist = new Map<string, {dist: number, client: string}>();
  readonly clientHeartbeats = new Map<string, SmartTimeout>(); // being in this list implies the heartbeat is active
  
  readonly dmChannel: ChannelType;

  readonly listener = new Listener<clientEvents, string>();
  readonly errListener = new Listener<errEvents, { type: string, message: string }>();
  private readonly readyStates = new Set<string>();
  private _isDestroyed = false;

  readonly hbInterval: SmartInterval;

  constructor(id: string, connection: ConnectionType, heartbeatInterval: number) {
    this.id = id;
    this.conn = connection;

    // this.sender.on("receive", this.onReceive.bind(this));
    this.dmChannel = this.buildChannel(`_${id}`);
    this.listener.on("receive", this.onReceive.bind(this));

    this.hbInterval = new SmartInterval(this.sendHeartbeat.bind(this), heartbeatInterval);
    this.hbInterval.pause(); // don't run until ready

    this.listener.on("readystatechange", (id) => {
      if (id == this.id) {
        if (this.getReadyState(id)) this.hbInterval.play(); // ready, so start hb interval
        else this.hbInterval.pause(); // not ready, so do nothing
      }
    });

    this.listener.on("connect", (id) => {
      setTimeout(() => {
        this.dmChannel.sendControlMessage({
          hb: {
            id: this.id,
            interval: this.hbInterval.getInterval()
          }
        }, id); // send control message to all
      }, 1000); // need to figure out why this is needed...
    });

    // no success
    this.errListener.on("unavailable", () => {
      if (this.onConnectCallback) this.onConnectCallback(false);
    });
  }

  // if isReady == this.readyStates.has(id), set this.readyState... to !isReady, then back to isReady
  protected toggleReadyStateTo(id: string, isReady: boolean) {
    if (this.getReadyState(id) == isReady) this.setReadyState(id, !isReady);
    this.setReadyState(id, isReady);
  }

  protected setReadyState(id: string, isReady: boolean, doTriggerEvent: boolean = true) {
    const wasReady = this.readyStates.has(id);
    if (wasReady == isReady) return; // no change occurred
    if (isReady) { // connection created
      this.readyStates.add(id);
      if (id != this.id && doTriggerEvent) this.listener.trigger("connect", id);
    }
    else { // connection destroyed
      this.readyStates.delete(id);
      if (id != this.id && doTriggerEvent) this.listener.trigger("disconnect", id);
    }

    this.listener.trigger("readystatechange", id);
  }
  getReadyState(id: string) { return this.readyStates.has(id); }

  set routerId(routerId: string) {
    if (routerId == this._routerId) return; // unchanged

    // tell old router that this router is disconnecting
    if (this._routerId) {
      this.dmChannel.sendControlMessage({
        disconnect: this.id
      });
      const oldId = this._routerId;
      this.setReadyState(oldId, false, false); // no matter what, treat as disconnected (if fail, likely already disconnected)
      this.disconnectFrom(oldId).then(() => {})
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

      if (this.onConnectCallback) this.onConnectCallback(false); // indicate that previous conenction was unsuccessful
      this.onConnectCallback = this.onConnect.bind(this,routerId);
      this.connectTo(routerId, this.onConnectCallback);
    }
  }
  get routerId() { return this._routerId ?? null; }
  hasRouter() { return this._routerId != null; }

  private onConnect(routerId: string, success: boolean) {
    this.onConnectCallback = null;
    if (success) this.setReadyState(routerId, true);
    else {
      setTimeout(this.doDisconnect.bind(this, routerId), 1000);
    }
  }
  
  abstract connectTo(id: string, callback: (success: boolean) => void ): void; // using callback as a type of promise (kind of...)
  abstract disconnectFrom(id: string): Promise<boolean>;

  abstract createNewChannel(id: string): ChannelType;
  buildChannel(id: string) {
    if (!this.channels.has(id)) this.channels.set(id, this.createNewChannel(id));   
    return this.channels.get(id);
  }

  protected onReceive(msg: string) {
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

      const tags: string[] = message?.header?.tags?.split(",") ?? [];
      const origin = message.header.sender?.origin ?? null;
      if (origin != null) {
        this.resetHeartbeat(origin);
      }

      switch (type) {
        case "control":
          if (message.header && message.header.recipient != null && message.header.recipient != this.id) return; // Message not intended for this client
          
          try { this.handleControl(JSON.parse(message.data), message.header); }
          catch(err) {} // catch error to not stop program because of malformed message
          this.dmChannel.listener.trigger("_control", messageData);
          return;
        case "send":
          if (tags.includes("hb")) return; // hb flag signifies that message is not used for anything, so it can be safely ignored by the rest of the program
          break;
        case "request":
          if (!tags.includes("init") || !message?.header?.id || !origin) break; // non-init, or malformed id
          messageData.res = {
            send: this.dmChannel.sendResponse.bind(this.dmChannel, message)
          };

          {
            let oldReadyState = this.getReadyState(origin);

            this.setReadyState(origin, true, false);  // Allow for message to be sent
            this.dmChannel.sendResponse(message, message.data);
            this.setReadyState(origin, oldReadyState, false); // Reset ready state

          }
          return;
        case "response": 
        if (!tags.includes("init")) break;
        this.dmChannel.respond(messageData);
        return;
      }
      
      // forward to someone who probably knows the final recipient
      if ("recipient" in message.header && message.header.recipient != null && message.header.recipient != this.id) {
        this.dmChannel.forward(message);
        this.dmChannel.listener.trigger("_forward", messageData);
        return;
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

            if (!tags.includes("echo")) channel.listener.trigger("request", messageData); // only trigger if not echo request
            else {
              channel.listener.trigger("echoB", messageData);
              channel.sendResponse(message, message.data);
            }
          }
          break;
        case "response":
          channel.respond(messageData);
          if (tags.includes("echo")) channel.listener.trigger("echoA", messageData);
          break;
        case "send":
          channel.listener.trigger("message", messageData);
          if (!("recipient" in message.header) || message.header.recipient == null) this.rebroadcast(message); // recipient doesn't matter
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
      
      // Set ready state, if no other mechanism
      this.setReadyState(control.client.id, true);
    }

    if (
      "hb" in control
      && "id" in control.hb
      && "interval" in control.hb
    ) {
      const id = String(control.hb.id); // stringify in case not already
      let interval = parseInt(control.hb.interval) ?? 0;
      
      if (Number.isNaN(interval)) interval = 0;

      interval *= 3; // allow 3 missed messages before heartbeat declared dead

      if (interval > 0) { // only create new interval if non-zero
        if (!this.clientHeartbeats.has(id)) this.clientHeartbeats.set(id, new SmartTimeout(this.doDisconnect.bind(this,id), interval)); // create new entry
        else this.clientHeartbeats.get(id).timeout = interval; // update existing entry
      }
      else { // stop timeout
        if (this.clientHeartbeats.has(id)) this.clientHeartbeats.get(id).pause();
        this.clientHeartbeats.delete(id);
      }
    }

    if (
      "disconnect" in control
      && "id" in control.disconnect
    ) {
      const id = String(control.disconnect.id); // stringify in case not already
      this.doDisconnect(id);
    }
  }

  private doDisconnect(id: string) {
    this.killHeartbeat(id);
    this.clients.delete(id);
    this.recalculateMinDist();
    
    // NOTE: only try to reconnect to routers, clients will try automatically try to reconnect
    // diagram: A -> B
    // if [A] disconnects, both [A] and [B] will get a disconnect, so only [A] will need to try and reconnect
    if (id == this._routerId) {
      this.routerId = null;

      this.listener.trigger("reconnect", id);
      if (this.hasBlockedReconnect) { // don't do reconnect
        this.hasBlockedReconnect = false; // reset value
        return;
      }

      // attempt reconnect
      this.routerId = id;
    }
    else { // manual disconnect
      this.disconnectFrom(id);
      this.setReadyState(id, false); // also triggers disconnect event3
    }
  }

  /**
   * Call this function when the "reconnect" event fired, to prevent reconnect process
   * This does nothing, otherwise
   */
  blockReconnect() {
    this.hasBlockedReconnect = true;
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
        }, null, header);
      }

      if (didAdd) this.listener.trigger("subclientadd", "");
  }

  protected recalculateMinDist() {
    this.subclientDist.clear();

    for (const [clientId, subclients] of this.clients) {
      this.subclientDist.set(clientId, { dist: 1, client: clientId }); // add in direct clients

      // add in subclients
      for (const [subclientId, distance] of subclients) {
        if (!this.subclientDist.has(subclientId)) this.subclientDist.set(subclientId, { client: clientId, dist: distance });
        else {
          const oldDist = this.subclientDist.get(subclientId).dist;
          if (oldDist < distance) { // new distance is lesser
            this.subclientDist.set(subclientId, { dist: distance, client: clientId });
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

    this.dmChannel.forward(message);
  }

  // returns router and client ids
  static debug_getStructure(client: ClientBase<any,any>) {
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

  private sendHeartbeat() {
    if (this.routerId) this.dmChannel.sendHeartbeat(this.routerId); // alert router (if it exists) that this client is still responsive
    for (const [clientId, subclients] of this.clients) {
      this.dmChannel.sendHeartbeat(clientId); // alert clients that router still exists
    }
  }

  private resetHeartbeat(id: string) {
    this.clientHeartbeats.get(id)?.restart();
  }

  private killHeartbeat(id: string) {
    if (this.clientHeartbeats.has(id)) {
      this.clientHeartbeats.get(id).pause(); // stop timoeut
      this.clientHeartbeats.delete(id);
    }
  }

  async destroy() {
    this.routerId = null; // disconnect from router
    
    const promises: Promise<boolean>[] = [];
    this.clients.forEach((_, clientId) => {
      promises.push(this.disconnectFrom(clientId));
    });
    
    this.listener.clear()
    await this.destroyClient();
    this.conn.destroyClient(this.id);
  }

  protected abstract destroyClient(): Promise<void>;

  get isDestroyed() { return this._isDestroyed; }
}

export abstract class ChannelBase<ClientType extends ClientBase<any,any>> {
  protected readonly requestIds = new Ids();
  protected readonly requestResolves = new Map<number, (msg:channelMessageData) => void>();
  readonly id: string;
  readonly client: ClientType;

  protected readonly sendQueue = new TimeoutQueue<[msg: string, recipientFunc: () => string]>(5000, (a,b) => a[0] === b[0] && a[1] === b[1] );

  readonly listener = new Listener<channelEvents, channelMessageData>();

  constructor(id: string, client: ClientType) {
    this.id = id;
    this.client = client;
    this.client.listener.on("subclientadd", this.attemptEmptySendQueue.bind(this));
    this.client.listener.on("readystatechange", this.onReadyStateChange.bind(this));
  }

  broadcast(data: string, tags: string = "") { // tags in the form of csv
    this.doSendTo({ type: "send", recipient: null }, data, null);
  }

  sendTo(data: string, finalRecipientId: string, tags: string = "") { // tags in the form of csv
    this.doSendTo({ type: "send", tags }, data, finalRecipientId);
  }

  request(data: string, finalRecipientId: string, timeout: number = null, tags: string = "") { // tags in the form of csv
    return new Promise<channelMessageData>((resolve, reject) => {
      let timeoutId: number = null;
      const id = this.initRequest((value) => {
        clearTimeout(timeoutId); // Stop timeout from running
        resolve(value);
      });
      this.doSendTo({ type: "request", id, tags }, data, finalRecipientId);

      // After some time, assume connection failed
      if (timeout !== null && timeout > 0) {
        timeoutId = setTimeout(() => {
          this.cancelRequest(id);
          reject();
        }, timeout);
      }
    });
  }

  sendHeartbeat(finalRecipientId: string) {
    this.sendTo("", finalRecipientId, "hb");
  }

  echo(data: string, finalRecipientId: string, timeout?: number, tags: string = "") {
    // Combine tags
    let fullTags = "echo";
    if (tags) fullTags += "," + tags;

    // Echo is just a request in disguise
    return this.request(data, finalRecipientId, timeout, fullTags);
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
    
    let path = [];
    if (("sender" in header)) {
      try { path = JSON.parse(header.sender.path); }
      catch(err) { // invalid path; reset
        header.sender.path = "[]";
        path = [];
      }
    }
    
    if (path.includes(finalRecipientId)) return; // recipient has already recieved message; don't need to send again

    const recipientId = this.client.getSendClient(finalRecipientId);
    if (path.includes(recipientId)) return; // recipient has already recieved message; don't need to send again

    const msg = this.constructMessageString(header, data);
    if (
      !this.client.getReadyState(this.client.id) // client not yet ready to send
      || recipientId === null // finalRecipient cannot be reached
      || !this.client.getReadyState(recipientId) // client cannot yet communicate with 'recipientId'
    ) {
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

  // doSendTo, but stops if current client id already in header.sender.path // aka: useless
  // protected doForwardTo(header: channelMessage["header"], data: channelMessage["data"], finalRecipientId: string = null) {
  //   const path = header?.sender?.path ?? null;
  //   if (path) {
  //     try {
  //       const pathArr = JSON.parse(path);
  //       if (Array.isArray(pathArr) && pathArr.includes(this.client.id)) console.log("STOP")
  //       if (Array.isArray(pathArr) && pathArr.includes(this.client.id)) return; // don't send, as it would be a repeat
  //     }
  //     catch(err) {}
  //   }
  //   this.doSendTo(header, data, finalRecipientId);
  // }

  forward(message: channelMessage) {
    if (!("header" in message && "data" in message && "recipient" in message.header)) return; // invalid message
    this.doSendTo(message.header, message.data, message.header.recipient);
  }

  sendControlMessage(data: Record<string, any>, finalRecipientId:string=null, lastHeader?: channelMessage["header"]) {
    if (finalRecipientId === null) { 
      finalRecipientId = this.client.routerId; // invalid id, so try router
      if (finalRecipientId === null) return; // router doesn't exist, so give up
    }

    const header = lastHeader ?? {} as channelMessage["header"];
    header.type = "control";
    
    if (!lastHeader) this.doSendTo(header, JSON.stringify(data), finalRecipientId);
    else this.doSendTo(header, JSON.stringify(data), finalRecipientId);
  }

  private initRequest(resolve: (value: channelMessageData) => void) {
    const id = this.requestIds.generateId();
    this.requestResolves.set(id, resolve);
    return id;
  }

  private cancelRequest(id: number) {
    this.requestResolves.delete(id);
    this.requestIds.releaseId(id);
  }

  respond(message: channelMessageData) {
    if (!message.req.header.id) return; // no id, so invalid response
    
    const id = message.req.header.id;
    if (!this.requestIds.isInUse(id)) return; // id not in use
    this.requestIds.releaseId(id);

    this.requestResolves.get(id).call(this, message);
    this.requestResolves.delete(id);
  }

  sendResponse(message: channelMessage, data: string) {
    const finalRecipient = message.header.sender.origin;
    const tags = message.header.tags ?? "";
    this.doSendTo({ type: "response", id: message.header.id, tags }, data, finalRecipient);
  }

  private attemptEmptySendQueue() {
    const toDelete: [msg: string, recipientFunc: () => string][] = [];
    this.sendQueue.forEach(([msg, recipientFunc]) => {
      const recipientId = recipientFunc();
      if (
        recipientId == null // invalid id
        || !this.client.getReadyState(recipientId) // client connection not yet ready
      ) return; // try again later

      // id is assumed valid
      toDelete.push([msg,recipientFunc]); // remove value from queue, as send is being attempted (and if failed, value will be added automatically again)
      this.doSend(msg, recipientId); // TODO: fix [recipientId] being undefined
    });

    for (const item of toDelete) { this.sendQueue.delete(item); }
  }

  private onReadyStateChange(id: string) {
    if (this.client.getReadyState(id)) { // ready state set to true
      this.attemptEmptySendQueue();
    }
  }
}
