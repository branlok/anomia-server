module.exports = (pubClient, roomCode, socketID ) => {
    return pubClient.hexists(`game:${roomCode}`, socketID)
}