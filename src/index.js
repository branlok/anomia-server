//utility
const path = require("path");
const { nanoid } = require("nanoid");

//server setup
const express = require("express");
const app = express();
const http = require("http");
const server = http.createServer(app);
const { Server } = require("socket.io");
const { RateLimiterMemory } = require("rate-limiter-flexible");

//redis setup
const redisAdapter = require("@socket.io/redis-adapter");
const Redis = require("ioredis");

// const pubClient = new Redis();

const pubClient = new Redis(process.env.REDIS_URL);

const subClient = pubClient.duplicate();

// const io = new Server(server, {
//   cors: {
//     `origin`: "http://localhost:3000",
//     methods: ["GET", "POST"],
//   },
// });

const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

io.adapter(redisAdapter(pubClient, subClient));

const rateLimiter = new RateLimiterMemory({
  points: 15, // 5 points
  duration: 1, // per second
});

const rateLimiterMiddleware = (req, res, next) => {
  rateLimiter.consume(req.ip)
     .then(() => {
         next();
     })
     .catch(_ => {
       console.log("ran")
         res.status(429).send('Too Many Requests');
     });
  };

  app.use(rateLimiterMiddleware);
// app.use(express.static(path.join(__dirname, "build")));

// app.get("/", (req, res) => {
//   res.sendFile(path.join(__dirname, "build", "index.html"));
// });

//Backend
io.use((socket, next) => {
  next();
});




const roomHandler = require("./handlers/RoomHandler");
const gameHandler = require("./handlers/GameHandler");

//CONNECTION
var connectionsLimit = 500
io.on("connection", (socket) => {
  //LOG NEW CONNECTION
  if (io.engine.clientsCount > connectionsLimit) {
    socket.emit('err', { message: 'reach the limit of connections' })
    socket.disconnect()
    console.log('Max connections exceeded, Disconnecting...')
    //! need to consider how to take action when connection reach limit.
    return
  }

  console.log("a user connected", socket.id);
  // USER CREATE NEW ROOM
  roomHandler(io, socket, pubClient, rateLimiter);
  // INITALIZE GAME
  gameHandler(io, socket, pubClient, rateLimiter);
});

server.listen(process.env.PORT || 3001, () => {
  console.log("listening on *:3001");
});

/*
SETUP PARTY FOR GAME
1. CREATE ROOM
2. JOIN ROOM
3. ALL READY UP 

4. START - INITAILIZE GAME DATA

GAME LOGIC
5. USER ROTATION
6. WIN / NO ACTION / PASS
*/
