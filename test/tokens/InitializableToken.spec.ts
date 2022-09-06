import { MAX_UINT256 } from "@utils/constants"
import { StandardAccounts } from "@utils/machines"
import { simpleToExactAmount } from "@utils/math"
import { ethers } from "hardhat"
import { MockInitializableToken__factory } from "types/generated"

import { shouldBehaveLikeToken } from "../../test/shared/Token.behaviour"

import type { MockInitializableToken } from "types/generated"

import type { TokenContext } from "../../test/shared/Token.behaviour"

describe("Basic Initializable Token ", async () => {
    let sa: StandardAccounts
    let token: MockInitializableToken
    const ctx: Partial<TokenContext> = {
        maxAmount: MAX_UINT256,
    }

    const deployToken = async (decimals = 18): Promise<MockInitializableToken> => {
        token = await new MockInitializableToken__factory(sa.default.signer).deploy()

        await token.initialize("Test Token", "TST", decimals, sa.default.address, 10000)

        return token
    }

    before("init contract", async () => {
        const accounts = await ethers.getSigners()
        sa = await new StandardAccounts().initAccounts(accounts)
        ctx.sender = sa.dummy1
        ctx.spender = sa.dummy2
        ctx.recipient = sa.dummy3
    })
    describe("should behave like a token", () => {
        // Test with different amounts of decimals
        ;[18, 2, 0].forEach((decimals) => {
            describe(`with ${decimals} decimals`, () => {
                const tokenBalance = decimals > 0 ? simpleToExactAmount(1000, decimals) : 1000
                beforeEach(async () => {
                    ctx.decimals = decimals
                    ctx.token = await deployToken(decimals)
                })
                describe("with the sender having 1,000 tokens", async () => {
                    beforeEach(async () => {
                        await token.connect(sa.default.signer).transfer(ctx.sender.address, tokenBalance)
                    })
                    shouldBehaveLikeToken(() => ctx as TokenContext)
                })
                describe("with the sender and recipient having 1,000 tokens", () => {
                    beforeEach(async () => {
                        await token.connect(sa.default.signer).transfer(ctx.sender.address, tokenBalance)
                        await token.connect(sa.default.signer).transfer(ctx.recipient.address, tokenBalance)
                    })
                    shouldBehaveLikeToken(() => ctx as TokenContext)
                })
                describe("with the sender, spender and recipient having 1,000 tokens", () => {
                    beforeEach(async () => {
                        await token.connect(sa.default.signer).transfer(ctx.sender.address, tokenBalance)
                        await token.connect(sa.default.signer).transfer(ctx.spender.address, tokenBalance)
                        await token.connect(sa.default.signer).transfer(ctx.recipient.address, tokenBalance)
                    })
                    shouldBehaveLikeToken(() => ctx as TokenContext)
                })
            })
        })
    })
})
