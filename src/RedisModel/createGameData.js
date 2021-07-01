module.exports = async (pubClient, roomCode, username, password, socketID) => {
    let status = "lobby";
    let roomLimit = "6";
    let passwordLocked = password !== null ? "true" : "false";
    // await pubClient.hset(`game:${roomCode}:members`, socketID, username );
    return pubClient.hset(
      `game:${roomCode}`,
      "creator",
      socketID,
      "roomCode",
      roomCode,
      "creatorUsername",
      username,
      "status",
      status,
      "passwordLocked",
      passwordLocked,
      "password",
      password,
      "roomLimit",
      roomLimit,
      socketID,
      "ready",
    ).then((res) => {
      pubClient.expire(`game:${roomCode}`, 7200);
    }).catch((err) => {
      console.log(err)
      throw {error: err, from: "redis"}
    })
}