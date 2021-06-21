const cards = require("../Game/cards");
const editGameProgress = require("../RedisModel/editGameProgress");
const getCards = require("../RedisModel/getCards");
const getGameData = require("../RedisModel/getGameData");
const getGameMembersData = require("../RedisModel/getGameMembersData");
const getPlayerHand = require("../RedisModel/getPlayerHand");
const getPlayerPos = require("../RedisModel/getPlayerPos");
const getTopCard = require("../RedisModel/getTopCard");
const getWildcards = require("../RedisModel/getWildcards");
const incrPlayerPoint = require("../RedisModel/incrPlayerPoint");
const mGetPlayerPoints = require("../RedisModel/mGetPlayerPoints");
const popPlayerhand = require("../RedisModel/popPlayerhand");
const setPlayerhand = require("../RedisModel/setPlayerhand");
const setPlayersPos = require("../RedisModel/setPlayersPos");
const setWildCards = require("../RedisModel/setWildCards");

module.exports = async (io, socket, pubClient) => {
  const startGame = async (roomCode, cb) => {
    //we assume its the leader that started the game.
    //should still protect from outside attacker.

    //check game is ready
    let roomSettings = await getGameData(pubClient, roomCode);

    if (!confirmRoomReady(cb, roomSettings)) return;

    const playersPos = await assignPlayerPositions(io, pubClient, roomCode);

    //iterate the room's members and assigning them a number.

    await editGameProgress(pubClient, roomCode, "status", "starting");
    await editGameProgress(
      pubClient,
      roomCode,
      "numberOfPlayers",
      playersPos.length
    );
    await editGameProgress(pubClient, roomCode, "playerTurn", 0);

    io.to(roomCode).emit("startGame", {
      status: "success",
      message: "start",
      init: {
        playerTurn: 0,
        playerDraw: 0,
        playerPositions: [...playersPos],
        chosenDeck: 1,
      },
    });
  };

  const draw = async (roomCode, cb) => {
    //check which player,
    let roomSettings = await getGameData(pubClient, roomCode);
    let playerOrder = await getPlayerPos(pubClient, roomCode);
    let playerId = playerOrder[roomSettings.playerTurn]; //getID of player.
    console.log(playerId, "draw");
    //Make sure its the right player drawing.
    if (!playerId === socket.id) return;

    let lastPlayer = roomSettings.playerTurn;
    let nextTurn = ++roomSettings.playerTurn % playerOrder.length;
    let nextPlayerId = playerOrder[nextTurn];

    let revealCard = await getTopCard(pubClient, roomCode);

    if (revealCard == null) {
      let playerIds = playerOrder;
      let results = await mGetPlayerPoints(pubClient, roomCode, playerIds);
      io.to(roomCode).emit("roomAnnouncement", {
        revealed: null,
        playerTurn: null,
        action: "endgame",
        results
      });
      return;
    }
    //is it wild card?

    let wildCard = cards[revealCard].type == "wild" ? true : false;

    if (wildCard) {
      await setWildCards(pubClient, roomCode, revealCard);
      io.emit("wildCard", {
        card: revealCard,
      });

      //test

      let promiseArray = [];

      for (let i = 0; i < playerOrder.length; i++) {
        promiseArray.push(getPlayerHand(pubClient, roomCode, playerOrder[i]));
      }
      let tophands = await Promise.all(promiseArray);
      let match = [];
      tophands.forEach((item, idx) => {
        //this evaluates all cards between, can use a better algorithmn
        if (item.length == 0) {
          return;
        }
        if (cards[item[0]].match[0] == cards[revealCard].match[0]) {
          match.push(playerOrder[idx]);
        } else if (cards[item[0]].match[0] == cards[revealCard].match[1]) {
          match.push(playerOrder[idx]);
        }
      });

      if (match.length == 2) {
        io.to(roomCode).emit("faceoff_challenged", {
          faceoff: "init",
          playersInvolved: match,
        });
      }
      //check if there is a pair;

      //   if (dual) {
      //     io.to(roomCode).emit("faceoff_challenged", {
      //       faceoff: "init",
      //       playersInvolved: dual,
      //     });
      //     return;
      //   }

      //end test
      return;
    }

    let wildCardPresent = await getWildcards(pubClient, roomCode);
    console.log(wildCardPresent, "wildCardPresent");

    let dual = false;

    for (let i = 0; i < playerOrder.length; i++) {
      if (i == lastPlayer) continue;
      if (!revealCard) break;

      let card = await getPlayerHand(pubClient, roomCode, playerOrder[i]);
      if (card.length === 0) continue;

      if (cards[revealCard].match[0] == cards[card[0]].match[0]) {
        dual = [playerOrder[i], socket.id];
        break;
      }
      if (wildCardPresent.length > 0) {
        //we can use better search than this. this is temporary.
        if (cards[revealCard].match[0] == cards[wildCardPresent[0]].match[0]) {
          if (cards[card[0]].match[0] == cards[wildCardPresent[0]].match[1]) {
            dual = [playerOrder[i], socket.id];
            break;
          } else {
            continue;
          }
        } else if (
          cards[revealCard].match[0] == cards[wildCardPresent[0]].match[1]
        ) {
          if (cards[card[0]].match[0] == cards[wildCardPresent[0]].match[0]) {
            dual = [playerOrder[i], socket.id];
            break;
          } else {
            continue;
          }
        }
      }
    }

    await editGameProgress(pubClient, roomCode, "playerTurn", nextTurn); // update to next turn.

    await setPlayerhand(pubClient, roomCode, socket.id, revealCard);

    if (dual) {
      io.to(roomCode).emit(`player_draw`, {
        card: revealCard,
        playerId: playerId,
        nextToDraw: nextPlayerId,
      });
      io.to(roomCode).emit("faceoff_challenged", {
        faceoff: "init",
        playersInvolved: dual,
      });
      return;
    }

    // io.to(roomCode).emit("roomAnnouncement", {
    //   revealed: revealCard,
    //   playerDraw: null,
    //   playerTurn: nextTurn,
    //   action: "none",
    // });

    io.to(roomCode).emit(`player_draw`, {
      card: revealCard,
      playerId: playerId,
      nextToDraw: nextPlayerId,
    });

    cb({ status: "success", nextToDraw: nextPlayerId, faceoff: false });

    // io.to(roomCode).emit("roomAnnouncement", {
    //     ...roomSettings,
    //     playerTurn: nextTurn,
    //     action: "face-off"

    //   });
  };

  const winCard = async (roomCode, faceoffIds, cb) => {
    //first to submit wins...
    let roomSettings = await getGameData(pubClient, roomCode);
    let playerOrder = await getPlayerPos(pubClient, roomCode);

    await popPlayerhand(pubClient, roomCode, faceoffIds[0]);
    await popPlayerhand(pubClient, roomCode, faceoffIds[1]);

    await incrPlayerPoint(pubClient, roomCode, socket.id);

    io.to(roomCode).emit(`faceoff_resolved_${faceoffIds[0]}`, {
      victor: socket.id,
      nextToDraw: playerOrder[roomSettings.playerTurn],
    });

    io.to(roomCode).emit(`faceoff_resolved_${faceoffIds[1]}`, {
      victor: socket.id,
      nextToDraw: playerOrder[roomSettings.playerTurn],
    });

    io.to(roomCode).emit(`faceoff_resolved`, {
      nextToDraw: playerOrder[roomSettings.playerTurn],
    });

    //TEST
    let promiseArray = [];
    let wildCardPresent = await getWildcards(pubClient, roomCode);
    console.log(wildCardPresent, "read this");
    for (let i = 0; i < playerOrder.length; i++) {
      promiseArray.push(getPlayerHand(pubClient, roomCode, playerOrder[i]));
    }

    let tophands = await Promise.all(promiseArray);
    let match = [];
    if (wildCardPresent.length > 0) {
      tophands.forEach((item, idx) => {
        //this evaluates all cards between, can use a better algorithmn
        if (item.length == 0) {
          return;
        }

        if (cards[item[0]].match[0] == cards[wildCardPresent[0]].match[0]) {
          match.push(playerOrder[idx]);
        } else if (
          cards[item[0]].match[0] == cards[wildCardPresent[0]].match[1]
        ) {
          match.push(playerOrder[idx]);
        }
      });
    }

    let pair = [];
    for (let i = 0; i < tophands.length; i++) {
      triggered = false;
      if (triggered) {
        break;
      }
      for (let j = 0; j < tophands.length; j++) {
        if (i == j) {
          continue;
        } else {
          if (
            cards[tophands[i][0]].match[0] == cards[tophands[j][0]].match[0]
          ) {
            pair.push(playerOrder[i], playerOrder[j]);
            triggered = true;
            break;
          }
        }
      }
    }

    // tophands.forEach((item, idx) => {
    //     //this evaluates all cards between, can use a better algorithmn
    //     if (item.length == 0) {
    //       return;
    //     }
    //     if (cards[item[0]].match[0] == cards[wildCardPresent[0]].match[0]) {
    //       match.push(playerOrder[idx]);
    //     } else if (cards[item[0]].match[0] == cards[wildCardPresent[0]].match[1]) {
    //       match.push(playerOrder[idx]);
    //     }
    //   });

    console.log(match, pair, "the pair");

    if (match.length == 2) {
      io.to(roomCode).emit("faceoff_challenged", {
        faceoff: "init",
        playersInvolved: match,
      });
    }

    if (pair.length >= 2) {
      io.to(roomCode).emit("faceoff_challenged", {
        faceoff: "init",
        playersInvolved: pair,
      });
    }

    cb({ message: "Ayo" });

    //TEST
  };

  socket.on("startGame", startGame);
  socket.on("draw", draw);
  socket.on("winCard", winCard);
};

function confirmRoomReady(cb, roomSettings) {
  if (roomSettings.status !== "ready") {
    cb({ status: "failed", message: "not all members are ready" });
    return false;
  } else {
    return true;
  }
}

async function assignPlayerPositions(io, pubClient, roomCode) {
  let members = await getGameMembersData(pubClient, roomCode);
  let room = io.of("/").adapter.rooms.get(roomCode);
  //let position = 0;
  let playersAssignment = [];
  let onlyID = [];
  let pos = 0;
  room.forEach((key) => {
    //[position, username]
    onlyID.push(key);
    playersAssignment.push([key, members[key]]);
    // position++;
  });

  await setPlayersPos(pubClient, roomCode, ...onlyID);
  return playersAssignment;
}
