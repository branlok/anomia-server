module.exports = (pubClient, roomCode, key, value, ...args) => {
  return pubClient.hset(`game:${roomCode}`, key, value, ...args).then((res) => {
    console.log(res);
    return res;
  });
};
