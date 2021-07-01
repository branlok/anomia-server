module.exports = (pubClient, roomCode, ID) => {
    return pubClient.hget(`game:${roomCode}`, ID).catch((err) => {
        throw {error: err, from: "redis"}
    })
}