import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import cors from 'cors'

import { registerSocketHandlers } from './socket-handlers'
import { cleanupEmptyRooms, getRoomCount, getTotalConnections } from './room-manager'

// ─────────────────────────────────────────────────────────────────────────────
// Express + Socket.io server
// ─────────────────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT || '3456', 10)

const app = express()

// CORS — allow any origin so the Electron renderer and browser clients can connect
app.use(cors({ origin: '*' }))
app.use(express.json())

// ── Health-check route ──────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    rooms: getRoomCount(),
    connections: getTotalConnections(),
  })
})

// ── HTTP + WebSocket server ─────────────────────────────────────────────────

const httpServer = createServer(app)

const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  pingInterval: 25000,
  pingTimeout: 20000,
})

// Register all Socket.io event handlers
registerSocketHandlers(io)

// ── Periodic cleanup of stale empty rooms ───────────────────────────────────

const CLEANUP_INTERVAL_MS = 60_000 // every 60 seconds
setInterval(() => {
  cleanupEmptyRooms()
}, CLEANUP_INTERVAL_MS)

// ── Start listening ─────────────────────────────────────────────────────────

httpServer.listen(PORT, () => {
  console.log(`\n🎵 ArchiveTune Sync Server running on http://localhost:${PORT}`)
  console.log(`   Health check: http://localhost:${PORT}/health`)
  console.log(`   Ready for Music Together sessions!\n`)
})
