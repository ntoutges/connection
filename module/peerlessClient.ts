import { ChannelBase, ClientBase, ConnectionBase } from "./connBase.js";

export abstract class PeerlessClient<ConnectionType extends ConnectionBase<any>, ChannelType extends ChannelBase<any>> extends ClientBase<ConnectionType, ChannelType> {
  private _onLocalConnectionCallback: (success: boolean) => void = null;
  private _onRemoteConnectionCallback: (success: boolean) => void = null;
  
  setConnectionStatus(working: boolean) {
    this.doFinalizeConnect(false, working);
  }

  connectTo(id: string, callback: (success: boolean) => void) {
    if (id == null) { // Not connecting to anyone
      if (this.getReadyState(this.id)) callback(true);  // Already connected
      else this._onLocalConnectionCallback = callback;       // Still yet to connect
      return;
    }

    // Already connected to router
    if (this.getReadyState(this.id) && this.getReadyState(id)) return callback(true);
    
    this._onRemoteConnectionCallback = callback;
    this.sendHandshake(id);
  }

  private sendHandshake(id: string) {
    let oldLocalReadyState = this.getReadyState(this.id);
    let oldRemoteReadyState = this.getReadyState(id);

    this.setReadyState(this.id, true, false); // Allow for message to be sent
    this.setReadyState(id, true, false); // Allow for message to be sent

    this.dmChannel.echo("", id, 1000, "init").then(response => {
      this.doFinalizeConnect(true, true); // Successfully connected
    }).catch(() => {
      this.doFinalizeConnect(true, false); // Failed to connect
    });

    // Reset ready states
    this.setReadyState(this.id, oldLocalReadyState, false);
    this.setReadyState(id, oldRemoteReadyState, false);
  }

  private doFinalizeConnect(remote: boolean, success: boolean) {
    if (remote == !!this.routerId) {
      if (this.routerId) this.setReadyState(this.routerId, success);
      this.setReadyState(this.id, success);
    }

    let callback = remote ? this._onRemoteConnectionCallback : this._onLocalConnectionCallback;

    if (!callback) return;  // No callback available
    callback(success);      // Run callback

    // Reset callback for use later
    this._onRemoteConnectionCallback = null;
    this._onLocalConnectionCallback = null;
  }
}