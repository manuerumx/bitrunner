// More names than the purchased-server cap (25), so every server gets a unique one.
export const SCIENTIST_NAMES = [
  "turing", "lovelace", "hopper", "dijkstra", "knuth", "shannon",
  "von-neumann", "hamilton", "ritchie", "thompson", "torvalds",
  "berners-lee", "mccarthy", "minsky", "engelbart", "liskov",
  "lamport", "kay", "cerf", "backus", "church", "boole",
  "babbage", "wilkes", "karp", "rivest", "shamir", "adleman",
  "hoare", "wirth", "kernighan", "codd",
];

/** @param {string[]} owned */
export function pickServerName(owned) {
  const available = SCIENTIST_NAMES.filter((name) => !owned.includes(name));
  // If somehow exhausted, reuse any name; the game auto-appends a number.
  const pool = available.length > 0 ? available : SCIENTIST_NAMES;
  return pool[Math.floor(Math.random() * pool.length)];
}
