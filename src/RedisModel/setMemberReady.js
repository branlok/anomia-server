module.exports = (pubClient, roomCode, socketID) => {
    return pubClient.hset(`game:${roomCode}`, socketID, "ready")
}