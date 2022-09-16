import { SAFE_INFINITY, ZERO } from "@utils/constants"
import { StandardAccounts } from "@utils/machines"
import { simpleToExactAmount } from "@utils/math"
import { expect } from "chai"
import { ethers } from "hardhat"
import {
    BasicDexSwap__factory,
    MockERC20__factory,
    MockNexus__factory,
} from "types/generated"

import type {
    BasicDexSwap,
    DexSwapData,
    MockERC20,
    MockNexus,
} from "types"

describe("BasicDexSwap", async () => {
    let sa: StandardAccounts
    let nexus: MockNexus
    let basicDex: BasicDexSwap
    let asset1: MockERC20
    let asset2: MockERC20

    const asset1Total = simpleToExactAmount(200000)
    const asset2Total = simpleToExactAmount(100000)

    const setup = async () => {
        const accounts = await ethers.getSigners()
        sa = await new StandardAccounts().initAccounts(accounts)
        nexus = await new MockNexus__factory(sa.default.signer).deploy(sa.governor.address)
        await nexus.setKeeper(sa.keeper.address)

        // Deploy mock assets
        asset1 = await new MockERC20__factory(sa.default.signer).deploy("Asset 1", "A1", 18, sa.default.address, asset1Total)
        asset2 = await new MockERC20__factory(sa.default.signer).deploy("Asset 2", "A2", 18, sa.default.address, asset2Total)

        // Deploy mock basicDex
        const exchanges = [
            { from: asset2.address, to: asset1.address, rate: simpleToExactAmount(2, 18) },
        ]
        basicDex = await new BasicDexSwap__factory(sa.default.signer).deploy(nexus.address)
        await basicDex.initialize(exchanges)
    }
    describe("failed as", async () => {
        before(async () => {
            await setup()
        })
        it("initialize is called more than once", async () => {
            await expect(basicDex.initialize([])).to.be.revertedWith("Initializable: contract is already initialized")
        })
        it("setRate is called by non keeper or governor", async () => {
            const tx = basicDex.connect(sa.dummy1.signer)
                .setRate({ from: asset2.address, to: asset1.address, rate: simpleToExactAmount(2, 18) })
            await expect(tx).to.be.revertedWith("Only keeper or governor")
        })
        it("user doesn't have enough from assets", async () => {
            const insufficientfromAssetAmountSwapData: DexSwapData = {
                fromAsset: asset2.address,
                fromAssetAmount: SAFE_INFINITY,
                toAsset: asset1.address,
                minToAssetAmount: ZERO,
                data: "0x",
            }
            const tx = basicDex.swap(insufficientfromAssetAmountSwapData)
            await expect(tx).to.be.revertedWith("not enough from assets")
        })
    })
})