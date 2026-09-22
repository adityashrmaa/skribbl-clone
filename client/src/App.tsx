import { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import "./App.css";

interface Player {
  id: string;
  name: string;
  ready: boolean;
  score: number;
}

interface RoomSettings {
  maxPlayers: number;
  rounds: number;
  drawTime: number;
  wordChoices: number;
  hints: number;
  isPrivate: boolean;
}

interface ChatMessage {
  playerName: string;
  message: string;
  system?: boolean;
}

interface DrawData {
  x: number;
  y: number;
  color: string;
  lineWidth: number;
  tool: "brush" | "eraser";
}

const SERVER_URL =
  import.meta.env.VITE_SERVER_URL || "http://localhost:3000";

const socket: Socket = io(SERVER_URL, {
  transports: ["websocket"],
  autoConnect: true,
});

function App() {
  // ============================================================
  // CONNECTION
  // ============================================================

  const [connected, setConnected] = useState(false);

  // ============================================================
  // ROOM / LOBBY
  // ============================================================

  const [roomId, setRoomId] = useState("");
  const [roomInput, setRoomInput] = useState("");

  const [playerName, setPlayerName] = useState("");
  const [joined, setJoined] = useState(false);

  const [players, setPlayers] = useState<Player[]>([]);
  const [hostId, setHostId] = useState("");

  const [error, setError] = useState("");

  const [settings, setSettings] = useState<RoomSettings>({
    maxPlayers: 8,
    rounds: 3,
    drawTime: 60,
    wordChoices: 3,
    hints: 2,
    isPrivate: false,
  });

  // ============================================================
  // GAME
  // ============================================================

  const [gameStarted, setGameStarted] = useState(false);

  const [gameState, setGameState] = useState<
    "lobby" | "choosing_word" | "playing" | "game_over"
  >("lobby");

  const [drawerId, setDrawerId] = useState<string | null>(null);

  const [currentRound, setCurrentRound] = useState(0);
  const [totalRounds, setTotalRounds] = useState(3);

  const [wordOptions, setWordOptions] = useState<string[]>([]);
  const [selectedWord, setSelectedWord] = useState("");
  const [maskedWord, setMaskedWord] = useState("");

  const [timeLeft, setTimeLeft] = useState(60);

  const [winner, setWinner] = useState<Player | null>(null);

  // ============================================================
  // HINTS
  // ============================================================

  const [hintsUsed, setHintsUsed] = useState(0);

  // ============================================================
  // CHAT
  // ============================================================

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [guess, setGuess] = useState("");

  // ============================================================
  // DRAWING
  // ============================================================

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const drawingRef = useRef(false);

  const [color, setColor] = useState("#000000");
  const [lineWidth, setLineWidth] = useState(5);
  const [tool, setTool] = useState<"brush" | "eraser">("brush");

  // ============================================================
  // CANVAS HISTORY
  // ============================================================

  const canvasHistoryRef = useRef<string[]>([]);

  // ============================================================
  // TIMER
  // ============================================================

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ============================================================
  // CURRENT PLAYER
  // ============================================================

  const currentPlayer = players.find(
    (player) => player.id === socket.id
  );

  const isHost = socket.id === hostId;
  const isDrawer = socket.id === drawerId;

  // ============================================================
  // SYSTEM MESSAGE
  // ============================================================

  function addSystemMessage(message: string) {
    setChatMessages((previous) => [
      ...previous,
      {
        playerName: "System",
        message,
        system: true,
      },
    ]);
  }

  // ============================================================
  // SOCKET EVENTS
  // ============================================================

  useEffect(() => {
    socket.on("connect", () => {
      setConnected(true);
      setError("");
    });

    socket.on("disconnect", () => {
      setConnected(false);
    });

    // ------------------------------------------------------------
    // ROOM CREATED
    // ------------------------------------------------------------

    socket.on("room_created", (data) => {
      setRoomId(data.roomId);
      setPlayers(data.players || []);
      setHostId(data.hostId);
      setSettings(data.settings);

      setJoined(true);
      setError("");
    });

    // ------------------------------------------------------------
    // ROOM JOINED
    // ------------------------------------------------------------

    socket.on("room_joined", (data) => {
      setRoomId(data.roomId);
      setPlayers(data.players || []);
      setHostId(data.hostId);
      setSettings(data.settings);

      setJoined(true);
      setError("");
    });

    // ------------------------------------------------------------
    // PLAYER LIST
    // ------------------------------------------------------------

    socket.on("player_list", (data) => {
      setPlayers(data.players || []);
      setHostId(data.hostId);
    });

    // ------------------------------------------------------------
    // SETTINGS
    // ------------------------------------------------------------

    socket.on("room_settings", (data) => {
      setSettings(data.settings);
    });

    // ------------------------------------------------------------
    // ERRORS
    // ------------------------------------------------------------

    socket.on("error_message", (message) => {
      setError(String(message));
    });

    // ------------------------------------------------------------
    // GAME STARTED
    // ------------------------------------------------------------

    socket.on("game_started", () => {
      setGameStarted(true);
      setGameState("choosing_word");
      resetCanvasHistory();
    });

    // ------------------------------------------------------------
    // ROUND STATE
    // ------------------------------------------------------------

    socket.on("round_state", (data) => {
      setGameStarted(true);

      setGameState(data.state);

      setDrawerId(data.drawerId);

      setCurrentRound(data.currentRound);

      setTotalRounds(data.totalRounds);

      if (data.state === "choosing_word") {
        setHintsUsed(0);
        resetCanvasHistory();
      }
    });

    // ------------------------------------------------------------
    // WORD OPTIONS
    // ------------------------------------------------------------

    socket.on("word_options", (data) => {
      setWordOptions(data.words || []);
      setGameState("choosing_word");
    });

    // ------------------------------------------------------------
    // WORD SELECTED
    // ------------------------------------------------------------

    socket.on("word_selected", (data) => {
      setSelectedWord(data.word || "");
    });

    // ------------------------------------------------------------
    // DRAWER WORD
    // ------------------------------------------------------------

    socket.on("drawer_word", (data) => {
      setSelectedWord(data.word || "");
    });

    // ------------------------------------------------------------
    // WORD STATE
    // ------------------------------------------------------------

    socket.on("word_state", (data) => {
      setMaskedWord(data.word || "");

      if (typeof data.hintsUsed === "number") {
        setHintsUsed(data.hintsUsed);
      }
    });

    // ------------------------------------------------------------
    // ROUND STARTED
    // ------------------------------------------------------------

    socket.on("round_started", (data) => {
      setGameStarted(true);

      setGameState("playing");

      setDrawerId(data.drawerId);

      setCurrentRound(data.currentRound);

      setTotalRounds(data.totalRounds);

      setTimeLeft(data.duration);

      setSelectedWord("");

      setWordOptions([]);

      setMaskedWord("");

      setHintsUsed(0);

      resetCanvasHistory();

      startTimer(data.endsAt);
    });

    // ------------------------------------------------------------
    // ROUND ENDED
    // ------------------------------------------------------------

    socket.on("round_ended", (data) => {
      setGameState("choosing_word");

      setSelectedWord("");

      setMaskedWord("");

      setHintsUsed(0);

      stopTimer();

      resetCanvasHistory();

      addSystemMessage(
        `Round ${data.currentRound} ended. Word was: ${data.selectedWord}`
      );
    });

    // ------------------------------------------------------------
    // CORRECT GUESS
    // ------------------------------------------------------------

    socket.on("correct_guess", (data) => {
      addSystemMessage(
        `${data.playerName} guessed correctly! +${data.points} points`
      );
    });

    // ------------------------------------------------------------
    // CHAT
    // ------------------------------------------------------------

    socket.on("chat_message", (data) => {
      setChatMessages((previous) => [
        ...previous,
        {
          playerName:
            data.playerName ||
            data.name ||
            "Player",

          message:
            data.message ||
            data.guess ||
            "",
        },
      ]);
    });

    // ------------------------------------------------------------
    // CLEAR CANVAS
    // ------------------------------------------------------------

    socket.on("clear_canvas", () => {
      clearCanvasOnly();
      resetCanvasHistory();
    });
    
    // ------------------------------------------------------------
    // DRAW MOVE
    // ------------------------------------------------------------

    socket.on("draw_move", (data: DrawData) => {
      drawMoveRemote(data);
    });

    // ------------------------------------------------------------
    // DRAW END
    // ------------------------------------------------------------

    socket.on("draw_end", () => {
      drawingRef.current = false;
    });

  // ------------------------------------------------------------
// DRAW START + UNDO
// ------------------------------------------------------------

socket.on("draw_start", (data: DrawData) => {
  // Drawer saves its snapshot locally before emitting.
  // Spectators need to save the snapshot when they receive the stroke.
  if (!drawingRef.current) {
    saveCanvasSnapshot();
  }

  drawStartRemote(data);
});

socket.on("undo_canvas", () => {
  undoLocalCanvas();
});

    // ------------------------------------------------------------
    // GAME OVER
    // ------------------------------------------------------------

    socket.on("game_over", (data) => {
      stopTimer();

      setGameState("game_over");

      setGameStarted(true);

      if (data.winner) {
        setWinner(data.winner);
      }

      if (data.leaderboard) {
        setPlayers(data.leaderboard);
      }
    });

    return () => {
      socket.off("connect");
      socket.off("disconnect");

      socket.off("room_created");
      socket.off("room_joined");
      socket.off("player_list");

      socket.off("room_settings");

      socket.off("error_message");

      socket.off("game_started");

      socket.off("round_state");

      socket.off("word_options");

      socket.off("word_selected");

      socket.off("drawer_word");

      socket.off("word_state");

      socket.off("round_started");

      socket.off("round_ended");

      socket.off("correct_guess");

      socket.off("chat_message");

      socket.off("clear_canvas");

      socket.off("draw_start");

      socket.off("draw_move");

      socket.off("draw_end");

      socket.off("undo_canvas");

      socket.off("game_over");
    };
  }, []);

  // ============================================================
  // TIMER
  // ============================================================

  function startTimer(endsAt: number) {
    stopTimer();

    const update = () => {
      const remaining = Math.max(
        0,
        Math.ceil((endsAt - Date.now()) / 1000)
      );

      setTimeLeft(remaining);

      if (remaining <= 0) {
        stopTimer();
      }
    };

    update();

    timerRef.current = setInterval(update, 250);
  }

  function stopTimer() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  // ============================================================
  // ROOM ACTIONS
  // ============================================================

  function createRoom() {
    setError("");

    const name = playerName.trim();

    if (!name) {
      setError("Enter your name.");
      return;
    }

    socket.emit("create_room", {
      playerName: name,
      settings,
    });
  }

  function joinRoom() {
    setError("");

    const name = playerName.trim();
    const code = roomInput.trim().toUpperCase();

    if (!name) {
      setError("Enter your name.");
      return;
    }

    if (!code) {
      setError("Enter a room code.");
      return;
    }

    socket.emit("join_room", {
      roomId: code,
      playerName: name,
    });
  }

  function toggleReady() {
    socket.emit("toggle_ready", {
      roomId,
    });
  }

  function startGame() {
    socket.emit("start_game", {
      roomId,
    });
  }

  function updateSetting<K extends keyof RoomSettings>(
    key: K,
    value: RoomSettings[K]
  ) {
    const updated = {
      ...settings,
      [key]: value,
    };

    setSettings(updated);

    socket.emit("update_settings", {
      roomId,
      settings: updated,
    });
  }

  // ============================================================
  // WORD ACTIONS
  // ============================================================

  function selectWord(word: string) {
    setSelectedWord(word);

    socket.emit("select_word", {
      roomId,
      word,
    });
  }

  // ============================================================
  // HINT
  // ============================================================

  function requestHint() {
    if (isDrawer) return;

    if (gameState !== "playing") return;

    if (hintsUsed >= settings.hints) {
      addSystemMessage("No hints remaining.");
      return;
    }

    socket.emit("request_hint", {
      roomId,
    });
  }

  // ============================================================
  // CHAT / GUESS
  // ============================================================

  function sendGuess() {
    const message = guess.trim();

    if (!message || isDrawer) return;

    socket.emit("send_guess", {
      roomId,
      guess: message,
      message: message,
    });

    setGuess("");
  }

  function handleGuessKeyDown(
    event: React.KeyboardEvent<HTMLInputElement>
  ) {
    if (event.key === "Enter") {
      sendGuess();
    }
  }

  // ============================================================
  // CANVAS HELPERS
  // ============================================================

  function getCanvasCoordinates(
    event: React.PointerEvent<HTMLCanvasElement>
  ) {
    const canvas = canvasRef.current;

    if (!canvas) {
      return {
        x: 0,
        y: 0,
      };
    }

    const rect = canvas.getBoundingClientRect();

    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY,
    };
  }

  // ============================================================
  // CANVAS HISTORY
  // ============================================================

  function saveCanvasSnapshot() {
    const canvas = canvasRef.current;

    if (!canvas) return;

    try {
      const snapshot = canvas.toDataURL("image/png");

      canvasHistoryRef.current.push(snapshot);

      if (canvasHistoryRef.current.length > 50) {
        canvasHistoryRef.current.shift();
      }
    } catch {
      // Ignore snapshot errors.
    }
  }

  function resetCanvasHistory() {
    canvasHistoryRef.current = [];
  }

  function undoLocalCanvas() {
    const canvas = canvasRef.current;

    if (!canvas) return;

    const context = canvas.getContext("2d");

    if (!context) return;

    const history = canvasHistoryRef.current;

    if (history.length === 0) {
      clearCanvasOnly();
      return;
    }

    const previousSnapshot = history.pop();

    if (!previousSnapshot) {
      clearCanvasOnly();
      return;
    }

    const image = new Image();

    image.onload = () => {
      clearCanvasOnly();

      context.drawImage(
        image,
        0,
        0,
        canvas.width,
        canvas.height
      );
    };

    image.src = previousSnapshot;
  }

  // ============================================================
  // DRAWING HELPERS
  // ============================================================

  function drawLine(
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    colorValue: string,
    width: number,
    toolValue: "brush" | "eraser"
  ) {
    context.strokeStyle =
      toolValue === "eraser"
        ? "#ffffff"
        : colorValue;

    context.lineWidth = width;

    context.lineCap = "round";

    context.lineJoin = "round";

    context.lineTo(x, y);

    context.stroke();
  }

  function drawStartRemote(data: DrawData) {
    const canvas = canvasRef.current;

    if (!canvas) return;

    const context = canvas.getContext("2d");

    if (!context) return;

    context.beginPath();

    context.moveTo(data.x, data.y);

    context.strokeStyle =
      data.tool === "eraser"
        ? "#ffffff"
        : data.color;

    context.lineWidth = data.lineWidth;

    context.lineCap = "round";

    context.lineJoin = "round";
  }

  function drawMoveRemote(data: DrawData) {
    const canvas = canvasRef.current;

    if (!canvas) return;

    const context = canvas.getContext("2d");

    if (!context) return;

    drawLine(
      context,
      data.x,
      data.y,
      data.color,
      data.lineWidth,
      data.tool
    );
  }

  function clearCanvasOnly() {
    const canvas = canvasRef.current;

    if (!canvas) return;

    const context = canvas.getContext("2d");

    if (!context) return;

    context.clearRect(
      0,
      0,
      canvas.width,
      canvas.height
    );

    context.fillStyle = "#ffffff";

    context.fillRect(
      0,
      0,
      canvas.width,
      canvas.height
    );
  }

  // ============================================================
  // CANVAS DRAWING
  // ============================================================

  function handlePointerDown(
    event: React.PointerEvent<HTMLCanvasElement>
  ) {
    if (!isDrawer || gameState !== "playing") {
      return;
    }

    const canvas = canvasRef.current;

    if (!canvas) return;

    const context = canvas.getContext("2d");

    if (!context) return;

    const { x, y } =
      getCanvasCoordinates(event);

    // Save state BEFORE this stroke.
    saveCanvasSnapshot();

    drawingRef.current = true;

    context.beginPath();

    context.moveTo(x, y);

    context.strokeStyle =
      tool === "eraser"
        ? "#ffffff"
        : color;

    context.lineWidth = lineWidth;

    context.lineCap = "round";

    context.lineJoin = "round";

    context.lineTo(
      x + 0.01,
      y + 0.01
    );

    context.stroke();

    socket.emit("draw_start", {
      roomId,
      x,
      y,
      color,
      lineWidth,
      tool,
    });
  }

  function handlePointerMove(
    event: React.PointerEvent<HTMLCanvasElement>
  ) {
    if (
      !drawingRef.current ||
      !isDrawer ||
      gameState !== "playing"
    ) {
      return;
    }

    const canvas = canvasRef.current;

    if (!canvas) return;

    const context = canvas.getContext("2d");

    if (!context) return;

    const { x, y } =
      getCanvasCoordinates(event);

    drawLine(
      context,
      x,
      y,
      color,
      lineWidth,
      tool
    );

    socket.emit("draw_move", {
      roomId,
      x,
      y,
      color,
      lineWidth,
      tool,
    });
  }

  function handlePointerUp() {
    if (!drawingRef.current) return;

    drawingRef.current = false;

    if (isDrawer) {
      socket.emit("draw_end", {
        roomId,
      });
    }
  }

  function clearCanvas() {
    if (!isDrawer) return;

    clearCanvasOnly();

    resetCanvasHistory();

    socket.emit("clear_canvas", {
      roomId,
    });
  }

  function undoCanvas() {
  if (!isDrawer) return;

  // Don't allow undo while currently drawing a stroke.
  if (drawingRef.current) return;

  if (canvasHistoryRef.current.length === 0) {
    addSystemMessage("Nothing to undo.");
    return;
  }

  socket.emit("undo_canvas", {
    roomId,
  });
}

  // ============================================================
  // COPY ROOM CODE
  // ============================================================

  async function copyRoomCode() {
    try {
      await navigator.clipboard.writeText(roomId);

      addSystemMessage("Room code copied!");
    } catch {
      addSystemMessage(
        `Room code: ${roomId}`
      );
    }
  }

  // ============================================================
  // RESET / PLAY AGAIN
  // ============================================================

  function resetToLobby() {
    stopTimer();

    setGameStarted(false);

    setGameState("lobby");

    setDrawerId(null);

    setCurrentRound(0);

    setSelectedWord("");

    setMaskedWord("");

    setWordOptions([]);

    setWinner(null);

    setHintsUsed(0);

    setChatMessages([]);

    resetCanvasHistory();

    clearCanvasOnly();
  }

  // ============================================================
  // RENDER
  // ============================================================

  if (!connected) {
    return (
      <div className="app">
        <div className="center-card">
          <h1>🎨 Skribbl Clone</h1>

          <p>Connecting to server...</p>

          <div className="loader" />
        </div>
      </div>
    );
  }

  // ============================================================
  // CREATE / JOIN SCREEN
  // ============================================================

  if (!joined) {
    return (
      <div className="app">
        <div className="home-container">
          <div className="logo-section">
            <h1>🎨 Skribbl Clone</h1>

            <p>
              Draw. Guess. Compete.
            </p>
          </div>

          <div className="card">
            <h2>Enter your name</h2>

            <input
              type="text"
              placeholder="Your name"
              value={playerName}
              maxLength={20}
              onChange={(event) =>
                setPlayerName(
                  event.target.value
                )
              }
            />

            <div className="button-row">
              <button
                className="primary-button"
                onClick={createRoom}
              >
                Create Room
              </button>

              <button
                className="secondary-button"
                onClick={joinRoom}
              >
                Join Room
              </button>
            </div>

            <div className="divider">
              OR
            </div>

            <input
              type="text"
              placeholder="Room code"
              value={roomInput}
              maxLength={6}
              onChange={(event) =>
                setRoomInput(
                  event.target.value.toUpperCase()
                )
              }
            />

            <button
              className="secondary-button full-width"
              onClick={joinRoom}
            >
              Join with Code
            </button>

            {error && (
              <div className="error-message">
                {error}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ============================================================
  // GAME OVER
  // ============================================================

  if (gameState === "game_over") {
    return (
      <div className="app">
        <div className="game-over-card">
          <div className="winner-icon">
            🏆
          </div>

          <h1>Game Over!</h1>

          {winner && (
            <div className="winner-section">
              <p>Winner</p>

              <h2>{winner.name}</h2>

              <strong>
                {winner.score} points
              </strong>
            </div>
          )}

          <div className="leaderboard">
            <h3>Final Leaderboard</h3>

            {players
              .slice()
              .sort(
                (a, b) =>
                  b.score - a.score
              )
              .map((player, index) => (
                <div
                  className="leaderboard-row"
                  key={player.id}
                >
                  <span>
                    #{index + 1}
                  </span>

                  <span>
                    {player.name}
                  </span>

                  <strong>
                    {player.score}
                  </strong>
                </div>
              ))}
          </div>

          <button
            className="primary-button"
            onClick={resetToLobby}
          >
            Back to Lobby
          </button>
        </div>
      </div>
    );
  }

  // ============================================================
  // LOBBY
  // ============================================================

  if (!gameStarted) {
    return (
      <div className="app">
        <div className="lobby-container">
          <div className="lobby-header">
            <div>
              <h1>🎨 Game Lobby</h1>

              <p>
                Room:{" "}
                <strong>{roomId}</strong>
              </p>
            </div>

            <button
              className="secondary-button"
              onClick={copyRoomCode}
            >
              Copy Code
            </button>
          </div>

          <div className="lobby-grid">
            <div className="card">
              <h2>
                Players ({players.length}/
                {settings.maxPlayers})
              </h2>

              <div className="players-list">
                {players.map((player) => (
                  <div
                    className="player-row"
                    key={player.id}
                  >
                    <div>
                      <span className="player-name">
                        {player.name}
                      </span>

                      {player.id ===
                        hostId && (
                        <span className="host-badge">
                          HOST
                        </span>
                      )}

                      {player.id ===
                        socket.id && (
                        <span className="you-badge">
                          YOU
                        </span>
                      )}
                    </div>

                    <span
                      className={
                        player.ready
                          ? "ready"
                          : "not-ready"
                      }
                    >
                      {player.ready
                        ? "✓ Ready"
                        : "Not Ready"}
                    </span>
                  </div>
                ))}
              </div>

              <button
                className="primary-button full-width"
                onClick={toggleReady}
              >
                {currentPlayer?.ready
                  ? "Cancel Ready"
                  : "Ready"}
              </button>

              {isHost && (
                <button
                  className="start-button full-width"
                  onClick={startGame}
                >
                  Start Game
                </button>
              )}
            </div>

            <div className="card">
              <h2>Game Settings</h2>

              <label>
                Max Players

                <select
                  value={settings.maxPlayers}
                  disabled={!isHost}
                  onChange={(event) =>
                    updateSetting(
                      "maxPlayers",
                      Number(
                        event.target.value
                      )
                    )
                  }
                >
                  {[2, 4, 6, 8, 10, 12, 16, 20].map(
                    (value) => (
                      <option
                        key={value}
                        value={value}
                      >
                        {value}
                      </option>
                    )
                  )}
                </select>
              </label>

              <label>
                Rounds

                <select
                  value={settings.rounds}
                  disabled={!isHost}
                  onChange={(event) =>
                    updateSetting(
                      "rounds",
                      Number(
                        event.target.value
                      )
                    )
                  }
                >
                  {[2, 3, 4, 5, 6, 8, 10].map(
                    (value) => (
                      <option
                        key={value}
                        value={value}
                      >
                        {value}
                      </option>
                    )
                  )}
                </select>
              </label>

              <label>
                Drawing Time

                <select
                  value={settings.drawTime}
                  disabled={!isHost}
                  onChange={(event) =>
                    updateSetting(
                      "drawTime",
                      Number(
                        event.target.value
                      )
                    )
                  }
                >
                  {[15, 30, 45, 60, 90, 120, 180, 240].map(
                    (value) => (
                      <option
                        key={value}
                        value={value}
                      >
                        {value} seconds
                      </option>
                    )
                  )}
                </select>
              </label>

              <label>
                Word Choices

                <select
                  value={settings.wordChoices}
                  disabled={!isHost}
                  onChange={(event) =>
                    updateSetting(
                      "wordChoices",
                      Number(
                        event.target.value
                      )
                    )
                  }
                >
                  {[1, 2, 3, 4, 5].map(
                    (value) => (
                      <option
                        key={value}
                        value={value}
                      >
                        {value}
                      </option>
                    )
                  )}
                </select>
              </label>

              <label>
                Hints

                <select
                  value={settings.hints}
                  disabled={!isHost}
                  onChange={(event) =>
                    updateSetting(
                      "hints",
                      Number(
                        event.target.value
                      )
                    )
                  }
                >
                  {[0, 1, 2, 3, 4, 5].map(
                    (value) => (
                      <option
                        key={value}
                        value={value}
                      >
                        {value}
                      </option>
                    )
                  )}
                </select>
              </label>

              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={settings.isPrivate}
                  disabled={!isHost}
                  onChange={(event) =>
                    updateSetting(
                      "isPrivate",
                      event.target.checked
                    )
                  }
                />

                Private Room
              </label>
            </div>
          </div>

          {error && (
            <div className="error-message">
              {error}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ============================================================
  // WORD SELECTION
  // ============================================================

  if (
    gameState === "choosing_word" &&
    isDrawer
  ) {
    return (
      <div className="app">
        <div className="word-selection">
          <div className="room-topbar">
            <span>
              Room:{" "}
              <strong>{roomId}</strong>
            </span>

            <span>
              Round {currentRound} /{" "}
              {totalRounds}
            </span>
          </div>

          <div className="card">
            <h1>✏️ Choose a word</h1>

            <p>
              Choose one word for the other
              players to guess.
            </p>

            <div className="word-options">
              {wordOptions.map((word) => (
                <button
                  key={word}
                  className="word-button"
                  onClick={() =>
                    selectWord(word)
                  }
                >
                  {word}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ============================================================
  // WAITING FOR DRAWER
  // ============================================================

  if (
    gameState === "choosing_word" &&
    !isDrawer
  ) {
    const drawer = players.find(
      (player) => player.id === drawerId
    );

    return (
      <div className="app">
        <div className="center-card">
          <div className="waiting-icon">
            🎨
          </div>

          <h1>
            {drawer?.name ||
              "The drawer"}{" "}
            is choosing a word...
          </h1>

          <p>
            Get ready to guess!
          </p>

          <div className="players-mini">
            {players
              .slice()
              .sort(
                (a, b) =>
                  b.score - a.score
              )
              .map((player) => (
                <div
                  key={player.id}
                  className="mini-player"
                >
                  <span>
                    {player.name}
                  </span>

                  <strong>
                    {player.score}
                  </strong>
                </div>
              ))}
          </div>
        </div>
      </div>
    );
  }

  // ============================================================
  // MAIN GAME
  // ============================================================

  return (
    <div className="app game-app">
      {/* TOP BAR */}

      <header className="game-header">
        <div>
          <h1>🎨 Skribbl Clone</h1>

          <span>
            Room:{" "}
            <strong>{roomId}</strong>
          </span>
        </div>

        <div className="round-info">
          <span>
            Round {currentRound} /{" "}
            {totalRounds}
          </span>

          <span
            className={
              timeLeft <= 10
                ? "timer danger"
                : "timer"
            }
          >
            ⏱️ {timeLeft}s
          </span>
        </div>
      </header>

      <main className="game-layout">
        {/* ======================================================
            LEFT SIDE
            ====================================================== */}

        <aside className="sidebar left-sidebar">
          <div className="panel">
            <h3>
              Players
            </h3>

            <div className="live-leaderboard">
              {players
                .slice()
                .sort(
                  (a, b) =>
                    b.score - a.score
                )
                .map(
                  (player, index) => (
                    <div
                      key={player.id}
                      className={
                        player.id ===
                        drawerId
                          ? "game-player drawer"
                          : "game-player"
                      }
                    >
                      <div>
                        <span className="rank-number">
                          #{index + 1}
                        </span>

                        <span>
                          {player.name}
                        </span>

                        {player.id ===
                          drawerId && (
                          <span className="drawer-label">
                            ✏️ Drawing
                          </span>
                        )}

                        {player.id ===
                          socket.id && (
                          <span className="you-label">
                            You
                          </span>
                        )}
                      </div>

                      <strong>
                        {player.score}
                      </strong>
                    </div>
                  )
                )}
            </div>
          </div>

          <div className="panel">
            <h3>Word</h3>

            <div className="word-display">
              {isDrawer
                ? selectedWord || "..."
                : maskedWord ||
                  "Waiting..."}
            </div>

            {!isDrawer &&
              gameState ===
                "playing" &&
              settings.hints > 0 && (
                <div className="hint-section">
                  <button
                    className="hint-button"
                    onClick={requestHint}
                    disabled={
                      hintsUsed >=
                      settings.hints
                    }
                  >
                    💡 Hint
                  </button>

                  <span className="hint-count">
                    {Math.max(
                      0,
                      settings.hints -
                        hintsUsed
                    )}{" "}
                    left
                  </span>
                </div>
              )}
          </div>

          <div className="panel score-panel">
            <h3>Your Score</h3>

            <div className="your-score">
              {currentPlayer?.score || 0}
              <span>points</span>
            </div>
          </div>
        </aside>

        {/* ======================================================
            CENTER
            ====================================================== */}

        <section className="drawing-section">
          <div className="canvas-wrapper">
            <canvas
              ref={canvasRef}
              width={900}
              height={600}
              onPointerDown={
                handlePointerDown
              }
              onPointerMove={
                handlePointerMove
              }
              onPointerUp={
                handlePointerUp
              }
              onPointerLeave={
                handlePointerUp
              }
              className={
                isDrawer
                  ? "drawing-canvas"
                  : "drawing-canvas spectator"
              }
            />
          </div>

          {/* TOOLS */}

          {isDrawer && (
            <div className="toolbar">
              <button
                className={
                  tool === "brush"
                    ? "tool active"
                    : "tool"
                }
                onClick={() =>
                  setTool("brush")
                }
              >
                🖌️ Brush
              </button>

              <button
                className={
                  tool === "eraser"
                    ? "tool active"
                    : "tool"
                }
                onClick={() =>
                  setTool("eraser")
                }
              >
                🧽 Eraser
              </button>

              <input
                type="color"
                value={color}
                disabled={
                  tool === "eraser"
                }
                onChange={(event) =>
                  setColor(
                    event.target.value
                  )
                }
              />

              <select
                value={lineWidth}
                onChange={(event) =>
                  setLineWidth(
                    Number(
                      event.target.value
                    )
                  )
                }
              >
                <option value={2}>
                  Thin
                </option>

                <option value={5}>
                  Medium
                </option>

                <option value={10}>
                  Thick
                </option>

                <option value={18}>
                  Very Thick
                </option>
              </select>

              <button
                className="tool"
                onClick={undoCanvas}
              >
                ↩️ Undo
              </button>

              <button
                className="tool danger-tool"
                onClick={clearCanvas}
              >
                🗑️ Clear
              </button>
            </div>
          )}
        </section>

        {/* ======================================================
            RIGHT SIDE
            ====================================================== */}

        <aside className="sidebar right-sidebar">
          <div className="panel chat-panel">
            <h3>
              💬 Chat / Guesses
            </h3>

            <div className="chat-messages">
              {chatMessages.map(
                (message, index) => (
                  <div
                    key={`${index}-${message.playerName}`}
                    className={
                      message.system
                        ? "chat-message system"
                        : "chat-message"
                    }
                  >
                    <strong>
                      {message.playerName}:
                    </strong>{" "}
                    {message.message}
                  </div>
                )
              )}
            </div>

            <div className="chat-input">
              <input
                type="text"
                placeholder={
                  isDrawer
                    ? "You are drawing..."
                    : "Enter your guess..."
                }
                value={guess}
                disabled={isDrawer}
                onChange={(event) =>
                  setGuess(
                    event.target.value
                  )
                }
                onKeyDown={
                  handleGuessKeyDown
                }
              />

              <button
                onClick={sendGuess}
                disabled={
                  isDrawer ||
                  !guess.trim()
                }
              >
                Send
              </button>
            </div>
          </div>
        </aside>
      </main>
    </div>
  );
}

export default App;