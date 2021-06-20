module.exports = (pubClient, roomCode, ...cards) => {
    return pubClient.lpush(`game:${roomCode}:cards`, ...cards )
}