/*
 * SPDX-FileCopyrightText: 2026 Kyan Bosman
 * License: see LICENSE
 */

const QUEST_TYPES = ["release", "spend", "earn", "evolve", "trade"];

/**
 * Flatten the searchable text of a message, including embed content.
 *
 * @param {object} msg Message-like object.
 * @returns {string}
 */
function messageText(msg) {
  const parts = [msg.content ?? ""];

  for (const embed of msg.embeds ?? []) {
    parts.push(
      embed.author?.name ?? "",
      embed.title ?? "",
      embed.description ?? "",
      embed.footer?.text ?? ""
    );

    for (const field of embed.fields ?? []) {
      parts.push(field.name ?? "", field.value ?? "");
    }
  }

  return parts.join("\n");
}

/**
 * Convert snake_case keys to camelCase recursively.
 *
 * @param {*} value Value to convert.
 * @returns {*}
 */
function camelCaseKeys(value) {
  if (Array.isArray(value)) return value.map(camelCaseKeys);

  if (value && typeof value === "object") {
    const result = {};

    for (const [key, entry] of Object.entries(value)) {
      const camelKey = key.replace(/_([a-z])/g, (_, letter) =>
        letter.toUpperCase()
      );
      result[camelKey] = camelCaseKeys(entry);
    }

    return result;
  }

  return value;
}

/**
 * Collect text from Components V2 containers on a message.
 *
 * @param {object} data Message-like object with a components array.
 * @returns {string|null}
 */
function getContainerText(data) {
  const containers = (data.components ?? []).filter(
    (component) => component.type === 17
  );

  for (const container of containers) {
    const text = (container.components ?? [])
      .filter((component) => component.type === 10)
      .map((component) => component.content ?? "")
      .join("\n");

    if (text.includes("### Quests") || text.includes("### Inventory")) {
      return text;
    }
  }

  const texts = [];
  const walk = (node) => {
    if (!node || typeof node !== "object") return;

    if (node.type === 10 && typeof node.content === "string") {
      texts.push(node.content);
    }

    for (const child of node.components ?? []) walk(child);
  };

  for (const component of data.components ?? []) walk(component);

  return texts.join("\n") || null;
}

/**
 * Parse Halloween bingo quest lines.
 *
 * Expected shape:
 * **A1.** <:emoji:123> Catch 17 Ghost-type pokemon (0/17)
 * **B2.** Release 13 pokemon (0/13)
 *
 * @param {string|null} text Bingo card text.
 * @returns {Array<object>}
 */
function parseQuests(text) {
  if (!text) return [];

  const quests = [];

  for (const line of text.split("\n")) {
    const match = line.match(
      /^\*\*([A-E]\d)\.\*\*\s*(.+?)\s*\((\d+)\/(\d+)\)\s*$/
    );
    if (!match) continue;

    const [, key, rawDescription, currentRaw, goalRaw] = match;
    const description = rawDescription
      .replace(/<a?:[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();
    const current = Number(currentRaw);
    const goal = Number(goalRaw);
    const lower = description.toLowerCase();

    let type = "catch";
    if (lower.startsWith("release ")) type = "release";
    else if (lower.startsWith("spend ")) type = "spend";
    else if (lower.startsWith("earn ")) type = "earn";
    else if (lower.startsWith("evolve ")) type = "evolve";
    else if (/^complete \d+ trades?/.test(lower)) type = "trade";

    quests.push({
      key,
      type,
      description,
      current,
      goal,
      remaining: Math.max(0, goal - current),
    });
  }

  return quests;
}

/**
 * Reduce quests to the remaining amount for each actionable type.
 *
 * @param {Array<object>} quests Parsed quests.
 * @returns {{release:number,spend:number,earn:number,evolve:number,trade:number}}
 */
function summarizeTasks(quests) {
  const summary = Object.fromEntries(
    QUEST_TYPES.map((type) => [type, 0])
  );

  for (const quest of quests) {
    if (!(quest.type in summary)) continue;
    summary[quest.type] = Math.max(summary[quest.type], quest.remaining);
  }

  return summary;
}

/**
 * Parse the pokemon shown in a "Your pokemon" embed.
 *
 * @param {object} msg Message-like object with an embed.
 * @returns {Array<{id:string,name:string,iv:number,shiny:boolean}>}
 */
function parsePokemonEmbed(msg) {
  const description = msg.embeds?.[0]?.description ?? "";
  const pokemon = [];

  for (const line of description.split("\n")) {
    const idMatch = line.match(/`\s*(\d+)`/);
    const nameMatch = line.match(/>\s*(.+?)<:/);
    const ivMatch = line.match(/•\s*(\d+(?:\.\d+)?)%/);
    if (!idMatch || !nameMatch || !ivMatch) continue;

    pokemon.push({
      id: idMatch[1],
      name: nameMatch[1].replace("✨", "").trim(),
      iv: Number(ivMatch[1]),
      shiny: line.includes("✨"),
    });
  }

  return pokemon;
}

/**
 * Parse the Halloween inventory counts from the event page.
 *
 * @param {string|null} text Event page text.
 * @returns {{sunlit:number,phantom:number,eclipse:number,fusers:number}}
 */
function parseInventory(text) {
  return {
    sunlit: Number(text?.match(/Sunlit Chests\*\*:\s*(\d+)/i)?.[1] ?? 0),
    phantom: Number(text?.match(/Phantom Chests\*\*:\s*(\d+)/i)?.[1] ?? 0),
    eclipse: Number(text?.match(/Eclipse Chests\*\*:\s*(\d+)/i)?.[1] ?? 0),
    fusers: Number(text?.match(/Eclipse Fusers\*\*:\s*(\d+)/i)?.[1] ?? 0),
  };
}

module.exports = {
  messageText,
  camelCaseKeys,
  getContainerText,
  parseQuests,
  summarizeTasks,
  parsePokemonEmbed,
  parseInventory,
};
