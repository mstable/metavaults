import { impersonate } from "@utils/fork"
import { ContractMocks, StandardAccounts } from "@utils/machines"
import { BN, simpleToExactAmount } from "@utils/math"
import { encodeInitiateSwap, encodeSettleSwap } from "@utils/peripheral/cowswap"
import { expect } from "chai"
import { ethers } from "hardhat"
import { CowSwapDex__factory, MockERC20__factory } from "types/generated"

import type { DexSwapData, DexTradeData } from "types"
import type { CowSwapDex, MockERC20, MockGPv2Settlement, MockGPv2VaultRelayer, MockNexus } from "types/generated"

const DEX_SWAP_DATA = "(address,uint256,address,uint256,bytes)"

const SETTLE_SWAP_SINGLE = `settleSwap(${DEX_SWAP_DATA})`

const CANCEL_SINGLE_ORDER = "cancelSwap(bytes)"
const CANCEL_BATCH_ORDER = "cancelSwap(bytes[])"

const INITIATE_SWAP_SINGLE = `initiateSwap(${DEX_SWAP_DATA})`
const INITIATE_SWAP_BATCH = `initiateSwap(${DEX_SWAP_DATA}[])`

describe("CowSwapDex", () => {
    /* -- Declare shared variables -- */
    let sa: StandardAccounts
    let mocks: ContractMocks
    let nexus: MockNexus
    let relayer: MockGPv2VaultRelayer
    let settlement: MockGPv2Settlement
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

    const orderUid1 = "0x3132333431"
    const orderUid2 = "0x3132333432"
    const orderUid3 = "0x3132333433"

    // Testing contract
    let cowSwapDex: CowSwapDex

    const setup = async () => {
        const accounts = await ethers.getSigners()
        sa = await new StandardAccounts().initAccounts(accounts)
        mocks = await new ContractMocks().init(sa)
        nexus = mocks.nexus
        // Deploy mock assets
        asset1 = await new MockERC20__factory(sa.default.signer).deploy("Asset 1", "A1", 18, sa.keeper.address, asset1Total)
        asset2 = await new MockERC20__factory(sa.default.signer).deploy("Asset 2", "A2", 6, sa.keeper.address, asset2Total)
        asset3 = await new MockERC20__factory(sa.default.signer).deploy("Asset 3", "A3", 18, sa.keeper.address, asset3Total)

        // Deploy mock rewards
        rewards1 = await new MockERC20__factory(sa.default.signer).deploy("Reward 1", "R1", 18, sa.keeper.address, reward1Total)
        rewards2 = await new MockERC20__factory(sa.default.signer).deploy("Reward 2", "R2", 6, sa.keeper.address, reward2Total)
        rewards3 = await new MockERC20__factory(sa.default.signer).deploy("Reward 3", "R3", 12, sa.keeper.address, reward3Total)

        // Deploy mock swapper
        const gpv2Mocks = await ContractMocks.mockCowSwapGPv2(sa.default.signer)
        settlement = gpv2Mocks.gpv2Settlement
        relayer = gpv2Mocks.gpv2VaultRelayer

        // Deploy test contract.
        cowSwapDex = await new CowSwapDex__factory(sa.default.signer).deploy(
            nexus.address,
            gpv2Mocks.gpv2VaultRelayer.address,
            gpv2Mocks.gpv2Settlement.address,
        )
        await relayer.initialize([
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

        // Approve cowSwapDex to spend assets
        await rewards1.connect(sa.keeper.signer).approve(cowSwapDex.address, ethers.constants.MaxUint256)
        await rewards2.connect(sa.keeper.signer).approve(cowSwapDex.address, ethers.constants.MaxUint256)
        await rewards3.connect(sa.keeper.signer).approve(cowSwapDex.address, ethers.constants.MaxUint256)
    }

    const toSettleSwapData = (orderUid: string, tradeData: DexTradeData): DexSwapData => ({
        toAsset: tradeData.toAsset,
        minToAssetAmount: tradeData.toAssetAmount,
        data: encodeSettleSwap(orderUid, tradeData.owner, tradeData.receiver),
        fromAsset: tradeData.fromAsset,
        fromAssetAmount: tradeData.fromAssetAmount,
    })
    const toSwapData = async (orderUid: string, tradeData: DexTradeData) => {
        const fromAssetFeeAmount = reward1Total.div(1000)
        const fromAsset = MockERC20__factory.connect(tradeData.fromAsset, sa.keeper.signer)
        const fromAssetAmount = await fromAsset.balanceOf(cowSwapDex.address)
        return {
            fromAsset: tradeData.fromAsset,
            fromAssetAmount,
            toAsset: tradeData.toAsset,
            minToAssetAmount: BN.from(0),
            //                     encodeSettleSwap
            data: encodeInitiateSwap(orderUid, fromAssetFeeAmount, sa.keeper.address),
        }
    }
    async function simulateAsyncSwap(swaps: Array<DexSwapData>) {
        // fromAsset => toAsset
        const cowSwapAccount = await impersonate(cowSwapDex.address)
        await asset1.connect(sa.keeper.signer).transfer(relayer.address, asset1Total)
        await asset2.connect(sa.keeper.signer).transfer(relayer.address, asset2Total)
        await asset3.connect(sa.keeper.signer).transfer(relayer.address, asset3Total)

        swaps.forEach(async (swap) => {
            await relayer.connect(cowSwapAccount).swap(swap)
        })
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async function simulateAsyncSettlement(tradesData: DexTradeData[]) {
        // fromAsset => toAsset
        const cowSwapAccount = await impersonate(cowSwapDex.address)
        // Relayer send to receiver the tokens after the off-chain settlement.
        tradesData.forEach(async (tradeData) => {
            // Relayer send to receiver the tokens after the off-chain settlement.
            await MockERC20__factory.connect(tradeData.toAsset, cowSwapAccount).transfer(tradeData.receiver, tradeData.toAssetAmount)
        })
    }
    before("init contract", async () => {
        await setup()
    })
    describe("constructor", async () => {
        it("should properly store valid arguments", async () => {
            expect(await cowSwapDex.nexus()).to.equal(nexus.address)
            expect(await cowSwapDex.RELAYER()).to.equal(relayer.address)
            expect(await cowSwapDex.SETTLEMENT()).to.equal(settlement.address)
        })
    })

    // Off-chain creates orders => Liquidator / Keeper perform on-chain swaps
    describe("swap single order", async () => {
        const fromAssetFeeAmount = reward1Total.div(1000)
        let swapData: DexSwapData
        before(async () => {
            swapData = {
                fromAsset: rewards1.address,
                fromAssetAmount: reward1Total.div(10),
                toAsset: asset1.address,
                minToAssetAmount: asset1Total.div(10),
                data: encodeInitiateSwap(orderUid1, fromAssetFeeAmount, sa.keeper.address),
            }
        })
        it("reward to asset", async () => {
            // Given
            const keeperRewards1BalBefore = await rewards1.balanceOf(sa.keeper.address)
            const dexRewards1BalBefore = await rewards1.balanceOf(cowSwapDex.address)
            const keeperAssets1BalBefore = await asset1.balanceOf(sa.keeper.address)

            // Test
            const tx = await cowSwapDex.connect(sa.keeper.signer)[INITIATE_SWAP_SINGLE](swapData)

            // Verify events, storage change, balance, etc.
            await expect(tx)
                .to.emit(cowSwapDex, "SwapInitiated")
                .withArgs(orderUid1, swapData.fromAsset, swapData.fromAssetAmount, fromAssetFeeAmount)
            await expect(tx).to.emit(settlement, "PreSignature").withArgs(cowSwapDex.address, orderUid1, true)

            // As the swap is async only "fromAsset" is updated
            expect(await rewards1.balanceOf(sa.keeper.address), "msg.sender sends rewards to dex").to.equal(
                keeperRewards1BalBefore.sub(swapData.fromAssetAmount).sub(fromAssetFeeAmount),
            )
            expect(await rewards1.balanceOf(cowSwapDex.address), "dex asset balance increase").to.equal(
                dexRewards1BalBefore.add(swapData.fromAssetAmount).add(fromAssetFeeAmount),
            )
            expect(await asset1.balanceOf(sa.keeper.address), "keeper assets does not change").to.equal(keeperAssets1BalBefore)
        })
        it("re-try a swap without sending rewards", async () => {
            // Given
            swapData = {
                ...swapData,
                data: encodeInitiateSwap(orderUid1, fromAssetFeeAmount, sa.keeper.address, true),
            }

            const keeperRewards1BalBefore = await rewards1.balanceOf(sa.keeper.address)
            const dexRewards1BalBefore = await rewards1.balanceOf(cowSwapDex.address)
            const keeperAssets1BalBefore = await asset1.balanceOf(sa.keeper.address)

            // Test
            const tx = await cowSwapDex.connect(sa.keeper.signer)[INITIATE_SWAP_SINGLE](swapData)

            // Verify events, storage change, balance, etc.
            await expect(tx)
                .to.emit(cowSwapDex, "SwapInitiated")
                .withArgs(orderUid1, swapData.fromAsset, swapData.fromAssetAmount, fromAssetFeeAmount)
            await expect(tx).to.emit(settlement, "PreSignature").withArgs(cowSwapDex.address, orderUid1, true)

            // As the swap is async and the flag onlySign is true, no balance should be updated
            expect(await rewards1.balanceOf(sa.keeper.address), "keeper rewards does not change").to.equal(keeperRewards1BalBefore)
            expect(await rewards1.balanceOf(cowSwapDex.address), "dex asset balance does not change").to.equal(dexRewards1BalBefore)
            expect(await asset1.balanceOf(sa.keeper.address), "keeper assets does not change").to.equal(keeperAssets1BalBefore)
        })
        describe("fails", async () => {
            it("if caller is not keeper or liquidator", async () => {
                await expect(cowSwapDex.connect(sa.default.signer)[INITIATE_SWAP_SINGLE](swapData), "!auth").to.be.revertedWith(
                    "Only keeper or liquidator",
                )
            })
            it("if balance is not enough", async () => {
                const fromAssetAmount = await rewards1.balanceOf(sa.keeper.address)
                const wrongSwapData = {
                    ...swapData,
                    fromAssetAmount,
                    data: encodeInitiateSwap(orderUid1, fromAssetFeeAmount, sa.keeper.address, false),
                }
                await expect(cowSwapDex.connect(sa.keeper.signer)[INITIATE_SWAP_SINGLE](wrongSwapData), "!balance").to.be.revertedWith(
                    "not enough from assets",
                )
            })
        })
    })

    describe("swap batch orders", async () => {
        const fromAssetFeeAmount = reward2Total.div(1000)
        const swapsData: Array<DexSwapData> = []

        before(async () => {
            const swapDate2 = {
                fromAsset: rewards2.address,
                fromAssetAmount: reward2Total.div(10),
                toAsset: asset2.address,
                minToAssetAmount: asset2Total.div(10),
                data: encodeInitiateSwap(orderUid2, fromAssetFeeAmount, sa.keeper.address),
            }
            const swapDate3 = {
                fromAsset: rewards3.address,
                fromAssetAmount: reward3Total.div(10),
                toAsset: asset3.address,
                minToAssetAmount: asset3Total.div(10),
                data: encodeInitiateSwap(orderUid3, fromAssetFeeAmount, sa.keeper.address),
            }
            swapsData.push(swapDate2)
            swapsData.push(swapDate3)
        })

        it("swap should swap multiple orders", async () => {
            // Given
            const keeperRewards2BalBefore = await rewards2.balanceOf(sa.keeper.address)
            const dexRewards2BalBefore = await rewards2.balanceOf(cowSwapDex.address)
            const keeperAssets2BalBefore = await asset2.balanceOf(sa.keeper.address)

            const keeperRewards3BalBefore = await rewards3.balanceOf(sa.keeper.address)
            const dexRewards3BalBefore = await rewards3.balanceOf(cowSwapDex.address)
            const keeperAssets3BalBefore = await asset3.balanceOf(sa.keeper.address)

            // Test
            const tx = await cowSwapDex.connect(sa.keeper.signer)[INITIATE_SWAP_BATCH](swapsData)

            // Verify events, storage change, balance, etc.
            await expect(tx)
                .to.emit(cowSwapDex, "SwapInitiated")
                .withArgs(orderUid2, swapsData[0].fromAsset, swapsData[0].fromAssetAmount, fromAssetFeeAmount)
            await expect(tx).to.emit(settlement, "PreSignature").withArgs(cowSwapDex.address, orderUid2, true)

            await expect(tx)
                .to.emit(cowSwapDex, "SwapInitiated")
                .withArgs(orderUid3, swapsData[1].fromAsset, swapsData[1].fromAssetAmount, fromAssetFeeAmount)
            await expect(tx).to.emit(settlement, "PreSignature").withArgs(cowSwapDex.address, orderUid3, true)

            // As the swap is async only "fromAsset" is updated
            expect(await rewards2.balanceOf(sa.keeper.address), "msg.sender sends rewards to dex").to.equal(
                keeperRewards2BalBefore.sub(swapsData[0].fromAssetAmount).sub(fromAssetFeeAmount),
            )
            expect(await rewards2.balanceOf(cowSwapDex.address), "dex asset balance increase").to.equal(
                dexRewards2BalBefore.add(swapsData[0].fromAssetAmount).add(fromAssetFeeAmount),
            )
            expect(await asset2.balanceOf(sa.keeper.address), "keeper assets does not change").to.equal(keeperAssets2BalBefore)

            expect(await rewards3.balanceOf(sa.keeper.address), "msg.sender sends rewards to dex").to.equal(
                keeperRewards3BalBefore.sub(swapsData[1].fromAssetAmount).sub(fromAssetFeeAmount),
            )
            expect(await rewards3.balanceOf(cowSwapDex.address), "dex asset balance increase").to.equal(
                dexRewards3BalBefore.add(swapsData[1].fromAssetAmount).add(fromAssetFeeAmount),
            )
            expect(await asset3.balanceOf(sa.keeper.address), "keeper assets does not change").to.equal(keeperAssets3BalBefore)
        })
        describe("fails", async () => {
            it("if caller is not keeper or liquidator", async () => {
                await expect(cowSwapDex.connect(sa.default.signer)[INITIATE_SWAP_BATCH]([]), "!auth").to.be.revertedWith(
                    "Only keeper or liquidator",
                )
            })
            it("if balance is not enough", async () => {
                const wrongSwapData = { ...swapsData[0], fromAssetAmount: await rewards2.balanceOf(sa.keeper.address) }
                const wrongSwapsData = [wrongSwapData]
                await expect(cowSwapDex.connect(sa.keeper.signer)[INITIATE_SWAP_BATCH](wrongSwapsData), "!balance").to.be.revertedWith(
                    "not enough from assets",
                )
            })
        })
    })
    // Off-chain monitor when order is settled => Liquidator / Keeper perform settlement on-chain
    describe("settle swap", async () => {
        const fromAssetFeeAmount = reward1Total.div(1000)
        let trade1Data: DexTradeData
        let swapFromReward1ToAsset1: DexSwapData
        let swapFromReward2ToAsset2: DexSwapData
        let swapFromReward3ToAsset3: DexSwapData

        before(async () => {
            trade1Data = {
                owner: cowSwapDex.address,
                receiver: sa.keeper.address,
                fromAsset: rewards1.address,
                fromAssetAmount: reward1Total.div(10),
                fromAssetFeeAmount,
                toAsset: asset1.address,
                toAssetAmount: BN.from("2000000000000000000000"),
            }
            swapFromReward1ToAsset1 = await toSwapData(orderUid1, trade1Data)
            // simulate DexCowSwap already process the swap
            await simulateAsyncSwap([swapFromReward1ToAsset1, swapFromReward2ToAsset2, swapFromReward3ToAsset3])
        })
        it("fails caller is not keeper or liquidator", async () => {
            await expect(
                cowSwapDex.connect(sa.default.signer)[SETTLE_SWAP_SINGLE](toSettleSwapData(orderUid1, trade1Data)),
                "!not supported",
            ).to.be.revertedWith("!not supported")
        })
    })

    // Off-chain creates orders => Liquidator / Keeper perform on-chain cancel
    describe("cancelSwap single order", async () => {
        const orderUid = "0x12345678"

        it("should cancel swap order", async () => {
            const tx = await cowSwapDex.connect(sa.keeper.signer)[CANCEL_SINGLE_ORDER](orderUid)
            // Verify events, storage change, balance, etc.
            await expect(tx).to.emit(cowSwapDex, "SwapCancelled").withArgs(orderUid)
            await expect(tx).to.emit(settlement, "PreSignature").withArgs(cowSwapDex.address, orderUid, false)
        })
        describe("fails", async () => {
            it("if caller is not keeper or liquidator", async () => {
                await expect(cowSwapDex.connect(sa.default.signer)[CANCEL_SINGLE_ORDER](orderUid), "!auth").to.be.revertedWith(
                    "Only keeper or liquidator",
                )
            })
        })
    })

    describe("cancelSwap batch", async () => {
        const orderUid = "0x12345678"
        const orderUids = [orderUid]

        it("cancelSwap should ...", async () => {
            const tx = await cowSwapDex.connect(sa.keeper.signer)[CANCEL_BATCH_ORDER](orderUids)
            // Verify events, storage change, balance, etc.
            await expect(tx).to.emit(cowSwapDex, "SwapCancelled").withArgs(orderUid)
            await expect(tx).to.emit(settlement, "PreSignature").withArgs(cowSwapDex.address, orderUid, false)
        })
        describe("fails", async () => {
            it("if caller is not keeper or liquidator", async () => {
                await expect(cowSwapDex.connect(sa.default.signer)[CANCEL_BATCH_ORDER](orderUids), "!auth").to.be.revertedWith(
                    "Only keeper or liquidator",
                )
            })
        })
    })
    // Off-chain calculation of tokens to be rescue
    describe("rescue tokens", async () => {
        async function verifyRescueToken(asset: MockERC20, amount: BN) {
            const to = await nexus.governor()
            const toBalanceBefore = await asset.balanceOf(to)
            const tx = await cowSwapDex.connect(sa.governor.signer).rescueToken(asset.address, amount)
            // Verify events, storage change, balance, etc.
            await expect(tx).to.emit(asset, "Transfer").withArgs(cowSwapDex.address, to, amount)
            expect(await asset.balanceOf(cowSwapDex.address), "dex assets balance decreased").to.equal(0)
            expect(await asset.balanceOf(to), "to assets balance increased").to.equal(toBalanceBefore.add(amount))
        }

        it("rescue multiple tokens", async () => {
            const dexAssetsBalBefore = []
            dexAssetsBalBefore.push(await asset1.balanceOf(cowSwapDex.address))
            dexAssetsBalBefore.push(await asset2.balanceOf(cowSwapDex.address))
            dexAssetsBalBefore.push(await asset3.balanceOf(cowSwapDex.address))

            await verifyRescueToken(asset1, dexAssetsBalBefore[0])
            await verifyRescueToken(asset2, dexAssetsBalBefore[1])
            await verifyRescueToken(asset3, dexAssetsBalBefore[2])
        })
        describe("fails", async () => {
            it("if caller is not governor or liquidator", async () => {
                await expect(cowSwapDex.connect(sa.default.signer).rescueToken(asset1.address, BN.from(1)), "!caller").to.be.revertedWith(
                    "Only governor can execute",
                )
            })
        })
    })
})
