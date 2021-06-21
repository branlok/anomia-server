//utility
const path = require("path");
const { nanoid } = require("nanoid");

//server setup
const express = require("express");
const app = express();
const http = require("http");
const server = http.createServer(app);
const { Server } = require("socket.io");

//redis setup
const redisAdapter = require("@socket.io/redis-adapter");
const Redis = require("ioredis");

// const pubClient = new Redis();

const pubClient = new Redis(process.env.REDIS_URL);

const subClient = pubClient.duplicate();

// const io = new Server(server, {
//   cors: {
//     origin: "http://localhost:3000",
//     methods: ["GET", "POST"],
//   },
// });

const io = new Server(server, {
    cors: {
      origin: "*",
    },
  });


io.adapter(redisAdapter(pubClient, subClient));

app.use(express.static(path.join(__dirname, "build")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "build", "index.html"));
});

//Backend
io.use((socket, next) => {
  //rate limiting implementation
  next();
});

const roomHandler = require('./handlers/RoomHandler'); 

const gameHandler = require('./handlers/GameHandler'); 

//CONNECTION

io.on("connection", (socket) => {
  //LOG NEW CONNECTION
  console.log("a user connected", socket.id);
  // USER CREATE NEW ROOM
  roomHandler(io, socket, pubClient);

  // INITALIZE GAME
  gameHandler(io, socket, pubClient);


//   socket.on("leaveRoom", (roomCode, cb) => {
//     socket.leave(roomCode);
//     cb({ status: "success", message: "left room" });
//   });

//   socket.on("startGame", (roomCode, username, cb) => {
//     //blocked a ui end,
//     //leader starts game
//     //instantiate game
//     //run logic if game is in starting
//     if (passwordProtectedRooms[roomCode].status == "lobby") {
//       passwordProtectedRooms[roomCode].status = "initializing";
//       console.log(passwordProtectedRooms[roomCode].status);
//       let playersCards = {};
//       let playerPoints = {};
//       for (let member of passwordProtectedRooms[roomCode].members) {
//         playersCards[member] = [];
//         playerPoints[member] = 0;
//       }
//       passwordProtectedRooms[roomCode].shuffledDeck = [1, 2, 3, 4, 5]; //should keep this on server side.
//       let game = {
//         cardsLeft: 5,
//         playerPoints,
//         wildcard: [],
//         attention: [],
//         whoseTurn: username, //the leader starts first
//         turnsPassed: 0,
//         ...playersCards,
//       };

//       passwordProtectedRooms[roomCode].game = game;
//       io.to(roomCode).emit("game:started", game);
//     } else {
//       cb({ status: "failed", message: "do not spam" });
//     }
//   });

//   socket.on("draw", (roomCode, username, cb) => {
//     //leader starts game
//     //insantiate game
//     let game = passwordProtectedRooms[roomCode].game;
//     let shuffledDeck = passwordProtectedRooms[roomCode].shuffledDeck;
//     if (game.whoseTurn == username) {
//       let newCard = shuffledDeck.pop();
//       if (game.cardsLeft == 0) {
//         //status: ending
//       }
//       game.cardsLeft--;
//       game[game.whoseTurn].push(newCard);
//       game.whoseTurn =
//         passwordProtectedRooms[roomCode].members[
//           (passwordProtectedRooms[roomCode].members.indexOf(game.whoseTurn) +
//             1) %
//             passwordProtectedRooms[roomCode].members.length
//         ]; //theres got to be a more elegant approach lol
//       game.turnsPassed++;
//     }
//     io.to(roomCode).emit("playerDrawed", game);
//   });
});

server.listen(process.env.PORT || 5000, () => {
  console.log("listening on *:3001");
});
