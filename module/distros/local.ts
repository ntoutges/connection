import { ClientBase, ConnectionBase } from "../connBase.js";
import { ProtocolBase } from "../protocolBase.js";

const connWorlds = new Map<string, Map<string,LocalClient>>();

export class LocalConnection extends ConnectionBase<LocalClient> {
  readonly worldId: string;
  constructor({
    worldId = "default"
  }: {
    worldId?: string
  }) {
    super();
    this.addInitParams({ worldId })

    this.worldId = worldId;
    if (!connWorlds.has(this.worldId)) connWorlds.set(this.worldId, new Map());
  }
  protected createNewClient(id: string, protocol: ProtocolBase, heartbeatInterval: number): LocalClient {
    const client = new LocalClient(id,this, protocol, heartbeatInterval);
    connWorlds.get(this.worldId).set(id, client);
    return client;
  }
}

export class LocalClient extends ClientBase<LocalConnection> {
  constructor(id: string, connection: LocalConnection, protocol: ProtocolBase, heartbeatInterval: number) {
    super(id, connection, protocol, heartbeatInterval);

    setTimeout(() => { this.setReadyState(this.id, true); }, 0); // allow other events to happen before running this
  }
  
  getClient(id: string) {
    if (this.clients.has(id) || id == this._routerId) return this.conn.getClient(id);
    return null;
  }

  connectTo(id: string, callback: (success: boolean) => void): void {
    const otherClient = connWorlds.get(this.conn.worldId).get(id);
    if (!otherClient) callback(false);
    else {
      otherClient.acceptConnection(this.id);
      callback(true);
    }
  }

  // TODO: make this do something...
  async disconnectFrom(id: string) { return true; } // always assume success

  acceptConnection(id: string) { this.setReadyState(id, true); }

  protected async destroyClient(): Promise<void> {
    connWorlds.get(this.conn.worldId).delete(this.id);
  }

  doSend(msg: string, recipientId: string) {
    const recipient = connWorlds.get(this.conn.worldId).get(recipientId);
    if (!recipient) return; // Ignore

    // Allow other events to happen before message "sends"
    setTimeout(() => {
      recipient.listener.trigger("receive", msg);
    }, 0);
  }
}
