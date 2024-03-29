export class SmartInterval {
  private callback: () => void;
  private timeout: number = 0;
  private iId: number = null;
  private tId: number = null;
  private _isPaused: boolean = false;
  private lastTick: number = (new Date()).getTime();
  constructor(
    callback: () => void,
    interval: number = 0, // default case -- means will not run
    runImmediate: boolean = false // if false: will set wait [interval] seconds before sending first callback. if true: will callback immediately
  ) {
    this.setCallback(callback);
    this.interval = interval;

    if (runImmediate) this.callback();
  }

  set interval(interval: number) {
    const oldInterval = this.timeout;
    this.timeout = interval;

    if (oldInterval != this.timeout && !this._isPaused) { // new and valid interval
      this.createInterval();
    }
  }
  get interval() { return this.timeout; }

  setCallback(callback: () => void) {
    this.callback = callback;
  }

  pause() {
    if (this._isPaused) return; // already is paused
    if (this.iId) clearInterval(this.iId);
    if (this.tId) clearTimeout(this.tId);
    this.iId = null;
    this.tId = null;
    this._isPaused = true;
  }

  play() {
    if (!this._isPaused) return; // already is playing
    if (this.createInterval()) this._isPaused = false;
  }

  // stop current interval, and wait [this.timeout]ms to send the next
  resetCycle() {
    this.pause();
    this.lastTick = null; // force interval to restart with no reference to last time callback was fired
    this.play();
  }

  get isPaused() { return this._isPaused; }

  private createInterval() {
    if (this.timeout <= 0) return false; // don't create interval with invalid timeout

    const now = (new Date()).getTime();
    if (this.iId != null) clearInterval(this.iId); // remove old interval, then replace it
    if (this.tId != null) clearTimeout(this.tId); // remove old timeout

    if (this.lastTick == null) this.lastTick = now;

    // [delay] allows interval to run smoothly throuhg plays and pauses
    const delay = Math.max(this.timeout - (now - this.lastTick), 0); // value in range [0,this.timeout]

    this.tId = setTimeout(() => {
      this.tId = null; // no longer in use
      this.lastTick = now;
      this.callback();

      // create brand new interval
      this.iId = setInterval(
        () => {
          this.lastTick = (new Date()).getTime();
          this.callback()
        },
        this.timeout
      );
    }, delay);
    return true; // successfully created interval
  }

  get id() { return this.iId; }
}