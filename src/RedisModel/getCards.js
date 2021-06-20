module.exports = (pubClient, roomCode) => {
    return pubClient.lrange(`game:${roomCode}:cards`, 0, -1 )
}