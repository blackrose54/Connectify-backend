import express from "express";
import { Server, Socket } from "socket.io";
import { createServer } from "node:http";
import router from "./router";
import "dotenv/config";
import Redis from "ioredis";

type FriendRequest = {
  from?: string;
  to?: string;
};

type Message = {
  message: string;
  partnerID: string;
  userID: string;
  timestamp: number;
};

const PORT = process.env.PORT || 5000;

const app = express();
app.use(router);
const server = createServer(app);

const socketMap = new Map<string, Socket>();

if (!process.env.REDIS_URL) throw new Error("REDIS URL not specified");
const redisURL = process.env.REDIS_URL;

const pub = new Redis(redisURL);
const sub = new Redis(redisURL);
sub.subscribe("MESSAGES");
sub.subscribe("FriendRequests");
sub.subscribe("Friends");

const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  socket.data.sessionID = token;
  socketMap.set(token, socket);
  next();
});

io.on("connect", async (socket) => {
  const friends = await pub.smembers(`user:${socket.data.sessionID}:Friends`);

  if (friends) {
    friends.forEach((friend) => {
      if (socketMap.has(friend)) {
        const friendSocket = socketMap.get(friend);
        friendSocket?.emit("online", socket.data.sessionID);
        socket.emit("online", friend);
      } else {
        socket.emit("offline", friend);
      }
    });
  }

  socket.on("event:Message", async (msg) => {
    await pub.publish("MESSAGES", JSON.stringify(msg));
  });
  socket.on("disconnect", () => {
    socketMap.delete(socket.data.sessionID);
    if (friends) {
      friends.forEach((friend) => {
        if (socketMap.has(friend)) {
          const friendSocket = socketMap.get(friend);
          friendSocket?.emit("offline", socket.data.sessionID);
          socket.emit("offline", friend);
        }
      });
    }
  });
  socket.on("event:FriendRequests", async (req) => {
    await pub.publish("FriendRequests", req);
  });
});

sub.on("message", async (channel, message: string) => {
  if (channel === "MESSAGES") {
    const data = JSON.parse(message) as Message;
    let larger: string = data.partnerID;
    let lower: string = data.userID;
    if (data.partnerID < data.userID) {
      larger = data.userID;
      lower = data.partnerID;
    }
    let unread = await pub.zscore(
      `user:messages:${larger}--${lower}`,
      "unread"
    );
    if (!unread)
      await pub.zadd(`user:messages:${larger}--${lower}`, 1, "unread");

    if (socketMap.has(data.partnerID) || socketMap.has(data.userID)) {
      if (!socketMap.has(data.partnerID)) {
        if (unread) {
          pub.zadd(
            `user:messages:${larger}--${lower}`,
            Number(unread) + 1,
            "unread"
          );
        }
      }
      const socketPartner = socketMap.get(data.partnerID);
      socketPartner?.emit("message", data);
      pub.zadd(
        `user:messages:${larger}--${lower}`,
        data.timestamp,
        JSON.stringify(data)
      ); // format- user:messages:${largerValuedID}--${lowerValuedID}
    } else {
      console.log("message socket not found");
    }
  } else if (channel === "FriendRequests") {
    const { from, to } = JSON.parse(message) as FriendRequest;

    if (socketMap.has(to!)) {
      const socket = socketMap.get(to!);
      if (socket) {
        socket.emit("friendRequest", await pub.get(`user:${from}`));
      }
    } else {
      console.log("socket not found!");
    }
  } else if (channel === "Friends") {
    const [acceptor, sender] = message.split(":accepted:");
    console.log(message);
    if (socketMap.has(acceptor)) {
      const socket = socketMap.get(sender);
      const socketacceptor = socketMap.get(acceptor);
      if (socketacceptor) {
        socketacceptor.emit("friendAdd", await pub.get(`user:${sender}`));

        if (socket) {
          socket.emit("friendAdd", await pub.get(`user:${acceptor}`));
          socket.emit("online", acceptor);
          socketacceptor.emit("online", sender);
        } else {
          socketacceptor.emit("offline", sender);

        }
      } else {
        console.log("socket not found");
      }
    } else {
      console.log("socket not found! Friends");
    }
  }
});

server.listen(PORT, () => {
  console.log("listening on port " + PORT);
});
