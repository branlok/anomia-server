module.exports = (pubClient, roomCode, socketId) => {
    return pubClient.incr(`game:${roomCode}:${socketId}:points` )
}