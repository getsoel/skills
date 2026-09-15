import { main } from "./cli";

try {
  main(process.argv.slice(2));
} catch (err) {
  console.error(`context-index: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 2;
}
