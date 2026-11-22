import type { Room, RoomUser, RoomState, SyncTrack, ChatMessage } from './types'

// ─────────────────────────────────────────────────────────────────────────────
// In-memory room storage
// ─────────────────────────────────────────────────────────────────────────────

const rooms = new Map<string, Room>()

const ROOM_CODE_LENGTH = 6
const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no ambiguous 0/O, 1/I
const MAX_CHAT_HISTORY = 50
const EMPTY_ROOM_TTL_MS = 5 * 60 * 1000 // 5 minutes

// ── Code generation ─────────────────────────────────────────────────────────

function generateRoomCode(): string {
  let code: string
  do {
    code = ''
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
      code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)]
    }
  } while (rooms.has(code))
  return code
}

// ── Public API ──────────────────────────────────────────────────────────────

export function createRoom(hostSocketId: string, displayName: string): Room {
  const code = generateRoomCode()
  const now = Date.now()

  const host: RoomUser = {
    id: hostSocketId,
    displayName,
    isHost: true,
    joinedAt: now,
  }

  const room: Room = {
    code,
    hostId: hostSocketId,
    members: [host],
    currentTrack: null,
    isPlaying: false,
    currentTime: 0,
    lastSyncTimestamp: now,
    queue: [],
    chatHistory: [],
    createdAt: now,
    lastActivity: now,
  }

  rooms.set(code, room)
  console.log(`[Room] Created room ${code} by "${displayName}" (${hostSocketId})`)
  return room
}

export function joinRoom(
  roomCode: string,
  userId: string,
  displayName: string
): { room: Room; user: RoomUser } | null {
  const room = rooms.get(roomCode)
  if (!room) return null

  // Prevent duplicate joins
  if (room.members.some((m) => m.id === userId)) {
    return { room, user: room.members.find((m) => m.id === userId)! }
  }

  const user: RoomUser = {
    id: userId,
    displayName,
    isHost: false,
    joinedAt: Date.now(),
  }

  room.members.push(user)
  room.lastActivity = Date.now()
  console.log(`[Room] "${displayName}" joined room ${roomCode} (${room.members.length} members)`)
  return { room, user }
}

export function leaveRoom(
  roomCode: string,
  userId: string
): { room: Room | null; removedUser: RoomUser | null; newHost: RoomUser | null; roomDeleted: boolean } {
  const room = rooms.get(roomCode)
  if (!room) return { room: null, removedUser: null, newHost: null, roomDeleted: false }

  const idx = room.members.findIndex((m) => m.id === userId)
  if (idx === -1) return { room, removedUser: null, newHost: null, roomDeleted: false }

  const [removedUser] = room.members.splice(idx, 1)

  // Room is now empty → mark for cleanup
  if (room.members.length === 0) {
    room.lastActivity = Date.now()
    rooms.delete(roomCode)
    console.log(`[Room] Room ${roomCode} deleted (last member left)`)
    return { room: null, removedUser, newHost: null, roomDeleted: true }
  }

  // Host left → transfer to the longest-tenured member
  let newHost: RoomUser | null = null
  if (removedUser.isHost) {
    const nextHost = room.members.reduce((oldest, m) =>
      m.joinedAt < oldest.joinedAt ? m : oldest
    )
    nextHost.isHost = true
    room.hostId = nextHost.id
    newHost = nextHost
    console.log(`[Room] Host transferred in ${roomCode} to "${nextHost.displayName}"`)
  }

  room.lastActivity = Date.now()
  return { room, removedUser, newHost, roomDeleted: false }
}

export function getRoom(roomCode: string): Room | undefined {
  return rooms.get(roomCode)
}

export function getRoomBySocketId(socketId: string): Room | undefined {
  for (const room of rooms.values()) {
    if (room.members.some((m) => m.id === socketId)) {
      return room
    }
  }
  return undefined
}

export function isHost(room: Room, userId: string): boolean {
  return room.hostId === userId
}

export function toRoomState(room: Room): RoomState {
  return {
    code: room.code,
    hostId: room.hostId,
    members: room.members,
    currentTrack: room.currentTrack,
    isPlaying: room.isPlaying,
    currentTime: room.currentTime,
    serverTimestamp: Date.now(),
    queue: room.queue,
    chatHistory: room.chatHistory,
  }
}

// ── Playback state mutations ────────────────────────────────────────────────

export function setPlayTrack(room: Room, track: SyncTrack, currentTime: number): void {
  room.currentTrack = track
  room.currentTime = currentTime
  room.isPlaying = true
  room.lastSyncTimestamp = Date.now()
  room.lastActivity = Date.now()
}

export function setPause(room: Room, currentTime: number): void {
  room.isPlaying = false
  room.currentTime = currentTime
  room.lastSyncTimestamp = Date.now()
  room.lastActivity = Date.now()
}

export function setResume(room: Room, currentTime: number): void {
  room.isPlaying = true
  room.currentTime = currentTime
  room.lastSyncTimestamp = Date.now()
  room.lastActivity = Date.now()
}

export function setSeek(room: Room, currentTime: number): void {
  room.currentTime = currentTime
  room.lastSyncTimestamp = Date.now()
  room.lastActivity = Date.now()
}

export function setQueue(room: Room, queue: SyncTrack[]): void {
  room.queue = queue
  room.lastSyncTimestamp = Date.now()
  room.lastActivity = Date.now()
}

export function addChatMessage(
  room: Room,
  userId: string,
  displayName: string,
  text: string
): ChatMessage {
  const msg: ChatMessage = {
    userId,
    displayName,
    text: text.slice(0, 500), // cap at 500 chars
    timestamp: Date.now(),
  }
  room.chatHistory.push(msg)
  if (room.chatHistory.length > MAX_CHAT_HISTORY) {
    room.chatHistory.shift()
  }
  room.lastActivity = Date.now()
  return msg
}

// ── Periodic cleanup ────────────────────────────────────────────────────────

export function cleanupEmptyRooms(): number {
  const now = Date.now()
  let cleaned = 0
  for (const [code, room] of rooms) {
    if (room.members.length === 0 && now - room.lastActivity > EMPTY_ROOM_TTL_MS) {
      rooms.delete(code)
      cleaned++
    }
  }
  if (cleaned > 0) {
    console.log(`[Room] Cleaned up ${cleaned} empty room(s)`)
  }
  return cleaned
}

export function getRoomCount(): number {
  return rooms.size
}

export function getTotalConnections(): number {
  let total = 0
  for (const room of rooms.values()) {
    total += room.members.length
  }
  return total
}
