"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TimeoutSet = void 0;
const listener_1 = require("./listener");
// push items into this set, and after [timeout] time, they will remove themselves on their own
class TimeoutSet extends Set {
    listener = new listener_1.Listener;
    timeouts = new Map();
    fallbackTimeout;
    constructor(fallbackTimeout = 1000) {
        super();
        this.fallbackTimeout = fallbackTimeout;
    }
    add(value, timeout = this.fallbackTimeout) {
        const timeoutId = setTimeout(this.doAutoDelete.bind(this, value), timeout);
        if (this.timeouts.has(value)) {
            clearTimeout(this.timeouts.get(value));
        } // stop old timeout
        this.timeouts.set(value, timeoutId); // start tracking new timeout
        return super.add(value);
    }
    clear() {
        for (const [key, timeoutId] of this.timeouts) {
            clearTimeout(timeoutId);
        } // stop all timeouts
        this.timeouts.clear(); // stop tracking all timeouts
        super.clear();
    }
    delete(value) {
        clearTimeout(this.timeouts.get(value));
        this.timeouts.delete(value);
        return super.delete(value);
    }
    doAutoDelete(value) {
        this.delete(value);
        this.listener.trigger("timeout", value);
    }
}
exports.TimeoutSet = TimeoutSet;
//# sourceMappingURL=timeoutSet.js.map