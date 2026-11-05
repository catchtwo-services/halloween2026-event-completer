/*
 * SPDX-FileCopyrightText: 2026 Kyan Bosman
 * License: see LICENSE
 */

const config = require("../config.js");
const {
  POKETWO_ID,
  MARKET_PRICE,
  MAX_EVOLVE_PAGES,
  TIMEOUTS,
  DELAYS,
  IV_RANGES,
  EVOLVE_TARGETS,
} = require("./constants");
const { sendLog } = require("./logger");
const {
  getContainerText,
  messageText,
  parseInventory,
} = require("./parsers");
const {
  delay,
  waitForMessage,
  pressButton,
} = require("./discord");
const {
  fetchPokemon,
  annotateRarity,
  matchesIvRange,
} = require("./pokemon");
const {
  market,
  saveFiles,
  removeMarketListing,
} = require("./storage");

/**
 * Release enough safe pokemon to finish the Release quest.
 *
 * @param {object} session Account session.
 * @param {number} amount Number of pokemon to release.
 * @returns {Promise<void>}
 */
async function releaseTask(session, amount) {
  if (amount <= 0) return;

  const { client, channel, username, pokemon } = session;
  const candidates = pokemon
    .filter((entry) => matchesIvRange(entry, IV_RANGES.release))
    .slice(0, amount);

  if (candidates.length === 0) {
    sendLog(username, "No suitable pokemon to release.", "error");
    return;
  }

  const waitForConfirm = waitForMessage(
    client,
    channel,
    (msg) =>
      msg.author.id === POKETWO_ID &&
      /are you sure you want to .*release/i.test(messageText(msg)),
    TIMEOUTS.message
  );

  try {
    await channel.send(
      `<@${POKETWO_ID}> release ${candidates
        .map((entry) => entry.id)
        .join(" ")}`
    );
  } catch (err) {
    waitForConfirm.catch(() => {});
    throw err;
  }

  const confirm = await waitForConfirm;
  pressButton(confirm, confirm.components?.[0]?.components?.[0]?.customId);
  await delay(DELAYS.action);

  const releasedIds = new Set(candidates.map((entry) => entry.id));
  session.pokemon = pokemon.filter((entry) => !releasedIds.has(entry.id));

  sendLog(username, `Released ${candidates.length} pokemon.`, "success");

  if (candidates.length < amount) {
    sendLog(
      username,
      `Only found ${candidates.length}/${amount} release candidates.`,
      "error"
    );
  }
}

/**
 * Evolve enough safe pokemon to finish the Evolve quest.
 *
 * @param {object} session Account session.
 * @param {number} amount Number of pokemon to evolve.
 * @returns {Promise<void>}
 */
async function evolveTask(session, amount) {
  if (amount <= 0) return;

  const { client, channel, username } = session;
  const query = `${EVOLVE_TARGETS.map((name) => `--n ${name}`).join(
    " "
  )} --lev >9`;
  const candidates = await fetchPokemon(client, channel, {
    query,
    maxPages: MAX_EVOLVE_PAGES,
  });
  await annotateRarity(candidates);

  const selected = candidates
    .filter((entry) => matchesIvRange(entry, IV_RANGES.evolve))
    .slice(0, amount);

  if (selected.length === 0) {
    sendLog(username, "No suitable pokemon to evolve.", "error");
    return;
  }

  await channel.send(
    `<@${POKETWO_ID}> evolve ${selected
      .map((entry) => entry.id)
      .join(" ")}`
  );
  await delay(DELAYS.short);

  sendLog(username, `Evolved ${selected.length} pokemon.`, "success");

  if (selected.length < amount) {
    sendLog(
      username,
      `Only found ${selected.length}/${amount} evolve candidates.`,
      "error"
    );
  }
}

/**
 * List one safe pokemon on the market for the Earn quest.
 *
 * @param {object} session Account session.
 * @param {number} amount Remaining Earn amount.
 * @returns {Promise<void>}
 */
