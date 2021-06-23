module.exports = (pubClient, roomCode, status) => {
    return pubClient.get(`game:${roomCode}:turn:status`)
}