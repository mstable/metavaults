import { resolveAddress } from "@tasks/utils"
import { ContractMocks, StandardAccounts } from "@utils/machines"
import { simpleToExactAmount } from "@utils/math"
import { encodeOneInchSwap } from "@utils/peripheral/oneInch"
import { expect } from "chai"
import { ethers } from "hardhat"
import { MockERC20__factory, OneInchDexSwap__factory } from "types/generated"

import type { Account, DexSwapData } from "types"
import type { MockAggregationRouterV4, MockERC20, OneInchDexSwap } from "types/generated"

describe("OneInchDexSwap", () => {
    /* -- Declare shared variables -- */
    let sa: StandardAccounts
    let mocks: ContractMocks
    let aggregationRouterV4: MockAggregationRouterV4
    let asset1: MockERC20
    let asset2: MockERC20
    let asset3: MockERC20
    let rewards1: MockERC20
    let rewards2: MockERC20
    let rewards3: MockERC20

    const asset1Total = simpleToExactAmount(200000)
    const asset2Total = simpleToExactAmount(300000, 6)
    const asset3Total = simpleToExactAmount(200000)

    const reward1Total = simpleToExactAmount(100000)
    const reward2Total = simpleToExactAmount(200000, 6)
    const reward3Total = simpleToExactAmount(300000, 12)
    let executorAddress: string
    // Testing contract
    let oneInchDexSwap: OneInchDexSwap

    /* -- Declare shared functions -- */

    const setup = async () => {
        const accounts = await ethers.getSigners()
        sa = await new StandardAccounts().initAccounts(accounts)
        mocks = await new ContractMocks().init(sa)
        // Deploy mock assets
        asset1 = await new MockERC20__factory(sa.default.signer).deploy("Asset 1", "A1", 18, sa.keeper.address, asset1Total)
        asset2 = await new MockERC20__factory(sa.default.signer).deploy("Asset 2", "A2", 6, sa.keeper.address, asset2Total)
        asset3 = await new MockERC20__factory(sa.default.signer).deploy("Asset 3", "A3", 18, sa.keeper.address, asset3Total)

        // Deploy mock rewards
        rewards1 = await new MockERC20__factory(sa.default.signer).deploy("Reward 1", "R1", 18, sa.keeper.address, reward1Total)
        rewards2 = await new MockERC20__factory(sa.default.signer).deploy("Reward 2", "R2", 6, sa.keeper.address, reward2Total)
        rewards3 = await new MockERC20__factory(sa.default.signer).deploy("Reward 3", "R3", 12, sa.keeper.address, reward3Total)

        // Deploy mock swapper
        aggregationRouterV4 = await ContractMocks.mockOneInchRouter(sa.default.signer)
        const routerAddress = aggregationRouterV4.address
        executorAddress = resolveAddress("OneInchAggregationExecutor")
        await aggregationRouterV4.initialize([
            // R1/A1 exchange rate of 2 means 1 R1 = 2 A1
            // 18 -> 6 means 18 decimals to 6 decimals
            { from: rewards1.address, to: asset1.address, rate: simpleToExactAmount(2, 18) }, // R1/A1 2; 18 -> 18
            { from: rewards2.address, to: asset1.address, rate: simpleToExactAmount(3, 30) }, // R2/A1 3; 6 -> 18
            { from: rewards3.address, to: asset1.address, rate: simpleToExactAmount(4, 24) }, // R3/A1 4; 12 -> 18
            { from: rewards1.address, to: asset2.address, rate: simpleToExactAmount(2, 5) }, // R1/A2 0.2; 18 -> 6
            { from: rewards2.address, to: asset2.address, rate: simpleToExactAmount(3, 17) }, // R2/A2 0.3; 6 -> 6
            { from: rewards3.address, to: asset2.address, rate: simpleToExactAmount(4, 11) }, // R3/A2 0.4; 12 -> 6
            { from: rewards1.address, to: asset3.address, rate: simpleToExactAmount(2, 5) }, // R1/A3 0.2; 18 -> 6
            { from: rewards2.address, to: asset3.address, rate: simpleToExactAmount(3, 17) }, // R2/A3 0.3; 6 -> 6
            { from: rewards3.address, to: asset3.address, rate: simpleToExactAmount(4, 11) }, // R3/A3 0.4; 12 -> 6
            { from: asset1.address, to: asset2.address, rate: simpleToExactAmount(10, 6) }, // A1/A2 10; 18 -> 6
        ])

        // Deploy test contract.
        // routerAddress = resolveAddress("OneInchAggregationRouterV4")
        oneInchDexSwap = await new OneInchDexSwap__factory(sa.default.signer).deploy(routerAddress)
        await asset1.connect(sa.keeper.signer).transfer(aggregationRouterV4.address, asset1Total)
        await asset2.connect(sa.keeper.signer).transfer(aggregationRouterV4.address, asset2Total)
        await asset3.connect(sa.keeper.signer).transfer(aggregationRouterV4.address, asset3Total)

        await rewards1.connect(sa.keeper.signer).transfer(sa.alice.address, reward1Total.div(10))
    }

    before("init contract", async () => {
        await setup()
    })
    describe("constructor", async () => {
        it("should properly store valid arguments", async () => {
            expect(await oneInchDexSwap.router()).to.equal(aggregationRouterV4.address)
            // TODO review if the executor should be within the contract or per call.
            // const executorAddress = resolveAddress("OneInchAggregationExecutor")
            // expect(await oneInchDexSwap.executor()).to.equal(executorAddress)
        })
    })
    describe("swap single order", async () => {
        const fromAssetFeeAmount = 0

        async function assertSwap(account: Account, swapData: DexSwapData) {
            const fromAsset = MockERC20__factory.connect(swapData.fromAsset, account.signer)
            const toAsset = MockERC20__factory.connect(swapData.toAsset, account.signer)

            const fromAssetBalBefore = await fromAsset.balanceOf(account.address)
            const toAssetBalBefore = await toAsset.balanceOf(account.address)

            const dexFromAssetBalBefore = await fromAsset.balanceOf(oneInchDexSwap.address)
            const dexToAssetBalBefore = await toAsset.balanceOf(oneInchDexSwap.address)

            // Test
            const tx = await oneInchDexSwap.connect(account.signer).swap(swapData)

            // Verify events, storage change, balance, etc.
            await expect(tx)
                .to.emit(oneInchDexSwap, "Swapped")
                .withArgs(swapData.fromAsset, swapData.toAsset, swapData.fromAssetAmount, swapData.minToAssetAmount)
            expect(await fromAsset.balanceOf(account.address), "msg.sender fromAsset balance decreases").to.equal(
                fromAssetBalBefore.sub(swapData.fromAssetAmount).sub(fromAssetFeeAmount),
            )
            expect(await fromAsset.balanceOf(oneInchDexSwap.address), "dex fromAsset balance does not change").to.equal(
                dexFromAssetBalBefore,
            )
            expect(await toAsset.balanceOf(oneInchDexSwap.address), "dex toAsset balance does not change").to.equal(dexToAssetBalBefore)

            expect(await toAsset.balanceOf(account.address), "msg.sender toAsset increases").to.equal(
                toAssetBalBefore.add(swapData.minToAssetAmount),
            )
        }
        it("reward to asset as keeper", async () => {
            // TODO - implement encodeOneInchSwap
            const swapData = {
                fromAsset: rewards1.address,
                fromAssetAmount: reward1Total.div(10),
                toAsset: asset1.address,
                minToAssetAmount: asset1Total.div(10),
                data: encodeOneInchSwap(executorAddress, sa.keeper.address, "0x"),
            }
            await rewards1.connect(sa.keeper.signer).approve(oneInchDexSwap.address, swapData.fromAssetAmount)

            await assertSwap(sa.keeper, swapData)
        })
        it("reward to asset as anyone", async () => {
            // TODO - implement encodeOneInchSwap
            const swapData = {
                fromAsset: rewards1.address,
                fromAssetAmount: reward1Total.div(10),
                toAsset: asset1.address,
                minToAssetAmount: asset1Total.div(10),
                data: encodeOneInchSwap(executorAddress, sa.keeper.address, "0x"),
            }
            await rewards1.connect(sa.alice.signer).approve(oneInchDexSwap.address, swapData.fromAssetAmount)

            await assertSwap(sa.alice, swapData)
        })
        describe("fails", async () => {
            xit("if balance is not enough", async () => {
                // TODO - after fork of one inch , check the error thrown and mock it here
                const fromAssetAmount = await rewards1.balanceOf(sa.keeper.address)
                const swapData = {
                    fromAsset: rewards1.address,
                    fromAssetAmount: fromAssetAmount.add(100),
                    toAsset: asset1.address,
                    minToAssetAmount: asset1Total.div(10),
                    data: encodeOneInchSwap(executorAddress, sa.keeper.address, "0x"),
                }
                await rewards1.connect(sa.alice.signer).approve(oneInchDexSwap.address, swapData.fromAssetAmount)

                await expect(oneInchDexSwap.connect(sa.keeper.signer).swap(swapData), "!balance").to.be.revertedWith(
                    "not enough from assets",
                )
            })
            it("if insufficient allowance", async () => {
                const swapData = {
                    fromAsset: rewards1.address,
                    fromAssetAmount: reward1Total.div(10),
                    toAsset: asset1.address,
                    minToAssetAmount: asset1Total.div(10),
                    data: encodeOneInchSwap(executorAddress, sa.keeper.address, "0x"),
                }
                await rewards1.connect(sa.alice.signer).approve(oneInchDexSwap.address, swapData.fromAssetAmount.sub(100))

                await expect(oneInchDexSwap.connect(sa.keeper.signer).swap(swapData), "!balance").to.be.revertedWith(
                    "ERC20: insufficient allowance",
                )
            })
        })
    })
})
