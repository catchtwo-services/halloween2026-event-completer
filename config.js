/*
 * SPDX-FileCopyrightText: 2026 Kyan Bosman
 * License: see LICENSE
 */

const config = {
  // Guild where all of the accounts can talk. Required.
  guildId: "",

  // Optional. Use a specific channel instead of finding or creating one per account.
  channelId: "",

  /*
   * Market commands run in DMs with Poketwo by default. Private guilds cannot
   * search the market, and the Halloween bingo card says market quests only
   * count in DMs or the official Poketwo server.
   */
  marketInDms: true,

  /*
   * Optional. Shared channel used for the trade quest. All accounts must be able
   * to see and send messages here. Defaults to channelId, then a channel named
   * commands, bots, poketwo, trades or general.
   */
  tradeChannelId: "",

  // Optional. Fuse Sunlit + Phantom Chests with Eclipse Fusers.
  fuseChests: false,

  // Optional. Open every chest after the quest actions finish.
  openChests: false,
};

module.exports = config;
