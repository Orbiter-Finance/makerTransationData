import { isEmpty } from "orbiter-chaincore/src/utils/core";
const tx = {
  from: "0xd7aa9ba6caac7b0436c91396f22ca5a7f31664fc",
  to: "0x6a745cf3283fd2a048229f079869b4e88e16ce16",
  value: "10000000000",
  nonce: 1213,
  symbol: "USDT",
};
console.log(isEmpty(tx.from));
console.log(isEmpty(tx.to));
console.log(isEmpty(tx.value));
console.log(isEmpty(1));
console.log(isEmpty(tx.symbol));
