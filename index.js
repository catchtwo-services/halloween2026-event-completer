const config = require("./config.js");
const { sendLog, formatError } = require("./src/logger");
const { readTokens, saveFiles } = require("./src/storage");
const { DELAYS } = require("./src/constants");
const { login, destroyClient, delay } = require("./src/discord");
const { prepareAccount } = require("./src/account");
const { sellTask, buyTask, handleChests } = require("./src/actions");
const { getTradeChannelId, runTrades } = require("./src/trade");

process.on("unhandledRejection", (reason) => {
  const detail =
    reason instanceof Error ? reason.stack : String(reason);

  sendLog(null, `Unhandled rejection: ${detail}`, "error");
});

let shuttingDown = false;

/**
 * Stop after the current action.
 *
 * @param {string} signal Signal name.
 * @returns {void}
 */
function requestShutdown(signal) {
  if (shuttingDown) {
    sendLog(null, "Forcing exit.", "error");
    process.exit(0);
  }

  shuttingDown = true;
  sendLog(
    null,
    `Received ${signal}. Stopping after the current action.`,
    "info"
  );
}

process.on("SIGINT", () => requestShutdown("SIGINT"));
process.on("SIGTERM", () => requestShutdown("SIGTERM"));

/**
 * Wait for the next cycle, but stop early when a shutdown signal arrives.
 *
 * @param {number} ms Delay in milliseconds.
 * @returns {Promise<void>}
 */
async function waitForNextCycle(ms) {
  const end = Date.now() + ms;

  while (!shuttingDown && Date.now() < end) {
    await delay(Math.min(1000, end - Date.now()));
  }
}

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
      sendLog(null, `Login failed: ${formatError(err)}`, "error");
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
      const detail = formatError(err);

      sendLog(
        client.user.username,
        `Setup failed: ${detail}`,
        "error"
      );

      if (detail.includes("status 401")) {
        sendLog(
          client.user.username,
          "Discord rejected the token for REST requests. Generate a fresh token for this account.",
          "error"
        );
      }
    }

    await delay(DELAYS.account);
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
      sendLog(session.username, `Sell failed: ${formatError(err)}`, "error");
    }

    await delay(DELAYS.account);
  }

  const attemptedListings = new Set();

  for (const session of sessions) {
    try {
      await buyTask(
        session,
        session.summary.spend,
        attemptedListings
      );
    } catch (err) {
      sendLog(session.username, `Buy failed: ${formatError(err)}`, "error");
    }

    await delay(DELAYS.account);
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
    sendLog(null, `Trade run failed: ${formatError(err)}`, "error");
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
        `Chest handling failed: ${formatError(err)}`,
        "error"
      );
    }

    await delay(DELAYS.account);
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
    sendLog(null, `Could not save files: ${formatError(err)}`, "error");
  }

  for (const client of clients) destroyClient(client);
}

/**
 * Run one full quest cycle.
 *
 * @param {Array<object>} clients Ready clients.
 * @returns {Promise<void>}
 */
async function runCycle(clients) {
  const sessions = await prepareSessions(clients);
  await delay(DELAYS.account);
  await runMarketPhase(sessions);
  await delay(DELAYS.account);
  await runTradePhase(sessions);
  await delay(DELAYS.account);
  await runChestPhase(sessions);
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
    if (clients.length === 0 || shuttingDown) return;

    const configuredLoop = Number(config.loopDelayMinutes ?? 0);
    const loopMinutes =
      Number.isFinite(configuredLoop) && configuredLoop > 0
        ? configuredLoop
        : 0;

    do {
      try {
        await runCycle(clients);
        sendLog(
          null,
          loopMinutes > 0 ? "Cycle finished." : "Done.",
          "info"
        );
      } catch (err) {
        sendLog(null, `Cycle failed: ${formatError(err)}`, "error");
      }

      if (shuttingDown || loopMinutes <= 0) break;

      sendLog(
        null,
        `Next check in ${loopMinutes} minute(s).`,
        "info"
      );

      await waitForNextCycle(loopMinutes * 60 * 1000);
    } while (!shuttingDown);
  } finally {
    shutdown(clients);
  }
}

if (require.main === module) {
  main().catch((err) => {
    sendLog(null, `Fatal: ${err.stack ?? formatError(err)}`, "error");
    process.exitCode = 1;
  });
}

module.exports = { main };
