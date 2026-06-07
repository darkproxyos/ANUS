const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  transports: ["websocket", "polling"],
});

app.use(cors());
app.use(express.static(path.join(__dirname, "public")));

const ROUND_DURATION = 20;
const MAX_PLAYERS = 8;
const rooms = {};

function createRoom(id) {
  return { id, players: {}, scores: {}, guesses: {},
           phase: "waiting", secret: null, round: 0,
           timeLeft: ROUND_DURATION, timer: null };
}
function room(id) {
  if (!rooms[id]) rooms[id] = createRoom(id);
  return rooms[id];
}
function publicPlayers(r) {
  return Object.values(r.players).map(p => ({
    id: p.id, name: p.name,
    score: r.scores[p.id] || 0,
    guessed: r.guesses[p.id] !== undefined,
  }));
}
function startRound(roomId) {
  const r = rooms[roomId];
  if (!r) return;
  r.phase = "playing";
  r.secret = Math.floor(Math.random() * 100) + 1;
  r.guesses = {};
  r.round += 1;
  r.timeLeft = ROUND_DURATION;
  io.to(roomId).emit("round_start", { round: r.round, timeLeft: r.timeLeft, players: publicPlayers(r) });
  if (r.timer) clearInterval(r.timer);
  r.timer = setInterval(() => {
    r.timeLeft -= 1;
    io.to(roomId).emit("timer", { timeLeft: r.timeLeft });
    if (r.timeLeft <= 0) { clearInterval(r.timer); endRound(roomId); }
  }, 1000);
}
function endRound(roomId) {
  const r = rooms[roomId];
  if (!r) return;
  r.phase = "results";
  if (r.timer) clearInterval(r.timer);
  const results = Object.values(r.players).map(p => {
    const g = r.guesses[p.id];
    const diff = g !== undefined ? Math.abs(g - r.secret) : 999;
    const pts = g !== undefined ? Math.max(0, 100 - diff * 5) : 0;
    r.scores[p.id] = (r.scores[p.id] || 0) + pts;
    return { id: p.id, name: p.name, guess: g ?? "—", diff: g !== undefined ? diff : "—",
             points: pts, total: r.scores[p.id] };
  }).sort((a, b) => b.total - a.total);
  io.to(roomId).emit("round_end", { secret: r.secret, results, round: r.round });
  setTimeout(() => {
    if (rooms[roomId] && Object.keys(rooms[roomId].players).length >= 1) startRound(roomId);
  }, 5000);
}

io.on("connection", socket => {
  socket.on("join_room", ({ roomId, playerName }) => {
    const r = room(roomId);
    if (Object.keys(r.players).length >= MAX_PLAYERS)
      return socket.emit("err", { msg: "Sala llena" });
    const name = (playerName || "Jugador").slice(0, 16).trim() || "Jugador";
    r.players[socket.id] = { id: socket.id, name };
    r.scores[socket.id] = r.scores[socket.id] || 0;
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.emit("joined", {
      playerId: socket.id,
      room: { id: r.id, phase: r.phase, round: r.round, timeLeft: r.timeLeft, players: publicPlayers(r) },
    });
    socket.to(roomId).emit("player_joined", { player: { id: socket.id, name, score: 0, guessed: false }, players: publicPlayers(r) });
    if (r.phase === "waiting" && Object.keys(r.players).length >= 1) {
      setTimeout(() => {
        const rr = rooms[roomId];
        if (rr && rr.phase === "waiting" && Object.keys(rr.players).length >= 1) startRound(roomId);
      }, 2000);
    }
  });
  socket.on("submit_guess", ({ guess }) => {
    const r = rooms[socket.data.roomId];
    if (!r || r.phase !== "playing") return;
    const n = parseInt(guess);
    if (isNaN(n) || n < 1 || n > 100) return socket.emit("err", { msg: "Número entre 1 y 100" });
    if (r.guesses[socket.id] !== undefined) return socket.emit("err", { msg: "Ya enviaste tu respuesta" });
    r.guesses[socket.id] = n;
    socket.emit("guess_accepted", { guess: n });
    io.to(socket.data.roomId).emit("player_guessed", { players: publicPlayers(r) });
    if (Object.keys(r.guesses).length >= Object.keys(r.players).length) {
      clearInterval(r.timer);
      endRound(socket.data.roomId);
    }
  });
  socket.on("disconnect", () => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms[roomId]) return;
    const r = rooms[roomId];
    const p = r.players[socket.id];
    if (p) {
      delete r.players[socket.id];
      socket.to(roomId).emit("player_left", { playerId: socket.id, playerName: p.name, players: publicPlayers(r) });
    }
    if (Object.keys(r.players).length === 0) {
      if (r.timer) clearInterval(r.timer);
      delete rooms[roomId];
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🎮 http://localhost:${PORT}`));
