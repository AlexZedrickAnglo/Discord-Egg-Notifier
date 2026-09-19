// ──────────────────────────────────────────────────────────────
// utils/dataDir.js — Persistent data directory resolver
// ──────────────────────────────────────────────────────────────
// On Railway, files in the project directory are reset on every deploy.
// This module resolves to a persistent volume path (RAILWAY_VOLUME_MOUNT_PATH
// or DATA_DIR env var) so that runtime state files (spawn-history, message IDs,
// etc.) survive across deployments.
//
// Locally, it falls back to <project>/data/ for normal development.
//
// On first boot after a fresh deploy, if the persistent directory is empty,
// seed files are copied from the bundled ./data/ directory so the predictor
// starts with at least the seed spawn history.

const fs = require('fs');
const path = require('path');

const PROJECT_DATA_DIR = path.join(__dirname, '..', 'data');

// Railway persistent volume or explicit override, fallback to project ./data/
let persistentDir = PROJECT_DATA_DIR;
if (process.env.RAILWAY_VOLUME_MOUNT_PATH) {
  persistentDir = process.env.RAILWAY_VOLUME_MOUNT_PATH;
} else if (process.env.DATA_DIR) {
  persistentDir = process.env.DATA_DIR;
}
const PERSISTENT_DIR = persistentDir;

// Ensure persistent directory exists
if (!fs.existsSync(PERSISTENT_DIR)) {
  fs.mkdirSync(PERSISTENT_DIR, { recursive: true });
  console.log(`[dataDir] Created persistent data directory: ${PERSISTENT_DIR}`);
}

// Seed files from bundled ./data/ if they don't exist in the persistent path yet
const SEED_FILES = ['spawn-history.json', 'eggs.json'];

for (const file of SEED_FILES) {
  const persistentPath = path.join(PERSISTENT_DIR, file);
  const bundledPath = path.join(PROJECT_DATA_DIR, file);
  if (!fs.existsSync(persistentPath) && fs.existsSync(bundledPath)) {
    try {
      fs.copyFileSync(bundledPath, persistentPath);
      console.log(`[dataDir] Seeded ${file} from bundled data to persistent storage.`);
    } catch (err) {
      console.error(`[dataDir] Failed to seed ${file}:`, err.message);
    }
  }
}

/**
 * Resolve a data file path within the persistent directory.
 * @param {string} filename - e.g. 'spawn-history.json'
 * @returns {string} Absolute path in persistent storage
 */
function dataPath(filename) {
  return path.join(PERSISTENT_DIR, filename);
}

console.log(`[dataDir] Using data directory: ${PERSISTENT_DIR} (persistent: ${PERSISTENT_DIR !== PROJECT_DATA_DIR})`);

module.exports = { dataPath, PERSISTENT_DIR, PROJECT_DATA_DIR };
