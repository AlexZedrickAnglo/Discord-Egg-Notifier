// ──────────────────────────────────────────────────────────────
// utils/roblox.js — Roblox API helpers + egg database lookups
// ──────────────────────────────────────────────────────────────
const axios    = require('axios');
const path     = require('path');
const eggDb    = require(path.join(__dirname, '..', 'data', 'eggs.json'));

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
 * @returns {object|null} The first entry from the Roblox games API response.
 */
async function getGameDetails() {
  const universeId = await getUniverseId();
  const url = `https://games.roblox.com/v1/games?universeIds=${universeId}`;
  const { data } = await axios.get(url);
  return data.data?.[0] ?? null;
}

// ── Egg Database Helpers ─────────────────────────────────────

/**
 * Build a flat lookup map: lowercase egg name → { name, rarity, biome }
 */
const eggLookup = new Map();
for (const [rarity, eggs] of Object.entries(eggDb)) {
  for (const egg of eggs) {
    eggLookup.set(egg.name.toLowerCase(), {
      name:   egg.name,
      rarity,
      biome:  egg.biome,
    });
  }
}

/**
 * Look up an egg by name (case-insensitive, supports partial matches).
 * @param {string} query
 * @returns {object|null} { name, rarity, biome } or null
 */
function findEgg(query) {
  if (!query) return null;
  const q = query.toLowerCase().trim();

  // Exact match first
  if (eggLookup.has(q)) return eggLookup.get(q);

  // Partial / fuzzy match
  for (const [key, entry] of eggLookup) {
    if (key.includes(q) || q.includes(key)) return entry;
  }
  return null;
}

/**
 * Return all eggs in the database grouped by rarity.
 */
function getAllEggs() {
  return eggDb;
}

module.exports = { PLACE_ID, getUniverseId, getGameDetails, findEgg, getAllEggs, eggLookup };
