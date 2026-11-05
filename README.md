## Poketwo Halloween 2026 Event Completer

This is a standalone completer for the Halloween 2026 event, **When the Night Falls**. It handles the non-catch bingo quests for one or more accounts:

- releases pokemon for the Release quest
- evolves pokemon for the Evolve quest
- lists and buys market pokemon between your accounts for the Spend and Earn quests
- completes the Trade quest by trading 1 Pokecoin between two accounts in a shared channel
- optionally fuses and opens chests

It does **not** catch pokemon. Use your own autocatcher for that.

> [!IMPORTANT]
> Use a throwaway account. Selfbots violate Discord's Terms of Service and can get an account disabled.
>
> Never commit `tokens.txt` or paste a token into chat. Treat every token like a password.

> [!NOTE]
> All accounts must be in the same server. At least two accounts are needed for the Spend and Earn quests.

### Setup

1. Install dependencies:

   ```sh
   npm install
   ```

2. Open [config.js](config.js) and set `guildId`. Optionally set `channelId` to reuse an existing channel, set `tradeChannelId` to a shared channel for trades, set `marketInDms` to false to use the guild channel for market commands, and enable `fuseChests` or `openChests`.

3. Put one token per line in [tokens.txt](tokens.txt). If the file is missing, copy [tokens.example.txt](tokens.example.txt) to `tokens.txt` first. Do not commit this file.

4. Start the script:

   ```sh
   node index.js
   ```

The script runs once, then exits. Run it again as your autocatcher completes more catch quests.

### How it works

1. Each account sends `@Poketwo halloween bingo` and parses the 24 quests.
2. It calculates the remaining amount for Release, Evolve, Spend, Earn and Trade. Catch quests are ignored.
3. It fetches the account's pokemon list and releases or evolves what it can.
4. After every account has listed its market item, the other accounts buy them. This completes Spend and Earn in the same run.
5. If a Trade quest is on the card, it pairs accounts and completes each trade with 1 Pokecoin from each side.
6. If enabled, it fuses Sunlit and Phantom Chests with Eclipse Fusers, then opens the chests.

If there are not enough release or evolve candidates on the first few pages, the script logs how many it found. It does not buy extra evolve candidates from the market.

The trade channel has to be visible to every account. If `tradeChannelId` is empty, the script uses `channelId`, then a text channel named `commands`, `bots`, `poketwo`, `trades` or `general`.

Each trade adds 1 Pokecoin on each side, so every account needs at least 1 Pokecoin.

### Files

- `index.js` runs the phases: login, prepare, market, trade, chests.
- `src/constants.js` holds IDs, timeouts, delays and IV ranges.
- `src/logger.js` handles console output.
- `src/storage.js` loads `tokens.txt` and loads/saves `tasks.json` and `market.json`.
- `src/parsers.js` turns bingo cards, pokemon lists and inventory text into objects.
- `src/discord.js` wraps the discord-self-lite helpers.
- `src/event.js` starts the event and reads the bingo card.
- `src/pokemon.js` fetches pokemon and checks rarity.
- `src/actions.js` contains release, evolve, sell, buy and chest actions.
- `src/trade.js` contains the trade flow.
- `src/account.js` prepares one account.
- `config.js` contains the guild and feature settings.
- `tokens.txt` contains one account token per line. This file is ignored by git.
- `tasks.json` stores the last parsed quest amounts.
- `market.json` stores the listing IDs created by your accounts.

Run `npm run check` to syntax-check the entry point and load every module.
