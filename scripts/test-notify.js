// ──────────────────────────────────────────────────────────────
// scripts/test-notify.js — Test Egg/Boss Notification Dispatcher
// ──────────────────────────────────────────────────────────────
// Sends simulated egg spawn alerts to verify Discord notifications,
// role pings, embeds, and AI predictor learning.

require('dotenv').config();
const axios = require('axios');

const BOT_URL = process.env.BOT_URL || 'https://discord-egg-notifier-production.up.railway.app';

async function sendEggAlert({ eggName, rarity, biome, jobId, instanceIndex = 1 }) {
  console.log(`[test-notify] 🚀 Dispatching ${rarity} alert: "${eggName}" (#${instanceIndex}) in "${biome}" to ${BOT_URL}...`);
  try {
    const res = await axios.post(`${BOT_URL}/api/notify-egg`, {
      eggName,
      rarity,
      biome,
      jobId: jobId || `test_job_${Date.now()}`,
      clientTime: Date.now(),
    }, { timeout: 10000 });

    console.log(`[test-notify] ✅ Response (${res.status}):`, res.data);
    return res.data;
  } catch (err) {
    console.error(`[test-notify] ❌ Failed:`, err.response?.data || err.message);
    throw err;
  }
}

async function run() {
  const args = process.argv.slice(2);

  if (args.includes('--help')) {
    console.log(`
Usage:
  node scripts/test-notify.js [options]
  node scripts/test-notify.js <eggName> <rarity> <biome>

Options:
  --divine-pair     Test notify both 2 Divine eggs in Angels & Demons (ArchAngel & World Burner)
  --divine-multi    Test notify a double spawn (Instance #1 & #2) of ArchAngel in Angels & Demons
  --help            Show this help message
    `);
    process.exit(0);
  }

  // Check custom args: <eggName> <rarity> <biome>
  if (args.length >= 3 && !args[0].startsWith('--')) {
    const [eggName, rarity, biome] = args;
    await sendEggAlert({ eggName, rarity, biome });
    return;
  }

  const isMulti = args.includes('--divine-multi');
  const sessionId = `test_session_${Date.now()}`;

  console.log(`\n═══════════════════════════════════════════════════════════════`);
  console.log(`🔔 TESTING 2 DIVINE NOTIFICATIONS IN ANGELS & DEMONS`);
  console.log(`═══════════════════════════════════════════════════════════════\n`);

  if (isMulti) {
    // Scenario 1: Same Divine egg spawning twice in the same server (Double Multi-Spawn)
    console.log(`▶ Scenario: Double Multi-Spawn of ArchAngel (#1 & #2) in Angels & Demons\n`);
    await sendEggAlert({
      eggName: 'ArchAngel',
      rarity: 'Divine',
      biome: 'Angels & Demons',
      jobId: sessionId,
      instanceIndex: 1,
    });

    console.log(`⏳ Waiting 1s before dispatching Multi-Spawn #2...`);
    await new Promise((r) => setTimeout(r, 1000));

    await sendEggAlert({
      eggName: 'ArchAngel',
      rarity: 'Divine',
      biome: 'Angels & Demons',
      jobId: sessionId,
      instanceIndex: 2,
    });
  } else {
    // Scenario 2: The 2 canonical Divine eggs in Angels & Demons (ArchAngel & World Burner)
    console.log(`▶ Scenario: Both canonical Divine eggs in Angels & Demons (ArchAngel & World Burner)\n`);
    await sendEggAlert({
      eggName: 'ArchAngel',
      rarity: 'Divine',
      biome: 'Angels & Demons',
      jobId: sessionId,
    });

    console.log(`⏳ Waiting 1s before dispatching World Burner...`);
    await new Promise((r) => setTimeout(r, 1000));

    await sendEggAlert({
      eggName: 'World Burner',
      rarity: 'Divine',
      biome: 'Angels & Demons',
      jobId: sessionId,
    });
  }

  console.log(`\n🎉 Test alerts dispatched successfully to Discord! Check your notification channel.\n`);
}

run().catch((err) => {
  console.error('[test-notify] Fatal error:', err.message);
  process.exit(1);
});
