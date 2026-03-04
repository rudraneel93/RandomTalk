require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { v4: uuidv4 } = require("uuid");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
  pingInterval: 10000,
  pingTimeout: 5000,
});

const PORT = process.env.PORT || 3000;

// ─── Static files ───
app.use(express.static(path.join(__dirname, "public")));
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ─── In-memory state ───
// users[socketId] = { socketId, gender, interests[], mode, roomId, alias, connectedAt }
const users = new Map();

// Queue per mode: { text: [...], video: [...], group: [...] }
const queues = {
  text: [],
  video: [],
  group: [],
};

// rooms[roomId] = { id, users: [socketId, socketId], startedAt, messageCount }
const rooms = new Map();

// Shared group room (simple lobby)
const GROUP_ROOM = "group-lobby";
const groupMessages = []; // last 50

// ─── Helpers ───
function broadcastOnlineCount() {
  io.emit("online_count", users.size);
}

function getQueueCount() {
  return queues.text.length + queues.video.length + queues.group.length;
}

// Interest overlap score (0-10)
function interestScore(a, b) {
  if (!a.length || !b.length) return 0;
  const setB = new Set(b);
  return a.filter((i) => setB.has(i)).length;
}

// Find best match in queue for a user
function findMatch(queue, user) {
  if (queue.length === 0) return null;

  // Try interest-match first (score >= 1)
  let bestIdx = -1;
  let bestScore = -1;
  for (let i = 0; i < queue.length; i++) {
    const candidate = users.get(queue[i]);
    if (!candidate) continue;
    // Skip same gender filter (future: gender prefs)
    const score = interestScore(user.interests, candidate.interests);
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }

  // If no interest match, just pick the first in queue (FIFO)
  if (bestScore === 0 && queue.length > 0) {
    bestIdx = 0;
  }

  if (bestIdx === -1) return null;
  return queue.splice(bestIdx, 1)[0]; // remove from queue and return
}

function removeFromQueue(socketId) {
  for (const mode of ["text", "video", "group"]) {
    const idx = queues[mode].indexOf(socketId);
    if (idx !== -1) {
      queues[mode].splice(idx, 1);
      break;
    }
  }
}

function endRoom(roomId, reason = "ended") {
  const room = rooms.get(roomId);
  if (!room) return;
  for (const sid of room.users) {
    const sock = io.sockets.sockets.get(sid);
    if (sock) {
      sock.leave(roomId);
      sock.emit("chat_ended", { reason });
      const u = users.get(sid);
      if (u) u.roomId = null;
    }
  }
  rooms.delete(roomId);
}

function tryMatch(socketId) {
  const user = users.get(socketId);
  if (!user) return;
  const queue = queues[user.mode];

  const partnerId = findMatch(queue, user);
  if (!partnerId) {
    // No match yet — add self to queue
    if (!queue.includes(socketId)) {
      queue.push(socketId);
    }
    io.to(socketId).emit("queued", { position: queue.length });
    return;
  }

  const partner = users.get(partnerId);
  if (!partner) {
    // Stale queue entry, try again
    tryMatch(socketId);
    return;
  }

  // Pair them in a room
  const roomId = uuidv4();
  const room = { id: roomId, users: [socketId, partnerId], startedAt: Date.now(), messageCount: 0 };
  rooms.set(roomId, room);

  user.roomId = roomId;
  partner.roomId = roomId;

  const userSock = io.sockets.sockets.get(socketId);
  const partnerSock = io.sockets.sockets.get(partnerId);

  if (userSock) userSock.join(roomId);
  if (partnerSock) partnerSock.join(roomId);

  const sharedInterests = user.interests.filter((i) => partner.interests.includes(i));

  io.to(socketId).emit("matched", {
    roomId,
    partnerAlias: partner.alias,
    partnerGender: partner.gender,
    sharedInterests,
    mode: user.mode,
    isInitiator: true,   // person who was waiting creates the offer
  });
  io.to(partnerId).emit("matched", {
    roomId,
    partnerAlias: user.alias,
    partnerGender: user.gender,
    sharedInterests,
    mode: user.mode,
    isInitiator: false,  // person who just matched waits for offer
  });
}

// ─── Aliases (anonymous) ───
const adjectives = ["Swift","Cosmic","Silver","Neon","Arctic","Blazing","Quiet","Golden","Velvet","Shadow","Crystal","Mystic","Bold","Calm","Wild"];
const nouns = ["Fox","Star","Wolf","River","Hawk","Comet","Panda","Storm","Ember","Tide","Raven","Phoenix","Lynx","Sage","Sprite"];
function randomAlias() {
  const a = adjectives[Math.floor(Math.random() * adjectives.length)];
  const n = nouns[Math.floor(Math.random() * nouns.length)];
  const num = Math.floor(Math.random() * 90) + 10;
  return `${a}${n}${num}`;
}

