module.exports = (pubClient, roomCode, playerIds) => {
  return pubClient.mget(
    `game:${roomCode}:${playerIds[0]}:points`,
    `game:${roomCode}:${playerIds[1]}:points`,
    `game:${roomCode}:${playerIds[2]}:points`,
    `game:${roomCode}:${playerIds[3]}:points`,
    `game:${roomCode}:${playerIds[4]}:points`,
    `game:${roomCode}:${playerIds[5]}:points`,
  );
};
