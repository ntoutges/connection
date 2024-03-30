import { SmartInterval } from "./smartInterval.js";

export class Listener<Types, Data> {
  listenerIds: number = 0;
  private readonly listeners = new Map<Types, Map<number, (data: Data) => void>>();
  private readonly allListeners = new Map<number, ((type: Types, data: Data) => void)>;
  private readonly priorities = new Map<number,number>(); // gives the priority of any given id in the call stack
  private readonly reserved = new Set<number>; // stores listener ids currently in use
  private readonly onListenCallbacks: Array<(type: Types, isNew: boolean) => void> = [];

  private readonly pollingCallbacks = new Map<Types, [callback: () => (Data | null), period: number]>();
  private readonly pollingIntervals = new Map<Types, SmartInterval>(); // maps an event type to a polling interval
   
  private readonly rateLimits = new Map<Types, {period: number, id: number, buffer: Data, hasData: boolean}>();

  private readonly autoResponses = new Map<Types, Data>;

  /**
   * listens for events
   * @param type type of event to listen for
   * @param listener callback when event is triggered
   * @param priority order in which callbacks are called; greater values mean the callback is called earlier
   * @returns numeric id to reference specific callback
   */
  on(type: Types, listener: (data: Data) => void, priority=100) {
    const newId = this.listenerIds++;
    
    const isNewListen = !this.listeners.has(type);
    this.onListenCallbacks.forEach(callback => { callback(type, isNewListen); });
    
    if (isNewListen) this.listeners.set(type, new Map<number, (data: Data) => void>());
    this.listeners.get(type).set(newId, listener);
    this.reserved.add(newId);
    this.priorities.set(newId, priority);

    if (this.autoResponses.has(type)) {
      listener(this.autoResponses.get(type));
    }

    // start polling interval if needed and not already
    if (this.pollingCallbacks.has(type) && !this.pollingIntervals.has(type)) {
      const data = this.pollingCallbacks.get(type);
      this.pollingIntervals.set(
        type,
        new SmartInterval(() => {
          const output = data[0]();
          if (output !== null) this.trigger(type, output);
        }, data[1])
      );
    }

    return newId;
  }

  onAll(listener: (type: Types, data: Data) => void) {
    const newId = this.listenerIds++;
    this.allListeners.set(newId, listener);
    return newId;
  }

  onListen(callback: (type: Types, isNew: boolean) => void) {
    this.onListenCallbacks.push(callback);

    if (this.listeners.size) { // some listens already made
      for (const type of this.listeners.keys()) { callback(type, true); }
    }
  }

  /**
   * Sets a polling function to be used to periodically check if an event should be triggered
   * @param period the amount of time between polling requests
   */
  setPollingOptions(
    type: Types,
    callback: () => (Data | null),
    period: number = null // ms
  ) {
    if (this.pollingIntervals.has(type)) { // modify existing SmartInterval
      if (period != null) this.pollingIntervals.get(type).setInterval(period);
      this.pollingIntervals.get(type).setCallback(callback);
    }
    this.pollingCallbacks.set(type, [ callback, period ?? 400 ]); // create new entry
  }

  setPollingInterval(
    type: Types,
    period: number
  ) {
    if (this.pollingIntervals.has(type)) { // modify existing SmartInterval
      this.pollingIntervals.get(type).setInterval(period);
    }
    this.pollingCallbacks.set(type, [ () => { return null; }, period ?? 400 ]); // create new entry
  }

  /**
   * An event that triggers once, after which, sends an immediate event to any listeners that connect
   */
  setAutoResponse(type: Types, data: Data) {
    this.trigger(type, data); // send initial event
    this.autoResponses.set(type, data); // update any who connect afterwards
  }

  /**
   * Used to limit the amount of triggers that can be activated in a period of time
   * @param period A value <= 0 implies removing the rate limit
   */
  setRateLimit(
    type: Types,
    period: number
  ) {
    if (this.rateLimits.has(type)) {
      if (period > 0) this.rateLimits.get(type).period = period;
      else this.rateLimits.delete(type);
    }
    else if (period > 0) {
      this.rateLimits.set(type, {
        period,
        buffer: null,
        id: null,
        hasData: false
      });
    }
  }

