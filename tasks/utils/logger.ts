import debug from "debug"

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export const logger = (...args: string[]) => debug(`mstable:${args.join(":")}`)
