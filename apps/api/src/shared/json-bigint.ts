/**
 * Express `res.json` uses `JSON.stringify`, which throws on `bigint`.
 * Prisma maps Postgres `BigInt` columns (e.g. `ChainEvent.blockNumber`) to JS `bigint`.
 */
Object.defineProperty(BigInt.prototype, "toJSON", {
  value(this: bigint) {
    return this.toString();
  },
  configurable: true,
  enumerable: false,
  writable: true
});

export {};
