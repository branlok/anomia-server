module.exports = (pubClient, roomCode, socketId, card) => {
    return pubClient.lpush(`game:${roomCode}:${socketId}:hand`, card )
}