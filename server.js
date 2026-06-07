const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*"
  }
});

const PORT = process.env.PORT || 3000;

app.use(express.static("public"));

const GAME_WIDTH = 400;
const GAME_HEIGHT = 700;

const PADDLE_WIDTH = 100;
const PADDLE_HEIGHT = 18;
const BALL_SIZE = 14;

let players = [];
let gameRunning = false;

const gameState = {
  ball: {
    x: GAME_WIDTH / 2,
    y: GAME_HEIGHT / 2,
    vx: 4,
    vy: 4
  },

  paddles: {
    player1: GAME_WIDTH / 2 - PADDLE_WIDTH / 2,
    player2: GAME_WIDTH / 2 - PADDLE_WIDTH / 2
  },

  score: {
    player1: 0,
    player2: 0
  }
};

function randomDirection() {
  return Math.random() > 0.5 ? 1 : -1;
}

function resetBall() {
  gameState.ball.x = GAME_WIDTH / 2;
  gameState.ball.y = GAME_HEIGHT / 2;

  gameState.ball.vx = randomDirection() * (4 + Math.random() * 2);
  gameState.ball.vy = randomDirection() * (4 + Math.random() * 2);
}

function resetGame() {
  gameState.score.player1 = 0;
  gameState.score.player2 = 0;

  gameState.paddles.player1 =
    GAME_WIDTH / 2 - PADDLE_WIDTH / 2;

  gameState.paddles.player2 =
    GAME_WIDTH / 2 - PADDLE_WIDTH / 2;

  resetBall();
}

function pauseGame() {
  gameRunning = false;
}

function startGame() {
  if (players.length !== 2) return;

  resetGame();
  gameRunning = true;

  io.emit("game_start", {
    message: "Game Started"
  });

  console.log("Game started");
}

function emitWaiting() {
  io.emit("waiting", {
    players: players.length,
    message: "Waiting for second player..."
  });
}

io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  socket.on("join_game", () => {
    if (players.length >= 2) {
      socket.emit("waiting", {
        message: "Room Full"
      });
      return;
    }

    const playerNumber = players.length + 1;

    players.push({
      id: socket.id,
      number: playerNumber
    });

    socket.playerNumber = playerNumber;

    console.log(
      `Player ${playerNumber} joined (${socket.id})`
    );

    if (players.length < 2) {
      emitWaiting();
    } else {
      startGame();
    }
  });

  socket.on("paddle_move", (x) => {
    if (!socket.playerNumber) return;

    const clamped = Math.max(
      0,
      Math.min(GAME_WIDTH - PADDLE_WIDTH, x)
    );

    if (socket.playerNumber === 1) {
      gameState.paddles.player1 = clamped;
    } else {
      gameState.paddles.player2 = clamped;
    }
  });

  socket.on("disconnect", () => {
    console.log("Disconnected:", socket.id);

    players = players.filter(
      p => p.id !== socket.id
    );

    pauseGame();

    io.emit("player_disconnected", {
      message: "Player disconnected"
    });

    emitWaiting();
  });
});

function gameLoop() {
  if (!gameRunning) return;
  if (players.length < 2) return;

  const ball = gameState.ball;

  ball.x += ball.vx;
  ball.y += ball.vy;

  if (ball.x <= 0) {
    ball.x = 0;
    ball.vx *= -1;
  }

  if (ball.x >= GAME_WIDTH - BALL_SIZE) {
    ball.x = GAME_WIDTH - BALL_SIZE;
    ball.vx *= -1;
  }

  const paddleTopY = 20;
  const paddleBottomY = GAME_HEIGHT - 40;

  if (
    ball.y <= paddleTopY + PADDLE_HEIGHT &&
    ball.y + BALL_SIZE >= paddleTopY &&
    ball.x + BALL_SIZE >= gameState.paddles.player2 &&
    ball.x <=
      gameState.paddles.player2 + PADDLE_WIDTH
  ) {
    ball.vy = Math.abs(ball.vy);
  }

  if (
    ball.y + BALL_SIZE >= paddleBottomY &&
    ball.y <= paddleBottomY + PADDLE_HEIGHT &&
    ball.x + BALL_SIZE >= gameState.paddles.player1 &&
    ball.x <=
      gameState.paddles.player1 + PADDLE_WIDTH
  ) {
    ball.vy = -Math.abs(ball.vy);
  }

  if (ball.y < 0) {
    gameState.score.player1++;

    if (gameState.score.player1 >= 5) {
      gameRunning = false;

      io.emit("game_over", {
        winner: 1,
        score: gameState.score
      });

      return;
    }

    resetBall();
  }

  if (ball.y > GAME_HEIGHT) {
    gameState.score.player2++;

    if (gameState.score.player2 >= 5) {
      gameRunning = false;

      io.emit("game_over", {
        winner: 2,
        score: gameState.score
      });

      return;
    }

    resetBall();
  }

  io.emit("game_state", {
    width: GAME_WIDTH,
    height: GAME_HEIGHT,

    ball: {
      x: gameState.ball.x,
      y: gameState.ball.y
    },

    paddles: {
      player1: gameState.paddles.player1,
      player2: gameState.paddles.player2
    },

    score: gameState.score
  });
}

setInterval(gameLoop, 1000 / 60);

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
