export class SmartTimeout {
    callback;
    _timeout = 0;
    timeoutProgress = 0;
    tId = null;
    _isPaused = false;
    startTick = null;
    constructor(callback, timeout = 0 // default case -- means will not run
    ) {
        this.setCallback(callback);
        this.timeout = timeout;
    }
    set timeout(timeout) {
        const oldTimeout = this._timeout;
        this._timeout = timeout;
        if (timeout > 0 && oldTimeout != this._timeout && !this._isPaused) {
            this.createTimeout();
        }
    }
    get timeout() { return this.timeout; }
    setCallback(callback) {
        this.callback = callback;
    }
    pause() {
        if (this._isPaused)
            return; // already is paused
        if (this.tId)
            clearTimeout(this.tId);
        this.tId = null;
        this.setTimeoutProgress();
        this._isPaused = true;
        this.startTick = null;
    }
    play() {
        if (!this._isPaused)
            return; // already is playing
        this.createTimeout();
        this._isPaused = false;
    }
    restart() {
        this.pause();
        this.timeoutProgress = 0;
        this.play();
    }
    createTimeout() {
        if (this.tId) { // remove old timeout (if it exists), and clear slate for next timeout
            clearTimeout(this.tId);
            this.setTimeoutProgress();
        }
        const now = (new Date()).getTime();
        if (this.startTick == null)
            this.startTick = now;
        const delay = Math.max(0, this._timeout - this.timeoutProgress); // in range [0,this._timeout]
        this.tId = setTimeout(() => { this.callback(); }, delay);
    }
    setTimeoutProgress() {
        const now = (new Date()).getTime();
        this.timeoutProgress += now - (this.startTick ?? 0);
    }
    get isPaused() { return this._isPaused; }
    get id() { return this.tId; }
}
//# sourceMappingURL=smartTimeout.js.map