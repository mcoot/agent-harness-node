export async function main(): Promise<void> {
  // Intentionally empty for now.
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
