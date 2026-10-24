/** One plain line per event: `HH:MM:SS [prefix] message`. Short text only: never provider payloads or secrets. */
export const log = (prefix: string) => (message: string) =>
  console.log(`${new Date().toTimeString().slice(0, 8)} [${prefix}] ${message}`);
