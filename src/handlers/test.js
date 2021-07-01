const cards = require("../Game/cards");
const editGameProgress = require("../RedisModel/editGameProgress");
// const getCards = require("../RedisModel/getCards");
const getGameData = require("../RedisModel/getGameData");
const getGameMembersData = require("../RedisModel/getGameMembersData");
const getPlayerHand = require("../RedisModel/getPlayerHand");
const getPlayerPos = require("../RedisModel/getPlayerPos");
const getTopCard = require("../RedisModel/getTopCard");
// const getTurnStatus = require("../RedisModel/getTurnStatus");
const getWildcards = require("../RedisModel/getWildcards");
const incrPlayerPoint = require("../RedisModel/incrPlayerPoint");
const mGetPlayerPoints = require("../RedisModel/mGetPlayerPoints");
const popPlayerhand = require("../RedisModel/popPlayerhand");
const setPlayerhand = require("../RedisModel/setPlayerhand");
const setPlayersPos = require("../RedisModel/setPlayersPos");
const setTurnStatus = require("../RedisModel/setTurnStatus");
const setWildCards = require("../RedisModel/setWildCards");

module.exports = async (io, socket, pubClient, rateLimiter) => {
  const startGame = async (roomCode, cb) => {
    //authorization - creator, from: party room
    try {
      //1. Disllow game start if not all member are ready
      await rateLimiter.consume(socket.handshake.address).catch((rateLimiterRes) => {
        throw {error: rateLimiterRes, from: 'rateLimiter'}
      })
      let roomSettings = await getGameData(pubClient, roomCode);
      if (!confirmRoomReady(cb, roomSettings)) return;

      //2. record player position, update Game Progress
      const playersPos = await assignPlayerPositions(io, pubClient, roomCode); //record all players in array to redis, and return [...[socket.id, username]]
      
      await editGameProgress(
        pubClient,
        roomCode,
        "status",
        "starting",
        "numberOfPlayers",
        playersPos.length,
        "playerTurn",
        0
      );

      //return to creator
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
    } catch(err) {
      if (err) {
        if (err.from == "rateLimiter") {
          io.to(socket.id).emit("err", {
            status: "error",
            message: "too many calls too quickly"
          })
        }
        if (err.from == "redis") {
          io.to(socket.id).emit("err", {
            status: "error",
            message: "server storage failure"
          })
        }
      }
    }
  };

  const draw = async (roomCode, cb) => {
    //any player - call from game session
    try {
      await rateLimiter.consume(socket.handshake.address).catch((rateLimiterRes) => {
        throw {error: rateLimiterRes, from: 'rateLimiter'}
        })

        let roomSettings = await getGameData(pubClient, roomCode);
        let playerOrder = await getPlayerPos(pubClient, roomCode); //redis returns an array [id1, id2, id3]
        //check current player turn
        let playerId = playerOrder[roomSettings.playerTurn]; //getID of player, ensure member of room in redis.
        //validate cooresponding character
        if (!(playerId === socket.id)) return;
        let revealCard = await getTopCard(pubClient, roomCode);
    
        //END GAME SEQUENCE
        if (revealCard == null) {
          let playerIds = playerOrder;
          let results = await mGetPlayerPoints(pubClient, roomCode, playerIds);
          await setTurnStatus(pubClient, roomCode, "open");
          io.to(roomCode).emit("roomAnnouncement", {
            revealed: null,
            playerTurn: null,
            action: "endgame",
            results,
          });
          return;
        }
    
        //CHECK WILD CARD
        let lastPlayer = roomSettings.playerTurn; //player pos that will draw the revealCard
        let nextTurn = ++roomSettings.playerTurn % playerOrder.length; //player pos that will allow to draw next
        let nextPlayerId = playerOrder[nextTurn]; //specific id from player pos 
    
        //is it a wild card?
        let wildCard = cards[revealCard].type == "wild" ? true : false;
    
        if (wildCard) {
          //emit wildcard and check for wildcard faceoffs
          await compareWildCardToBoard(pubClient, io, roomCode, cb, revealCard, playerOrder);
          return;
        } else {
          //emit card drawn and check for player faceoffs
          
          await setPlayerhand(pubClient, roomCode, socket.id, revealCard); 
          await editGameProgress(pubClient, roomCode, "playerTurn", nextTurn);
          // await setPlayerhand(pubClient, roomCode, socket.id, revealCard);
          io.to(roomCode).emit(`player_draw`, {
            card: revealCard,
            playerId: playerId,
            nextToDraw: nextPlayerId,
          });

          //Check against existing wildcard
          let wildCardPresent = await getWildcards(pubClient, roomCode); //top wild card

          let dual = await compareSameAndWildCard(pubClient,roomCode, playerOrder, lastPlayer, revealCard, wildCardPresent,socket);
      
          if (dual) {
            io.to(roomCode).emit("faceoff_challenged", {
              faceoff: "init",
              playersInvolved: dual,
            });
            return;
          }
      
          cb({ status: "success", nextToDraw: nextPlayerId, faceoff: false });
        }
    
        
    } catch(err) {

    }
    
  };

  const winCard = async (roomCode, faceoffIds, cb) => {
    //first to submit wins...
    await rateLimiter.consume(socket.handshake.address).catch((rateLimiterRes) => {
      throw {error: rateLimiterRes, from: 'rateLimiter'}
    })
    let roomSettings = await getGameData(pubClient, roomCode);
    let playerOrder = await getPlayerPos(pubClient, roomCode);

    await popPlayerhand(pubClient, roomCode, faceoffIds[0]);
    await popPlayerhand(pubClient, roomCode, faceoffIds[1]);

    await incrPlayerPoint(pubClient, roomCode, socket.id);

    // io.to(roomCode).emit(`faceoff_resolved_${faceoffIds[0]}`, {
    //   victor: socket.id,
    //   nextToDraw: playerOrder[roomSettings.playerTurn],
    // });

    // io.to(roomCode).emit(`faceoff_resolved_${faceoffIds[1]}`, {
    //   victor: socket.id,
    //   nextToDraw: playerOrder[roomSettings.playerTurn],
    // });

    cb({ message: "successfully incremented user points" });
    console.log([faceoffIds[0], faceoffIds[1]], "playeres involved");
    io.to(roomCode).emit(`faceoff_resolved`, {
      players: [faceoffIds[0], faceoffIds[1]],
      victor: socket.id,
      nextToDraw: playerOrder[roomSettings.playerTurn],
    });

    //check for more matches:
    let promiseArray = [];
    let wildCardPresent = await getWildcards(pubClient, roomCode);
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
          if (!cards[tophands[i][0]] || !cards[tophands[j][0]]) {
            //neither has no card, then we can skip it.
            continue;
          }
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

    // cb({ message: "Ayo" });

    //TEST
  };

  socket.on("startGame", startGame);
  socket.on("draw", draw);
  socket.on("winCard", winCard);
};

