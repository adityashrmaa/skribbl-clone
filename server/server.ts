import express from "express";
import cors from "cors";
import http from "http";
import { Server } from "socket.io";

const app = express();

const CLIENT_URL =
  process.env.CLIENT_URL || "http://localhost:5173";

app.use(
  cors({
    origin: CLIENT_URL,
  })
);

app.use(express.json());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: CLIENT_URL,
    methods: ["GET", "POST"],
  },
});

// ============================================================
// TYPES
// ============================================================

interface RoomSettings {
  maxPlayers: number;
  rounds: number;
  drawTime: number;
  wordChoices: number;
  hints: number;
  isPrivate: boolean;
}

interface Player {
  id: string;
  name: string;
  ready: boolean;
  score: number;
}

type GameState =
  | "lobby"
  | "choosing_word"
  | "playing"
  | "game_over";

interface Room {
  id: string;
  hostId: string;

  players: Player[];

  settings: RoomSettings;

  gameState: GameState;

  drawerId: string | null;

  drawerIndex: number;

  wordOptions: string[];

  selectedWord: string;

  currentRound: number;

  guessedPlayerIds: string[];

  hintsUsed: number;

  revealedIndexes: number[];

  roundEndsAt: number | null;

  roundTimer: ReturnType<typeof setTimeout> | null;

  roundVersion: number;
}

// ============================================================
// DATA
// ============================================================

const rooms = new Map<string, Room>();

const WORDS = [
  "apple",
  "banana",
  "car",
  "house",
  "tree",
  "computer",
  "phone",
  "pizza",
  "burger",
  "cat",
  "dog",
  "elephant",
  "tiger",
  "lion",
  "guitar",
  "football",
  "basketball",
  "airplane",
  "rocket",
  "sun",
  "moon",
  "star",
  "ocean",
  "mountain",
  "river",
  "school",
  "book",
  "camera",
  "robot",
  "flower",
  "rainbow",
  "castle",
  "bridge",
  "train",
  "bicycle",
  "ice cream",
  "coffee",
  "pizza",
  "hamburger",
  "dragon",
  "superhero",
  "beach",
  "island",
  "hospital",
  "doctor",
  "firefighter",
  "police",
  "king",
  "queen",
  "pirate",
  "ghost",
];

// ============================================================
// DEFAULT SETTINGS
// ============================================================

const DEFAULT_SETTINGS: RoomSettings = {
  maxPlayers: 8,
  rounds: 3,
  drawTime: 60,
  wordChoices: 3,
  hints: 2,
  isPrivate: false,
};

// ============================================================
// HELPERS
// ============================================================

function generateRoomId(): string {
  const characters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  let roomId = "";

  do {
    roomId = "";

    for (let i = 0; i < 6; i++) {
      roomId +=
        characters[
          Math.floor(
            Math.random() * characters.length
          )
        ];
    }
  } while (rooms.has(roomId));

  return roomId;
}

function normalizeName(name: string): string {
  return String(name || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 20);
}

