module.exports = (pubClient, roomCode) => {
    return pubClient.hgetall(`game:${roomCode}:members`, function (err, result) {
      if (err) {
        console.error(err);
      } else {
        console.log(result); // Promise resolves to "bar"
        return result;
      }
    });
  };
  