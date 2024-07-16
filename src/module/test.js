import { LocalConnection } from "./distros/local.js";
import { SmartTimeout } from "./smartTimeout.js";
const connection = new LocalConnection({});
connection.addMiddleware("json", (message) => {
    return JSON.parse(message.data);
});
// const clientA = connection.buildClient("A");
// const clientB = connection.buildClient("B");
// const clientC = connection.buildClient("C");
// clientA.routerId = clientB.id;
// clientB.routerId = clientC.id;
// // A -> B -> C
// const channelA = clientA.buildChannel("test");
// const channelB = clientB.buildChannel("test");
// const channelC = clientC.buildChannel("test");
// setTimeout(() => {
//   console.log(LocalClient.debug_getStructure(clientA));
//   console.log(LocalClient.debug_getStructure(clientB));
//   console.log(LocalClient.debug_getStructure(clientC));
// }, 100)
console.log("start");
const start = (new Date()).getTime();
const timeout = new SmartTimeout(() => {
    const now = (new Date()).getTime();
    console.log(`expired after ${now - start}ms`);
}, 1000);
setTimeout(() => {
    timeout.timeout = 1000;
    timeout.restart();
    console.log("restart");
}, 1500);
//# sourceMappingURL=test.js.map