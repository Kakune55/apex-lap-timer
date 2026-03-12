import crypto from "node:crypto";

const DEFAULT_ITERATIONS = 120000;
const KEY_LENGTH = 32;
const DIGEST = "sha256";

function printUsage() {
  console.log("Usage:");
  console.log("  node scripts/gen-password-hash.mjs <password> [iterations] [saltHex]");
  console.log("");
  console.log("Examples:");
  console.log("  node scripts/gen-password-hash.mjs \"MyStrongPass123!\"");
  console.log("  node scripts/gen-password-hash.mjs \"MyStrongPass123!\" 150000");
  console.log("  node scripts/gen-password-hash.mjs \"MyStrongPass123!\" 120000 aabbcc...");
}

const [, , passwordArg, iterationsArg, saltArg] = process.argv;

if (!passwordArg) {
  printUsage();
  process.exit(1);
}

const iterations = iterationsArg ? Number(iterationsArg) : DEFAULT_ITERATIONS;
if (!Number.isInteger(iterations) || iterations <= 0) {
  console.error("[error] iterations must be a positive integer");
  process.exit(1);
}

const salt = saltArg || crypto.randomBytes(16).toString("hex");
if (!/^[0-9a-fA-F]+$/.test(salt) || salt.length < 16 || salt.length % 2 !== 0) {
  console.error("[error] saltHex must be even-length hex string with at least 16 chars");
  process.exit(1);
}

const hash = crypto.pbkdf2Sync(passwordArg, salt, iterations, KEY_LENGTH, DIGEST).toString("hex");

const result = {
  salt,
  iterations,
  hash,
  sql: {
    password_salt: salt,
    password_iterations: iterations,
    password_hash: hash,
  },
};

console.log(JSON.stringify(result, null, 2));
