/*
 * SPDX-FileCopyrightText: 2026 Kyan Bosman
 * License: see LICENSE
 */

const {
  POKETWO_ID,
  EVENT_COMMAND,
  TIMEOUTS,
  DELAYS,
} = require("./constants");
const { sendLog } = require("./logger");
const { getContainerText } = require("./parsers");
const { delay, waitForMessage } = require("./discord");

/**
 * Ask Poketwo to show the event page so the event is started.
 * This is best effort; the bingo command still works if the page times out.
 *
 * @param {object} client discord-self-lite client.
 * @param {object} channel Guild channel.
 * @returns {Promise<void>}
 */
async function startEvent(client, channel) {
  const waitForEvent = waitForMessage(
    client,
    channel,
    (msg) =>
      msg.author.id === POKETWO_ID &&
      getContainerText(msg)?.includes("### Inventory"),
    TIMEOUTS.event
  );

  try {
    await channel.send(`<@${POKETWO_ID}> halloween`);
    await waitForEvent;
  } catch (err) {
    // The event page is optional. The bingo card command can still work.
    waitForEvent.catch(() => {});
  }
}

/**
 * Fetch and parse the current bingo card.
 *
 * @param {object} client discord-self-lite client.
 * @param {object} channel Guild channel.
 * @param {number} [retries=2] Number of retries after a timeout.
 * @returns {Promise<{text:string,cardNumber:number|null,bingos:number|null}>}
 */
async function fetchBingoCard(client, channel, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const waitForCard = waitForMessage(
      client,
      channel,
      (msg) =>
        msg.author.id === POKETWO_ID &&
        getContainerText(msg)?.includes("### Quests"),
      TIMEOUTS.card
    );

    try {
      await channel.send(`<@${POKETWO_ID}> ${EVENT_COMMAND}`);
    } catch (err) {
      waitForCard.catch(() => {});
      throw err;
    }

    try {
      const msg = await waitForCard;
      const text = getContainerText(msg);
      const cardMatch = text.match(/### Bingo card #(\d+)/);
      const bingosMatch = text.match(/(\d+)\/12 Bingos/);

      return {
        text,
        cardNumber: cardMatch ? Number(cardMatch[1]) : null,
        bingos: bingosMatch ? Number(bingosMatch[1]) : null,
      };
    } catch (err) {
      if (attempt === retries) throw err;

      sendLog(
        client.user.username,
        `Bingo card request timed out, retrying (${attempt + 1}/${retries}).`,
        "error"
      );

      await delay(DELAYS.retry);
    }
  }
}

module.exports = { startEvent, fetchBingoCard };