  off(listenerId: number) {
    if (!this.hasListenerId(listenerId)) return false;

    if (this.allListeners.has(listenerId)) {
      this.allListeners.delete(listenerId);
      return true;
    }
    
    for (const type of this.listeners.keys()) {
      if (this.listeners.get(type).has(listenerId)) {
        this.listeners.get(type).delete(listenerId);
        this.reserved.delete(listenerId); // remove tracking for listener id
        this.priorities.delete(listenerId);
        if (this.listeners.get(type).size == 0) {
          this.listeners.delete(type); // remove listener callback
          if (this.pollingIntervals.has(type)) {
            this.pollingIntervals.get(type).pause();
            // clearInterval(this.pollingIntervals.get(type)); // clear polling function
            this.pollingIntervals.delete(type)
          }
        }
        return true;
      }
    }
    return false;
  }

  trigger(type: Types, data: Data) {
    // only try to trigger if type is being listened to
    if (this.listeners.has(type)) {

      // need to wait, so just update data buffer
      if (this.rateLimits.has(type) && this.rateLimits.get(type).id !== null) {
        const rateLimitData = this.rateLimits.get(type);
        
        // save new data to be sent after trigger rate-limiter has expired
        rateLimitData.buffer = data;
        rateLimitData.hasData = true;
        return;
      }

      const listeners = (
        Array.from(
          this.listeners.get(type).entries()
        ).sort(
          (a,b) => this.priorities.get(b[0]) - this.priorities.get(a[0])
        )
      );
      for (const listener of listeners) {
        listener[1](data);
      }

      // rate limit exists for this type, but no timeout in action
      if (this.rateLimits.has(type) && this.rateLimits.get(type).id === null) {
        const rateLimitData = this.rateLimits.get(type);

        // schedule time for when trigger of this type can activate again
        rateLimitData.id = setTimeout(() => {
          rateLimitData.id = null;
          if (rateLimitData.hasData) { // only run trigger if data is available (ie, trigger wass called in the mean time, but this timeout hadn't yet finished)
            // send out trigger
            this.trigger(type, rateLimitData.buffer);

            // reset all values
            rateLimitData.buffer = null;
            rateLimitData.hasData = false;
          }
        }, rateLimitData.period);
      }
    }

    // allListeners listens to everything, so run it
    if (this.allListeners.size > 0) {
      for (const listener of this.allListeners.values()) {
        listener(type, data);
      }
    }
  }

  reserve(listenerId: number) {
    this.listenerIds = Math.max(listenerId + 1, this.listenerIds); // ensure there is never a collision
  }

  /**
   * Used to prevent two listeners from using the same id
   */
  doSync(other: Listener<any,any>) {
    this.reserve(other.listenerIds);
    other.listenerIds = this.listenerIds;
  }

  isListeningTo(type: Types): boolean { return this.listeners.has(type) }
  hasListenerId(id: number) { return this.reserved.has(id); }
  

  clear() {
    this.listeners.clear();
    this.allListeners.clear();
    this.priorities.clear();
      this.reserved.clear();
      this.onListenCallbacks.splice(0);
      this.pollingCallbacks.clear();
      
      this.pollingIntervals.forEach(interval => interval.pause());
      this.pollingIntervals.clear();

      this.rateLimits.clear();
      this.autoResponses.clear();
  }
}

export class ElementListener<ExtraTypes, ExtraData=void> extends Listener<ExtraTypes | "resize", HTMLElement | ExtraData> {
  private readonly elements = new Set<HTMLElement>();
  private readonly resizeObserver = new ResizeObserver(this.triggerElementResize.bind(this));
  
  constructor() {
    super();
    this.setRateLimit("resize", 100); // non-absurd rate-limit number
  }

  observe(el: HTMLElement) {
    this.elements.add(el);
    this.resizeObserver.observe(el);
  }

  unobserve(el: HTMLElement) {
    this.elements.delete(el);
    this.resizeObserver.unobserve(el);
  }

  private triggerElementResize(entries: ResizeObserverEntry[]) {
    const context = this;
    entries.forEach((entry: ResizeObserverEntry) => {
      context.trigger("resize", entry.target as HTMLElement);
    });
  }
}
