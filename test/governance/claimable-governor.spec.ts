import { StandardAccounts } from "@utils/machines"
import { expect } from "chai"
import { ethers } from "hardhat"
import { ClaimableGovernor__factory } from "types/generated"

import {shouldBehaveLikeClaimable } from "./ClaimableGovernor.behaviour"

import type { IClaimableGovernableBehaviourContext} from "./ClaimableGovernor.behaviour";
import { Account } from "types"

describe("ClaimableGovernable", () => {
    const ctx: Partial<IClaimableGovernableBehaviourContext> = {}

    beforeEach("Create Contract", async () => {
        const accounts = await ethers.getSigners()
        const sa = await new StandardAccounts().initAccounts(accounts)
        ctx.default = sa.default
        ctx.governor = sa.governor
        ctx.other = sa.other
        ctx.claimable = await new ClaimableGovernor__factory(sa.governor.signer).deploy(sa.governor.address)
    })

    shouldBehaveLikeClaimable(ctx as Required<typeof ctx>)

    describe("after initiating a transfer", () => {
        let newOwner: Account

        beforeEach(async () => {
            const accounts = await ethers.getSigners()
            const sa = await new StandardAccounts().initAccounts(accounts)
            newOwner = sa.other
            await ctx.claimable.connect(sa.governor.signer).requestGovernorChange(newOwner.address)
        })

        it("changes allow pending owner to claim ownership", async () => {
            await ctx.claimable.connect(newOwner.signer).claimGovernorChange()
            const owner = await ctx.claimable.governor()

            expect(owner === newOwner.address).to.equal(true)
        })
    })
})
