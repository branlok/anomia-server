module.exports = (pubClient, roomCode, card) => {
    return pubClient.lpush(`game:${roomCode}:wildCards`, card )
}