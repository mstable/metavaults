import { ONE_DAY, ONE_HOUR, ONE_WEEK } from "@utils/constants"
import { subtask, task, types } from "hardhat/config"

subtask("time-increase", "Move a local forked chain forward in time")
    .addOptionalParam("hours", "Number of hours to move time forward.", undefined, types.int)
    .addOptionalParam("days", "Number of days to move time forward.", undefined, types.int)
    .addOptionalParam("weeks", "Number of weeks to move time forward.", undefined, types.int)
    .addOptionalParam("time", "Unix time in seconds to increase time to.", undefined, types.int)
    .setAction(async (taskArgs) => {
        // Dynamic import time module to avoid importing while hardhat config is being defined.
        // The error this avoids is:
        // Error HH9: Error while loading Hardhat's configuration.
        // You probably tried to import the "hardhat" module from your config or a file imported from it.
        // This is not possible, as Hardhat can't be initialized while its config is being defined.
        const { increaseTime, increaseTimeTo } = await import("@utils/time")

        if (taskArgs.hours) await increaseTime(ONE_HOUR.mul(taskArgs.hours))
        else if (taskArgs.days) await increaseTime(ONE_DAY.mul(taskArgs.days))
        else if (taskArgs.weeks) await increaseTime(ONE_WEEK.mul(taskArgs.weeks))
        else if (taskArgs.time) await increaseTimeTo(taskArgs.time)
        else throw Error(`Must specify hours, days, weeks, or time`)
    })
task("time-increase").setAction(async (_, __, runSuper) => {
    return runSuper()
})
