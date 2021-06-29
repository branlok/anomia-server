module.exports = async (pubClient, roomCode) => {
    return pubClient.expire(`game:${roomCode}:members`, 7200);
}