import { scanNetwork } from "/src/lib/scanner.js";
import { log, tlog } from "/src/lib/utils.js";

export const SOLVERS = {
  "Find Largest Prime Factor": (data) => {
    let n = data;
    let largest = 1;
    for (let factor = 2; factor * factor <= n; factor++) {
      while (n % factor === 0) {
        largest = factor;
        n /= factor;
      }
    }
    // If n > 1 here it's a prime larger than any factor already divided out (e.g. 13195 -> 29).
    // Otherwise the largest factor we divided out is the answer (e.g. 100 -> 5, where n hit 1).
    return n > 1 ? n : largest;
  },

  "Subarray with Maximum Sum": (data) => {
    let maxSum = data[0];
    let current = data[0];
    for (let i = 1; i < data.length; i++) {
      current = Math.max(data[i], current + data[i]);
      maxSum = Math.max(maxSum, current);
    }
    return maxSum;
  },

  "Total Ways to Sum": (data) => {
    const ways = new Array(data + 1).fill(0);
    ways[0] = 1;
    for (let i = 1; i < data; i++) {
      for (let j = i; j <= data; j++) {
        ways[j] += ways[j - i];
      }
    }
    return ways[data];
  },

  "Total Ways to Sum II": (data) => {
    const [target, nums] = data;
    const ways = new Array(target + 1).fill(0);
    ways[0] = 1;
    for (const num of nums) {
      for (let j = num; j <= target; j++) {
        ways[j] += ways[j - num];
      }
    }
    return ways[target];
  },

  "Spiralize Matrix": (data) => {
    const result = [];
    if (data.length === 0 || data[0].length === 0) return result;
    let top = 0, bottom = data.length - 1, left = 0, right = data[0].length - 1;
    while (top <= bottom && left <= right) {
      for (let i = left; i <= right; i++) result.push(data[top][i]);
      top++;
      for (let i = top; i <= bottom; i++) result.push(data[i][right]);
      right--;
      if (top <= bottom) {
        for (let i = right; i >= left; i--) result.push(data[bottom][i]);
        bottom--;
      }
      if (left <= right) {
        for (let i = bottom; i >= top; i--) result.push(data[i][left]);
        left++;
      }
    }
    return result;
  },

  "Array Jumping Game": (data) => {
    let maxReach = 0;
    for (let i = 0; i < data.length; i++) {
      if (i > maxReach) return 0;
      maxReach = Math.max(maxReach, i + data[i]);
      if (maxReach >= data.length - 1) return 1;
    }
    return 0;
  },

  "Array Jumping Game II": (data) => {
    if (data.length <= 1) return 0;
    let jumps = 0, currentEnd = 0, farthest = 0;
    for (let i = 0; i < data.length - 1; i++) {
      farthest = Math.max(farthest, i + data[i]);
      if (i === currentEnd) {
        jumps++;
        currentEnd = farthest;
        if (currentEnd >= data.length - 1) return jumps;
      }
    }
    return 0;
  },

  "Merge Overlapping Intervals": (data) => {
    const sorted = [...data].sort((a, b) => a[0] - b[0]);
    const merged = [sorted[0]];
    for (let i = 1; i < sorted.length; i++) {
      const last = merged[merged.length - 1];
      if (sorted[i][0] <= last[1]) {
        last[1] = Math.max(last[1], sorted[i][1]);
      } else {
        merged.push(sorted[i]);
      }
    }
    return merged;
  },

  "Generate IP Addresses": (data) => {
    const result = [];
    for (let a = 1; a <= 3; a++) {
      for (let b = 1; b <= 3; b++) {
        for (let c = 1; c <= 3; c++) {
          const d = data.length - a - b - c;
          if (d < 1 || d > 3) continue;
          const parts = [data.slice(0, a), data.slice(a, a + b), data.slice(a + b, a + b + c), data.slice(a + b + c)];
          if (parts.every((p) => parseInt(p) <= 255 && (p.length === 1 || p[0] !== "0"))) {
            result.push(parts.join("."));
          }
        }
      }
    }
    return result;
  },

  "Algorithmic Stock Trader I": (data) => {
    let maxProfit = 0, minPrice = Infinity;
    for (const price of data) {
      minPrice = Math.min(minPrice, price);
      maxProfit = Math.max(maxProfit, price - minPrice);
    }
    return maxProfit;
  },

  "Algorithmic Stock Trader II": (data) => {
    let profit = 0;
    for (let i = 1; i < data.length; i++) {
      if (data[i] > data[i - 1]) profit += data[i] - data[i - 1];
    }
    return profit;
  },

  "Algorithmic Stock Trader III": (data) => {
    return solveStockTrader(2, data);
  },

  "Algorithmic Stock Trader IV": (data) => {
    const [k, prices] = data;
    return solveStockTrader(k, prices);
  },

  "Minimum Path Sum in a Triangle": (data) => {
    const dp = [...data[data.length - 1]];
    for (let i = data.length - 2; i >= 0; i--) {
      for (let j = 0; j <= i; j++) {
        dp[j] = data[i][j] + Math.min(dp[j], dp[j + 1]);
      }
    }
    return dp[0];
  },

  "Unique Paths in a Grid I": (data) => {
    const [rows, cols] = data;
    const dp = new Array(cols).fill(1);
    for (let i = 1; i < rows; i++) {
      for (let j = 1; j < cols; j++) {
        dp[j] += dp[j - 1];
      }
    }
    return dp[cols - 1];
  },

  "Unique Paths in a Grid II": (data) => {
    if (!data.length || !data[0].length) return 0;
    const rows = data.length, cols = data[0].length;
    const dp = new Array(cols).fill(0);
    dp[0] = 1;
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        if (data[i][j] === 1) {
          dp[j] = 0;
        } else if (j > 0) {
          dp[j] += dp[j - 1];
        }
      }
    }
    return dp[cols - 1];
  },

  "Sanitize Parentheses in Expression": (data) => {
    const result = new Set();
    let minRemove = Infinity;

    function dfs(idx, open, removed, current) {
      if (idx === data.length) {
        if (open === 0) {
          if (removed < minRemove) {
            minRemove = removed;
            result.clear();
            result.add(current);
          } else if (removed === minRemove) {
            result.add(current);
          }
        }
        return;
      }
      if (removed > minRemove) return;

      const ch = data[idx];
      if (ch === "(") {
        dfs(idx + 1, open + 1, removed, current + ch);
        dfs(idx + 1, open, removed + 1, current);
      } else if (ch === ")") {
        if (open > 0) dfs(idx + 1, open - 1, removed, current + ch);
        dfs(idx + 1, open, removed + 1, current);
      } else {
        dfs(idx + 1, open, removed, current + ch);
      }
    }

    dfs(0, 0, 0, "");
    return [...result];
  },

  "Find All Valid Math Expressions": (data) => {
    const [digits, target] = data;
    const result = [];

    function dfs(idx, expr, value, prevOperand) {
      if (idx === digits.length) {
        if (value === target) result.push(expr);
        return;
      }
      for (let i = idx; i < digits.length; i++) {
        if (i > idx && digits[idx] === "0") break;
        const numStr = digits.slice(idx, i + 1);
        const num = parseInt(numStr);
        if (idx === 0) {
          dfs(i + 1, numStr, num, num);
        } else {
          dfs(i + 1, expr + "+" + numStr, value + num, num);
          dfs(i + 1, expr + "-" + numStr, value - num, -num);
          dfs(i + 1, expr + "*" + numStr, value - prevOperand + prevOperand * num, prevOperand * num);
        }
      }
    }

    dfs(0, "", 0, 0);
    return result;
  },

  "HammingCodes: Integer to Encoded Binary": (data) => {
    const bits = data.toString(2).split("").map(Number);
    let r = 1;
    while ((1 << r) < bits.length + r + 1) r++;
    const encoded = new Array(bits.length + r + 1).fill(0);
    let dataIdx = 0;
    for (let i = 1; i < encoded.length; i++) {
      if ((i & (i - 1)) !== 0) {
        encoded[i] = bits[dataIdx++];
      }
    }
    for (let p = 0; p < r; p++) {
      const bit = 1 << p;
      let parity = 0;
      for (let i = bit; i < encoded.length; i++) {
        if (i & bit) parity ^= encoded[i];
      }
      encoded[bit] = parity;
    }
    let overallParity = 0;
    for (let i = 1; i < encoded.length; i++) overallParity ^= encoded[i];
    encoded[0] = overallParity;
    return encoded.join("");
  },

  "HammingCodes: Encoded Binary to Integer": (data) => {
    const bits = data.split("").map(Number);
    let errPos = 0;
    for (let p = 0; (1 << p) < bits.length; p++) {
      const bit = 1 << p;
      let parity = 0;
      for (let i = bit; i < bits.length; i++) {
        if (i & bit) parity ^= bits[i];
      }
      if (parity) errPos += bit;
    }
    if (errPos > 0 && errPos < bits.length) bits[errPos] ^= 1;
    const dataBits = [];
    for (let i = 3; i < bits.length; i++) {
      if ((i & (i - 1)) !== 0) dataBits.push(bits[i]);
    }
    return parseInt(dataBits.join(""), 2);
  },

  "Proper 2-Coloring of a Graph": (data) => {
    const [n, edges] = data;
    const adj = Array.from({ length: n }, () => []);
    for (const [u, v] of edges) {
      adj[u].push(v);
      adj[v].push(u);
    }
    const color = new Array(n).fill(-1);
    for (let start = 0; start < n; start++) {
      if (color[start] !== -1) continue;
      color[start] = 0;
      const queue = [start];
      while (queue.length > 0) {
        const node = queue.shift();
        for (const neighbor of adj[node]) {
          if (color[neighbor] === -1) {
            color[neighbor] = 1 - color[node];
            queue.push(neighbor);
          } else if (color[neighbor] === color[node]) {
            return [];
          }
        }
      }
    }
    return color;
  },

  "Compression I: RLE Compression": (data) => {
    let result = "";
    let i = 0;
    while (i < data.length) {
      let count = 1;
      while (i + count < data.length && data[i + count] === data[i] && count < 9) count++;
      result += count + data[i];
      i += count;
    }
    return result;
  },

  "Compression II: LZ Decompression": (data) => {
    let result = "";
    let i = 0;
    let isLiteral = true;
    while (i < data.length) {
      const len = parseInt(data[i]);
      i++;
      if (len === 0) {
        isLiteral = !isLiteral;
        continue;
      }
      if (isLiteral) {
        result += data.slice(i, i + len);
        i += len;
      } else {
        const offset = parseInt(data[i]);
        i++;
        for (let j = 0; j < len; j++) {
          result += result[result.length - offset];
        }
      }
      isLiteral = !isLiteral;
    }
    return result;
  },

  "Compression III: LZ Compression": (data) => {
    // Optimal LZ encoder — a port of Bitburner's own reference comprLZEncode. The grader
    // accepts an answer only if it decodes to `data` AND is no longer than the game's optimal
    // compression, so the previous greedy heuristic was rejected for producing valid-but-longer
    // output (e.g. "10×a" -> "1a811a" len 6 vs optimal "1a91" len 4). This is a DP over states:
    //   state[0][j] = shortest encoding whose in-progress final chunk is a LITERAL of length j
    //   state[i][j] (i>0) = ... a BACKREFERENCE of offset i and length j
    // The stored string is the encoding of everything BEFORE that in-progress final chunk.
    const plain = data;
    if (plain.length === 0) return "";

    const blank = () => Array.from({ length: 10 }, () => new Array(10).fill(null));
    const setBest = (state, i, j, str) => {
      const cur = state[i][j];
      if (cur === null || str.length < cur.length) state[i][j] = str;
    };

    let curState = blank();
    curState[0][1] = ""; // first character begins a length-1 literal, nothing encoded before it

    for (let i = 1; i < plain.length; i++) {
      const c = plain[i];
      const newState = blank();

      // Transitions out of an in-progress literal chunk.
      for (let len = 1; len <= 9; len++) {
        const s = curState[0][len];
        if (s === null) continue;
        if (len < 9) {
          setBest(newState, 0, len + 1, s);                                    // extend literal
        } else {
          setBest(newState, 0, 1, s + "9" + plain.substring(i - 9, i) + "0");  // flush, start literal
        }
        for (let offset = 1; offset <= Math.min(9, i); offset++) {
          if (plain[i - offset] === c) {
            setBest(newState, offset, 1, s + len + plain.substring(i - len, i)); // flush literal, start backref
          }
        }
      }

      // Transitions out of an in-progress backreference chunk.
      for (let offset = 1; offset <= 9; offset++) {
        for (let len = 1; len <= 9; len++) {
          const s = curState[offset][len];
          if (s === null) continue;
          if (plain[i - offset] === c) {
            if (len < 9) {
              setBest(newState, offset, len + 1, s);                           // extend backref
            } else {
              setBest(newState, offset, 1, s + "9" + offset + "0");            // flush, start backref
            }
          }
          setBest(newState, 0, 1, s + len + offset);                           // flush backref, start literal
          for (let newOffset = 1; newOffset <= Math.min(9, i); newOffset++) {
            if (plain[i - newOffset] === c) {
              setBest(newState, newOffset, 1, s + len + offset + "0");         // flush backref, start backref
            }
          }
        }
      }

      curState = newState;
    }

    // Flush the final in-progress chunk and take the shortest overall.
    let result = null;
    for (let len = 1; len <= 9; len++) {
      const s = curState[0][len];
      if (s === null) continue;
      const out = s + len + plain.substring(plain.length - len, plain.length);
      if (result === null || out.length < result.length) result = out;
    }
    for (let offset = 1; offset <= 9; offset++) {
      for (let len = 1; len <= 9; len++) {
        const s = curState[offset][len];
        if (s === null) continue;
        const out = s + len + "" + offset;
        if (result === null || out.length < result.length) result = out;
      }
    }
    return result === null ? "" : result;
  },

  "Encryption I: Caesar Cipher": (data) => {
    const [text, shift] = data;
    return text.split("").map((c) => {
      if (c === " ") return c;
      const code = ((c.charCodeAt(0) - 65 - shift + 260) % 26) + 65;
      return String.fromCharCode(code);
    }).join("");
  },

  "Encryption II: Vigenère Cipher": (data) => {
    const [text, key] = data;
    return text.split("").map((c, i) => {
      if (c === " ") return c;
      const shift = key.charCodeAt(i % key.length) - 65;
      return String.fromCharCode(((c.charCodeAt(0) - 65 + shift) % 26) + 65);
    }).join("");
  },

  "Shortest Path in a Grid": (data) => {
    if (!data.length || !data[0].length) return "";
    const rows = data.length, cols = data[0].length;
    if (data[0][0] === 1 || data[rows - 1][cols - 1] === 1) return "";
    /** @type {Array<[number, number, string]>} */
    const dirs = [[0, 1, "R"], [0, -1, "L"], [1, 0, "D"], [-1, 0, "U"]];
    const visited = Array.from({ length: rows }, () => new Array(cols).fill(false));
    visited[0][0] = true;
    /** @type {Array<[number, number, string]>} */
    const queue = [[0, 0, ""]];
    while (queue.length > 0) {
      const [r, c, path] = queue.shift();
      if (r === rows - 1 && c === cols - 1) return path;
      for (const [dr, dc, dir] of dirs) {
        const nr = r + dr, nc = c + dc;
        if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && !visited[nr][nc] && data[nr][nc] === 0) {
          visited[nr][nc] = true;
          queue.push([nr, nc, path + dir]);
        }
      }
    }
    return "";
  },
};

