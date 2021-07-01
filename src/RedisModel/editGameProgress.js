module.exports = (pubClient, roomCode, key, value, ...args) => {
  return pubClient.hset(`game:${roomCode}`, key, value, ...args).then((res) => {
    return res;
  }).catch((err) => {
    throw {error: err, from: "redis"}
  })
};
