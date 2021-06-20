module.exports = (pubClient, roomCode, ...playerIDs) => {
    return pubClient.rpush(`game:${roomCode}:position`, ...playerIDs )
}