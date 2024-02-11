# Connection

This library is built around 3 core classes that can be extended to change the connection type.

## Client
* This generates connections of a type

## Connection
* This generates channels of a type
* 

## Channel
* This is what actually handles passing data around.
* A channel class must implement a `doSend` method, taking in the arguments of a stringified JSON message, and the string representing the id of the recipient of a message.