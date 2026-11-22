import type { Server, Socket } from 'socket.io'
import type {
  CreateRoomPayload,
  JoinRoomPayload,
  PlayTrackPayload,
  ResumePayload,
  SeekPayload,
  QueueUpdatePayload,
  SendMessagePayload,
  PingPayload,
} from './types'
import {
  createRoom,
  joinRoom,
  leaveRoom,
  getRoom,
  getRoomBySocketId,
  isHost,
  toRoomState,
  setPlayTrack,
  setPause,
  setResume,
  setSeek,
  setQueue,
  addChatMessage,
} from './room-manager'

// ─────────────────────────────────────────────────────────────────────────────
// Socket.io event handler registration
// ─────────────────────────────────────────────────────────────────────────────

export function registerSocketHandlers(io: Server): void {
  io.on('connection', (socket: Socket) => {
    console.log(`[Socket] Connected: ${socket.id}`)

    // ── Create Room ───────────────────────────────────────────────────────
    socket.on('create-room', (payload: CreateRoomPayload) => {
      const displayName = payload?.displayName?.trim()
      if (!displayName) {
        socket.emit('error', { message: 'Display name is required' })
        return
      }

      const room = createRoom(socket.id, displayName)
      socket.join(room.code)
      socket.data.roomCode = room.code
      socket.data.displayName = displayName

      socket.emit('room-created', {
        roomCode: room.code,
        roomState: toRoomState(room),
      })
    })

    // ── Join Room ─────────────────────────────────────────────────────────
    socket.on('join-room', (payload: JoinRoomPayload) => {
      const roomCode = payload?.roomCode?.trim().toUpperCase()
      const displayName = payload?.displayName?.trim()

      if (!roomCode || !displayName) {
        socket.emit('error', { message: 'Room code and display name are required' })
        return
      }

      const result = joinRoom(roomCode, socket.id, displayName)
      if (!result) {
        socket.emit('error', { message: `Room "${roomCode}" not found` })
        return
      }

      socket.join(roomCode)
      socket.data.roomCode = roomCode
      socket.data.displayName = displayName

      // Send the joiner the full room state
      socket.emit('room-joined', {
        roomState: toRoomState(result.room),
      })

      // Notify everyone else in the room
      socket.to(roomCode).emit('user-joined', {
        user: result.user,
        memberCount: result.room.members.length,
      })
    })

    // ── Leave Room ────────────────────────────────────────────────────────
    socket.on('leave-room', () => {
      handleLeave(socket)
    })

    // ── Play Track (host only) ────────────────────────────────────────────
    socket.on('play-track', (payload: PlayTrackPayload) => {
      const room = getGuardedRoom(socket, true)
      if (!room) return

      setPlayTrack(room, payload.track, payload.currentTime ?? 0)

      socket.to(room.code).emit('sync-play-track', {
        track: payload.track,
        currentTime: payload.currentTime ?? 0,
        serverTimestamp: Date.now(),
      })
    })

    // ── Pause (host only) ─────────────────────────────────────────────────
    socket.on('pause', (payload?: { currentTime?: number }) => {
      const room = getGuardedRoom(socket, true)
      if (!room) return

      const ct = payload?.currentTime ?? room.currentTime
      setPause(room, ct)

      socket.to(room.code).emit('sync-pause', {
        currentTime: ct,
        serverTimestamp: Date.now(),
      })
    })

    // ── Resume (host only) ────────────────────────────────────────────────
    socket.on('resume', (payload: ResumePayload) => {
      const room = getGuardedRoom(socket, true)
      if (!room) return

      setResume(room, payload.currentTime ?? 0)

      socket.to(room.code).emit('sync-resume', {
        currentTime: payload.currentTime ?? 0,
        serverTimestamp: Date.now(),
      })
    })

    // ── Seek (host only) ──────────────────────────────────────────────────
    socket.on('seek', (payload: SeekPayload) => {
      const room = getGuardedRoom(socket, true)
      if (!room) return

      setSeek(room, payload.currentTime)

      socket.to(room.code).emit('sync-seek', {
        currentTime: payload.currentTime,
        serverTimestamp: Date.now(),
      })
    })

    // ── Queue Update (host only) ──────────────────────────────────────────
    socket.on('queue-update', (payload: QueueUpdatePayload) => {
      const room = getGuardedRoom(socket, true)
      if (!room) return

      setQueue(room, payload.queue)

      socket.to(room.code).emit('sync-queue-update', {
        queue: payload.queue,
        serverTimestamp: Date.now(),
      })
    })

    // ── Chat ──────────────────────────────────────────────────────────────
    socket.on('send-message', (payload: SendMessagePayload) => {
      const room = getGuardedRoom(socket, false)
      if (!room) return

      const text = payload?.text?.trim()
      if (!text) return

      const displayName = socket.data.displayName || 'Anonymous'
      const msg = addChatMessage(room, socket.id, displayName, text)

      io.in(room.code).emit('chat-message', msg)
    })

    // ── Ping / Pong (latency measurement) ─────────────────────────────────
    socket.on('ping', (payload: PingPayload) => {
      socket.emit('pong', {
        clientTimestamp: payload?.clientTimestamp,
        serverTimestamp: Date.now(),
      })
    })

    // ── Disconnect ────────────────────────────────────────────────────────
    socket.on('disconnect', (reason: string) => {
      console.log(`[Socket] Disconnected: ${socket.id} (${reason})`)
      handleLeave(socket)
    })
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function handleLeave(socket: Socket): void {
  const roomCode = socket.data.roomCode as string | undefined
  if (!roomCode) return

  const { room, removedUser, newHost, roomDeleted } = leaveRoom(roomCode, socket.id)
  socket.leave(roomCode)
  socket.data.roomCode = undefined

  if (!removedUser) return

  if (roomDeleted) {
    // Room is gone, nothing more to broadcast
    return
  }

  if (room) {
    // Notify remaining members
    socket.to(roomCode).emit('user-left', {
      userId: removedUser.id,
      displayName: removedUser.displayName,
      memberCount: room.members.length,
    })

    // If host changed, announce it
    if (newHost) {
      socket.to(roomCode).emit('host-changed', {
        newHostId: newHost.id,
        displayName: newHost.displayName,
      })
    }
  }
}

function getGuardedRoom(socket: Socket, hostOnly: boolean) {
  const roomCode = socket.data.roomCode as string | undefined
  if (!roomCode) {
    socket.emit('error', { message: 'You are not in a room' })
    return null
  }

  const room = getRoom(roomCode)
  if (!room) {
    socket.emit('error', { message: 'Room no longer exists' })
    return null
  }

  if (hostOnly && !isHost(room, socket.id)) {
    socket.emit('error', { message: 'Only the host can perform this action' })
    return null
  }

  return room
}
