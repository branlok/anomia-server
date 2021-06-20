module.exports = (pubClient, roomCode) => {
    return pubClient.lpop(`game:${roomCode}:cards` )
}