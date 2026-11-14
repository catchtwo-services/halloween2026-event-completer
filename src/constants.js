/*
 * SPDX-FileCopyrightText: 2026 Kyan Bosman
 * License: see LICENSE
 */

const POKETWO_ID = "716390085896962058";
const EVENT_COMMAND = "halloween bingo";
const MARKET_PRICE = 1000;
const MAX_LIST_PAGES = 5;
const MAX_EVOLVE_PAGES = 10;
const MAX_MARKET_ATTEMPTS = 10;

const TASKS_FILE = "tasks.json";
const MARKET_FILE = "market.json";
const TOKENS_FILE = "tokens.txt";

const TIMEOUTS = Object.freeze({
  message: 20000,
  event: 10000,
  card: 20000,
  tradeRequest: 15000,
  cancel: 10000,
  marketResult: 10000,
  login: 30000,
});

const DELAYS = Object.freeze({
  short: 1000,
  page: 500,
  action: 1500,
  account: 2500,
  retry: 3000,
  cancel: 1000,
});

const IV_RANGES = Object.freeze({
  release: { min: 25, max: 75 },
  evolve: { min: 10, max: 85 },
});

/**
 * Cheap, common pokemon that can be evolved for the evolve quest.
 * These are the same targets the Winter 2024 version used.
 */
const EVOLVE_TARGETS = Object.freeze([
  "Mantyke",
  "Charjabug",
  "Stantler",
  "Hisuian Qwilfish",
  "Caterpie",
  "Weedle",
  "Wurmple",
  "Scatterbug",
  "Metapod",
  "Kakuna",
  "Silcoon",
  "Cascoon",
  "Kricketot",
  "Blipbug",
]);

const TRADE_CHANNEL_NAMES = Object.freeze([
  "commands",
  "bots",
  "bot",
  "poketwo",
  "trades",
  "general",
]);

const NEXT_BUTTON_EMOJIS = Object.freeze(["▶️", "▶"]);

module.exports = {
  POKETWO_ID,
  EVENT_COMMAND,
  MARKET_PRICE,
  MAX_LIST_PAGES,
  MAX_EVOLVE_PAGES,
  MAX_MARKET_ATTEMPTS,
  TASKS_FILE,
  MARKET_FILE,
  TOKENS_FILE,
  TIMEOUTS,
  DELAYS,
  IV_RANGES,
  EVOLVE_TARGETS,
  TRADE_CHANNEL_NAMES,
  NEXT_BUTTON_EMOJIS,
};
