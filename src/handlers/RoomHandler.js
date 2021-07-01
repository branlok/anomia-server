const { nanoid } = require("nanoid");
const createGameData = require("../RedisModel/createGameData");
const editGameProgress = require("../RedisModel/editGameProgress");
const expireGame = require("../RedisModel/expireGame");
const getGameRoomData = require("../RedisModel/getGameData");
const getGameMembersData = require("../RedisModel/getGameMembersData");
const isMemberReady = require("../RedisModel/isMemberReady");
const memberExists = require("../RedisModel/memberExists");
const setCards = require("../RedisModel/setCards");
const setMemberNotReady = require("../RedisModel/setMemberNotReady");
const setMemberReady = require("../RedisModel/setMemberReady");
const setMemberToGame = require("../RedisModel/setMemberToGame");
const shuffle = require("../utils/shuffle");

let cards = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25,
  26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49,
  50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73,
  74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95,
  96, 97, 98, 99, 100]

module.exports = async (io, socket, pubClient, rateLimiter) => {
  const createPartyRoom = async (username, password, cb) => {
    try {
    //APPLY LIMITER
    await rateLimiter.consume(socket.handshake.address).catch((rateLimiterRes) => {
      throw {error: rateLimiterRes, from: 'rateLimiter'}
    })
    
    //set room, update redis
    let roomCode = nanoid(6);
    let shuffledCards = shuffle(cards);
    await setCards(pubClient, roomCode, shuffledCards); //SETUP GAME DECK STORAGE, lpush game:${roomCode}:cards, set Deck
    await createGameData(pubClient, roomCode, username, password, socket.id); //SETUP GAME, hset game:${roomCode}, hset game information
    await setMemberToGame(pubClient, roomCode, username, socket.id);//SET MEMBER, hset game:${roomCode}:members, 

    let members = await getGameMembersData(pubClient, roomCode); //{id: username}
    socket.join(roomCode);

    cb({
      status: "success",
      connectedRoom: roomCode,
      currentMembers: members,
      [socket.id]: {
        id: socket.id,
        username: username,
        ready: true,
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

  const joinPartyRoom = async (roomCode, username, password, cb) => {
    try {
      await rateLimiter.consume(socket.handshake.address).catch((rateLimiterRes) => {
        throw {error: rateLimiterRes, from: 'rateLimiter'}
      })

      //validating entry requirements
      if (!confirmRoomInitialized(io, cb, roomCode)) return; 
      if (!confirmRoomHasCapacity(io, cb, roomCode)) return;
      let roomSettings = await getGameRoomData(pubClient, roomCode);
      if (!confirmRoomRequirePassword(cb, roomSettings, password)) return;
      socket.join(roomCode);

      //set room, update redis
      await setMemberToGame(pubClient, roomCode, username, socket.id);
      await setMemberNotReady(pubClient, roomCode, socket.id);
      let members = await getGameMembersData(pubClient, roomCode); //hset of all members
  
      let memberDetails = {};

      for (let [key, value] of Object.entries(members)) {
        memberDetails[key] = {
          id: key,
          username: value,
          ready: roomSettings[key] == "ready" ? true : false,
        };
      }
      socket.join(roomCode);

      cb({
        status: "success",
        message: "successfully entered room",
          connectedRoom: roomCode,
          currentMembers: members,
          ...memberDetails,
      });

      io.to(roomCode).emit("roomUpdates", {
        message: `${username} joined`,
        currentMembers: members,
        ...memberDetails,
      });
  
      //game wont be not ready
      await editGameProgress(pubClient, roomCode, "status", "lobby");
      io.to(roomCode).emit("creatorAnnouncement", {
        message: "game is still not ready to start",
        command: "do nothing",
      });

    } catch(err) {
      console.log(err)
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
  };

  const userReady = async (roomCode, username, cb) => {
    try {
      await rateLimiter.consume(socket.handshake.address).catch((rateLimiterRes) => {
        throw {error: rateLimiterRes, from: 'rateLimiter'}
      })
      //CHECK REQUIREMENTS TO THIS ROUTE
      if (!confirmUserFromRoom(cb, socket, roomCode)) return;
  
      await setMemberReady(pubClient, roomCode, socket.id);
      io.to(roomCode).emit("roomUpdates", {
        [socket.id]: {
          id: socket.id,
          username: username,
          ready: true,
        },
      });
  
      await checkAllIsReady(pubClient, io, roomCode);
    } catch(err) {
      console.log(err)
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
   
  };

  const userNotReady = async (roomCode, username, cb) => {
    try {
      await rateLimiter.consume(socket.handshake.address).catch((rateLimiterRes) => {
        throw {error: rateLimiterRes, from: 'rateLimiter'}
      })

      if (!confirmUserFromRoom(cb, socket, roomCode)) return;
      await setMemberNotReady(pubClient, roomCode, socket.id);
      io.to(roomCode).emit("roomUpdates", {
        [socket.id]: {
          id: socket.id,
          username: username,
          ready: false,
        },
      });
  
      await editGameProgress(pubClient, roomCode, "status", "lobby");

      io.to(roomCode).emit("creatorAnnouncement", {
        message: "game is still not ready to start",
        command: "do nothing",
      });
  
      // await checkAllIsReady(pubClient, io, roomCode);
      cb({ status: "success", message: "toggled not Ready" });

    }catch(err) {
      console.log(err)
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

  };

  const cleanUpOnDisconnect = async () => {
    try {
      //get roomName
      let rooms = socket.rooms;
      let roomCode = "";
      rooms.forEach((item) => {
        if (item.length == 6) roomCode = item;
      })
      
      console.log(socket.id, "user disconnected");
      let gameData = await getGameRoomData(pubClient, roomCode);
  
      if (gameData.status === "starting") {
        io.to(roomCode).emit("roomAnnouncement", {
          revealed: null,
          playerTurn: null,
          action: "disconnection",
          results: null,
          // results,
        });
        //delete game
        return;
      } else if (gameData.status === "lobby" || gameData.status === "ready" ) {
        let promiseArray = [];
        rooms.forEach((item) => {
          promiseArray.push(pubClient.hdel(`game:${item}`, socket.id));
          promiseArray.push(pubClient.hdel(`game:${item}:members`, socket.id));
        });
    
        rooms.forEach(async (item) => {
          let members = await getGameMembersData(pubClient, item);
          console.log(members, "remain in the room");
          io.to(item).emit("roomUpdates", {
            currentMembers: members,
          });
        });
      }  
      await checkAllIsReady(pubClient, io, roomCode);    
    } catch (err){
      console.log(err)
      if (err.from == "redis") {
        io.to(socket.id).emit("err", {
          status: "error",
          message: "server storage failure"
        })
      }
    }
    
    
  };

  let checkRoom = async (roomCode, cb) => {
    try {
      await rateLimiter.consume(socket.handshake.address).catch((rateLimiterRes) => {
        throw {error: rateLimiterRes, from: 'rateLimiter'}
      })
      let roomSettings = await getGameRoomData(pubClient, roomCode); 
      if (!(roomSettings.status === "lobby" || roomSettings.status === "ready")) {
        cb({status: "error", message: "game already started"})
      }
      if (!confirmRoomInitialized(io, cb, roomCode)) {
        cb({ status: "error", message: "room does not exist" });
        return;
      } 
      if (!confirmRoomHasCapacity(io, cb, roomCode)) cb({status: "error", message: "room is full"});
    } catch(err) {
      console.log(err)
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
    
  };

  const passwordInquiry = async (roomCode, cb) => {
    try {
      await rateLimiter.consume(socket.handshake.address).catch((rateLimiterRes) => {
        throw {error: rateLimiterRes, from: 'rateLimiter'}
      })

      let roomSettings = await getGameRoomData(pubClient, roomCode); 
      // let roomSettings = await pubClient.hgetall(`game:${roomCode}`);
      if (!roomSettings) {
        cb({ status: "failed", message: "game not found" });
        return;
      }
      
      let passwordLocked = roomSettings.passwordLocked == "true" ? true : false;
      cb({ status: "success", password: passwordLocked });
      // io.room(socket.id).emit("passwordInquiry", {})
    } catch {
      console.log(err)
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
    
  };

  //MAIN SEQUENCES
  socket.on("setNewRoom", createPartyRoom);
  socket.on("checkRoom", checkRoom);
  socket.on("joinNewRoom", joinPartyRoom);
  socket.on("userReady", userReady);
  socket.on("userNotReady", userNotReady);

  //UTILS
  socket.on("disconnecting", cleanUpOnDisconnect);
  socket.on("passwordInquiry", passwordInquiry);
};

async function checkAllIsReady(pubClient, io, roomCode) {
  //grabs all users in the room, and test against if they are all ready, and emit creator to start;
  let room = io.of("/").adapter.rooms.get(roomCode);

  let fetchPlayerStatus = [];
  room.forEach((item) => {
    fetchPlayerStatus.push(isMemberReady(pubClient, roomCode, item));
  });

  let playerStatus = await Promise.all(fetchPlayerStatus);

  if (playerStatus.every((value) => value === "ready")) {
    await editGameProgress(pubClient, roomCode, "status", "ready");
    io.to(roomCode).emit("creatorAnnouncement", {
      message: "game Ready to start",
      command: "start game",
    });
  } else {
    await editGameProgress(pubClient, roomCode, "status", "lobby");
    io.to(roomCode).emit("creatorAnnouncement", {
      message: "game is still not ready to start",
      command: "do nothing",
    });
  }
}

function confirmUserFromRoom(cb, socket, roomCode) {
  if (socket.rooms.has(roomCode)) {
    return true;
  } else {
    cb({ status: "failed", message: "not authorized" });
    return false;
  }
  //   let room = io.of("/").adapter.rooms.get(roomCode);
  //   if (room) {
  //     if (room.has(socketID)) {
  //       return true;
  //     } else {
  //       cb({ status: "failed", message: "not authorized" });
  //       return false;
  //     }
  //   } else {
  //     cb({ status: "failed", message: "not authorized" });
  //     return false;
  //   }
}

function confirmRoomInitialized(io, cb, roomCode) {
  let exists = io.of("/").adapter.rooms.has(roomCode);
  if (!exists) {
    cb({ status: "error", message: "Room does not exist" });
    return false;
  } else {
    return true;
  }
}

function confirmRoomHasCapacity(io, cb, roomCode) {
  let full = io.of("/").adapter.rooms.get(roomCode).size === 6;
  if (full) {
    cb({ status: "failed", message: "room is full" });
    return false;
  } else {
    return true;
  }
}

function confirmRoomRequirePassword(cb, roomSettings, providedPassword) {
  let passwordRequired = roomSettings.passwordLocked === "true";

  if (passwordRequired) {
    if (roomSettings.password === providedPassword) {
      //we allow user to join room if password matches.
      return true;
    } else {
      cb({ status: "failed", message: "wrong password" });
      return false;
    }
  } else {
    //we allow user to join room if no room didn't require password.
    return true;
  }
}
