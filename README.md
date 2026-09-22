# 🎨 Skribbl Clone

A real-time multiplayer drawing and guessing game inspired by Skribbl.io.

Players can create or join rooms, take turns drawing a randomly selected word, and compete for the highest score by guessing correctly.

## 🚀 Live Demo

**Frontend:**  
https://skribbl-clone-virid.vercel.app/

**Backend:**  
https://skribbl-backend-ppma.onrender.com/

## ✨ Features

- 🎮 Multiplayer real-time gameplay
- 🏠 Create and join rooms using room codes
- 🔒 Public and private rooms
- 👥 Lobby with player ready system
- 🎨 Real-time collaborative drawing using Canvas + Socket.IO
- 🖌️ Brush, eraser, colors and brush sizes
- ↩️ Undo and clear canvas
- 📝 Multiple word choices for the drawer
- 💡 Hint system
- 💬 Real-time chat and guessing
- 🏆 Score calculation and live leaderboard
- ⏱️ Configurable drawing timer
- 🔄 Multiple rounds with automatic turn rotation
- 👑 Host controls and game settings
- 🏁 Final leaderboard and winner screen

## 🛠️ Tech Stack

### Frontend

- React
- TypeScript
- Vite
- HTML5 Canvas
- Socket.IO Client
- CSS

### Backend

- Node.js
- Express
- TypeScript
- Socket.IO
- CORS

### Deployment

- Frontend: Vercel
- Backend: Render

## 🏗️ Architecture

```text
                   ┌─────────────────────┐
                   │       Players       │
                   │  Browser / Clients  │
                   └──────────┬──────────┘
                              │
                              │ HTTPS
                              ▼
                   ┌─────────────────────┐
                   │       Vercel        │
                   │ React + TypeScript  │
                   │       Frontend      │
                   └──────────┬──────────┘
                              │
                         Socket.IO
                              │
                              ▼
                   ┌─────────────────────┐
                   │       Render        │
                   │ Node + Express      │
                   │      Backend        │
                   │    Socket.IO        │
                   └──────────┬──────────┘
                              │
                              ▼
                   ┌─────────────────────┐
                   │   In-memory Game    │
                   │      State          │
                   │ Rooms / Players /   │
                   │ Scores / Rounds     │
                   └─────────────────────┘