function solveStockTrader(k, prices) {
  if (prices.length <= 1) return 0;
  if (k >= prices.length / 2) {
    let profit = 0;
    for (let i = 1; i < prices.length; i++) {
      if (prices[i] > prices[i - 1]) profit += prices[i] - prices[i - 1];
    }
    return profit;
  }
  const buy = new Array(k + 1).fill(-Infinity);
  const sell = new Array(k + 1).fill(0);
  for (const price of prices) {
    for (let j = 1; j <= k; j++) {
      buy[j] = Math.max(buy[j], sell[j - 1] - price);
      sell[j] = Math.max(sell[j], buy[j] + price);
    }
  }
  return sell[k];
}

/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL");

  // Coding contracts SELF-DESTRUCT after their last failed attempt. A wrong answer here used
  // to be re-attempted every 5-min cycle, burning one try at a time until the contract (and
  // its money/rep/faction-invite reward) was permanently lost. This Set remembers contracts a
  // solver already got wrong this session so we never re-attempt them. Cleared on restart.
  const failedContracts = new Set();

  while (true) {
    const hostnames = ["home", ...scanNetwork(ns)];
    let found = 0, solved = 0, failed = 0, skipped = 0;

    for (const hostname of hostnames) {
      const contracts = ns.ls(hostname, ".cct");
      found += contracts.length;
      for (const contract of contracts) {
        const id = `${hostname}/${contract}`;

        // Already failed once this session — don't spend another try on it.
        if (failedContracts.has(id)) {
          skipped++;
          continue;
        }

        const type = ns.codingcontract.getContractType(contract, hostname);
        const solver = SOLVERS[type];

        if (!solver) {
          skipped++;
          continue;
        }

        // Never gamble the LAST try on an auto-solver — if it's wrong the contract is gone.
        // Leave low-try contracts for manual solving instead.
        if (ns.codingcontract.getNumTriesRemaining(contract, hostname) <= 1) {
          log(ns, `SKIP (1 try left): "${type}" on ${hostname}`);
          skipped++;
          continue;
        }

        const data = ns.codingcontract.getData(contract, hostname);
        try {
          const answer = solver(data);
          const reward = ns.codingcontract.attempt(answer, contract, hostname);
          if (reward) {
            log(ns, `SOLVED: "${type}" on ${hostname} -> ${reward}`);
            solved++;
          } else {
            // Genuine wrong answer (a try was consumed). Blacklist so the loop can't drain
            // the rest of the tries on the same bad solver over successive cycles.
            log(ns, `FAILED: "${type}" on ${hostname} (will not retry this session)`);
            failedContracts.add(id);
            failed++;
          }
        } catch (e) {
          // Solver threw before attempt() — no try consumed; log but don't blacklist, since
          // the contract itself may still be solvable once the solver is fixed.
          log(ns, `ERROR solving "${type}" on ${hostname}: ${e}`);
          failed++;
        }
      }
    }

    // Always log a heartbeat so the tail shows the solver is alive even when no contracts
    // exist (previously it was silent unless one was solved or failed).
    log(ns, `Contracts: ${found} found, ${solved} solved, ${failed} failed, ${skipped} skipped`);

    await ns.sleep(60000);
  }
}
