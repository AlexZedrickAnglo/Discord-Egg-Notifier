// ──────────────────────────────────────────────────────────────
// commands/predict.js — /predict slash command
// ──────────────────────────────────────────────────────────────
const { SlashCommandBuilder } = require('discord.js');
const { getPrediction }       = require('../utils/predictor');
const { buildPredictionEmbed } = require('../utils/notifier');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('predict')
    .setDescription('Forecast the next global egg spawn ETA, rarity pity, and specific pet probabilities.'),

  async execute(interaction) {
    try {
      const prediction = getPrediction();
      const embed = buildPredictionEmbed(prediction);
      await interaction.reply({ embeds: [embed] });
    } catch (err) {
      console.error('[command/predict] Error:', err);
      await interaction.reply({
        content: `❌ Failed to compute prediction: ${err.message}`,
        flags: 64, // ephemeral
      });
    }
  },
};
