module.exports = (pubClient, roomCode) => {
  return pubClient.hgetall(`game:${roomCode}`).then((res) => {
    return res;
  }).catch((err) => {
    throw {error: err, from: 'redis'}
  })

};