function normalizeGuess(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function clamp(
  value: number,
  min: number,
  max: number
): number {
  return Math.min(
    Math.max(value, min),
    max
  );
}

function getRandomWords(count: number): string[] {
  const shuffled = [...WORDS];

  for (
    let i = shuffled.length - 1;
    i > 0;
    i--
  ) {
    const j = Math.floor(
      Math.random() * (i + 1)
    );

    [shuffled[i], shuffled[j]] = [
      shuffled[j],
      shuffled[i],
    ];
  }

  return shuffled.slice(0, count);
}

function clearRoundTimer(room: Room) {
  if (room.roundTimer) {
    clearTimeout(room.roundTimer);

    room.roundTimer = null;
  }
}

function leaderboard(room: Room) {
  return [...room.players].sort(
    (a, b) => b.score - a.score
  );
}

// ============================================================
// BROADCAST HELPERS
// ============================================================

function broadcastPlayers(room: Room) {
  io.to(room.id).emit("player_list", {
    players: room.players,
    hostId: room.hostId,
  });
}

function broadcastSettings(room: Room) {
  io.to(room.id).emit("room_settings", {
    settings: room.settings,
  });
}

function broadcastGameState(room: Room) {
  io.to(room.id).emit("game_state", {
    state: room.gameState,
    drawerId: room.drawerId,
    currentRound: room.currentRound,
    totalRounds: room.settings.rounds,
  });
}

function sendWordState(room: Room) {
  if (!room.selectedWord) {
    return;
  }

  const word = room.selectedWord;

  const revealed = new Set(
    room.revealedIndexes
  );

  let masked = "";

  for (let i = 0; i < word.length; i++) {
    const character = word[i];

    if (character === " ") {
      masked += " ";
    } else if (revealed.has(i)) {
      masked += character;
    } else {
      masked += "_";
    }

    if (
      i < word.length - 1 &&
      character !== " " &&
      word[i + 1] !== " "
    ) {
      masked += " ";
    }
  }

  io.to(room.id).emit("word_state", {
    word: masked,
  });
}

// ============================================================
// ROUND START
// ============================================================

function startChoosingWord(room: Room) {
  clearRoundTimer(room);

  if (room.players.length < 2) {
    room.gameState = "lobby";

    broadcastGameState(room);

    return;
  }

  room.gameState = "choosing_word";

  room.selectedWord = "";

  room.guessedPlayerIds = [];

  room.hintsUsed = 0;

  room.revealedIndexes = [];

  room.wordOptions = getRandomWords(
    clamp(
      room.settings.wordChoices,
      1,
      5
    )
  );

  const drawer =
    room.players[
      room.drawerIndex %
        room.players.length
    ];

  room.drawerId = drawer.id;

  io.to(room.id).emit("round_state", {
    state: "choosing_word",
    drawerId: room.drawerId,
    currentRound: room.currentRound,
    totalRounds: room.settings.rounds,
  });

  io.to(room.id).emit("clear_canvas");

  io.to(room.drawerId).emit(
    "word_options",
    {
      words: room.wordOptions,
    }
  );

  broadcastGameState(room);
}

// ============================================================
// START ROUND
// ============================================================

function startRound(
  room: Room,
  word: string
) {
  if (!room.selectedWord) {
    room.selectedWord = word;
  }

  room.gameState = "playing";

  room.guessedPlayerIds = [];

  room.hintsUsed = 0;

  room.revealedIndexes = [];

  const duration =
    room.settings.drawTime * 1000;

  const endsAt =
    Date.now() + duration;

  room.roundEndsAt = endsAt;

  room.roundVersion++;

  const currentVersion =
    room.roundVersion;

  io.to(room.id).emit(
    "round_started",
    {
      drawerId: room.drawerId,
      currentRound: room.currentRound,
      totalRounds: room.settings.rounds,
      duration: room.settings.drawTime,
      endsAt,
    }
  );

  io.to(room.id).emit(
    "clear_canvas"
  );

  // Drawer gets the actual word
  if (room.drawerId) {
    io.to(room.drawerId).emit(
      "drawer_word",
      {
        word: room.selectedWord,
      }
    );
  }

  sendWordState(room);

  broadcastGameState(room);

  clearRoundTimer(room);

  room.roundTimer = setTimeout(() => {
    if (
      room.roundVersion !==
      currentVersion
    ) {
      return;
    }

    endRound(room);
  }, duration);
}

// ============================================================
// END ROUND
// ============================================================

function endRound(room: Room) {
  if (
    room.gameState !== "playing"
  ) {
    return;
  }

  clearRoundTimer(room);

  room.gameState = "choosing_word";

  const answer = room.selectedWord;

  io.to(room.id).emit(
    "round_ended",
    {
      selectedWord: answer,
      currentRound: room.currentRound,
    }
  );

  // Small delay before next round
  setTimeout(() => {
    if (!rooms.has(room.id)) {
      return;
    }

    if (
      room.currentRound >=
      room.settings.rounds
    ) {
      finishGame(room);

      return;
    }

    room.currentRound++;

    room.drawerIndex =
      (room.drawerIndex + 1) %
      room.players.length;

    startChoosingWord(room);
  }, 2500);
}

// ============================================================
// FINISH GAME
// ============================================================

function finishGame(room: Room) {
  clearRoundTimer(room);

  room.gameState = "game_over";

  room.roundEndsAt = null;

  const finalLeaderboard =
    leaderboard(room);

  const winner =
    finalLeaderboard.length > 0
      ? finalLeaderboard[0]
      : null;

  io.to(room.id).emit(
    "game_over",
    {
      winner,
      leaderboard:
        finalLeaderboard,
    }
  );

  broadcastGameState(room);
}

// ============================================================
// SOCKET CONNECTION
// ============================================================

io.on("connection", (socket) => {
  console.log(
    `Player connected: ${socket.id}`
  );

  // ==========================================================
  // CREATE ROOM
  // ==========================================================

  socket.on(
    "create_room",
    (data) => {
      const playerName =
        normalizeName(
          data?.playerName
        );

      if (!playerName) {
        socket.emit(
          "error_message",
          "Please enter your name."
        );

        return;
      }

      const roomId =
        generateRoomId();

      const incomingSettings =
        data?.settings || {};

      const settings: RoomSettings =
        {
          maxPlayers: clamp(
            Number(
              incomingSettings.maxPlayers ??
                DEFAULT_SETTINGS.maxPlayers
            ),
            2,
            20
          ),

          rounds: clamp(
            Number(
              incomingSettings.rounds ??
                DEFAULT_SETTINGS.rounds
            ),
            2,
            10
          ),

          drawTime: clamp(
            Number(
              incomingSettings.drawTime ??
                DEFAULT_SETTINGS.drawTime
            ),
            15,
            240
          ),

          wordChoices: clamp(
            Number(
              incomingSettings.wordChoices ??
                DEFAULT_SETTINGS.wordChoices
            ),
            1,
            5
          ),

          hints: clamp(
            Number(
              incomingSettings.hints ??
                DEFAULT_SETTINGS.hints
            ),
            0,
            5
          ),

          isPrivate:
            Boolean(
              incomingSettings.isPrivate
            ),
        };

      const player: Player = {
        id: socket.id,
        name: playerName,
        ready: false,
        score: 0,
      };

      const room: Room = {
        id: roomId,

        hostId: socket.id,

        players: [player],

        settings,

        gameState: "lobby",

        drawerId: null,

        drawerIndex: 0,

        wordOptions: [],

        selectedWord: "",

        currentRound: 0,

        guessedPlayerIds: [],

        hintsUsed: 0,

        revealedIndexes: [],

        roundEndsAt: null,

        roundTimer: null,

        roundVersion: 0,
      };

      rooms.set(
        roomId,
        room
      );

      socket.join(roomId);

      socket.emit(
        "room_created",
        {
          roomId,
          players:
            room.players,
          hostId:
            room.hostId,
          settings:
            room.settings,
        }
      );

      broadcastPlayers(room);

      broadcastSettings(room);

      console.log(
        `Room created: ${roomId}`
      );
    }
  );

  // ==========================================================
  // JOIN ROOM
  // ==========================================================

  socket.on(
    "join_room",
    (data) => {
      const roomId =
        String(
          data?.roomId || ""
        )
          .trim()
          .toUpperCase();

      const playerName =
        normalizeName(
          data?.playerName
        );

      const room =
        rooms.get(roomId);

      if (!room) {
        socket.emit(
          "error_message",
          "Room not found."
        );

        return;
      }

      if (
        room.gameState !==
        "lobby"
      ) {
        socket.emit(
          "error_message",
          "Game has already started."
        );

        return;
      }

      if (
        room.players.length >=
        room.settings.maxPlayers
      ) {
        socket.emit(
          "error_message",
          "Room is full."
        );

        return;
      }

      if (!playerName) {
        socket.emit(
          "error_message",
          "Please enter your name."
        );

        return;
      }

      const duplicateName =
        room.players.some(
          (player) =>
            player.name.toLowerCase() ===
            playerName.toLowerCase()
        );

      if (duplicateName) {
        socket.emit(
          "error_message",
          "That name is already taken."
        );

        return;
      }

      const player: Player = {
        id: socket.id,
        name: playerName,
        ready: false,
        score: 0,
      };

      room.players.push(player);

      socket.join(roomId);

      socket.emit(
        "room_joined",
        {
          roomId,
          players:
            room.players,
          hostId:
            room.hostId,
          settings:
            room.settings,
        }
      );

      broadcastPlayers(room);

      console.log(
        `${playerName} joined ${roomId}`
      );
    }
  );

  // ==========================================================
  // TOGGLE READY
  // ==========================================================

  socket.on(
    "toggle_ready",
    (data) => {
      const room =
        rooms.get(data?.roomId);

      if (!room) return;

      const player =
        room.players.find(
          (p) =>
            p.id === socket.id
        );

      if (!player) return;

      player.ready =
        !player.ready;

      broadcastPlayers(room);
    }
  );

  // ==========================================================
  // UPDATE SETTINGS
  // ==========================================================

  socket.on(
    "update_settings",
    (data) => {
      const room =
        rooms.get(data?.roomId);

      if (!room) return;

      if (
        room.hostId !==
        socket.id
      ) {
        return;
      }

      if (
        room.gameState !==
        "lobby"
      ) {
        return;
      }

      const incoming =
        data?.settings || {};

      room.settings = {
        maxPlayers: clamp(
          Number(
            incoming.maxPlayers ??
              room.settings.maxPlayers
          ),
          2,
          20
        ),

        rounds: clamp(
          Number(
            incoming.rounds ??
              room.settings.rounds
          ),
          2,
          10
        ),

        drawTime: clamp(
          Number(
            incoming.drawTime ??
              room.settings.drawTime
          ),
          15,
          240
        ),

        wordChoices: clamp(
          Number(
            incoming.wordChoices ??
              room.settings.wordChoices
          ),
          1,
          5
        ),

        hints: clamp(
          Number(
            incoming.hints ??
              room.settings.hints
          ),
          0,
          5
        ),

        isPrivate:
          Boolean(
            incoming.isPrivate ??
              room.settings.isPrivate
          ),
      };

      broadcastSettings(room);
    }
  );

  // ==========================================================
  // START GAME
  // ==========================================================

  socket.on(
    "start_game",
    (data) => {
      const room =
        rooms.get(data?.roomId);

      if (!room) return;

      if (
        room.hostId !==
        socket.id
      ) {
        socket.emit(
          "error_message",
          "Only the host can start the game."
        );

        return;
      }

      if (
        room.players.length < 2
      ) {
        socket.emit(
          "error_message",
          "At least 2 players are required."
        );

        return;
      }

      const everyoneReady =
        room.players.every(
          (player) =>
            player.ready
        );

      if (!everyoneReady) {
        socket.emit(
          "error_message",
          "Everyone must be ready."
        );

        return;
      }

      room.currentRound = 1;

      room.drawerIndex = 0;

      room.players.forEach(
        (player) => {
          player.score = 0;
        }
      );

      room.gameState =
        "choosing_word";

      io.to(room.id).emit(
        "game_started"
      );

      startChoosingWord(room);
    }
  );

  // ==========================================================
  // SELECT WORD
  // ==========================================================

  socket.on(
    "select_word",
    (data) => {
      const room =
        rooms.get(data?.roomId);

      if (!room) return;

      if (
        room.gameState !==
        "choosing_word"
      ) {
        return;
      }

      if (
        socket.id !==
        room.drawerId
      ) {
        return;
      }

      const word =
        String(
          data?.word || ""
        ).trim();

      if (!word) return;

      if (
        !room.wordOptions.includes(
          word
        )
      ) {
        return;
      }

      room.selectedWord =
        word;

      room.guessedPlayerIds =
        [];

      room.hintsUsed = 0;

      room.revealedIndexes =
        [];

      io.to(room.id).emit(
        "word_selected",
        {
          word,
        }
      );

      startRound(
        room,
        word
      );
    }
  );

  // ==========================================================
  // REQUEST HINT
  // ==========================================================

  socket.on(
    "request_hint",
    (data) => {
      const room =
        rooms.get(data?.roomId);

      if (!room) return;

      if (
        room.gameState !==
        "playing"
      ) {
        return;
      }

      if (
        room.hintsUsed >=
        room.settings.hints
      ) {
        return;
      }

      room.hintsUsed++;

      const hiddenIndexes =
        [];

      for (
        let i = 0;
        i <
        room.selectedWord.length;
        i++
      ) {
        if (
          room.selectedWord[i] !==
            " " &&
          !room.revealedIndexes.includes(
            i
          )
        ) {
          hiddenIndexes.push(i);
        }
      }

      if (
        hiddenIndexes.length ===
        0
      ) {
        return;
      }

      const randomIndex =
        hiddenIndexes[
          Math.floor(
            Math.random() *
              hiddenIndexes.length
          )
        ];

      room.revealedIndexes.push(
        randomIndex
      );

      sendWordState(room);
    }
  );

  // ==========================================================
  // DRAW START
  // ==========================================================

  socket.on(
    "draw_start",
    (data) => {
      const room =
        rooms.get(data?.roomId);

      if (!room) return;

      if (
        room.gameState !==
        "playing"
      ) {
        return;
      }

      if (
        socket.id !==
        room.drawerId
      ) {
        return;
      }

      socket
        .to(room.id)
        .emit(
          "draw_start",
          {
            x: Number(data.x),
            y: Number(data.y),
            color:
              data.color ||
              "#000000",
            lineWidth:
              Number(
                data.lineWidth
              ) || 5,
            tool:
              data.tool ===
              "eraser"
                ? "eraser"
                : "brush",
          }
        );
    }
  );

  // ==========================================================
  // DRAW MOVE
  // ==========================================================

  socket.on(
    "draw_move",
    (data) => {
      const room =
        rooms.get(data?.roomId);

      if (!room) return;

      if (
        room.gameState !==
        "playing"
      ) {
        return;
      }

      if (
        socket.id !==
        room.drawerId
      ) {
        return;
      }

      socket
        .to(room.id)
        .emit(
          "draw_move",
          {
            x: Number(data.x),
            y: Number(data.y),
            color:
              data.color ||
              "#000000",
            lineWidth:
              Number(
                data.lineWidth
              ) || 5,
            tool:
              data.tool ===
              "eraser"
                ? "eraser"
                : "brush",
          }
        );
    }
  );

  // ==========================================================
  // DRAW END
  // ==========================================================

  socket.on(
    "draw_end",
    (data) => {
      const room =
        rooms.get(data?.roomId);

      if (!room) return;

      if (
        room.gameState !==
        "playing"
      ) {
        return;
      }

      if (
        socket.id !==
        room.drawerId
      ) {
        return;
      }

      socket
        .to(room.id)
        .emit("draw_end");
    }
  );

  // ==========================================================
  // CLEAR CANVAS
  // ==========================================================

  socket.on(
    "clear_canvas",
    (data) => {
      const room =
        rooms.get(data?.roomId);

      if (!room) return;

      if (
        room.gameState !==
        "playing"
      ) {
        return;
      }

      if (
        socket.id !==
        room.drawerId
      ) {
        return;
      }

      io.to(room.id).emit(
        "clear_canvas"
      );
    }
  );

  // ==========================================================
  // UNDO
  // ==========================================================

  socket.on("undo_canvas", (data) => {
  const room = rooms.get(data?.roomId);

  if (!room) return;

  if (room.gameState !== "playing") {
    return;
  }

  // Only the current drawer can undo.
  if (socket.id !== room.drawerId) {
    return;
  }

  // Send undo to EVERYONE, including the drawer.
  io.to(room.id).emit("undo_canvas");
});
  // ==========================================================
  // SEND GUESS / CHAT
  // ==========================================================

  socket.on(
    "send_guess",
    (data) => {
      const room =
        rooms.get(data?.roomId);

      if (!room) {
        socket.emit(
          "error_message",
          "Room not found."
        );

        return;
      }

      if (
        room.gameState !==
        "playing"
      ) {
        return;
      }

      const player =
        room.players.find(
          (p) =>
            p.id === socket.id
        );

      if (!player) return;

      // Drawer cannot submit guesses
      if (
        socket.id ===
        room.drawerId
      ) {
        return;
      }

      const submittedGuess =
        String(
          data?.message ??
            data?.guess ??
            ""
        ).trim();

      if (!submittedGuess) {
        return;
      }

      // --------------------------------------------------------
      // ALWAYS SHOW GUESS IN CHAT
      // --------------------------------------------------------

      io.to(room.id).emit(
        "chat_message",
        {
          playerName:
            player.name,

          message:
            submittedGuess,
        }
      );

      // --------------------------------------------------------
      // DON'T SCORE SAME PLAYER TWICE
      // --------------------------------------------------------

      if (
        room.guessedPlayerIds.includes(
          socket.id
        )
      ) {
        return;
      }

      // --------------------------------------------------------
      // CHECK ANSWER
      // --------------------------------------------------------

      const normalizedGuess =
        normalizeGuess(
          submittedGuess
        );

      const normalizedAnswer =
        normalizeGuess(
          room.selectedWord
        );

      if (
        normalizedGuess !==
        normalizedAnswer
      ) {
        return;
      }

      // --------------------------------------------------------
      // CORRECT GUESS
      // --------------------------------------------------------

      room.guessedPlayerIds.push(
        socket.id
      );

      const guessNumber =
        room.guessedPlayerIds.length;

      const points = Math.max(
        50,
        100 -
          (guessNumber - 1) *
            10
      );

      player.score += points;

      // Drawer gets bonus
      const drawer =
        room.players.find(
          (p) =>
            p.id ===
            room.drawerId
        );

      if (drawer) {
        drawer.score += 25;
      }

      io.to(room.id).emit(
        "correct_guess",
        {
          playerId:
            socket.id,

          playerName:
            player.name,

          points,
        }
      );

      broadcastPlayers(room);

      // --------------------------------------------------------
      // EVERYONE EXCEPT DRAWER GUESSED
      // --------------------------------------------------------

      const guessersNeeded =
        room.players.length - 1;

      if (
        room.guessedPlayerIds
          .length >=
        guessersNeeded
      ) {
        endRound(room);
      }
    }
  );

  // ==========================================================
  // DISCONNECT
  // ==========================================================

  socket.on(
    "disconnect",
    () => {
      console.log(
        `Player disconnected: ${socket.id}`
      );

      for (
        const [
          roomId,
          room,
        ] of rooms.entries()
      ) {
        const playerIndex =
          room.players.findIndex(
            (player) =>
              player.id ===
              socket.id
          );

        if (
          playerIndex === -1
        ) {
          continue;
        }

        const wasDrawer =
          room.drawerId ===
          socket.id;

        const wasHost =
          room.hostId ===
          socket.id;

        room.players.splice(
          playerIndex,
          1
        );

        // No players left
        if (
          room.players.length ===
          0
        ) {
          clearRoundTimer(room);

          rooms.delete(roomId);

          continue;
        }

        // Transfer host
        if (wasHost) {
          room.hostId =
            room.players[0].id;
        }

        // Drawer disconnected
        if (wasDrawer) {
          clearRoundTimer(room);

          room.drawerId =
            null;

          if (
            room.players.length <
            2
          ) {
            room.gameState =
              "lobby";

            broadcastPlayers(
              room
            );

            broadcastGameState(
              room
            );

            continue;
          }

          if (
            room.gameState ===
              "playing" ||
            room.gameState ===
              "choosing_word"
          ) {
            room.drawerIndex =
              room.drawerIndex %
              room.players.length;

            startChoosingWord(
              room
            );
          }
        }

        broadcastPlayers(room);
      }
    }
  );
});

// ============================================================
// HEALTH CHECK
// ============================================================

app.get(
  "/",
  (_req, res) => {
    res.json({
      message:
        "Skribbl Clone Server is running!",
    });
  }
);

// ============================================================
// START SERVER
// ============================================================

const PORT = Number(process.env.PORT) || 3000;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});