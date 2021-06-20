module.exports = (pubClient, roomCode, username, socketID) => {
    return pubClient.hset(`game:${roomCode}:members`, socketID, username )
}