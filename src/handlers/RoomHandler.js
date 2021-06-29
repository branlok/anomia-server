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

module.exports = async (io, socket, pubClient, rateLimiter) => {
  const createPartyRoom = async (username, password, cb) => {
    //START OF SET UP ROOM
    let roomCode = nanoid(6);
    //Shuffle Cards
    let cards = [
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21,
      22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39,
      40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57,
      58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75,
      76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93,
      94, 95, 96, 97, 98, 99, 100,
    ];
    let shuffledCards = shuffle(cards);
    setCards(pubClient, roomCode, shuffledCards); // dont need to await

    await rateLimiter.consume(socket.handshake.address);
    await createGameData(pubClient, roomCode, username, password, socket.id); //also creator into game:room:members
    await setMemberToGame(pubClient, roomCode, username, socket.id);
    await expireGame(pubClient, roomCode);

    socket.join(roomCode);
    //END OF SET  UP

    //RELAY BACK TO CLIENT
    // cb({ status: "success", connectedRoom: roomCode, username,  });
    await setMemberToGame(pubClient, roomCode, username, socket.id);
    let members = await getGameMembersData(pubClient, roomCode); //{id: username}

    cb({
      status: "success",
      connectedRoom: roomCode,
      username,
      currentMembers: members,
      [socket.id]: {
        id: socket.id,
        username: username,
        ready: true,
      },
    });

    io.to(roomCode).emit("roomUpdates", {
      currentMembers: members,
      [socket.id]: {
        id: socket.id,
        username: username,
        ready: true,
      },
    });
  };

  const joinPartyRoom = async (roomCode, username, password, cb) => {
    //CHECK REQUIREMENTS TO JOIN
    if (!confirmRoomInitialized(io, cb, roomCode)) return; //should also add  is only open if the game is in lobby mode incase random person joins in during game.
    if (!confirmRoomHasCapacity(io, cb, roomCode)) return;
    let roomSettings = await getGameRoomData(pubClient, roomCode);
    if (!confirmRoomRequirePassword(cb, roomSettings, password)) return;

    //RELAY NECESSARY DATA BACK TO USER
    await rateLimiter.consume(socket.handshake.address);
    await setMemberToGame(pubClient, roomCode, username, socket.id);
    await setMemberNotReady(pubClient, roomCode, socket.id);
    let members = await getGameMembersData(pubClient, roomCode);

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
      roomState: {
        message: `${username} joined`,
        currentMembers: members,
        ...memberDetails,
      },
    });
    io.to(roomCode).emit("roomUpdates", {
      //   message: `${username} joined`,
      message: `${username} joined`,
      currentMembers: members,
      ...memberDetails,
      //   [roomSettings.creator]: {
      //     id: roomSettings.creator,
      //     username: roomSettings.creatorUsername,
      //     ready: true,
      //   },
      //   [socket.id]: {

      //     id: socket.id,
      //     username: username,
      //     ready: false,
      //   },
    });

    //DOUBLE CHECK TO SEE IF ALL USERS ARE READY.
    await checkAllIsReady(pubClient, io, roomCode);
  };

  const userReady = async (roomCode, username, cb) => {
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
  };

  const userNotReady = async (roomCode, username, cb) => {
    if (!confirmUserFromRoom(cb, socket, roomCode)) return;
    await setMemberNotReady(pubClient, roomCode, socket.id);

    io.to(roomCode).emit("roomUpdates", {
      //   action: "togglePlayerStatus",
      [socket.id]: {
        id: socket.id,
        username: username,
        ready: false,
      },
    });

    await checkAllIsReady(pubClient, io, roomCode);
    cb({ status: "success", message: "toggled not Ready" });
  };

  const cleanUpOnDisconnect = async () => {
    console.log(socket.rooms);
    let promiseArray = [];
    socket.rooms.forEach((item) => {
      promiseArray.push(pubClient.hdel(`game:${item}`, socket.id));
      promiseArray.push(pubClient.hdel(`game:${item}:members`, socket.id));
    });

    socket.rooms.forEach(async (item) => {
      //rather than playerjoinroom, this should be more generic like playercountupdate
      let members = await getGameMembersData(pubClient, item);
      io.to(item).emit("roomUpdates", {
        // message: `${socket.id} left`,
        currentMembers: members,
      });
    });

    console.log(await Promise.all(promiseArray));
  };

  let checkRoom = (roomCode, cb) => {
    console.log("i ran for some reason");
    if (!confirmRoomInitialized(io, cb, roomCode)) {
      cb({ status: "error", message: "room does not exist" });
      return;
    } //should also add  is only open if the game is in lobby mode incase random person joins in during game.
    if (!confirmRoomHasCapacity(io, cb, roomCode)) return;
  };

  const passwordInquiry = async (roomCode, cb) => {
    await rateLimiter.consume(socket.handshake.address);
    let roomSettings = await getGameRoomData(pubClient, roomCode); 
    // let roomSettings = await pubClient.hgetall(`game:${roomCode}`);
    if (!roomSettings) {
      cb({ status: "failed", message: "game not found" });
      return;
    }
    let passwordLocked = roomSettings.passwordLocked == "true" ? true : false;
    cb({ status: "success", password: passwordLocked });
    // io.room(socket.id).emit("passwordInquiry", {})
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
  console.log(room);
  let fetchPlayerStatus = [];

  room.forEach((item) => {
    console.log(isMemberReady(pubClient, roomCode, item));
    fetchPlayerStatus.push(isMemberReady(pubClient, roomCode, item));
  });

  let playerStatus = await Promise.all(fetchPlayerStatus);
  console.log(playerStatus, "eh");

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
