# Connection

This library is built around 3 core classes that can be extended to change the connection type.

## Connection
* This generates clients of a type.
* This class must implement a `createNewClient` method, which returns a new instance of a client.

## Client
* This generates channels of a type.
* This class must implement a `connectTo` method, which is used to connect one client to another, and takes in the other client's string id as an argument. This must return a promise--returning `true` if the client was successfully connected, and `false` otherwise.
* This class must implement a `disconnectFrom` method, which is used to disconnect one client from another, and takes in the other client's string id as an argument. This must return a promise--returning `true` if the client was successfully connected, and `false` otherwise.
* This class must implement a `createNewChannel` method, which returns a new instance of a channel.

## Channel
* This is what actually handles passing data around.
* This class must implement a `doSend` method, taking in the arguments of a stringified JSON message, and the string representing the id of the recipient of a message.