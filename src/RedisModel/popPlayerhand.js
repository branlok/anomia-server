module.exports = (pubClient, roomCode, socketId) => {
    return pubClient.lpop(`game:${roomCode}:${socketId}:hand` )
}