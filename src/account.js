/*
 * SPDX-FileCopyrightText: 2026 Kyan Bosman
 * License: see LICENSE
 */

const config = require("../config.js");
const {
  MAX_LIST_PAGES,
  DELAYS,
} = require("./constants");
const { sendLog, formatError } = require("./logger");
const {
  getGuildChannel,
  getMarketChannel,
  delay,
} = require("./discord");
const { startEvent, fetchBingoCard } = require("./event");
const {
  fetchPokemon,
  annotateRarity,
} = require("./pokemon");
const { releaseTask, evolveTask } = require("./actions");
const { parseQuests, summarizeTasks } = require("./parsers");
const { tasks, market, saveFiles } = require("./storage");

/**
 * @typedef {object} QuestSummary
 * @property {number} release
 * @property {number} spend
 * @property {number} earn
 * @property {number} evolve
 * @property {number} trade
 */

/**
 * @typedef {object} AccountSession
 * @property {object} client Ready discord-self-lite client.
 * @property {object} guild Cached guild.
 * @property {object} channel Guild command channel.
 * @property {object} marketChannel Channel used for market commands.
 * @property {string} username Account username.
 * @property {Array<object>} pokemon Parsed pokemon candidates.
 * @property {QuestSummary} summary Remaining quest amounts.
 * @property {number} accountCount Number of prepared accounts.
 */

/**
 * Log in one account, read its bingo card, and run the actions that only need
 * that account's own pokemon list.
 *
 * @param {object} client Ready discord-self-lite client.
 * @param {number} accountCount Number of accounts being prepared.
 * @returns {Promise<AccountSession>}
 */
async function prepareAccount(client, accountCount) {
  const username = client.user.username;

  if (!tasks[username]) tasks[username] = {};
  if (!market[username]) market[username] = [];

  let guild;

  try {
    guild =
      client.guilds.get(config.guildId) ??
      (await client.resolveGuild(config.guildId));
  } catch (err) {
    throw new Error(`Guild lookup failed: ${formatError(err)}`);
  }

  if (!guild) throw new Error(`Guild ${config.guildId} not found`);

  let channel;

  try {
    channel = await getGuildChannel(client, guild);
  } catch (err) {
    throw new Error(`Channel lookup failed: ${formatError(err)}`);
  }

  let marketChannel;

  try {
    marketChannel = await getMarketChannel(client, channel);
  } catch (err) {
    sendLog(
      username,
      `Market channel setup failed: ${formatError(
        err
      )}. Falling back to the guild channel.`,
      "error"
    );
    marketChannel = channel;
  }

  await startEvent(client, channel);
  await delay(DELAYS.account);

  let card;

  try {
    card = await fetchBingoCard(client, channel);
  } catch (err) {
    throw new Error(`Bingo card fetch failed: ${formatError(err)}`);
  }

  const quests = parseQuests(card.text);
  const summary = summarizeTasks(quests);

  tasks[username] = {
    ...tasks[username],
    ...summary,
    card: card.cardNumber,
    bingos: card.bingos,
    quests,
    updatedAt: new Date().toISOString(),
  };
  saveFiles();

  sendLog(
    username,
    `Bingo card #${card.cardNumber ?? "?"}: ${
      card.bingos ?? "?"
    }/12 bingos, ${quests.length} quests.`,
    "info"
  );
  sendLog(
    username,
    `Actionable: release ${summary.release}, evolve ${
      summary.evolve
    }, spend ${summary.spend}, earn ${summary.earn}, trade ${
      summary.trade
    }.`,
    "info"
  );

  let pokemon = [];

  if (summary.release > 0 || summary.earn > 0) {
    try {
      pokemon = await fetchPokemon(client, channel, {
        maxPages: MAX_LIST_PAGES,
      });
    } catch (err) {
      sendLog(
        username,
        `Pokemon list failed: ${formatError(err)}`,
        "error"
      );
    }
  }

  if (pokemon.length > 0) await annotateRarity(pokemon);

  const session = {
    client,
    guild,
    channel,
    marketChannel,
    username,
    pokemon,
    summary,
    accountCount,
  };

  if (summary.release > 0) {
    try {
      await releaseTask(session, summary.release);
    } catch (err) {
      sendLog(
        username,
        `Release action failed: ${formatError(err)}`,
        "error"
      );
    }

    await delay(DELAYS.account);
  }

  if (summary.evolve > 0) {
    try {
      await evolveTask(session, summary.evolve);
    } catch (err) {
      sendLog(
        username,
        `Evolve action failed: ${formatError(err)}`,
        "error"
      );
    }
  }

  return session;
}

module.exports = { prepareAccount };