async function sellTask(session, amount) {
  if (amount <= 0) return;

  const {
    client,
    marketChannel,
    username,
    pokemon,
    accountCount,
  } = session;

  if (accountCount < 2) {
    sendLog(
      username,
      "Skipping market listing: at least two accounts are needed to complete Spend and Earn.",
      "error"
    );
    return;
  }

  const candidate = pokemon.find((entry) =>
    matchesIvRange(entry, IV_RANGES.release)
  );

  if (!candidate) {
    sendLog(username, "No suitable pokemon to list on the market.", "error");
    return;
  }

  const waitForConfirm = waitForMessage(
    client,
    marketChannel,
    (msg) =>
      msg.author.id === POKETWO_ID &&
      /are you sure you want to list your/i.test(messageText(msg)),
    TIMEOUTS.message
  );

  try {
    await marketChannel.send(
      `<@${POKETWO_ID}> m add ${candidate.id} ${MARKET_PRICE}`
    );
  } catch (err) {
    waitForConfirm.catch(() => {});
    throw err;
  }

  const confirm = await waitForConfirm;
  const waitForListing = waitForMessage(
    client,
    marketChannel,
    (msg) =>
      msg.author.id === POKETWO_ID &&
      msg.id !== confirm.id &&
      /Listing #\d+/i.test(messageText(msg)),
    TIMEOUTS.message
  );

  pressButton(confirm, confirm.components?.[0]?.components?.[0]?.customId);

  const listed = await waitForListing;
  const match = messageText(listed).match(/Listing #(\d+)/i);

  if (!match) {
    sendLog(
      username,
      "Market listing did not return a listing ID.",
      "error"
    );
    return;
  }

  if (!Array.isArray(market[username])) {
    market[username] = [];
  }

  market[username].push(match[1]);
  saveFiles();

  sendLog(
    username,
    `Listed pokemon ${candidate.id} as listing #${match[1]}.`,
    "success"
  );
}

/**
 * Buy another account's listing for the Spend quest.
 *
 * @param {object} session Account session.
 * @param {number} amount Remaining Spend amount.
 * @returns {Promise<void>}
 */
async function buyTask(session, amount) {
  if (amount <= 0) return;

  const { client, marketChannel, username } = session;
  const listings = Object.entries(market)
    .filter(([owner]) => owner !== username)
    .flatMap(([owner, ids]) =>
      Array.isArray(ids) ? ids.map((id) => ({ id, owner })) : []
    );

  if (listings.length === 0) {
    sendLog(username, "No listings from other accounts to buy.", "error");
    return;
  }

  const listing = listings[0];
  const waitForConfirm = waitForMessage(
    client,
    marketChannel,
    (msg) =>
      msg.author.id === POKETWO_ID &&
      /are you sure you want to buy/i.test(messageText(msg)),
    TIMEOUTS.message
  );

  try {
    await marketChannel.send(`<@${POKETWO_ID}> m buy ${listing.id}`);
  } catch (err) {
    waitForConfirm.catch(() => {});
    throw err;
  }

  const confirm = await waitForConfirm;
  const waitForResult = waitForMessage(
    client,
    marketChannel,
    (msg) =>
      msg.author.id === POKETWO_ID &&
      msg.id !== confirm.id &&
      /(bought|purchased|purchase|not enough|no longer|failed)/i.test(
        messageText(msg)
      ),
    TIMEOUTS.marketResult
  );

  pressButton(confirm, confirm.components?.[0]?.components?.[0]?.customId);

  try {
    const result = await waitForResult;
    const text = messageText(result);

    if (/(no longer|not found|does not exist)/i.test(text)) {
      removeMarketListing(listing.owner, listing.id);
      saveFiles();

      sendLog(
        username,
        `Listing #${listing.id} no longer exists, removed it from market.json.`,
        "error"
      );
      return;
    }

    if (!/(bought|purchased|purchase)/i.test(text)) {
      sendLog(username, `Market purchase failed: ${text}`, "error");
      return;
    }
  } catch (err) {
    sendLog(
      username,
      "Market purchase result was not confirmed, assuming the purchase went through.",
      "error"
    );
  }

  removeMarketListing(listing.owner, listing.id);
  saveFiles();

  sendLog(
    username,
    `Bought listing #${listing.id} from ${listing.owner}.`,
    "success"
  );
}

/**
 * Fuse and/or open chests when enabled in config.js.
 *
 * @param {object} session Account session.
 * @returns {Promise<void>}
 */
async function handleChests(session) {
  if (!config.fuseChests && !config.openChests) return;

  const { client, channel, username } = session;
  const waitForEvent = waitForMessage(
    client,
    channel,
    (msg) =>
      msg.author.id === POKETWO_ID &&
      getContainerText(msg)?.includes("### Inventory"),
    TIMEOUTS.message
  );

  try {
    await channel.send(`<@${POKETWO_ID}> halloween`);
  } catch (err) {
    waitForEvent.catch(() => {});
    throw err;
  }

  const message = await waitForEvent;
  const text = getContainerText(message);
  const counts = parseInventory(text);

  if (config.fuseChests) {
    const fuseCount = Math.min(
      counts.sunlit,
      counts.phantom,
      counts.fusers
    );

    if (fuseCount > 0) {
      await channel.send(
        `<@${POKETWO_ID}> halloween fuse ${fuseCount}`
      );
      await delay(DELAYS.action);

      counts.sunlit -= fuseCount;
      counts.phantom -= fuseCount;
      counts.eclipse += fuseCount;

      sendLog(
        username,
        `Fused ${fuseCount} Eclipse Chest(s).`,
        "success"
      );
    }
  }

  if (config.openChests) {
    const chests = [
      ["Sunlit Chest", counts.sunlit],
      ["Phantom Chest", counts.phantom],
      ["Eclipse Chest", counts.eclipse],
    ];

    for (const [name, count] of chests) {
      if (count <= 0) continue;

      await channel.send(
        `<@${POKETWO_ID}> halloween open ${name} ${count}`
      );
      await delay(DELAYS.action);

      sendLog(username, `Opened ${count} ${name}(s).`, "success");
    }
  }
}

module.exports = {
  releaseTask,
  evolveTask,
  sellTask,
  buyTask,
  handleChests,
};
