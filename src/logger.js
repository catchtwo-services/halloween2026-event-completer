/*
 * SPDX-FileCopyrightText: 2026 Kyan Bosman
 * License: see LICENSE
 */

const chalk = require("chalk");
const date = require("date-and-time");

const LOG_COLORS = {
  info: chalk.bold.blue,
  success: chalk.bold.green,
  error: chalk.bold.red,
};

/**
 * Print one timestamped log line.
 *
 * @param {string|null} username Account name, or null for shared messages.
 * @param {string} message Log text.
 * @param {"info"|"success"|"error"} [type="info"] Log level.
 * @returns {void}
 */
function sendLog(username, message, type = "info") {
  const time = date.format(new Date(), "HH:mm");
  const color = LOG_COLORS[type] ?? LOG_COLORS.info;
  const prefix = username ? `${chalk.bold.red(username)}: ` : "";

  console.log(
    `${color(`[${type.toUpperCase()}]`)} - ` +
      `${chalk.white.bold(time)}: ` +
      `${prefix}${message}`
  );
}

/**
 * Format an error with the Discord API details when they are available.
 *
 * @param {*} err Error or rejection value.
 * @returns {string}
 */
function formatError(err) {
  if (!(err instanceof Error)) return String(err);

  const parts = [err.message];

  if (err.status) parts.push(`status ${err.status}`);
  if (err.path) parts.push(err.path);
  if (err.code) parts.push(`code ${err.code}`);

  return parts.join(" | ");
}

module.exports = { sendLog, formatError };
