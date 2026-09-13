// ──────────────────────────────────────────────────────────────
// utils/roblox.js — Roblox API helpers for Steal An Egg
// ──────────────────────────────────────────────────────────────
const axios = require('axios');

const PLACE_ID = '107778070777162';

let cachedUniverseId = null;

/**
 * Resolve the Universe ID from the hard-coded Place ID.
 * Result is cached after the first successful call.
 */
async function getUniverseId() {
  if (cachedUniverseId) return cachedUniverseId;

  const url = `https://apis.roblox.com/universes/v1/places/${PLACE_ID}/universe`;
  const { data } = await axios.get(url);
  cachedUniverseId = data.universeId;
  return cachedUniverseId;
}

/**
 * Fetch live game details (player count, visits, updated timestamp, etc.)
 * @returns {object} The first entry from the Roblox games API response.
 */
async function getGameDetails() {
  const universeId = await getUniverseId();
  const url = `https://games.roblox.com/v1/games?universeIds=${universeId}`;
  const { data } = await axios.get(url);
  return data.data?.[0] ?? null;
}

module.exports = { PLACE_ID, getUniverseId, getGameDetails };
