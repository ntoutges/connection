export class SmartInterval {
  private callback: () => void;
  private timeout: number = 0;
  private iId: number = null;
  private tId: number = null;
  private _isPaused: boolean = false;
  private lastTick: number = null;
  constructor(
    callback: () => void,
    interval: number = 0, // default case -- means will not run
    runImmediate: boolean = false // if false: will set wait [interval] seconds before sending first callback. if true: will callback immediately
  ) {
    this.setCallback(callback);
    this.setInterval(interval);

    if (runImmediate) this.callback();
  }
  
  setInterval(interval: number) {
    const oldInterval = this.timeout;
    this.timeout = interval;

    if (interval > 0 && oldInterval != this.timeout && !this._isPaused) { // new and valid interval
      this.createInterval();
    }
  }

  setCallback(callback: () => void) {
    this.callback = callback;
  }

  pause() {
    clearInterval(this.iId);
    this.iId = null;
    this._isPaused = true;
  }

  play() {
    this.createInterval();
    this._isPaused = false;
  }

  // stop current interval, and wait [this.timeout]ms to send the next
  resetCycle() {
    this.pause();
    this.lastTick = null; // force interval to restart with no reference to last time callback was fired
    this.play();
  }

  get isPaused() { return this._isPaused; }

  private createInterval() {
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
  }

  get id() { return this.iId; }
}