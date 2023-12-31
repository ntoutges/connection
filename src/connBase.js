"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChannelBase = exports.ClientBase = exports.ConnectionBase = void 0;
const ids_1 = require("./ids");
const listener_1 = require("./listener");
const timeoutQueue_1 = require("./timeoutQueue");
class ConnectionBase {
    clients = new Map();
    middleware = new Map();
    buildClient(id) {
        if (!this.clients.has(id))
            this.clients.set(id, this.createNewClient(id));
        return this.clients.get(id);
    }
    getClient(id) {
        return this.clients.get(id) ?? null;
    }
    addMiddleware(name, middlewareCallback) {
        this.middleware.set(name, middlewareCallback);
    }
    runMiddleware(message) {
        const body = {};
        for (const [name, callback] of this.middleware) {
            try {
                body[name] = callback(message);
            }
            catch (err) {
                body[name] = null;
                // TODO: store these errors somewhere
            }
        }
        return body;
    }
}
exports.ConnectionBase = ConnectionBase;
class ClientBase {
    id;
    conn;
    channels = new Map();
    // readonly sender = new Listener<"receive", string>;
    _routerId = null;
    clients = new Map();
    subclientDist = new Map();
    dmChannel;
    listener = new listener_1.Listener;
    constructor(id, connection) {
        this.id = id;
        this.conn = connection;
        // this.sender.on("receive", this.onReceive.bind(this));
        this.dmChannel = this.buildChannel(`_${id}`);
    }
    set routerId(routerId) {
        if (!routerId) {
            this._routerId = null;
        }
        if (routerId == this._routerId)
            return; // unchanged
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
    buildChannel(id) {
        if (!this.channels.has(id))
            this.channels.set(id, this.createNewChannel(id));
        return this.channels.get(id);
    }
    onReceive(msg) {
        try {
            const message = JSON.parse(msg);
            if (!message.header)
                return; // no header
            const type = message.header.type;
            const channelId = message.header.channel;
            if (!type || !channelId)
                return; // ignore malformed message
            const messageData = {
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
                    catch (err) { } // catch error to not stop program because of malformed message
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
            if (!this.channels.has(channelId))
                return; // invalid channel (when it matters)
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
                    if (!("recipient" in message.header) || message.header.recipient == "")
                        this.rebroadcast(message); // recipient doesn't matter
            }
            // channel.listener.trigger("all", messageData);
        }
        catch (err) { }
        ; // ignore malformed message
    }
    handleControl(control, header) {
        if ("client" in control
            && "id" in control.client
            && "mode" in control.client
            && "subclients" in control.client && typeof control.client.subclients == "object") {
            this.handleSubclientDiscovery(control, header);
        }
        if ("disconnect" in control) {
            const id = control.disconnect;
            if (this.clients.has(id))
                this.clients.delete(id);
            this.recalculateMinDist();
        }
    }
    handleSubclientDiscovery(control, header) {
        const clientId = control.client.id;
        if (!this.clients.has(clientId))
            this.clients.set(clientId, new Map());
        const subclientMap = this.clients.get(clientId);
        const mode = control.client.mode;
        const subclientsObj = control.client.subclients;
        let didAdd = false;
        switch (mode) {
            case "set":
                subclientMap.clear(); // empty out
                subclientMap.set(clientId, 1);
            // nobreak;
            case "add":
                for (const subclientId in subclientsObj) {
                    const distance = subclientsObj[subclientId] + 1;
                    if (Number.isNaN(distance) || !Number.isFinite(distance))
                        continue; // ignore useless values
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
            const forwardedSubclients = {};
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
        if (didAdd)
            this.listener.trigger("subclientadd");
    }
    recalculateMinDist() {
        const subclientMinDist = this.subclientDist;
        subclientMinDist.clear();
        for (const [clientId, subclients] of this.clients) {
            subclientMinDist.set(clientId, { dist: 1, client: clientId }); // add in direct clients
            // add in subclients
            for (const [subclientId, distance] of subclients) {
                if (!subclientMinDist.has(subclientId))
                    subclientMinDist.set(subclientId, { client: clientId, dist: distance });
                else {
                    const oldDist = subclientMinDist.get(subclientId).dist;
                    if (oldDist < distance) { // new distance is lesser
                        subclientMinDist.set(subclientId, { dist: distance, client: clientId });
                    }
                }
            }
        }
    }
    rebroadcast(message) {
        let pathArr = [];
        try {
            pathArr = JSON.parse(message.header.sender.path);
        }
        catch (err) { }
        if (!Array.isArray(pathArr))
            pathArr = []; // reset to empty array if not array
        if (this._routerId && !pathArr.includes(this._routerId)) {
            this.dmChannel.sendRaw(message, this._routerId);
        }
        for (const [clientId, subClients] of this.clients) {
            if (pathArr.includes(clientId))
                continue; // ignore anyone in send path
            this.dmChannel.sendRaw(message, clientId);
        }
    }
    getClient(id) {
        if (this.clients.has(id) || id == this._routerId)
            return this.conn.getClient(id);
        return null;
    }
    // returns router and client ids
    static debug_getStructure(client) {
        const id = client.id;
        const clients = Object.keys(Object.fromEntries(client.subclientDist)).join(", ");
        const router = client.routerId ?? "null";
        let spaces = "".padEnd(id.length + 2, " ");
        return `(${id}) router: ${router}\n${spaces} clients:[${clients}]`;
    }
    getSendClient(recipientId) {
        // comments go on structure of:
        //    A
        //   / \
        //  B  [C] <- recipientId
        if (recipientId == this.id)
            return this.id; // don't do anything; message is meant for self
        if (this.subclientDist.has(recipientId)) { // FOLLOW; A -> C
            return this.subclientDist.get(recipientId).client;
        }
        return this.routerId; // DISCOVERY; B -> A -> C
    }
}
exports.ClientBase = ClientBase;
class ChannelBase {
    requestIds = new ids_1.Ids();
    requestResolves = new Map();
    id;
    client;
    sendQueue = new timeoutQueue_1.TimeoutQueue(5000, (a, b) => a[0] === b[0] && a[1] === b[1]);
    listener = new listener_1.Listener();
    constructor(id, client) {
        this.id = id;
        this.client = client;
        this.client.listener.on("subclientadd", this.attemptEmptySendQueue.bind(this));
    }
    // if recipientId is null, will send to ALL
    doSendTo(header, data, finalRecipientId) {
        if (finalRecipientId === null) {
            this.sendToRouter(header, data);
            this.sendToClients(header, data);
            return;
        }
        if (!("recipient" in header) || header.recipient != null)
            header.recipient = finalRecipientId; // set recipientId
        const recipientId = this.client.getSendClient(finalRecipientId);
        const msg = this.constructMessageString(header, data);
        if (recipientId === null) { // finalRecipient cannot be reached
            this.sendQueue.add([msg, this.client.getSendClient.bind(this.client, finalRecipientId)]); // undefined recipientId indicates to queue that value needs to be generated based on 
            return;
        }
        this.doSend(msg, recipientId);
    }
    constructMessageString(header, data) {
        header = JSON.parse(JSON.stringify(header)); // create copy
        if (!header.sender)
            header.sender = { origin: null, path: "[]" };
        let senderArr = [];
        try { // try converting path string to array
            senderArr = JSON.parse(header.sender.path);
        }
        catch (err) { }
        if (!Array.isArray(senderArr))
            senderArr = []; // not array, so reset to empty array
        senderArr.push(this.client.id);
        header.sender.path = JSON.stringify(senderArr); // convert back to string, and save in path
        if (header.sender.origin == null)
            header.sender.origin = this.client.id; // set origin if not already
        if (!header.channel)
            header.channel = this.id;
        return JSON.stringify({
            header,
            data
        });
    }
    sendToRouter(header, data) {
        if (this.client.routerId)
            this.doSendTo(header, data, this.client.routerId); // only send if router exists 
    }
    sendToClients(header, data) {
        for (const [clientId, subClients] of this.client.clients) {
            this.doSendTo(header, data, clientId);
        }
    }
    // doSendTo, but stops if current client id already in header.sender.path
    doForwardTo(header, data, finalRecipientId = null) {
        const path = header?.sender?.path ?? null;
        if (path) {
            try {
                const pathArr = JSON.parse(path);
                if (Array.isArray(pathArr) && pathArr.includes(this.client.id))
                    return; // don't send, as it would be a repeat
            }
            catch (err) { }
        }
        this.doSendTo(header, data, finalRecipientId);
    }
    forward(message) {
        if (!("header" in message && "data" in message && "recipient" in message.header))
            return; // invalid message
        this.doForwardTo(message.header, message.data, message.header.recipient);
    }
    sendRaw(message, recipientId) {
        this.doSendTo(message.header, message.data, recipientId);
    }
    sendControlMessage(data, lastHeader) {
        const header = lastHeader ?? {};
        header.type = "control";
        if (!lastHeader)
            this.doSendTo(header, JSON.stringify(data), this.client.routerId ?? undefined);
        else
            this.doForwardTo(header, JSON.stringify(data), this.client.routerId ?? undefined);
    }
    broadcast(data) {
        this.doSendTo({ type: "send", recipient: null }, data, null);
    }
    sendTo(data, finalRecipientId) {
        this.doSendTo({ type: "send" }, data, finalRecipientId);
    }
    request(data, finalRecipientId) {
        return new Promise((resolve, reject) => {
            const id = this.requestIds.generateId();
            this.doSendTo({ type: "request", id }, data, finalRecipientId);
            this.requestResolves.set(id, resolve);
        });
    }
    respond(message) {
        if (!message.req.header.id)
            return; // no id, so invalid response
        const id = message.req.header.id;
        if (!this.requestIds.isInUse(id))
            return; // id not in use
        this.requestResolves.get(id).call(this, message);
        this.requestResolves.delete(id);
    }
    sendResponse(message, data) {
        const finalRecipient = message.header.sender.origin;
        this.doSendTo({ type: "response", id: message.header.id }, data, finalRecipient);
    }
    attemptEmptySendQueue() {
        this.sendQueue.forEach(([msg, recipientFunc]) => {
            const recipientId = recipientFunc();
            if (recipientId == null)
                return; // invalid id, so try again later
            // id is assumed valid
            this.sendQueue.delete([msg, recipientFunc]); // remove value from queue, as send is being attempted (and if failed, value will be added automatically again)
            this.doSend(msg, recipientId); // TODO: fix [recipientId] being undefined
        });
    }
}
exports.ChannelBase = ChannelBase;
//# sourceMappingURL=connBase.js.map