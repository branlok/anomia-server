module.exports = (pubClient, roomCode, status) => {
    return pubClient.set(`game:${roomCode}:turn:status`, status)
}