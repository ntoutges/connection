"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Listener = void 0;
const ids_js_1 = require("./ids.js");
const smartInterval_js_1 = require("./smartInterval.js");
class Listener {
    listeners = new Map();
    listenerAll = new Map();
    priorities = new Map(); // gives the priority of any given id in the call stack
    reserved = new ids_js_1.Ids(); // stores listener ids currently in use
    isSyncing = false;
    pollingCallbacks = new Map();
    pollingIntervals = new Map(); // maps an event type to a polling interval
    autoResponses = new Map;
    /**
     * listens for events
     * @param type type of event to listen for
     * @param listener callback when event is triggered
     * @param priority order in which callbacks are called; greater values mean the callback is called earlier
     * @returns numeric id to reference specific callback
     */
    on(type, listener, priority = 100) {
        const newId = this.reserved.generateId();
        if (!this.listeners.has(type))
            this.listeners.set(type, new Map());
        this.listeners.get(type).set(newId, listener);
        this.priorities.set(newId, priority);
        if (this.autoResponses.has(type)) {
            listener(this.autoResponses.get(type));
        }
        // start polling interval if needed and not already
        if (this.pollingCallbacks.has(type) && !this.pollingIntervals.has(type)) {
            const data = this.pollingCallbacks.get(type);
            this.pollingIntervals.set(type, new smartInterval_js_1.SmartInterval(() => {
                const output = data[0]();
                if (output !== null)
                    this.trigger(type, output);
            }, data[1]));
        }
        return newId;
    }
    // add event listener for all types
    // always has priority lower than all others (triggers last)
    // note: currently does not (automatically) work with autoresponses and polling intervals
    onAll(listener) {
        const newId = this.reserved.generateId();
        this.listenerAll.set(newId, listener);
        return newId;
    }
    /**
     * Sets a polling function to be used to periodically check if an event should be triggered
     * @param period the amount of time between polling requests
     */
    setPollingOptions(type, callback, period = null // ms
    ) {
        if (this.pollingIntervals.has(type)) { // modify existing SmartInterval
            if (period != null)
                this.pollingIntervals.get(type).setInterval(period);
            this.pollingIntervals.get(type).setCallback(callback);
        }
        this.pollingCallbacks.set(type, [callback, period ?? 400]); // create new entry
    }
    setPollingInterval(type, period) {
        if (this.pollingIntervals.has(type)) { // modify existing SmartInterval
            this.pollingIntervals.get(type).setInterval(period);
        }
        this.pollingCallbacks.set(type, [() => { return null; }, period ?? 400]); // create new entry
    }
    /**
     * An event that triggers once, after which, sends an immediate event to any listeners that connects
     */
    setAutoResponse(type, data) {
        this.trigger(type, data); // send initial event
        this.autoResponses.set(type, data); // update any who connect afterwards
    }
    off(listenerId) {
        if (!this.hasListenerId(listenerId))
            return false;
        for (const type of this.listeners.keys()) {
            if (this.listeners.get(type).has(listenerId)) {
                this.listeners.get(type).delete(listenerId);
                this.reserved.releaseId(listenerId); // remove tracking for listener id
                this.priorities.delete(listenerId);
                if (this.listeners.get(type).size == 0) {
                    this.listeners.delete(type); // remove listener callback
                    if (this.pollingIntervals.has(type)) {
                        this.pollingIntervals.get(type).pause();
                        // clearInterval(this.pollingIntervals.get(type)); // clear polling function
                        this.pollingIntervals.delete(type);
                    }
                }
                return true;
            }
            else if (this.listenerAll.has(listenerId)) {
                this.listenerAll.delete(listenerId);
                this.reserved.releaseId(listenerId); // remove tracking for listener id
                return true;
            }
        }
        return false;
    }
    trigger(type, data) {
        if (!this.listeners.has(type))
            return;
        const listeners = (Array.from(this.listeners.get(type).entries()).sort((a, b) => this.priorities.get(b[0]) - this.priorities.get(a[0])));
        for (const listener of listeners) {
            listener[1](data);
        } // trigger standard listeners
        for (const listener of this.listenerAll.values()) {
            listener(type, data);
        } // trigger "all" listenerss
    }
    reserve(listenerId) {
        return this.reserved.reserveId(listenerId); // ensure there is never a collision
    }
    getReserved() {
        return this.reserved.getIdsInUse();
    }
    /**
     * Used to prevent two listeners from using the same id
     */
    doSync(other) {
        this.isSyncing = true;
        for (const i of other.getReserved()) {
            this.reserve(i);
        }
        if (this.isSyncing)
            return;
        other.doSync(this);
        this.isSyncing = false;
    }
    isListeningTo(type) { return this.listeners.has(type); }
    hasListenerId(id) { return this.reserved.isInUse(id); }
}
exports.Listener = Listener;
//# sourceMappingURL=listener.js.map