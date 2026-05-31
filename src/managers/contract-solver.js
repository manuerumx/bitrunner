import { scanNetwork } from "/src/lib/scanner.js";
import { log, tlog } from "/src/lib/utils.js";

const SOLVERS = {
  "Find Largest Prime Factor": (data) => {
    let n = data;
    let factor = 2;
    while (factor * factor <= n) {
      while (n % factor === 0) n /= factor;
      factor++;
    }
    return n;
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
    if (data.length === 0) return result;
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
    let result = "";
    let pos = 0;

    while (pos < data.length) {
      let bestRefLen = 0, bestRefOffset = 0;
      for (let offset = 1; offset <= Math.min(9, pos); offset++) {
        let len = 0;
        while (pos + len < data.length && len < 9) {
          if (data[pos + len] === data[pos - offset + (len % offset)]) len++;
          else break;
        }
        if (len > bestRefLen) {
          bestRefLen = len;
          bestRefOffset = offset;
        }
      }

      let litEnd = pos;
      if (bestRefLen >= 2) {
        if (pos > 0 || result.length > 0) {
          result += "0";
        }
        result += bestRefLen.toString() + bestRefOffset.toString();
        pos += bestRefLen;
      } else {
        let litLen = 0;
        while (litLen < 9 && pos + litLen < data.length) {
          let hasGoodRef = false;
          const checkPos = pos + litLen;
          for (let offset = 1; offset <= Math.min(9, checkPos); offset++) {
            let len = 0;
            while (checkPos + len < data.length && len < 9) {
              if (data[checkPos + len] === data[checkPos - offset + (len % offset)]) len++;
              else break;
            }
            if (len >= 3) { hasGoodRef = true; break; }
          }
          if (hasGoodRef && litLen > 0) break;
          litLen++;
          if (!hasGoodRef && litLen >= 9) break;
        }
        if (litLen === 0) litLen = 1;
        result += litLen.toString() + data.slice(pos, pos + litLen);
        pos += litLen;
        if (pos < data.length) {
          let refLen = 0, refOffset = 0;
          for (let offset = 1; offset <= Math.min(9, pos); offset++) {
            let len = 0;
            while (pos + len < data.length && len < 9) {
              if (data[pos + len] === data[pos - offset + (len % offset)]) len++;
              else break;
            }
            if (len > refLen) { refLen = len; refOffset = offset; }
          }
          if (refLen >= 2) {
            result += refLen.toString() + refOffset.toString();
            pos += refLen;
          } else {
            result += "0";
          }
        }
      }
    }
    return result;
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
    const rows = data.length, cols = data[0].length;
    if (data[0][0] === 1 || data[rows - 1][cols - 1] === 1) return "";
    const dirs = [[0, 1, "R"], [0, -1, "L"], [1, 0, "D"], [-1, 0, "U"]];
    const visited = Array.from({ length: rows }, () => new Array(cols).fill(false));
    visited[0][0] = true;
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

  while (true) {
    const hostnames = ["home", ...scanNetwork(ns)];
    let solved = 0, failed = 0, skipped = 0;

    for (const hostname of hostnames) {
      const contracts = ns.ls(hostname, ".cct");
      for (const contract of contracts) {
        const type = ns.codingcontract.getContractType(contract, hostname);
        const solver = SOLVERS[type];

        if (!solver) {
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
            log(ns, `FAILED: "${type}" on ${hostname}`);
            failed++;
          }
        } catch (e) {
          log(ns, `ERROR solving "${type}" on ${hostname}: ${e}`);
          failed++;
        }
      }
    }

    if (solved > 0 || failed > 0) {
      log(ns, `Contracts: ${solved} solved, ${failed} failed, ${skipped} unsupported`);
    }

    await ns.sleep(300000);
  }
}
