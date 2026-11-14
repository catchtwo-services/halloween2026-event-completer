/*
 * SPDX-FileCopyrightText: 2026 Kyan Bosman
 * License: see LICENSE
 */

const config = require("../config.js");
const {
  POKETWO_ID,
  MARKET_PRICE,
  MAX_EVOLVE_PAGES,
  MAX_MARKET_ATTEMPTS,
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
 * @param {Set<string>} [attemptedListings] Listings already tried this run.
 * @returns {Promise<void>}
 */
async function buyTask(
  session,
  amount,
  attemptedListings = new Set()
) {
  if (amount <= 0) return;

  const { client, marketChannel, username } = session;
  const listings = Object.entries(market)
    .filter(([owner]) => owner !== username)
    .flatMap(([owner, ids]) =>
      Array.isArray(ids)
        ? ids.map((id) => ({ id: String(id), owner }))
        : []
    )
    .filter((listing) => !attemptedListings.has(listing.id))
    .slice(0, MAX_MARKET_ATTEMPTS);

  if (listings.length === 0) {
    sendLog(username, "No listings from other accounts to buy.", "error");
    return;
  }

  for (const listing of listings) {
    attemptedListings.add(listing.id);

    const waitForResponse = waitForMessage(
      client,
      marketChannel,
      (msg) => {
        if (msg.author.id !== POKETWO_ID) return false;

        const text = messageText(msg);
        return (
          /are you sure you want to buy/i.test(text) ||
          /couldn't find that listing/i.test(text) ||
          /can't purchase your own listing/i.test(text) ||
          /don't have enough pok[eé]coins/i.test(text)
        );
      },
      TIMEOUTS.marketResult
    );

    try {
      await marketChannel.send(`<@${POKETWO_ID}> m buy ${listing.id}`);
    } catch (err) {
      waitForResponse.catch(() => {});
      throw err;
    }

    let response;

    try {
      response = await waitForResponse;
    } catch (err) {
      sendLog(
        username,
        `Market buy ${listing.id} timed out.`,
        "error"
      );
      return;
    }

    const responseText = messageText(response);

    if (/couldn't find that listing/i.test(responseText)) {
      removeMarketListing(listing.owner, listing.id);
      saveFiles();
      sendLog(
        username,
        `Listing #${listing.id} no longer exists, removed it.`,
        "error"
      );
      continue;
    }

    if (/can't purchase your own listing/i.test(responseText)) {
      attemptedListings.delete(listing.id);
      sendLog(
        username,
        `Skipped own listing #${listing.id}.`,
        "error"
      );
      continue;
    }

    if (/don't have enough pok[eé]coins/i.test(responseText)) {
      attemptedListings.delete(listing.id);
      sendLog(
        username,
        `Not enough Pokécoins to buy listing #${listing.id}.`,
        "error"
      );
      return;
    }

    const waitForResult = waitForMessage(
      client,
      marketChannel,
      (msg) => {
        if (msg.author.id !== POKETWO_ID) return false;
        if (msg.id === response.id) return false;

        const text = messageText(msg);
        return (
          /purchased a .* from the market/i.test(text) ||
          /that listing no longer exists/i.test(text) ||
          /don't have enough pok[eé]coins/i.test(text) ||
          /time's up|aborted/i.test(text)
        );
      },
      TIMEOUTS.marketResult
    );

    pressButton(
      response,
      response.components?.[0]?.components?.[0]?.customId
    );

    let result;

    try {
      result = await waitForResult;
    } catch (err) {
      sendLog(
        username,
        `Purchase result for #${listing.id} was not confirmed, assuming success.`,
        "error"
      );
      removeMarketListing(listing.owner, listing.id);
      saveFiles();
      return;
    }

    const resultText = messageText(result);

    if (/that listing no longer exists/i.test(resultText)) {
      removeMarketListing(listing.owner, listing.id);
      saveFiles();
      sendLog(
        username,
        `Listing #${listing.id} no longer exists, removed it.`,
        "error"
      );
      continue;
    }

    if (/don't have enough pok[eé]coins/i.test(resultText)) {
      sendLog(
        username,
        `Not enough Pokécoins to buy listing #${listing.id}.`,
        "error"
      );
      return;
    }

    if (/time's up|aborted/i.test(resultText)) {
      attemptedListings.delete(listing.id);
      sendLog(
        username,
        `Purchase of #${listing.id} was aborted.`,
        "error"
      );
      continue;
    }

    if (!/purchased a .* from the market/i.test(resultText)) {
      attemptedListings.delete(listing.id);
      sendLog(
        username,
        `Market purchase failed: ${resultText}`,
        "error"
      );
      continue;
    }

    removeMarketListing(listing.owner, listing.id);
    saveFiles();
    sendLog(
      username,
      `Bought listing #${listing.id} from ${listing.owner}.`,
      "success"
    );
    return;
  }

  sendLog(username, "No usable market listings left to buy.", "error");
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
