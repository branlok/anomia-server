module.exports = (pubClient, roomCode) => {
    return pubClient.lrange(`game:${roomCode}:position`, 0, -1 )
}