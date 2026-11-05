/*
 * SPDX-FileCopyrightText: 2026 Kyan Bosman
 * License: see LICENSE
 */

const { Client } = require("discord-self-lite");
const config = require("../config.js");
const {
  POKETWO_ID,
  TIMEOUTS,
} = require("./constants");
const { sendLog } = require("./logger");
const { camelCaseKeys } = require("./parsers");

/**
 * Wait for a number of milliseconds.
 *
 * @param {number} ms Delay in milliseconds.
 * @returns {Promise<void>}
 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait for the first event that matches one of the given predicates.
 *
 * @param {object} client discord-self-lite client.
 * @param {Array<{event:string, predicate:Function}>} subscriptions Events to watch.
 * @param {number} timeout Timeout in milliseconds.
 * @param {string} errorMessage Timeout error text.
 * @returns {Promise<{event:string,args:Array}>}
 */
function waitForAnyEvent(client, subscriptions, timeout, errorMessage) {
  return new Promise((resolve, reject) => {
    const listeners = [];
    let timer;

    const cleanup = () => {
      clearTimeout(timer);
      for (const [event, handler] of listeners) client.off(event, handler);
    };

    for (const { event, predicate } of subscriptions) {
      const handler = (...args) => {
        let matched = false;

        try {
          matched = predicate(...args);
        } catch (err) {
          return;
        }

        if (!matched) return;

        cleanup();
        resolve({ event, args });
      };

      listeners.push([event, handler]);
      client.on(event, handler);
    }

    timer = setTimeout(() => {
      cleanup();
      reject(new Error(errorMessage));
    }, timeout);
    timer.unref();
  });
}

/**
 * Wait for a matching message in a channel.
 *
 * @param {object} client discord-self-lite client.
 * @param {{id:string}} channel Channel-like object.
 * @param {Function} predicate Message predicate.
 * @param {number} [timeout=TIMEOUTS.message] Timeout in milliseconds.
 * @returns {Promise<object>} Matching message.
 */
async function waitForMessage(
  client,
  channel,
  predicate,
  timeout = TIMEOUTS.message
) {
  const { args } = await waitForAnyEvent(
    client,
    [
      {
        event: "messageCreate",
        predicate: (msg) =>
          msg.channelId === channel.id && predicate(msg),
      },
    ],
    timeout,
    "Timed out waiting for the bot"
  );

  return args[0];
}

/**
 * Wait for an edit to a specific message.
 *
 * discord-self-lite does not emit a typed messageUpdate event, so this reads
 * the raw MESSAGE_UPDATE dispatch packet and normalizes it.
 *
 * @param {object} client discord-self-lite client.
 * @param {string} messageId Message ID to watch.
 * @param {number} [timeout=TIMEOUTS.message] Timeout in milliseconds.
 * @param {object|null} [fallback=null] Previous page used to fill missing fields.
 * @returns {Promise<object>} Normalized message data.
 */
async function waitForMessageUpdate(
  client,
  messageId,
  timeout = TIMEOUTS.message,
  fallback = null
) {
  const { args } = await waitForAnyEvent(
    client,
    [
      {
        event: "dispatch",
        predicate: (packet) =>
          packet?.t === "MESSAGE_UPDATE" &&
          packet.d?.id === messageId,
      },
    ],
    timeout,
    "Timed out waiting for the message update"
  );

  const updated = camelCaseKeys(args[0].d);

  if (fallback) {
    if (!updated.components) updated.components = fallback.components;
    if (!updated.embeds) updated.embeds = fallback.embeds;
  }

  return updated;
}

/**
 * Get the enabled buttons from a message.
 *
 * @param {object} msg Message-like object.
 * @returns {Array<object>}
 */
function getButtons(msg) {
  return (msg.components ?? [])
    .flatMap((row) => row.components ?? [])
    .filter(
      (component) =>
        component.type === 2 &&
        component.customId &&
        !component.disabled
    );
}

/**
 * Click a button by custom ID.
 *
 * @param {object} msg Message-like object.
 * @param {string} customId Button custom ID.
 * @returns {void}
 */
