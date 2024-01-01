import { LocalClient, LocalConnection } from "./distros/local.js";
import { SmartInterval } from "./smartInterval.js";

const connection = new LocalConnection();

connection.addMiddleware("json", (message) => {
  return JSON.parse(message.data)
})

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

var i = 0;
console.log("start")
const interval = new SmartInterval(() => {
  console.log("interval:", ++i);

  if (i == 3) {
    interval.pause();
    setTimeout(() => {
      interval.resetCycle();
      console.log("interval: 3.5");
    }, 500)
  }
}, 1000, true);