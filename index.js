const config = require("./config.js");
const { sendLog } = require("./src/logger");
const { readTokens, saveFiles } = require("./src/storage");
const { login, destroyClient } = require("./src/discord");
const { prepareAccount } = require("./src/account");
const { sellTask, buyTask, handleChests } = require("./src/actions");
const { getTradeChannelId, runTrades } = require("./src/trade");

/**
 * Check the minimum configuration needed to run.
 *
 * @param {string[]} tokens Account tokens.
 * @returns {boolean}
 */
function isConfigured(tokens) {
  if (tokens.length === 0) {
    sendLog(null, "No tokens found in tokens.txt.", "error");
    return false;
  }

  if (!config.guildId) {
    sendLog(null, "Set guildId in config.js.", "error");
    return false;
  }

  return true;
}

/**
 * Log in every account.
 *
 * @param {string[]} tokens Account tokens.
 * @returns {Promise<Array<object>>} Ready clients.
 */
async function loginAll(tokens) {
  const clients = [];

  for (const token of tokens) {
    try {
      const client = await login(token);
      clients.push(client);
      sendLog(client.user.username, "Logged in.", "success");
    } catch (err) {
      sendLog(null, `Login failed: ${err.message}`, "error");
    }
  }

  return clients;
}

/**
 * Prepare every account and run the actions that only need its own data.
 *
 * @param {Array<object>} clients Ready clients.
 * @returns {Promise<Array<object>>} Prepared sessions.
 */
async function prepareSessions(clients) {
  const sessions = [];

  for (const client of clients) {
    try {
      sessions.push(await prepareAccount(client, clients.length));
    } catch (err) {
      sendLog(
        client.user.username,
        `Setup failed: ${err.message}`,
        "error"
      );
    }
  }

  for (const session of sessions) {
    session.accountCount = sessions.length;
  }

  return sessions;
}

/**
 * Run the market sell and buy phases. Sellers run first so buyers have
 * listings to purchase.
 *
 * @param {Array<object>} sessions Prepared sessions.
 * @returns {Promise<void>}
 */
async function runMarketPhase(sessions) {
  for (const session of sessions) {
    try {
      await sellTask(session, session.summary.earn);
    } catch (err) {
      sendLog(session.username, `Sell failed: ${err.message}`, "error");
    }
  }

  for (const session of sessions) {
    try {
      await buyTask(session, session.summary.spend);
    } catch (err) {
      sendLog(session.username, `Buy failed: ${err.message}`, "error");
    }
  }
}

/**
 * Run the trade phase when at least one account has trades remaining.
 *
 * @param {Array<object>} sessions Prepared sessions.
 * @returns {Promise<void>}
 */
async function runTradePhase(sessions) {
  const needsTrades = sessions.some(
    (session) => session.summary.trade > 0
  );

  if (!needsTrades) return;

  const channelId = await getTradeChannelId(sessions);

  if (!channelId) {
    sendLog(
      null,
      "Trade quest found but no shared trade channel is available. " +
        "Set tradeChannelId in config.js.",
      "error"
    );
    return;
  }

  sendLog(null, `Running trades in channel ${channelId}.`, "info");

  try {
    await runTrades(sessions, channelId);
  } catch (err) {
    sendLog(null, `Trade run failed: ${err.message}`, "error");
  }
}

/**
 * Run the chest phase for every account.
 *
 * @param {Array<object>} sessions Prepared sessions.
 * @returns {Promise<void>}
 */
async function runChestPhase(sessions) {
  for (const session of sessions) {
    try {
      await handleChests(session);
    } catch (err) {
      sendLog(
        session.username,
        `Chest handling failed: ${err.message}`,
        "error"
      );
    }
  }
}

/**
 * Save state and close every client.
 *
 * @param {Array<object>} clients Ready clients.
 * @returns {void}
 */
function shutdown(clients) {
  try {
    saveFiles();
  } catch (err) {
    sendLog(null, `Could not save files: ${err.message}`, "error");
  }

  for (const client of clients) destroyClient(client);
}

/**
 * Main entry point.
 *
 * @returns {Promise<void>}
 */
async function main() {
  const clients = [];

  try {
    const tokens = readTokens();
    if (!isConfigured(tokens)) return;

    clients.push(...(await loginAll(tokens)));
    if (clients.length === 0) return;

    const sessions = await prepareSessions(clients);
    await runMarketPhase(sessions);
    await runTradePhase(sessions);
    await runChestPhase(sessions);

    sendLog(null, "Done.", "info");
  } finally {
    shutdown(clients);
  }
}

if (require.main === module) {
  main().catch((err) => {
    sendLog(null, `Fatal: ${err.stack ?? err.message}`, "error");
    process.exitCode = 1;
  });
}

module.exports = { main };