function pressButton(msg, customId) {
  if (!customId) throw new Error("No button to press");

  const button = getButtons(msg).find(
    (component) => component.customId === customId
  );

  if (!button) throw new Error("Button is unavailable");

  msg.clickButton(button.customId).catch(() => {});
}

/**
 * Check whether a message has a button matching one of the labels.
 *
 * @param {object} msg Message-like object.
 * @param {string[]} labels Labels or emoji names to match.
 * @returns {boolean}
 */
function hasButton(msg, labels) {
  return getButtons(msg).some((button) =>
    labels.some((label) => buttonMatches(button, label))
  );
}

/**
 * Click the first button matching one of the labels, falling back to the first
 * enabled button.
 *
 * @param {object} msg Message-like object.
 * @param {string[]} labels Labels or emoji names to match.
 * @returns {void}
 */
function pressButtonByLabel(msg, labels) {
  const buttons = getButtons(msg);
  const button =
    buttons.find((candidate) =>
      labels.some((label) => buttonMatches(candidate, label))
    ) ?? buttons[0];

  if (!button) throw new Error("No matching button found");

  msg.clickButton(button.customId).catch(() => {});
}

/**
 * @param {object} button Discord button component.
 * @param {string} label Label or emoji name.
 * @returns {boolean}
 */
function buttonMatches(button, label) {
  const wanted = label.toLowerCase();

  return (
    (button.label ?? "").toLowerCase().includes(wanted) ||
    (button.emoji?.name ?? "").toLowerCase() === wanted
  );
}

/**
 * Destroy a client without throwing.
 *
 * @param {object} client discord-self-lite client.
 * @returns {void}
 */
function destroyClient(client) {
  try {
    client.destroy();
  } catch (err) {
    // Nothing useful to do here.
  }
}

/**
 * Log in one account.
 *
 * @param {string} token Discord user token.
 * @returns {Promise<object>} Ready client.
 */
async function login(token) {
  const client = new Client({ apiVersion: 10 });

  client.on("error", (err) => {
    sendLog(
      client.user?.username,
      `Client error: ${err?.message ?? err}`,
      "error"
    );
  });

  let timer;
  try {
    await Promise.race([
      client.login(token),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Login timed out")),
          TIMEOUTS.login
        );
      }),
    ]);

    return client;
  } catch (err) {
    destroyClient(client);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Find or create the channel used for this account's commands.
 *
 * @param {object} client discord-self-lite client.
 * @param {object} guild Cached guild.
 * @returns {Promise<object>} Channel.
 */
async function getGuildChannel(client, guild) {
  if (config.channelId) {
    const channel =
      client.getChannel(config.channelId) ??
      (await client.resolveChannel(config.channelId).catch(() => null));

    if (!channel) throw new Error(`Channel ${config.channelId} not found`);
    return channel;
  }

  const username = client.user.username;
  let channels = guild.getChannels();

  if (channels.length === 0) {
    channels = await guild.fetchChannels().catch(() => []);
  }

  const channel =
    channels.find((entry) => entry.name === username) ??
    channels.find((entry) => entry.name?.includes(username));

  if (channel) return channel;

  const data = await client.rest
    .request(`/guilds/${guild.id}/channels`, {
      method: "POST",
      body: JSON.stringify({ name: username, type: 0 }),
    })
    .catch((err) => {
      throw new Error(
        `No channel found for ${username} and channel creation failed: ${err.message}`
      );
    });

  return await client.fetchChannel(data.id);
}

/**
 * Get the channel used for market commands.
 *
 * @param {object} client discord-self-lite client.
 * @param {object} guildChannel Fallback guild channel.
 * @returns {Promise<object>} Market channel.
 */
async function getMarketChannel(client, guildChannel) {
  if (config.marketInDms === false) return guildChannel;

  const user = await client.resolveUser(POKETWO_ID);
  return user.createDM();
}

module.exports = {
  delay,
  waitForAnyEvent,
  waitForMessage,
  waitForMessageUpdate,
  pressButton,
  hasButton,
  pressButtonByLabel,
  destroyClient,
  login,
  getGuildChannel,
  getMarketChannel,
};