function confirmRoomReady(cb, roomSettings) {
  if (roomSettings.status !== "ready") {
    cb({ status: "failed", message: "not all members are ready" });
    console.log("yolo");
    return false;
  } else {
    return true;
  }
}

async function assignPlayerPositions(io, pubClient, roomCode) {
  //get every member from
  let members = await getGameMembersData(pubClient, roomCode);
  //socket.io method, returns a set of all socket.id that are within the room.
  let room = io.of("/").adapter.rooms.get(roomCode);

  let playersAssignment = [];
  let onlyID = [];
  let pos = 0;
  room.forEach((key) => {
    onlyID.push(key);
    playersAssignment.push([key, members[key]]);
    //i.e [[5VP89MrEEJlADs3nAAAF, bob], [5VP89MrEEJlADs3nAAAF, jim]]
  });
  await setPlayersPos(pubClient, roomCode, ...onlyID);
  return playersAssignment;
}

async function compareWildCardToBoard(
  pubClient,
  io,
  roomCode,
  cb,
  revealCard,
  playerOrder
) {
  await setWildCards(pubClient, roomCode, revealCard); //push to wildCards array,
  io.emit("wildCard", {
    card: revealCard,
  });

  //get all player top hand;

  // let promiseArray = [];
  // for (let i = 0; i < playerOrder.length; i++) {
  //   promiseArray.push(getPlayerHand(pubClient, roomCode, playerOrder[i]));
  // }


  // let tophands = await Promise.all(promiseArray);

  let tophands = await getPlayerTopCards(pubClient, roomCode, playerOrder)

  let matchToWildCard = [];

  tophands.forEach((item, idx) => {
    //should replace with better matching algorithmn
    if (item.length == 0) {
      //do not check if player has no cards on hand.
      return;
    }
    //each player card is compared against the wildcard spec
    let playerCardSymbol = cards[item[0]].match[0];
    let wildCardSymbolOne = cards[revealCard].match[0];
    let wildCardSymbolTwo = cards[revealCard].match[1];
    
    if (playerCardSymbol == wildCardSymbolOne) {
      matchToWildCard.push(playerOrder[idx]);
    } else if (playerCardSymbol == wildCardSymbolTwo) {
      matchToWildCard.push(playerOrder[idx]);
    }
  });

  if (matchToWildCard.length == 2) {
    // await setTurnStatus(pubClient, roomCode, "open");
    io.to(roomCode).emit("faceoff_challenged", {
      faceoff: "init",
      playersInvolved: matchToWildCard,
    });
  } else {
    cb({ command: "draw again" });
  }

  return;
}


