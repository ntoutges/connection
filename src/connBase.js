import { Ids } from "./ids.js";
import { Listener } from "./listener.js";
import { SmartInterval } from "./smartInterval.js";
import { SmartTimeout } from "./smartTimeout.js";
import { TimeoutQueue } from "./timeoutQueue.js";
export class ConnectionBase {
    clients = new Map();
    middleware = new Map();
    buildClient(id, heartbeatInterval = 1000) {
        if (!this.clients.has(id))
            this.clients.set(id, this.createNewClient(id, heartbeatInterval));
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
export class ClientBase {
    id;
    conn;
    channels = new Map();
    // readonly sender = new Listener<"receive", string>;
    _routerId = null;
    clients = new Map();
    hasBlockedReconnect = false;
    subclientDist = new Map();
    clientHeartbeats = new Map(); // being in this list implies the heartbeat is active
    dmChannel;
    listener = new Listener;
    readyStates = new Set();
    hbInterval;
    constructor(id, connection, heartbeatInterval) {
        this.id = id;
        this.conn = connection;
        // this.sender.on("receive", this.onReceive.bind(this));
        this.dmChannel = this.buildChannel(`_${id}`);
        this.listener.on("receive", this.onReceive.bind(this));
        this.hbInterval = new SmartInterval(this.sendHeartbeat.bind(this), heartbeatInterval);
        this.hbInterval.pause(); // don't run until ready
        this.listener.on("readystatechange", (id) => {
            if (id == this.id) {
                if (this.getReadyState(id))
                    this.hbInterval.play(); // ready, so start hb interval
                else
                    this.hbInterval.pause(); // not ready, so do nothing
            }
        });
        this.listener.on("connect", (id) => {
            this.dmChannel.sendControlMessage({
                hb: {
                    id: this.id,
                    interval: this.hbInterval.interval
                }
            }, id); // send control message to all
        });
    }
    setReadyState(id, isReady, doTriggerEvent = true) {
        const wasReady = this.readyStates.has(id);
        if (wasReady == isReady)
            return; // no change occurred
        if (isReady) { // connection created
            this.readyStates.add(id);
            if (id != this.id && doTriggerEvent)
                this.listener.trigger("connect", id);
        }
        else { // connection destroyed
            this.readyStates.delete(id);
            if (id != this.id && doTriggerEvent)
                this.listener.trigger("disconnect", id);
        }
        this.listener.trigger("readystatechange", id);
    }
    getReadyState(id) { return this.readyStates.has(id); }
    set routerId(routerId) {
        if (routerId == this._routerId)
            return; // unchanged
        // tell old router that this router is disconnecting
        if (this._routerId) {
            this.dmChannel.sendControlMessage({
                disconnect: this.id
            });
            const oldId = this._routerId;
            this.disconnectFrom(oldId).then(success => {
                this.setReadyState(oldId, false, false); // no matter what, treat as disconnected (if fail, likely already disconnected)
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
            this.connectTo(routerId).then(success => {
                if (success)
                    this.setReadyState(routerId, true);
                else
                    console.log("failed to connect");
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
            const tags = message?.header?.tags?.split(",") ?? [];
            const origin = message.header.sender?.origin ?? null;
            if (origin != null) {
                this.resetHeartbeat(origin);
            }
            switch (type) {
                case "control":
                    try {
                        this.handleControl(JSON.parse(message.data), message.header);
                    }
                    catch (err) { } // catch error to not stop program because of malformed message
                    this.dmChannel.listener.trigger("_control", messageData);
                    return;
                case "send":
                    if (tags.includes("hb"))
                        return; // hb flag signifies that message is not used for anything, so it can be safely ignored by the rest of the program
                    break;
            }
            // forward to someone who probably knows the final recipient
            if ("recipient" in message.header && message.header.recipient != null && message.header.recipient != this.id) {
                this.dmChannel.forward(message);
                this.dmChannel.listener.trigger("_forward", messageData);
                return;
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
                        if (!tags.includes("echo"))
                            channel.listener.trigger("request", messageData); // only trigger if not echo request
                        else {
                            channel.listener.trigger("echoB", messageData);
                            channel.sendResponse(message, message.data);
                        }
                    }
                    break;
                case "response":
                    channel.respond(messageData);
                    if (tags.includes("echo"))
                        channel.listener.trigger("echoA", messageData);
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
        if ("hb" in control
            && "id" in control.hb
            && "interval" in control.hb) {
            const id = String(control.hb.id); // stringify in case not already
            let interval = parseInt(control.hb.interval) ?? 0;
            if (Number.isNaN(interval))
                interval = 0;
            interval *= 3; // allow 3 missed messages before heartbeat declared dead
            if (interval > 0) { // only create new interval if non-zero
                if (!this.clientHeartbeats.has(id))
                    this.clientHeartbeats.set(id, new SmartTimeout(this.doDisconnect.bind(this, id), interval)); // create new entry
                else
                    this.clientHeartbeats.get(id).timeout = interval; // update existing entry
            }
            else { // stop timeout
                if (this.clientHeartbeats.has(id))
                    this.clientHeartbeats.get(id).pause();
                this.clientHeartbeats.delete(id);
            }
        }
        if ("disconnect" in control
            && "id" in control.disconnect) {
            const id = String(control.disconnect.id); // stringify in case not already
            this.doDisconnect(id);
        }
    }
    doDisconnect(id) {
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
            }, null, header);
        }
        if (didAdd)
            this.listener.trigger("subclientadd", "");
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
            this.dmChannel.forward(message);
        }
        for (const [clientId, subClients] of this.clients) {
            if (pathArr.includes(clientId))
                continue; // ignore anyone in send path
            this.dmChannel.forward(message);
        }
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
    sendHeartbeat() {
        if (this.routerId)
            this.dmChannel.sendHeartbeat(this.routerId); // alert router (if it exists) that this client is still responsive
        for (const [clientId, subclients] of this.clients) {
            this.dmChannel.sendHeartbeat(clientId); // alert clients that router still exists
        }
    }
    resetHeartbeat(id) {
        this.clientHeartbeats.get(id)?.restart();
    }
    killHeartbeat(id) {
        if (this.clientHeartbeats.has(id)) {
            this.clientHeartbeats.get(id).pause(); // stop timoeut
            this.clientHeartbeats.delete(id);
        }
    }
}
export class ChannelBase {
    requestIds = new Ids();
    requestResolves = new Map();
    id;
    client;
    sendQueue = new TimeoutQueue(5000, (a, b) => a[0] === b[0] && a[1] === b[1]);
    listener = new Listener();
    constructor(id, client) {
        this.id = id;
        this.client = client;
        this.client.listener.on("subclientadd", this.attemptEmptySendQueue.bind(this));
        this.client.listener.on("readystatechange", this.onReadyStateChange.bind(this));
    }
    broadcast(data, tags = "") {
        this.doSendTo({ type: "send", recipient: null }, data, null);
    }
    sendTo(data, finalRecipientId, tags = "") {
        this.doSendTo({ type: "send", tags }, data, finalRecipientId);
    }
    request(data, finalRecipientId, tags = "") {
        return new Promise((resolve, reject) => {
            const id = this.initRequest(resolve);
            this.doSendTo({ type: "request", id, tags }, data, finalRecipientId);
        });
    }
    sendHeartbeat(finalRecipientId) {
        this.sendTo("", finalRecipientId, "hb");
    }
    echo(data, finalRecipientId) {
        return this.request(data, finalRecipientId, "echo");
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
        if (!this.client.getReadyState(this.client.id) // client not yet ready to send
            || recipientId === null // finalRecipient cannot be reached
            || !this.client.getReadyState(recipientId) // client cannot yet communicate with 'recipientId'
        ) {
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
    sendControlMessage(data, finalRecipientId = null, lastHeader) {
        if (finalRecipientId === null) {
            finalRecipientId = this.client.routerId; // invalid id, so try router
            if (finalRecipientId === null)
                return; // router doesn't exist, so give up
        }
        const header = lastHeader ?? {};
        header.type = "control";
        if (!lastHeader)
            this.doSendTo(header, JSON.stringify(data), finalRecipientId);
        else
            this.doForwardTo(header, JSON.stringify(data), finalRecipientId);
    }
    initRequest(resolve) {
        const id = this.requestIds.generateId();
        this.requestResolves.set(id, resolve);
        return id;
    }
    respond(message) {
        if (!message.req.header.id)
            return; // no id, so invalid response
        const id = message.req.header.id;
        if (!this.requestIds.isInUse(id))
            return; // id not in use
        this.requestIds.releaseId(id);
        this.requestResolves.get(id).call(this, message);
        this.requestResolves.delete(id);
    }
    sendResponse(message, data) {
        const finalRecipient = message.header.sender.origin;
        const tags = message.header.tags ?? "";
        this.doSendTo({ type: "response", id: message.header.id, tags }, data, finalRecipient);
    }
    attemptEmptySendQueue() {
        const toDelete = [];
        this.sendQueue.forEach(([msg, recipientFunc]) => {
            const recipientId = recipientFunc();
            if (recipientId == null // invalid id
                || !this.client.getReadyState(recipientId) // client connection not yet ready
            )
                return; // try again later
            // id is assumed valid
            toDelete.push([msg, recipientFunc]); // remove value from queue, as send is being attempted (and if failed, value will be added automatically again)
            this.doSend(msg, recipientId); // TODO: fix [recipientId] being undefined
        });
        for (const item of toDelete) {
            this.sendQueue.delete(item);
        }
    }
    onReadyStateChange(id) {
        if (this.client.getReadyState(id)) { // ready state set to true
            this.attemptEmptySendQueue();
        }
    }
}
//# sourceMappingURL=connBase.js.map