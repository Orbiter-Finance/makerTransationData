const fs = require('fs');
const path = require('path');

async function main() {
  fs.writeFileSync(path.join(__dirname, './node_modules/orbiter-chaincore/src/chain/evm-chain.service.js'), fs.readFileSync(path.join(__dirname, './package_change/evm-chain.service.js')));
  fs.writeFileSync(path.join(__dirname, './node_modules/orbiter-chaincore/src/chain/evm-chain.service.d.ts'), fs.readFileSync(path.join(__dirname, './package_change/evm-chain.service.d.ts')));
  console.log('package change end!!!!!');
}

main();