let compareSameAndWildCard = async (pubClient,roomCode, playerOrder, lastPlayer, revealCard, wildCardPresent, socket) => {
  let dual = false;
  for (let i = 0; i < playerOrder.length; i++) {
    //dont compare itself
    if (i == lastPlayer) continue;

    // if (!revealCard) break;
    let card = await getPlayerHand(pubClient, roomCode, playerOrder[i]);

    //ignore players with empty hands
    if (card.length === 0) continue;
    //matching only symbols
    let drawedPlayer = cards[revealCard].match[0];
    let otherPlayer = cards[card[0]].match[0]
    if (drawedPlayer == otherPlayer) {
      dual = [playerOrder[i], socket.id];
      break;
    }

    //matching wildcard symbols
    if (wildCardPresent.length > 0) {
      let wildCardOnBoardSymbolOne = cards[wildCardPresent[0]].match[0];
      let wildCardOnBoardSymbolTwo = cards[wildCardPresent[0]].match[1];

      if (drawedPlayer == wildCardOnBoardSymbolOne) {
        if (otherPlayer == wildCardOnBoardSymbolTwo) {
          dual = [playerOrder[i], socket.id];
          break;
        } else {
          continue;
        }
      } else if (
        drawedPlayer == wildCardOnBoardSymbolTwo
      ) {
        if (otherPlayer == wildCardOnBoardSymbolOne) {
          dual = [playerOrder[i], socket.id];
          break;
        } else {
          continue;
        }
      }
    }
  }
  return dual;
}


let getPlayerTopCards = async (pubClient, roomCode, playerOrder) => {
  let promiseArray = [];
  for (let i = 0; i < playerOrder.length; i++) {
    promiseArray.push(getPlayerHand(pubClient, roomCode, playerOrder[i]));
  }
  let tophands = await Promise.all(promiseArray);
  return tophands;
}

async function comparePlayerhands(
  pubClient,
  io,
  socket,
  roomCode,
  wildCardPresent,
  revealCard,
  lastPlayer,
  playerOrder,
  nextTurn,
  nextPlayerId,
  playerId
) {
  let dual = false;

  for (let i = 0; i < playerOrder.length; i++) {
    //dont compare itself
    if (i == lastPlayer) continue;

    // if (!revealCard) break;

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

  //   await editGameProgress(pubClient, roomCode, "playerTurn", nextTurn); // update to next turn.

  //   await setPlayerhand(pubClient, roomCode, socket.id, revealCard);

  if (dual) {
    // await setTurnStatus(pubClient, roomCode, "open");
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
  } else {
    cb({ command: "draw again" });
  }
}
