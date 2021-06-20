module.exports = async (pubClient, roomCode, username, password, socketID) => {
    let status = "lobby";
    let roomLimit = "6";
    let passwordLocked = password !== null ? "true" : "false";
    await pubClient.hset(`game:${roomCode}:members`, socketID, username );
    return await pubClient.hset(
      `game:${roomCode}`,
      "creator",
      socketID,
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
    );
}