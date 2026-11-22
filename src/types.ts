// ─────────────────────────────────────────────────────────────────────────────
// Shared types for the Music Together sync server
// ─────────────────────────────────────────────────────────────────────────────

/** Minimal track metadata shared across the room (no stream URLs). */
export interface SyncTrack {
  id: string // YouTube videoId or local track hash
  title: string
  artist: string
  album?: string
  duration?: number
  thumbnail?: string
}

/** A user inside a room. */
export interface RoomUser {
  id: string // socket.id
  displayName: string
  isHost: boolean
  joinedAt: number
}

/** A chat message. */
export interface ChatMessage {
  userId: string
  displayName: string
  text: string
  timestamp: number
}

/** Full room state — sent to clients on join. */
export interface RoomState {
  code: string
  hostId: string
  members: RoomUser[]
  currentTrack: SyncTrack | null
  isPlaying: boolean
  currentTime: number
  serverTimestamp: number
  queue: SyncTrack[]
  chatHistory: ChatMessage[]
}

/** Internal room storage (extends RoomState with housekeeping). */
export interface Room {
  code: string
  hostId: string
  members: RoomUser[]
  currentTrack: SyncTrack | null
  isPlaying: boolean
  currentTime: number
  lastSyncTimestamp: number
  queue: SyncTrack[]
  chatHistory: ChatMessage[]
  createdAt: number
  lastActivity: number // for empty-room cleanup
}

// ── Client → Server event payloads ──────────────────────────────────────────

export interface CreateRoomPayload {
  displayName: string
}

export interface JoinRoomPayload {
  roomCode: string
  displayName: string
}

export interface PlayTrackPayload {
  track: SyncTrack
  currentTime: number
}

export interface ResumePayload {
  currentTime: number
}

export interface SeekPayload {
  currentTime: number
}

export interface QueueUpdatePayload {
  queue: SyncTrack[]
}

export interface SendMessagePayload {
  text: string
}

export interface PingPayload {
  clientTimestamp: number
}
