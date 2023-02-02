import { caching } from "cache-manager";
export default async function getCache(options?: any) {
  const caheStore = await caching("memory", options);
  return caheStore;
}
