module.exports = (pubClient, roomCode, socketId) => {
    return pubClient.lrange(`game:${roomCode}:${socketId}:hand`, 0, -1 )
}