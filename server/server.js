// Run this to test out socketio connections

const express = require("express");
const path = require("node:path");

const app = express();
app.use(express.static(__dirname + "/.."));

const server = app.listen(4002, () => {
  console.log(`App started on port ${server.address().port}`);
});

const clients = new Set();

const io = require("socket.io")(server);
io.on("connection", client => {
  clients.add(client);
  
  client.on("disconnect", () => {
    clients.delete(client);
  });

  client.on("message", msg => {
    for (const c of clients) {
      if (c != client) c.send(msg);
    }
  })
});

app.get("/", (req,res) => {
  res.sendFile(path.join(__dirname, "../test.html"));
});


