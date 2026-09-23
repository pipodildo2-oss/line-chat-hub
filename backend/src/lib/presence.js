// Tracks which agents currently have at least one live Socket.io connection
// — the "ออนไลน์" indicator on Settings > ทีมงาน. Deliberately separate
// from Agent.status (schema.prisma): that field is a manually-picked value
// (or AfkTracker.jsx's inferred 'away') that sits in the database and can
// go stale — an agent who just closes their laptop without touching the
// status dropdown stays "online" there forever. This is live connection
// presence instead: true for exactly as long as a socket is actually open,
// nothing persisted.
//
// Backed by a Socket.io ROOM per agent rather than a local Map, specifically
// so it stays correct when running as more than one Railway replica behind
// the Redis adapter (index.js) — a plain in-process Map would only see
// sockets that happened to land on THAT replica, silently showing a
// teammate as offline the moment their connection was routed elsewhere.
// Every authenticated socket joins `agent:<id>` on connect (index.js); the
// Redis adapter keeps room membership synced across all replicas, so a room
// query here reflects the whole cluster, not just this process.
const AGENT_ROOM_PREFIX = 'agent:';

function agentRoom(agentId) {
  return AGENT_ROOM_PREFIX + agentId;
}

// Every agentId with at least one open socket anywhere in the cluster right
// now — used once, to seed the initial state when the Team page first
// loads (GET /api/agents/online-ids), before any live 'agent_presence'
// event has arrived. Reads the adapter's own room map directly rather than
// fetchSockets() per agent, since with the Redis adapter that map is
// already the synced cluster-wide view, not just this process's sockets.
function getOnlineAgentIds(io) {
  const ids = [];
  for (const [room, sockets] of io.sockets.adapter.rooms) {
    if (room.startsWith(AGENT_ROOM_PREFIX) && sockets.size > 0) {
      ids.push(room.slice(AGENT_ROOM_PREFIX.length));
    }
  }
  return ids;
}

module.exports = { agentRoom, getOnlineAgentIds };
