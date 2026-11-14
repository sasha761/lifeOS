const task = process.argv[2] ?? "unknown";

console.error(
  `LFS-101 scaffold: "${task}" is not configured for this workspace yet. ` +
    "See README.md for the remaining Foundation tasks.",
);
process.exitCode = 1;
