import { Listener } from "./listener.js";
// push items into this set, and after [timeout] time, they will remove themselves on their own
export class TimeoutQueue {
    listener = new Listener;
    fallbackTimeout;
    valueQueue = [];
    timeoutQueue = [];
    equalityCheck;
    constructor(fallbackTimeout = 1000, equalityCheck = null) {
        this.equalityCheck = equalityCheck ?? ((a, b) => a === b);
        this.fallbackTimeout = fallbackTimeout;
    }
    add(value, timeout = this.fallbackTimeout) {
        const timeoutId = setTimeout(this.doAutoDelete.bind(this, value), timeout);
        const index = this.valueQueue.findIndex(this.equalityCheck.bind(null, value));
        if (index != -1) { // stop old timeout, and start new
            clearTimeout(this.timeoutQueue[index]);
            this.timeoutQueue[index] = timeoutId;
        }
        else { // adding new value to queue
            this.timeoutQueue.push(timeoutId); // start tracking new timeout
            this.valueQueue.push(value);
        }
        return this;
    }
    clear() {
        for (const timeoutId of this.timeoutQueue) {
            clearTimeout(timeoutId);
        } // stop all timeouts
        this.timeoutQueue.splice(0); // stop tracking all timeouts
        this.valueQueue.splice(0);
    }
    delete(value) {
        const index = this.valueQueue.findIndex(this.equalityCheck.bind(null, value));
        if (index != -1) { // remove value that exists
            clearTimeout(this.timeoutQueue[index]);
            this.timeoutQueue.splice(index, 1);
            this.valueQueue.splice(index, 1);
            return true;
        }
        return false; // no value removed, as it didn't exist
    }
    doAutoDelete(value) {
        this.delete(value);
        this.listener.trigger("timeout", value);
    }
    forEach(callback) {
        return this.valueQueue.forEach(callback);
    }
    get size() { return this.valueQueue.length; }
}
//# sourceMappingURL=timeoutQueue.js.map