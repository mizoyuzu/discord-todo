// === FILE: src/utils/state.js ===
// Shared state for multi-step interaction flows

const pendingCreations = new Map();

// Cleanup expired entries (10 min TTL)
function cleanupPendingCreations() {
    const now = Date.now();
    for (const [key, data] of pendingCreations) {
        if (now - data.timestamp > 10 * 60 * 1000) {
            pendingCreations.delete(key);
        }
    }
}
setInterval(cleanupPendingCreations, 60 * 1000);

module.exports = { pendingCreations };
