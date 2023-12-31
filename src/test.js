"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const conn_js_1 = require("./conn.js");
const connection = new conn_js_1.LocalConnection();
connection.addMiddleware("json", (message) => {
    return JSON.parse(message.data);
});
const clientA = connection.buildClient("A");
const clientB = connection.buildClient("B");
const clientC = connection.buildClient("C");
clientA.routerId = clientB.id;
clientB.routerId = clientC.id;
// A -> B -> C
const channelA = clientA.buildChannel("test");
const channelB = clientB.buildChannel("test");
const channelC = clientC.buildChannel("test");
// setTimeout(() => {
//   console.log(LocalClient.debug_getStructure(clientA));
//   console.log(LocalClient.debug_getStructure(clientB));
//   console.log(LocalClient.debug_getStructure(clientC));
// }, 100)
channelA.listener.on("message", ({ req, res }) => {
    console.log("A:", req.data, req.body);
});
channelB.listener.on("message", ({ req, res }) => {
    console.log("B:", req.data, req.body);
});
channelC.listener.on("message", ({ req, res }) => {
    console.log("C:", req.data, req.body);
});
channelC.listener.on("request", ({ req, res }) => {
    console.log(`${req.header.sender.origin}->C`, req.data);
    res.send("No.");
});
// channelC.sendTo("For A's eyes ONLY", clientA.id);
// channelC.sendTo("For the eyes of B ONLY", clientB.id)
channelA.request("Penny for your thoughts?", clientC.id).then(({ req, res }) => {
    console.log(`A->${req.header.sender.origin}->A`, req.data);
});
// setTimeout(() => {
//   channelA.broadcast("hello, world!")
// }, 500)
// setTimeout(() => { 
//   channelB.broadcast(JSON.stringify({"A": "listen to me!"}))
// }, 1000)
// setTimeout(() => { 
//   channelC.broadcast("no, listen to me!")
// }, 1500)
//# sourceMappingURL=test.js.map