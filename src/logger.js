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

module.exports = { sendLog };
