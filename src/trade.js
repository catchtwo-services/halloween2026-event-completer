/*
 * SPDX-FileCopyrightText: 2026 Kyan Bosman
 * License: see LICENSE
 */

const config = require("../config.js");
const {
  POKETWO_ID,
  TIMEOUTS,
  DELAYS,
  TRADE_CHANNEL_NAMES,
} = require("./constants");
const { sendLog, formatError } = require("./logger");
const { messageText } = require("./parsers");
const {
  delay,
  waitForMessage,
  pressButtonByLabel,
} = require("./discord");

/**
 * Choose the shared channel used for trades.
 *
 * @param {Array<object>} sessions Account sessions.
 * @returns {Promise<string|null>} Channel ID.
 */
async function getTradeChannelId(sessions) {
  if (config.tradeChannelId) return config.tradeChannelId;
  if (config.channelId) return config.channelId;

  const guild = sessions[0]?.guild;
  if (!guild) return null;

  let channels = guild
    .getChannels()
    .filter((channel) => channel.type === 0);

  if (channels.length === 0) {
    channels = (await guild.fetchChannels().catch(() => [])).filter(
      (channel) => channel.type === 0
    );
  }

  for (const name of TRADE_CHANNEL_NAMES) {
    const channel = channels.find(
      (entry) => entry.name?.toLowerCase() === name
    );
    if (channel) return channel.id;
  }

  return channels[0]?.id ?? null;
}

/**
 * Cancel a trade without throwing.
 *
 * @param {object} session Account session.
 * @param {string} channelId Trade channel ID.
 * @returns {Promise<void>}
 */
async function cancelTrade(session, channelId) {
  try {
    await session.client.sendMessage(
      channelId,
      `<@${POKETWO_ID}> trade cancel`
    );
  } catch (err) {
    // Nothing useful to do here.
  }
}

/**
 * Start one trade, accept it, then cancel it immediately. Poketwo counts the
 * trade event even when no items were exchanged.
 *
 * @param {object} initiator Account that starts the trade.
 * @param {object} responder Account that accepts the trade.
 * @param {string} channelId Shared trade channel ID.
 * @returns {Promise<void>}
 */
async function runOneTrade(initiator, responder, channelId) {
  const responderId = responder.client.user.id;

  const waitForRequest = waitForMessage(
    responder.client,
    { id: channelId },
    (msg) =>
      msg.author.id === POKETWO_ID &&
      /requesting a trade/i.test(messageText(msg)),
    TIMEOUTS.tradeRequest
  );

  const waitForTrade = waitForMessage(
    initiator.client,
    { id: channelId },
    (msg) =>
      msg.author.id === POKETWO_ID &&
      /^trade between/i.test(msg.embeds?.[0]?.title ?? ""),
    TIMEOUTS.tradeRequest
  );

  await initiator.client.sendMessage(
    channelId,
    `<@${POKETWO_ID}> trade <@${responderId}>`
  );

  const request = await waitForRequest;
  pressButtonByLabel(request, ["accept", "✅"]);
  await waitForTrade;

  const waitForCancel = waitForMessage(
    initiator.client,
    { id: channelId },
    (msg) =>
      msg.author.id === POKETWO_ID &&
      /(cancel+ed|not in a trade)/i.test(
        messageText(msg)
      ),
    TIMEOUTS.cancel
  );

  await initiator.client.sendMessage(
    channelId,
    `<@${POKETWO_ID}> trade cancel`
  );

  await waitForCancel;
  await delay(DELAYS.short);

  sendLog(
    initiator.username,
    `Completed a trade with ${responder.username}.`,
    "success"
  );
}

/**
 * Pick a trade partner. Prefer an account that still needs trades.
 *
 * @param {object} session Current account.
 * @param {Array<object>} needy Accounts with trades remaining.
 * @param {Array<object>} sessions All accounts.
 * @param {Map<string, number>} remaining Remaining trade counts.
 * @returns {object|null}
 */
function pickPartner(session, needy, sessions, remaining) {
  return (
    needy.find(
      (candidate) =>
        candidate !== session &&
        remaining.get(candidate.username) > 0
    ) ??
    sessions.find((candidate) => candidate !== session) ??
    null
  );
}

/**
 * Complete all Trade quests by pairing accounts.
 *
 * @param {Array<object>} sessions Account sessions.
 * @param {string} channelId Shared trade channel ID.
 * @returns {Promise<void>}
 */
async function runTrades(sessions, channelId) {
  if (sessions.length < 2) {
    sendLog(
      null,
      "Trade quest found but only one account is logged in.",
      "error"
    );
    return;
  }

  const remaining = new Map(
    sessions.map((session) => [session.username, session.summary.trade])
  );
  const needy = sessions.filter(
    (session) => remaining.get(session.username) > 0
  );

  for (const session of needy) {
    while (remaining.get(session.username) > 0) {
      const partner = pickPartner(session, needy, sessions, remaining);
      if (!partner) break;

      try {
        await runOneTrade(session, partner, channelId);

        remaining.set(
          session.username,
          remaining.get(session.username) - 1
        );

        if (remaining.get(partner.username) > 0) {
          remaining.set(
            partner.username,
            remaining.get(partner.username) - 1
          );
        }
      } catch (err) {
        sendLog(
          session.username,
          `Trade with ${partner.username} failed: ${formatError(err)}`,
          "error"
        );

        await cancelTrade(session, channelId);
        await cancelTrade(partner, channelId);
        await delay(DELAYS.cancel);
        break;
      }

      await delay(DELAYS.account);
    }
  }

  for (const [username, count] of remaining) {
    if (count > 0) {
      sendLog(username, `${count} trade(s) still remaining.`, "error");
    }
  }
}

module.exports = {
  getTradeChannelId,
  runOneTrade,
  runTrades,
};
