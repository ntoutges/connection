import { Ids } from "./ids.js";
import { Listener } from "./listener.js";
export class ProtocolBase {
    requestIds = new Ids();
    requestResolves = new Map();
    listener = new Listener();
}
//# sourceMappingURL=protocolBase.js.map