// ─── Socket.io events ───
io.on("connection", (socket) => {
  console.log(`[+] Connected: ${socket.id}`);

  // Register user
  socket.on("register", ({ gender = "unspecified", interests = [], mode = "text" } = {}) => {
    const user = {
      socketId: socket.id,
      gender,
      interests: interests.slice(0, 10), // cap at 10
      mode,
      roomId: null,
      alias: randomAlias(),
      connectedAt: Date.now(),
    };
    users.set(socket.id, user);
    broadcastOnlineCount();
    socket.emit("registered", { alias: user.alias });
    console.log(`[register] ${socket.id} alias=${user.alias} mode=${mode} interests=${interests.join(",")}`);
  });

  // Join matchmaking queue
  socket.on("find_match", ({ mode = "text" } = {}) => {
    const user = users.get(socket.id);
    if (!user) {
      socket.emit("error_msg", "Please register first.");
      return;
    }

    // Leave any existing room
    if (user.roomId) {
      endRoom(user.roomId, "skipped");
    }

    user.mode = mode;
    removeFromQueue(socket.id);

    if (mode === "group") {
      // Group mode: just join the shared lobby
      socket.join(GROUP_ROOM);
      user.roomId = GROUP_ROOM;
      socket.emit("joined_group", {
        roomId: GROUP_ROOM,
        recentMessages: groupMessages.slice(-50),
        onlineInGroup: io.sockets.adapter.rooms.get(GROUP_ROOM)?.size || 1,
      });
      io.to(GROUP_ROOM).emit("group_user_count", io.sockets.adapter.rooms.get(GROUP_ROOM)?.size || 1);
    } else {
      tryMatch(socket.id);
    }
  });

  // Send message
  socket.on("message", ({ text } = {}) => {
    const user = users.get(socket.id);
    if (!user || !user.roomId || !text) return;
    text = text.toString().trim().slice(0, 2000); // cap length
    if (!text) return;

    const payload = {
      text,
      from: socket.id,
      alias: user.alias,
      timestamp: Date.now(),
    };

    if (user.roomId === GROUP_ROOM) {
      groupMessages.push(payload);
      if (groupMessages.length > 200) groupMessages.shift();
      io.to(GROUP_ROOM).emit("message", payload);
    } else {
      const room = rooms.get(user.roomId);
      if (!room) return;
      room.messageCount++;
      io.to(user.roomId).emit("message", payload);
    }
  });

  // Typing indicator
  socket.on("typing", ({ isTyping } = {}) => {
    const user = users.get(socket.id);
    if (!user || !user.roomId || user.roomId === GROUP_ROOM) return;
    socket.to(user.roomId).emit("partner_typing", { isTyping });
  });

  // Skip / next stranger
  socket.on("skip", () => {
    const user = users.get(socket.id);
    if (!user) return;

    if (user.roomId && user.roomId !== GROUP_ROOM) {
      endRoom(user.roomId, "skipped");
    }

    // Re-queue
    removeFromQueue(socket.id);
    tryMatch(socket.id);
  });

  // Leave chat (stop looking)
  socket.on("leave_chat", () => {
    const user = users.get(socket.id);
    if (!user) return;
    if (user.roomId) {
      if (user.roomId === GROUP_ROOM) {
        socket.leave(GROUP_ROOM);
        user.roomId = null;
        io.to(GROUP_ROOM).emit("group_user_count", io.sockets.adapter.rooms.get(GROUP_ROOM)?.size || 0);
      } else {
        endRoom(user.roomId, "left");
      }
    }
    removeFromQueue(socket.id);
    socket.emit("left_chat");
  });

  // ─── WebRTC Signaling ───
  socket.on("webrtc_offer", ({ offer } = {}) => {
    const user = users.get(socket.id);
    if (!user || !user.roomId || user.roomId === GROUP_ROOM) return;
    socket.to(user.roomId).emit("webrtc_offer", { offer });
  });
  socket.on("webrtc_answer", ({ answer } = {}) => {
    const user = users.get(socket.id);
    if (!user || !user.roomId || user.roomId === GROUP_ROOM) return;
    socket.to(user.roomId).emit("webrtc_answer", { answer });
  });
  socket.on("webrtc_ice_candidate", ({ candidate } = {}) => {
    const user = users.get(socket.id);
    if (!user || !user.roomId || user.roomId === GROUP_ROOM) return;
    socket.to(user.roomId).emit("webrtc_ice_candidate", { candidate });
  });

  // Report user
  socket.on("report", ({ reason = "no reason given" } = {}) => {
    const user = users.get(socket.id);
    if (!user || !user.roomId) return;
    const room = rooms.get(user.roomId);
    if (!room) return;
    const partnerId = room.users.find((id) => id !== socket.id);
    console.log(`[REPORT] ${socket.id} reported ${partnerId}: ${reason}`);
    socket.emit("report_received");
  });

  // Disconnect
  socket.on("disconnect", () => {
    const user = users.get(socket.id);
    if (user) {
      if (user.roomId && user.roomId !== GROUP_ROOM) {
        endRoom(user.roomId, "disconnected");
      } else if (user.roomId === GROUP_ROOM) {
        io.to(GROUP_ROOM).emit("group_user_count", (io.sockets.adapter.rooms.get(GROUP_ROOM)?.size || 1) - 1);
      }
      removeFromQueue(socket.id);
      users.delete(socket.id);
    }
    broadcastOnlineCount();
    console.log(`[-] Disconnected: ${socket.id}`);
  });
});

// ─── Broadcast online count every 5s ───
setInterval(broadcastOnlineCount, 5000);

// ─── Health check ───
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    online: users.size,
    queues: {
      text: queues.text.length,
      video: queues.video.length,
      group: queues.group.length,
    },
    rooms: rooms.size,
    uptime: process.uptime(),
  });
});

// ─── Start ───
server.listen(PORT, () => {
  console.log(`\n🟢 RandomTalk server running on http://localhost:${PORT}\n`);
});
