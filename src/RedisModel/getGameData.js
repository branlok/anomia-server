module.exports = (pubClient, roomCode) => {
  return pubClient.hgetall(`game:${roomCode}`).then((res) => {
    return res;
  });

};
