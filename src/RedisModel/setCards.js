module.exports = (pubClient, roomCode, ...cards) => {
    return pubClient.lpush(`game:${roomCode}:cards`, ...cards ).then((res) => {
        pubClient.expire(`game:${roomCode}:cards`, 7200);
      }).catch((err) => {
        console.log(err)
        throw {error: err, from: "redis"}
      })
}