/*
 * SPDX-FileCopyrightText: 2026 Kyan Bosman
 * License: see LICENSE
 */

const { checkRarity } = require("pokehint");
const {
  POKETWO_ID,
  MAX_LIST_PAGES,
  TIMEOUTS,
  DELAYS,
  NEXT_BUTTON_EMOJIS,
} = require("./constants");
const { messageText, parsePokemonEmbed } = require("./parsers");
const {
  delay,
  waitForMessage,
  waitForMessageUpdate,
} = require("./discord");

const rarityCache = new Map();

/**
 * Check whether a pokemon name is rare. Event forms are not in pokehint's
 * rarity list, so they are treated as rare to protect them from release.
 *
 * @param {string} name Pokemon name.
 * @returns {Promise<boolean>}
 */
async function isRare(name) {
  if (rarityCache.has(name)) return rarityCache.get(name);

  let rare;

  try {
    rare = (await checkRarity(name)) !== "Regular";
  } catch (err) {
    rare = true;
  }

  rarityCache.set(name, rare);
  return rare;
}

/**
 * Add a `rare` flag to every pokemon entry.
 *
 * @param {Array<object>} pokemon Pokemon entries.
 * @returns {Promise<void>}
 */
async function annotateRarity(pokemon) {
  for (const entry of pokemon) {
    entry.rare = await isRare(entry.name);
  }
}

/**
 * Check whether a pokemon is a safe candidate for an action.
 *
 * @param {{shiny:boolean,rare:boolean,iv:number}} entry Pokemon entry.
 * @param {{min:number,max:number}} range IV range.
 * @returns {boolean}
 */
function matchesIvRange(entry, range) {
  return (
    !entry.shiny &&
    !entry.rare &&
    entry.iv >= range.min &&
    entry.iv <= range.max
  );
}

/**
 * Fetch one or more pages of the account's pokemon list.
 *
 * @param {object} client discord-self-lite client.
 * @param {object} channel Guild channel.
 * @param {{query?:string,maxPages?:number}} [options] Search options.
 * @returns {Promise<Array<object>>} Parsed pokemon entries.
 */
async function fetchPokemon(
  client,
  channel,
  { query = "", maxPages = MAX_LIST_PAGES } = {}
) {
  const waitForList = waitForMessage(
    client,
    channel,
    (msg) => {
      if (msg.author.id !== POKETWO_ID) return false;
      if (msg.embeds?.[0]?.title === "Your pokémon") return true;
      return /no pok[eé]mon found/i.test(messageText(msg));
    },
    TIMEOUTS.message
  );

  const command = `<@${POKETWO_ID}> p${query ? ` ${query}` : ""}`;

  try {
    await channel.send(command);
  } catch (err) {
    waitForList.catch(() => {});
    throw err;
  }

  const message = await waitForList;
  const pokemon = [];
  let page = message;
  let pages = 0;

  while (page?.embeds?.[0] && pages < maxPages) {
    pokemon.push(...parsePokemonEmbed(page));
    pages++;

    const footer = (page.embeds[0].footer?.text ?? "").replace(/,/g, "");
    const range = footer.match(
      /(\d+)\s*[–-]\s*(\d+)\s+(?:out of|of)\s+(\d+)/i
    );

    if (!range || Number(range[2]) >= Number(range[3])) break;

    const row = page.components?.[0];
    const nextButton =
      row?.components?.find(
        (component) =>
          component.type === 2 &&
          component.customId &&
          !component.disabled &&
          NEXT_BUTTON_EMOJIS.includes(component.emoji?.name)
      ) ?? row?.components?.[1];

    if (!nextButton || nextButton.disabled || !nextButton.customId) break;

    const update = waitForMessageUpdate(
      client,
      message.id,
      TIMEOUTS.message,
      page
    );

    try {
      message.clickButton(nextButton.customId).catch(() => {});
    } catch (err) {
      update.catch(() => {});
      break;
    }

    try {
      page = await update;
    } catch (err) {
      break;
    }

    await delay(DELAYS.page);
  }

  return pokemon;
}

module.exports = {
  isRare,
  annotateRarity,
  matchesIvRange,
  fetchPokemon,
};
