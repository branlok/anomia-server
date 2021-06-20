module.exports = (pubClient, roomCode) => {
    return pubClient.lrange(`game:${roomCode}:wildCards`, 0, 0)
}