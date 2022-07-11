export * from "./maker";
export async function sleep(ms: number) {
  return new Promise(resolve => {
    setTimeout(() => {
      resolve(null);
    }, ms);
  });
}
