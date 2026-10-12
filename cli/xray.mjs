#!/usr/bin/env node
import { main } from '../src/cli.mjs';

main(process.argv.slice(2)).catch((e) => {
  console.error(`xray: ${e.message}`);
  process.exitCode = 2;
});
