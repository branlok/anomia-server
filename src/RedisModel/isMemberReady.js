module.exports = (pubClient, roomCode, ID) => {
    return pubClient.hget(`game:${roomCode}`, ID);
}