/*
 * SPDX-FileCopyrightText: 2026 Kyan Bosman
 * License: see LICENSE
 */

const fs = require("fs");
const {
  TASKS_FILE,
  MARKET_FILE,
  TOKENS_FILE,
} = require("./constants");

/**
 * Read and parse a JSON file, returning a fallback when the file is missing
 * or invalid.
 *
 * @param {string} file Path to the JSON file.
 * @param {object} fallback Value used when reading fails.
 * @returns {object}
 */
function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    return fallback;
  }
}

/**
 * Read account tokens from tokens.txt, one token per line.
 *
 * @returns {string[]} Token list with blank lines removed.
 */
function readTokens() {
  try {
    return fs
      .readFileSync(TOKENS_FILE, "utf8")
      .replace(/\r/g, "")
      .split("\n")
      .map((token) => token.trim())
      .filter(Boolean);
  } catch (err) {
    return [];
  }
}

const tasks = readJson(TASKS_FILE, {});
const market = readJson(MARKET_FILE, {});

/**
 * Write the in-memory task and market state to disk.
 *
 * @returns {void}
 */
function saveFiles() {
  fs.writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2));
  fs.writeFileSync(MARKET_FILE, JSON.stringify(market, null, 2));
}

/**
 * Remove one listing ID from an account's market list.
 *
 * @param {string} owner Account username.
 * @param {string} id Listing ID.
 * @returns {void}
 */
function removeMarketListing(owner, id) {
  const listings = market[owner];
  if (!Array.isArray(listings)) return;

  const index = listings.findIndex(
    (listing) => String(listing) === String(id)
  );
  if (index !== -1) listings.splice(index, 1);
}

module.exports = {
  tasks,
  market,
  readTokens,
  saveFiles,
  removeMarketListing,
};
