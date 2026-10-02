/**
 * VARDHAN INTELLIGENCE OPERATOR — interactive terminal entry point.
 *
 * Run with:  npm run vardhan
 */
import { VardhanOperator } from '../src/server/VardhanOperator';

async function main() {
  const operator = new VardhanOperator();
  await operator.start();
}

main().catch((err) => {
  console.error('VARDHAN OPERATOR FATAL:', err);
  process.exit(1);
});
