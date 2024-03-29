import { ZERO_ADDRESS } from "@utils/constants"
import { impersonate, loadOrExecFixture } from "@utils/fork"
import { ContractMocks, StandardAccounts } from "@utils/machines"
import { BN, simpleToExactAmount } from "@utils/math"
import { encodeInitiateSwap, encodeSettleSwap } from "@utils/peripheral/cowswap"
import { expect } from "chai"
import { ethers } from "hardhat"
import {
    BasicDexSwap__factory,
    CowSwapDex__factory,
    Liquidator__factory,
    LiquidatorBasicVault__factory,
    MockERC20__factory,
    MockLiquidatorMaliciousVault__factory,
    MockMaliciousDexSwap__factory,
    MockNexus__factory,
} from "types/generated"

import { buildDonateTokensInput } from "../../../tasks/utils/liquidatorUtil"

import type { ContractTransaction, Signer } from "ethers"
import type {
    BasicDexSwap,
    CowSwapDex,
    DexSwapData,
    Liquidator,
    LiquidatorBasicVault,
    MockERC20,
    MockGPv2VaultRelayer,
    MockNexus,
} from "types"
import type { MockLiquidatorMaliciousVault, MockMaliciousDexSwap } from "types/generated"

const ERROR = {
    ALREADY_INITIALIZED: "Initializable: contract is already initialized",
    INVALID_BATCH: "invalid batch",
    INVALID_SWAP: "invalid swap pair",
    ONLY_KEEPER_GOVERNOR: "Only keeper or governor",
    ONLY_GOVERNOR: "Only governor can execute",
    NO_PENDING_REWARDS: "no pending rewards",
    NOT_ENOUGH_ASSETS: "to asset < min",
    NOTHING_TO_DONATE: "nothing to donate",
    NOT_SWAPPED: "not swapped",
    ALREADY_DONATED: "already donated",
    WRONG_INPUT: "Wrong input",
    DONATE_WRONG_TOKEN: "Donated token not asset",
    REENTRY_GARD: "ReentrancyGuard: reentrant call",
}
const defaultAssetToBurn = simpleToExactAmount(0)

describe("Liquidator", async () => {
    let sa: StandardAccounts
    let nexus: MockNexus
    let asset1: MockERC20
    let asset2: MockERC20
    let rewards1: MockERC20
    let rewards2: MockERC20
    let rewards3: MockERC20
    let vault1: LiquidatorBasicVault
    let vault2: LiquidatorBasicVault
    let vault3: LiquidatorBasicVault
    let assetToBurn: BN
    let syncSwapper: BasicDexSwap
    let liquidator: Liquidator
    // async conf
    let asyncSwapper: CowSwapDex
    let relayer: MockGPv2VaultRelayer
    // malicious contracts
    let vaultMalicious: MockLiquidatorMaliciousVault
    let syncSwapperMalicious: MockMaliciousDexSwap

    let vault1Account: Signer
    let vault2Account: Signer
    let vault3Account: Signer

    const asset1Total = simpleToExactAmount(200000)
    const asset2Total = simpleToExactAmount(300000, 6)
    const reward1Total = simpleToExactAmount(100000)
    const reward2Total = simpleToExactAmount(200000, 6)
    const reward3Total = simpleToExactAmount(300000, 12)

    const vault1reward1 = reward1Total.mul(1).div(10)
    const vault1reward2 = reward2Total.mul(1).div(10)
    const vault1reward3 = reward3Total.mul(1).div(10)

    const vault2reward1 = reward1Total.mul(2).div(10)
    const vault2reward3 = reward3Total.mul(2).div(10)

    const vault3reward1 = reward1Total.mul(3).div(10)

    const deployMocks = async () => {
        asset1 = await new MockERC20__factory(sa.default.signer).deploy("Asset 1", "A1", 18, sa.default.address, asset1Total)
        asset2 = await new MockERC20__factory(sa.default.signer).deploy("Asset 2", "A2", 6, sa.default.address, asset2Total)

        // Deploy mock rewards
        rewards1 = await new MockERC20__factory(sa.default.signer).deploy("Reward 1", "R1", 18, sa.default.address, reward1Total)
        rewards2 = await new MockERC20__factory(sa.default.signer).deploy("Reward 2", "R2", 6, sa.default.address, reward2Total)
        rewards3 = await new MockERC20__factory(sa.default.signer).deploy("Reward 3", "R3", 12, sa.default.address, reward3Total)

        // Deploy mock syncSwapper
        const exchanges = [
            { from: rewards1.address, to: asset1.address, rate: simpleToExactAmount(2, 18) },
            { from: rewards2.address, to: asset1.address, rate: simpleToExactAmount(3, 30) },
            { from: rewards3.address, to: asset1.address, rate: simpleToExactAmount(4, 24) },
            { from: rewards1.address, to: asset2.address, rate: simpleToExactAmount(2, 5) },
            { from: rewards2.address, to: asset2.address, rate: simpleToExactAmount(3, 17) },
            { from: rewards3.address, to: asset2.address, rate: simpleToExactAmount(4, 11) },
            { from: asset1.address, to: asset2.address, rate: simpleToExactAmount(10, 6) },
        ]
        syncSwapper = await new BasicDexSwap__factory(sa.default.signer).deploy(nexus.address)
        await syncSwapper.initialize(exchanges)

        // Deploy mock asyncSwapper
        const gpv2Mocks = await ContractMocks.mockCowSwapGPv2(sa.default.signer)
        relayer = gpv2Mocks.gpv2VaultRelayer

        asyncSwapper = await new CowSwapDex__factory(sa.default.signer).deploy(
            nexus.address,
            gpv2Mocks.gpv2VaultRelayer.address,
            gpv2Mocks.gpv2Settlement.address,
        )
        await asyncSwapper.connect(sa.governor.signer).approveToken(rewards1.address)
        await asyncSwapper.connect(sa.governor.signer).approveToken(rewards2.address)
        await asyncSwapper.connect(sa.governor.signer).approveToken(rewards3.address)
        await relayer.initialize(exchanges)

        // deploy malicious

        syncSwapperMalicious = await new MockMaliciousDexSwap__factory(sa.default.signer).deploy(nexus.address)
        await syncSwapperMalicious.initialize(exchanges)
    }

    const setup = async () => {
        nexus = await new MockNexus__factory(sa.default.signer).deploy(sa.governor.address)
        await nexus.setKeeper(sa.keeper.address)

        assetToBurn = assetToBurn ?? defaultAssetToBurn

        // Deploy mock assets
        await deployMocks()

        // Deploy test Liquidator
        liquidator = await new Liquidator__factory(sa.default.signer).deploy(nexus.address)
        await liquidator.initialize(syncSwapper.address, asyncSwapper.address)
        liquidator = liquidator.connect(sa.keeper.signer)
        await liquidator.connect(sa.governor.signer).approveAsyncSwapper(rewards1.address)
        await liquidator.connect(sa.governor.signer).approveAsyncSwapper(rewards2.address)
        await liquidator.connect(sa.governor.signer).approveAsyncSwapper(rewards3.address)
        await nexus.setLiquidatorV2(liquidator.address)

        // Deploy mock vaults
        // Vault 1 has all rewards and asset 1
        vault1 = await new LiquidatorBasicVault__factory(sa.default.signer).deploy(nexus.address, asset1.address)
        await asset1.connect(sa.default.signer).approve(vault1.address, ethers.constants.MaxUint256)
        await vault1.initialize("Vault 1", "V1", sa.default.address, [rewards1.address, rewards2.address, rewards3.address], assetToBurn)
        // Vault 2 has all rewards and asset 2
        vault2 = await new LiquidatorBasicVault__factory(sa.default.signer).deploy(nexus.address, asset2.address)
        await asset2.connect(sa.default.signer).approve(vault2.address, ethers.constants.MaxUint256)
        await vault2.initialize("Vault 2", "V2", sa.default.address, [rewards1.address, rewards2.address, rewards3.address], assetToBurn)
        // Vault 3 has reward 1 and asset 1
        vault3 = await new LiquidatorBasicVault__factory(sa.default.signer).deploy(nexus.address, asset1.address)
        await asset1.connect(sa.default.signer).approve(vault3.address, ethers.constants.MaxUint256)
        await vault3.initialize("Vault 3", "V3", sa.default.address, [rewards1.address], assetToBurn)

        vaultMalicious = await new MockLiquidatorMaliciousVault__factory(sa.default.signer).deploy(nexus.address, asset1.address)
        await vaultMalicious.initialize("Vault R", "VR", sa.default.address, [rewards1.address])

        // to simulate calls from the vault
        vault1Account = await impersonate(vault1.address)
        vault2Account = await impersonate(vault2.address)
        vault3Account = await impersonate(vault3.address)
    }
    const simulateAsyncSwap = async (swapData: DexSwapData, receiver: string) => {
        const cowSwapAccount = await impersonate(asyncSwapper.address)
        const toAsset = MockERC20__factory.connect(swapData.toAsset, sa.default.signer)
        await toAsset.connect(sa.default.signer).transfer(relayer.address, swapData.minToAssetAmount)
        await relayer.connect(cowSwapAccount).swap(swapData)
        // after the swap send back the tokens to the receiver
        await toAsset.connect(cowSwapAccount).transfer(receiver, swapData.minToAssetAmount)
    }
    const verifyAsyncSwap = async (swapData: DexSwapData) => {
        // 1.- Initiate Swap
        // liquidator rewards balances is transfer to asyncSwapper
        const [orderUid, transfer] = ethers.utils.defaultAbiCoder.decode(["bytes", "bool"], swapData.data)
        const reward = MockERC20__factory.connect(swapData.fromAsset, sa.default.signer)
        const asset = MockERC20__factory.connect(swapData.toAsset, sa.default.signer)

        const liquidatorRewardBalanceBefore = await reward.balanceOf(liquidator.address)
        const swapperRewardBalanceBefore = await reward.balanceOf(asyncSwapper.address)
        const liquidatorAssetsBalanceBefore = await asset.balanceOf(liquidator.address)
        const pendingRewardsBefore = await liquidator.pendingRewards(reward.address, asset.address)
        const rewards = pendingRewardsBefore.rewards
        const initiateData = swapData.data

        await liquidator.connect(sa.keeper.signer).initiateSwap(reward.address, asset.address, initiateData)
        if (!transfer) {
            expect(await reward.allowance(liquidator.address, asyncSwapper.address), "rewards allowance").to.gte(rewards)
        } else {
            expect(await reward.balanceOf(liquidator.address), "rewards transfer from").to.eq(liquidatorRewardBalanceBefore.sub(rewards))
            expect(await reward.balanceOf(asyncSwapper.address), "rewards transfer to").to.eq(swapperRewardBalanceBefore.add(rewards))
            // Simulate off-chain swap
            // asyncSwapper assets balances is transfer from relayer
            await simulateAsyncSwap(swapData, liquidator.address)

            // Settle Swap
            const assets = swapData.minToAssetAmount
            // owner of the order is the CowswapDex, the receiver is the liquidator
            const settleData = encodeSettleSwap(orderUid, await liquidator.asyncSwapper(), liquidator.address)
            const settleTx = await liquidator.connect(sa.keeper.signer).settleSwap(reward.address, asset.address, assets, settleData)

            await expect(settleTx).to.emit(liquidator, "SwapSettled").withArgs(pendingRewardsBefore.batch, rewards, assets)
            // Verify assets are received
            expect(await reward.balanceOf(liquidator.address), "liquidator rewards balance decreased").to.equal(
                liquidatorRewardBalanceBefore.sub(rewards),
            )
            expect(await asset.balanceOf(liquidator.address), "liquidator assets balance increased").to.equal(
                liquidatorAssetsBalanceBefore.add(assets),
            )
        }
    }
    const verifyAsyncSwaps = async (swapsData: DexSwapData[]) => {
        // 1.- Initiate Swap
        // liquidator rewards balances is transfer to asyncSwapper
        const orders = await Promise.all(
            swapsData.map(async (swapData) => {
                const [orderUid] = ethers.utils.defaultAbiCoder.decode(["bytes", "uint256"], swapData.data)
                const pendingRewardsBefore = await liquidator.pendingRewards(swapData.fromAsset, swapData.toAsset)
                return { fromAsset: swapData.fromAsset, toAsset: swapData.toAsset, data: swapData.data, orderUid, pendingRewardsBefore }
            }),
        )
        const fromAssets = orders.map((o) => o.fromAsset)
        const toAssets = orders.map((o) => o.toAsset)
        const datas = orders.map((o) => o.data)
        const assetsAmounts = swapsData.map((o) => o.minToAssetAmount)

        await liquidator.connect(sa.keeper.signer).initiateSwaps(fromAssets, toAssets, datas)

        await Promise.all(
            swapsData.map(async (swapData) => {
                // Simulate off-chain swap
                // asyncSwapper assets balances is transfer from relayer
                await simulateAsyncSwap(swapData, liquidator.address)
            }),
        )
        const settleTx = await liquidator.connect(sa.keeper.signer).settleSwaps(fromAssets, toAssets, assetsAmounts, datas)

        // Settle Swap
        await Promise.all(
            swapsData.map(async (swapData, i) => {
                const pendingRewardsBefore = orders[i].pendingRewardsBefore
                const rewards = pendingRewardsBefore.rewards
                const assets = swapData.minToAssetAmount
                await expect(settleTx).to.emit(liquidator, "SwapSettled").withArgs(pendingRewardsBefore.batch, rewards, assets)
            }),
        )
    }
    const assertDonateTokens = async (assets: MockERC20[], amounts: BN[], vaultsAddress: string[]): Promise<ContractTransaction> => {
        const { rewardTokens, purchaseTokens, vaults } = await buildDonateTokensInput(sa.default.signer, vaultsAddress)
        const tx = liquidator.connect(sa.keeper.signer).donateTokens(rewardTokens, purchaseTokens, vaults)
        for (let i = 0; i < vaultsAddress.length; i++) {
            await expect(tx, `asset ${i}`)
                .to.emit(assets[i], "Transfer")
                .withArgs(liquidator.address, vaultsAddress[i], amounts[i].toString())
        }
        await expect(tx).to.emit(liquidator, "DonatedAssets").withArgs(amounts)
        return tx
    }

    before("init contract", async () => {
        const accounts = await ethers.getSigners()
        sa = await new StandardAccounts().initAccounts(accounts)
        await setup()
    })
    describe("calling initialize", async () => {
        it("should deployment and initialize", async () => {
            expect(await vault1.totalAssets(), "vault 1 total assets").to.eq(0)
            expect(await liquidator.nexus(), "nexus").to.eq(nexus.address)
            expect(await liquidator.syncSwapper(), "syncSwapper").to.eq(syncSwapper.address)
            expect(await liquidator.asyncSwapper(), "asyncSwapper").to.eq(asyncSwapper.address)

            const pending = await liquidator.pendingRewards(rewards1.address, asset1.address)
            expect(pending.rewards, "rewards for R1/A1").to.eq(0)
            expect(pending.batch, "batch for R1/A1").to.eq(0)

            const pendingVault1 = await liquidator.pendingVaultRewards(rewards1.address, asset1.address, vault1.address)
            expect(pendingVault1.rewards, "vault1 rewards for R1/A1").to.eq(0)
            expect(pendingVault1.batch, "vault1 batch for R1/A1").to.eq(0)

            const tx2 = liquidator.purchasedAssets(0, rewards1.address, asset1.address, vault1.address)
            await expect(tx2).to.revertedWith(ERROR.INVALID_BATCH)
        })
        it("fails if initialize is called more than once", async () => {
            await expect(liquidator.initialize(ZERO_ADDRESS, ZERO_ADDRESS), "init call twice").to.be.revertedWith(ERROR.ALREADY_INITIALIZED)
        })
        it("fails if underlying vaults initialize is called more than once", async () => {
            await expect(
                vault1.initialize("Vault 1", "V1", sa.default.address, [rewards1.address, rewards2.address, rewards3.address], assetToBurn),
                "init call twice",
            ).to.be.revertedWith(ERROR.ALREADY_INITIALIZED)
        })
    })

    describe("collect rewards", () => {
        const asset1Deposit = asset1Total.mul(1).div(10)
        const asset2Deposit = asset2Total.mul(1).div(10)
        const beforeEachFixture = async function fixture() {
            await setup()
            await asset1.approve(vault1.address, asset1Deposit)
            await asset2.approve(vault2.address, asset2Deposit)
            await asset1.approve(vault3.address, asset1Deposit.mul(2))

            await vault1.deposit(asset1Deposit, sa.default.address)
            await vault2.deposit(asset2Deposit, sa.default.address)
            await vault3.deposit(asset1Deposit.mul(2), sa.default.address)
        }
        beforeEach(async () => {
            await loadOrExecFixture(beforeEachFixture)
        })
        it("from a single vault with single reward", async () => {
            await rewards1.transfer(vault3.address, vault3reward1)

            const tx = await liquidator.collectRewards([vault3.address])

            await expect(tx).to.emit(liquidator, "CollectedRewards")
            await expect(tx).to.emit(rewards1, "Transfer").withArgs(vault3.address, liquidator.address, vault3reward1)

            const pendingTotal = await liquidator.pendingRewards(rewards1.address, asset1.address)
            expect(pendingTotal.rewards, "rewards for R1/A1").to.eq(vault3reward1)
            expect(pendingTotal.batch, "batch for R1/A1").to.eq(0)

            const pendingVault1 = await liquidator.pendingVaultRewards(rewards1.address, asset1.address, vault1.address)
            expect(pendingVault1.rewards, "vault1 rewards for R1/A1").to.eq(0)
            expect(pendingVault1.batch, "vault1 batch for R1/A1").to.eq(0)

            const pendingVault3 = await liquidator.pendingVaultRewards(rewards1.address, asset1.address, vault3.address)
            expect(pendingVault3.rewards, "vault3 rewards for R1/A1").to.eq(vault3reward1)
            expect(pendingVault3.batch, "vault3 batch for R1/A1").to.eq(0)

            expect(await liquidator.purchasedAssets(0, rewards1.address, asset1.address, vault1.address), "purchased assets").to.eq(0)
        })
        it("from multiple vaults with multiple rewards", async () => {
            await rewards1.transfer(vault1.address, vault1reward1)
            await rewards2.transfer(vault1.address, vault1reward2)
            await rewards3.transfer(vault1.address, vault1reward3)

            await rewards1.transfer(vault2.address, vault2reward1)
            await rewards3.transfer(vault2.address, vault2reward3)

            await rewards1.transfer(vault3.address, vault3reward1)

            const tx = await liquidator.collectRewards([vault1.address, vault2.address, vault3.address])

            await expect(tx).to.emit(liquidator, "CollectedRewards")

            const receipt = await tx.wait()
            const event = receipt.events.find((e) => e.event === "CollectedRewards")
            expect(event.args.rewardTokens[0][0], "reward token vault1 rewards 1").to.eq(rewards1.address)
            expect(event.args.rewardTokens[0][1], "reward token vault1 rewards 2").to.eq(rewards2.address)
            expect(event.args.rewardTokens[0][2], "reward token vault1 rewards 3").to.eq(rewards3.address)
            expect(event.args.rewardTokens[1][0], "reward token vault2 rewards 1").to.eq(rewards1.address)
            expect(event.args.rewardTokens[1][1], "reward token vault2 rewards 2").to.eq(rewards2.address)
            expect(event.args.rewardTokens[1][2], "reward token vault2 rewards 3").to.eq(rewards3.address)
            expect(event.args.rewardTokens[2][0], "reward token vault3 rewards 1").to.eq(rewards1.address)
            expect(event.args.rewards[0][0], "rewards vault1 rewards 1").to.eq(vault1reward1)
            expect(event.args.rewards[0][1], "rewards vault1 rewards 2").to.eq(vault1reward2)
            expect(event.args.rewards[0][2], "rewards vault1 rewards 3").to.eq(vault1reward3)
            expect(event.args.rewards[1][0], "rewards vault2 rewards 1").to.eq(vault2reward1)
            expect(event.args.rewards[1][1], "rewards vault2 rewards 2").to.eq(0)
            expect(event.args.rewards[1][2], "rewards vault2 rewards 3").to.eq(vault2reward3)
            expect(event.args.rewards[2][0], "rewards vault3 rewards 1").to.eq(vault3reward1)
            expect(event.args.purchaseTokens[0][0], "purchase token vault1 rewards 1").to.eq(asset1.address)
            expect(event.args.purchaseTokens[0][1], "purchase token vault1 rewards 2").to.eq(asset1.address)
            expect(event.args.purchaseTokens[0][2], "purchase token vault1 rewards 3").to.eq(asset1.address)
            expect(event.args.purchaseTokens[1][0], "purchase token vault2 rewards 1").to.eq(asset2.address)
            expect(event.args.purchaseTokens[1][1], "purchase token vault2 rewards 2").to.eq(asset2.address)
            expect(event.args.purchaseTokens[1][2], "purchase token vault2 rewards 3").to.eq(asset2.address)
            expect(event.args.purchaseTokens[2][0], "purchase token vault3 rewards 1").to.eq(asset1.address)

            // Transfers to vault 1
            await expect(tx).to.emit(rewards1, "Transfer").withArgs(vault1.address, liquidator.address, vault1reward1)
            await expect(tx).to.emit(rewards2, "Transfer").withArgs(vault1.address, liquidator.address, vault1reward2)
            await expect(tx).to.emit(rewards3, "Transfer").withArgs(vault1.address, liquidator.address, vault1reward3)
            // Transfers to vault 2
            await expect(tx).to.emit(rewards1, "Transfer").withArgs(vault2.address, liquidator.address, vault2reward1)
            await expect(tx).to.emit(rewards3, "Transfer").withArgs(vault2.address, liquidator.address, vault2reward3)
            // Transfers to vault 3
            await expect(tx).to.emit(rewards1, "Transfer").withArgs(vault3.address, liquidator.address, vault3reward1)
        })
        it("twice in a batch", async () => {})
        it("for a second batch", async () => {})
        it("no rewards in any vault", async () => {
            const tx = await liquidator.collectRewards([vault1.address, vault2.address, vault3.address])

            await expect(tx).to.emit(liquidator, "CollectedRewards")

            const receipt = await tx.wait()
            const event = receipt.events.find((e) => e.event === "CollectedRewards")
            expect(event.args.rewardTokens[0][0], "reward token vault1 rewards 1").to.eq(rewards1.address)
            expect(event.args.rewardTokens[0][1], "reward token vault1 rewards 2").to.eq(rewards2.address)
            expect(event.args.rewardTokens[0][2], "reward token vault1 rewards 3").to.eq(rewards3.address)
            expect(event.args.rewardTokens[1][0], "reward token vault2 rewards 1").to.eq(rewards1.address)
            expect(event.args.rewardTokens[1][1], "reward token vault2 rewards 2").to.eq(rewards2.address)
            expect(event.args.rewardTokens[1][2], "reward token vault2 rewards 3").to.eq(rewards3.address)
            expect(event.args.rewardTokens[2][0], "reward token vault3 rewards 1").to.eq(rewards1.address)
            expect(event.args.rewards[0][0], "rewards vault1 rewards 1").to.eq(0)
            expect(event.args.rewards[0][1], "rewards vault1 rewards 2").to.eq(0)
            expect(event.args.rewards[0][2], "rewards vault1 rewards 3").to.eq(0)
            expect(event.args.rewards[1][0], "rewards vault2 rewards 1").to.eq(0)
            expect(event.args.rewards[1][1], "rewards vault2 rewards 2").to.eq(0)
            expect(event.args.rewards[1][2], "rewards vault2 rewards 3").to.eq(0)
            expect(event.args.rewards[2][0], "rewards vault3 rewards 1").to.eq(0)
            expect(event.args.purchaseTokens[0][0], "purchase token vault1 rewards 1").to.eq(asset1.address)
            expect(event.args.purchaseTokens[0][1], "purchase token vault1 rewards 2").to.eq(asset1.address)
            expect(event.args.purchaseTokens[0][2], "purchase token vault1 rewards 3").to.eq(asset1.address)
            expect(event.args.purchaseTokens[1][0], "purchase token vault2 rewards 1").to.eq(asset2.address)
            expect(event.args.purchaseTokens[1][1], "purchase token vault2 rewards 2").to.eq(asset2.address)
            expect(event.args.purchaseTokens[1][2], "purchase token vault2 rewards 3").to.eq(asset2.address)
            expect(event.args.purchaseTokens[2][0], "purchase token vault3 rewards 1").to.eq(asset1.address)
        })
        describe("failed as", () => {
            it("not keeper or governor", async () => {
                const tx = liquidator.connect(sa.default.signer).collectRewards([vault3.address])
                await expect(tx).to.revertedWith(ERROR.ONLY_KEEPER_GOVERNOR)
            })
            it("reentrant call", async () => {
                const tx = liquidator.collectRewards([vaultMalicious.address])
                await expect(tx).to.revertedWith(ERROR.REENTRY_GARD)
            })
        })
    })
    describe("sync swap rewards for assets", () => {
        it("before rewards are collected", async () => {
            await setup()

            const tx = liquidator.connect(sa.keeper.signer).swap(rewards1.address, asset1.address, 0, "0x")

            await expect(tx).to.revertedWith(ERROR.INVALID_SWAP)
        })
        it("from single vault with single reward", async () => {
            await setup()
            const asset1Amount = vault3reward1.mul(2)
            await rewards1.transfer(vault3.address, vault3reward1)
            await liquidator.collectRewards([vault3.address])
            await asset1.transfer(syncSwapper.address, asset1Amount)

            const tx = await liquidator.connect(sa.keeper.signer).swap(rewards1.address, asset1.address, 0, "0x")

            await expect(tx).to.emit(liquidator, "Swapped").withArgs(0, vault3reward1, asset1Amount)
            await expect(tx, "reward 1").to.emit(rewards1, "Transfer").withArgs(liquidator.address, syncSwapper.address, vault3reward1)
            await expect(tx, "asset 1").to.emit(asset1, "Transfer").withArgs(syncSwapper.address, liquidator.address, asset1Amount)

            const pending = await liquidator.pendingRewards(rewards1.address, asset1.address)
            expect(pending.batch, "batch after").to.eq(1)
            expect(pending.rewards, "rewards after").to.eq(0)

            expect(await liquidator.purchasedAssets(0, rewards1.address, asset1.address, vault1.address), "vault1 purchased assets").to.eq(
                0,
            )
            expect(await liquidator.purchasedAssets(0, rewards1.address, asset1.address, vault3.address), "vault3 purchased assets").to.eq(
                asset1Amount,
            )
        })
        context("from multiple vaults with multiple rewards", async () => {
            before(async () => {
                await setup()
                await rewards1.transfer(vault1.address, vault1reward1)
                await rewards2.transfer(vault1.address, vault1reward2)
                await rewards3.transfer(vault1.address, vault1reward3)

                await rewards1.transfer(vault2.address, vault2reward1)
                await rewards3.transfer(vault2.address, vault2reward3)

                await rewards1.transfer(vault3.address, vault3reward1)

                await liquidator.collectRewards([vault1.address, vault2.address, vault3.address])
            })
            it("reward 1 to asset 1 for vaults 1 and 3", async () => {
                // Supply assets for the swap
                const rewardsAmount = vault1reward1.add(vault3reward1)
                const asset1Amount = rewardsAmount.mul(2)
                await asset1.transfer(syncSwapper.address, asset1Amount)

                const tx = await liquidator.connect(sa.keeper.signer).swap(rewards1.address, asset1.address, asset1Amount, "0x")

                await expect(tx).to.emit(liquidator, "Swapped").withArgs(0, rewardsAmount, asset1Amount)
                await expect(tx, "reward 1").to.emit(rewards1, "Transfer").withArgs(liquidator.address, syncSwapper.address, rewardsAmount)
                await expect(tx, "asset 1").to.emit(asset1, "Transfer").withArgs(syncSwapper.address, liquidator.address, asset1Amount)

                const pending = await liquidator.pendingRewards(rewards1.address, asset1.address)
                expect(pending.batch, "batch after").to.eq(1)
                expect(pending.rewards, "rewards after").to.eq(0)

                expect(
                    await liquidator.purchasedAssets(0, rewards1.address, asset1.address, vault1.address),
                    "vault 1 reward 1 asset 1",
                ).to.eq(vault1reward1.mul(2))
                expect(
                    await liquidator.purchasedAssets(0, rewards2.address, asset1.address, vault1.address),
                    "vault 1 reward 2 asset 1",
                ).to.eq(0)
                expect(
                    await liquidator.purchasedAssets(0, rewards1.address, asset1.address, vault2.address),
                    "vault 2 reward 1 asset 1",
                ).to.eq(0)
                expect(
                    await liquidator.purchasedAssets(0, rewards1.address, asset2.address, vault2.address),
                    "vault 2 reward 1 asset 2",
                ).to.eq(0)
                expect(
                    await liquidator.purchasedAssets(0, rewards1.address, asset1.address, vault3.address),
                    "vault 3 reward 1 asset 1",
                ).to.eq(vault3reward1.mul(2))
                expect(
                    await liquidator.purchasedAssets(0, rewards3.address, asset1.address, vault3.address),
                    "vault 3 reward 3 asset 1",
                ).to.eq(0)
            })
            it("reward 1 to asset 2 for vault 2", async () => {
                // Supply assets for the swap
                const rewardsAmount = vault2reward1
                const asset2Amount = vault2reward1.mul(2).div(1e13)
                await asset2.transfer(syncSwapper.address, asset2Amount)

                const tx = await liquidator.connect(sa.keeper.signer).swap(rewards1.address, asset2.address, asset2Amount, "0x")

                await expect(tx).to.emit(liquidator, "Swapped").withArgs(0, rewardsAmount, asset2Amount)
                await expect(tx, "reward 1").to.emit(rewards1, "Transfer").withArgs(liquidator.address, syncSwapper.address, rewardsAmount)
                await expect(tx, "asset 2").to.emit(asset2, "Transfer").withArgs(syncSwapper.address, liquidator.address, asset2Amount)

                const pending = await liquidator.pendingRewards(rewards1.address, asset2.address)
                expect(pending.batch, "batch after").to.eq(1)
                expect(pending.rewards, "rewards after").to.eq(0)

                expect(
                    await liquidator.purchasedAssets(0, rewards1.address, asset1.address, vault2.address),
                    "vault 2 reward 1 asset 1",
                ).to.eq(0)
                expect(
                    await liquidator.purchasedAssets(0, rewards1.address, asset2.address, vault2.address),
                    "vault 2 reward 1 asset 2",
                ).to.eq(asset2Amount)
            })
            it("reward 2 to asset 1 for vault 1", async () => {
                // Supply assets for the swap
                const rewardsAmount = vault1reward2
                const asset1Amount = rewardsAmount.mul(3e12)
                await asset1.transfer(syncSwapper.address, asset1Amount)

                const tx = await liquidator.connect(sa.keeper.signer).swap(rewards2.address, asset1.address, asset1Amount, "0x")

                await expect(tx).to.emit(liquidator, "Swapped").withArgs(0, rewardsAmount, asset1Amount)
                await expect(tx, "reward 1").to.emit(rewards2, "Transfer").withArgs(liquidator.address, syncSwapper.address, rewardsAmount)
                await expect(tx, "asset 1").to.emit(asset1, "Transfer").withArgs(syncSwapper.address, liquidator.address, asset1Amount)

                const pending = await liquidator.pendingRewards(rewards2.address, asset1.address)
                expect(pending.batch, "batch after").to.eq(1)
                expect(pending.rewards, "rewards after").to.eq(0)

                expect(
                    await liquidator.purchasedAssets(0, rewards2.address, asset1.address, vault1.address),
                    "vault 1 reward 2 asset 1",
                ).to.eq(asset1Amount)
                expect(
                    await liquidator.purchasedAssets(0, rewards2.address, asset1.address, vault2.address),
                    "vault 2 reward 2 asset 1",
                ).to.eq(0)
                expect(
                    await liquidator.purchasedAssets(0, rewards2.address, asset1.address, vault2.address),
                    "vault 2 reward 2 asset 2",
                ).to.eq(0)
                expect(
                    await liquidator.purchasedAssets(0, rewards2.address, asset1.address, vault3.address),
                    "vault 3 reward 2 asset 1",
                ).to.eq(0)
            })
        })
        context("swap a second time", async () => {
            before(async () => {
                await setup()
                await rewards1.transfer(vault1.address, vault1reward1)
                await rewards2.transfer(vault1.address, vault1reward2)
                await rewards3.transfer(vault1.address, vault1reward3)

                await rewards1.transfer(vault2.address, vault2reward1)
                await rewards3.transfer(vault2.address, vault2reward3)

                await rewards1.transfer(vault3.address, vault3reward1)

                await liquidator.collectRewards([vault1.address, vault2.address, vault3.address])

                // Supply assets for the swap
                const reward1Amount = vault1reward1.add(vault3reward1)
                const asset1Amount = reward1Amount.mul(2).add(vault1reward2.mul(3e12)).add(vault1reward3.mul(4e6))
                await asset1.transfer(syncSwapper.address, asset1Amount)
                const asset2Amount = vault2reward1.mul(2).div(1e13).add(vault2reward3.mul(4).div(7))
                await asset2.transfer(syncSwapper.address, asset2Amount)

                // Swap everything from the first batch
                await liquidator.connect(sa.keeper.signer).swap(rewards1.address, asset1.address, 0, "0x")
                await liquidator.connect(sa.keeper.signer).swap(rewards2.address, asset1.address, 0, "0x")
                await liquidator.connect(sa.keeper.signer).swap(rewards3.address, asset1.address, 0, "0x")
                await liquidator.connect(sa.keeper.signer).swap(rewards1.address, asset2.address, 0, "0x")
                await liquidator.connect(sa.keeper.signer).swap(rewards3.address, asset2.address, 0, "0x")

                // rewards are a quarter in the second batch
                await rewards1.transfer(vault1.address, vault1reward1.div(4))
                await rewards1.transfer(vault2.address, vault2reward1.div(4))
                await rewards1.transfer(vault3.address, vault3reward1.div(4))

                await liquidator.collectRewards([vault1.address, vault2.address, vault3.address])
            })
            it("reward 1 to asset 1 for vaults 1 and 3", async () => {
                const rewardsAmount = vault1reward1.add(vault3reward1).div(4)
                const assetAmount = rewardsAmount.mul(2)
                await asset1.transfer(syncSwapper.address, assetAmount)

                const tx = await liquidator.connect(sa.keeper.signer).swap(rewards1.address, asset1.address, assetAmount, "0x")

                await expect(tx).to.emit(liquidator, "Swapped").withArgs(1, rewardsAmount, assetAmount)
                await expect(tx, "reward 1").to.emit(rewards1, "Transfer").withArgs(liquidator.address, syncSwapper.address, rewardsAmount)
                await expect(tx, "asset 1").to.emit(asset1, "Transfer").withArgs(syncSwapper.address, liquidator.address, assetAmount)

                const pending = await liquidator.pendingRewards(rewards1.address, asset1.address)
                expect(pending.batch, "batch after").to.eq(2)
                expect(pending.rewards, "rewards after").to.eq(0)

                expect(
                    await liquidator.purchasedAssets(0, rewards1.address, asset1.address, vault1.address),
                    "vault 1 reward 1 asset 1 batch 1",
                ).to.eq(vault1reward1.mul(2))
                expect(
                    await liquidator.purchasedAssets(1, rewards1.address, asset1.address, vault1.address),
                    "vault 1 reward 1 asset 1 batch 2",
                ).to.eq(vault1reward1.mul(2).div(4))
                expect(
                    await liquidator.purchasedAssets(0, rewards1.address, asset1.address, vault3.address),
                    "vault 3 reward 1 asset 1 batch 1",
                ).to.eq(vault3reward1.mul(2))
                expect(
                    await liquidator.purchasedAssets(1, rewards1.address, asset1.address, vault3.address),
                    "vault 3 reward 1 asset 1 batch 2",
                ).to.eq(vault3reward1.mul(2).div(4))
            })
            it("reward 1 to asset 2 for vaults 2", async () => {
                const rewardsAmount = vault2reward1.div(4)
                const assetAmount = rewardsAmount.mul(2).div(1e13)
                await asset1.transfer(syncSwapper.address, assetAmount)

                const tx = await liquidator.connect(sa.keeper.signer).swap(rewards1.address, asset2.address, assetAmount, "0x")

                await expect(tx).to.emit(liquidator, "Swapped").withArgs(1, rewardsAmount, assetAmount)
                await expect(tx, "reward 1").to.emit(rewards1, "Transfer").withArgs(liquidator.address, syncSwapper.address, rewardsAmount)
                await expect(tx, "asset 2").to.emit(asset2, "Transfer").withArgs(syncSwapper.address, liquidator.address, assetAmount)

                const pending = await liquidator.pendingRewards(rewards1.address, asset2.address)
                expect(pending.batch, "batch after").to.eq(2)
                expect(pending.rewards, "rewards after").to.eq(0)

                expect(
                    await liquidator.purchasedAssets(0, rewards1.address, asset2.address, vault2.address),
                    "vault 2 reward 1 asset 3 batch 1",
                ).to.eq(vault2reward1.mul(2).div(1e13))
                expect(
                    await liquidator.purchasedAssets(1, rewards1.address, asset2.address, vault2.address),
                    "vault 2 reward 1 asset 2 batch 2",
                ).to.eq(assetAmount)
            })
        })
        describe("failed as", () => {
            const asset1Amount = vault3reward1.mul(2)
            before(async () => {
                await setup()
                await rewards1.transfer(vault3.address, vault3reward1)
                await liquidator.collectRewards([vault3.address])
                await asset1.transfer(syncSwapper.address, asset1Amount)
            })
            it("not keep or governor", async () => {
                const tx = liquidator.connect(sa.default.signer).swap(rewards1.address, asset1.address, asset1Amount, "0x")
                await expect(tx).to.revertedWith(ERROR.ONLY_KEEPER_GOVERNOR)
            })
            it("not enough assets", async () => {
                // this error is coming from BasicDexSwap but testing the min is passed to the IDexSwap
                const tx = liquidator.connect(sa.keeper.signer).swap(rewards1.address, asset1.address, asset1Amount.add(1), "0x")
                await expect(tx).to.revertedWith(ERROR.NOT_ENOUGH_ASSETS)
            })
            it("invalid reward", async () => {
                const tx = liquidator.connect(sa.keeper.signer).swap(asset1.address, asset2.address, asset1Amount, "0x")
                await expect(tx).to.revertedWith(ERROR.INVALID_SWAP)
            })
            it("reentrant call", async () => {
                await liquidator.connect(sa.governor.signer).setSyncSwapper(syncSwapperMalicious.address)
                const tx = liquidator.connect(sa.keeper.signer).swap(rewards1.address, asset1.address, 0, "0x")
                await expect(tx).to.revertedWith(ERROR.REENTRY_GARD)
                await liquidator.connect(sa.governor.signer).setSyncSwapper(syncSwapper.address)
            })
            it("no reward", async () => {
                // successfully swap so a new liquidation is created with no rewards
                await liquidator.connect(sa.keeper.signer).swap(rewards1.address, asset1.address, asset1Amount, "0x")
                const tx = liquidator.connect(sa.keeper.signer).swap(rewards1.address, asset1.address, 0, "0x")
                await expect(tx).to.revertedWith(ERROR.NO_PENDING_REWARDS)
            })
        })
    })
    describe("async swap rewards for assets", () => {
        it("before rewards are collected", async () => {
            await setup()

            const tx = liquidator.connect(sa.keeper.signer).initiateSwap(rewards1.address, asset1.address, "0x")

            await expect(tx).to.revertedWith(ERROR.INVALID_SWAP)
        })
        it("from single vault with single reward", async () => {
            await setup()
            const asset1Amount = vault3reward1.mul(2)
            await rewards1.transfer(vault3.address, vault3reward1)
            await liquidator.collectRewards([vault3.address])
            const swapFromReward1ToAsset1: DexSwapData = {
                fromAsset: rewards1.address,
                fromAssetAmount: vault3reward1,
                toAsset: asset1.address,
                minToAssetAmount: asset1Amount,
                data: encodeInitiateSwap("0x3132333431"),
            }
            const pendingRewardsBefore = await liquidator.pendingRewards(rewards1.address, asset1.address)
            await verifyAsyncSwap(swapFromReward1ToAsset1)
            const pending = await liquidator.pendingRewards(rewards1.address, asset1.address)
            expect(pending.batch, "batch after").to.eq(pendingRewardsBefore.batch.add(1))
            expect(pending.rewards, "rewards after").to.eq(0)

            expect(await liquidator.purchasedAssets(0, rewards1.address, asset1.address, vault1.address), "vault1 purchased assets").to.eq(
                0,
            )
            expect(await liquidator.purchasedAssets(0, rewards1.address, asset1.address, vault3.address), "vault3 purchased assets").to.eq(
                asset1Amount,
            )
        })
        it("retry from single vault with single reward", async () => {
            await setup()
            const asset1Amount = vault3reward1.mul(2)
            await rewards1.transfer(vault3.address, vault3reward1)
            await liquidator.collectRewards([vault3.address])
            const swapFromReward1ToAsset1: DexSwapData = {
                fromAsset: rewards1.address,
                fromAssetAmount: vault3reward1,
                toAsset: asset1.address,
                minToAssetAmount: asset1Amount,
                data: encodeInitiateSwap("0x3132333431", false),
            }
            const pendingRewardsBefore = await liquidator.pendingRewards(rewards1.address, asset1.address)

            // No transfer , just signing
            await verifyAsyncSwap(swapFromReward1ToAsset1)

            // Transfer and simulate swap
            await verifyAsyncSwap({ ...swapFromReward1ToAsset1, data: encodeInitiateSwap("0x3132333431", true) })

            const pending = await liquidator.pendingRewards(rewards1.address, asset1.address)
            expect(pending.batch, "batch after").to.eq(pendingRewardsBefore.batch.add(1))
            expect(pending.rewards, "rewards after").to.eq(0)

            expect(await liquidator.purchasedAssets(0, rewards1.address, asset1.address, vault1.address), "vault1 purchased assets").to.eq(
                0,
            )
            expect(await liquidator.purchasedAssets(0, rewards1.address, asset1.address, vault3.address), "vault3 purchased assets").to.eq(
                asset1Amount,
            )
        })
        context("from multiple vaults with multiple rewards", async () => {
            before(async () => {
                await setup()
                await rewards1.transfer(vault1.address, vault1reward1)
                await rewards2.transfer(vault1.address, vault1reward2)
                await rewards3.transfer(vault1.address, vault1reward3)

                await rewards1.transfer(vault2.address, vault2reward1)
                await rewards3.transfer(vault2.address, vault2reward3)

                await rewards1.transfer(vault3.address, vault3reward1)

                await liquidator.collectRewards([vault1.address, vault2.address, vault3.address])
            })
            it("reward 1 to asset 1 for vaults 1 and 3", async () => {
                // Supply assets for the swap
                const rewardsAmount = vault1reward1.add(vault3reward1)
                const asset1Amount = rewardsAmount.mul(2)
                await asset1.transfer(asyncSwapper.address, asset1Amount)

                const swapFromReward1ToAsset1: DexSwapData = {
                    fromAsset: rewards1.address,
                    fromAssetAmount: rewardsAmount,
                    toAsset: asset1.address,
                    minToAssetAmount: asset1Amount,
                    data: encodeInitiateSwap("0x3132333431"),
                }
                await verifyAsyncSwaps([swapFromReward1ToAsset1])

                const pending = await liquidator.pendingRewards(rewards1.address, asset1.address)
                expect(pending.batch, "batch after").to.eq(1)
                expect(pending.rewards, "rewards after").to.eq(0)

                expect(
                    await liquidator.purchasedAssets(0, rewards1.address, asset1.address, vault1.address),
                    "vault 1 reward 1 asset 1",
                ).to.eq(vault1reward1.mul(2))
                expect(
                    await liquidator.purchasedAssets(0, rewards2.address, asset1.address, vault1.address),
                    "vault 1 reward 2 asset 1",
                ).to.eq(0)
                expect(
                    await liquidator.purchasedAssets(0, rewards1.address, asset1.address, vault2.address),
                    "vault 2 reward 1 asset 1",
                ).to.eq(0)
                expect(
                    await liquidator.purchasedAssets(0, rewards1.address, asset2.address, vault2.address),
                    "vault 2 reward 1 asset 2",
                ).to.eq(0)
                expect(
                    await liquidator.purchasedAssets(0, rewards1.address, asset1.address, vault3.address),
                    "vault 3 reward 1 asset 1",
                ).to.eq(vault3reward1.mul(2))
                expect(
                    await liquidator.purchasedAssets(0, rewards3.address, asset1.address, vault3.address),
                    "vault 3 reward 3 asset 1",
                ).to.eq(0)
            })
            it("reward 1 to asset 2 for vault 2", async () => {
                // Supply assets for the swap
                const rewardsAmount = vault2reward1
                const asset2Amount = vault2reward1.mul(2).div(1e13)

                const swapFromReward1ToAsset2: DexSwapData = {
                    fromAsset: rewards1.address,
                    fromAssetAmount: rewardsAmount,
                    toAsset: asset2.address,
                    minToAssetAmount: asset2Amount,
                    data: encodeInitiateSwap("0x3132333431"),
                }
                await verifyAsyncSwap(swapFromReward1ToAsset2)

                const pending = await liquidator.pendingRewards(rewards1.address, asset2.address)
                expect(pending.batch, "batch after").to.eq(1)
                expect(pending.rewards, "rewards after").to.eq(0)

                expect(
                    await liquidator.purchasedAssets(0, rewards1.address, asset1.address, vault2.address),
                    "vault 2 reward 1 asset 1",
                ).to.eq(0)
                expect(
                    await liquidator.purchasedAssets(0, rewards1.address, asset2.address, vault2.address),
                    "vault 2 reward 1 asset 2",
                ).to.eq(asset2Amount)
            })
            it("reward 2 to asset 1 for vault 1", async () => {
                // Supply assets for the swap
                const rewardsAmount = vault1reward2
                const asset1Amount = rewardsAmount.mul(3e12)

                const swapFromReward2ToAsset1: DexSwapData = {
                    fromAsset: rewards2.address,
                    fromAssetAmount: rewardsAmount,
                    toAsset: asset1.address,
                    minToAssetAmount: asset1Amount,
                    data: encodeInitiateSwap("0x3132333431"),
                }
                await verifyAsyncSwap(swapFromReward2ToAsset1)

                const pending = await liquidator.pendingRewards(rewards2.address, asset1.address)
                expect(pending.batch, "batch after").to.eq(1)
                expect(pending.rewards, "rewards after").to.eq(0)

                expect(
                    await liquidator.purchasedAssets(0, rewards2.address, asset1.address, vault1.address),
                    "vault 1 reward 2 asset 1",
                ).to.eq(asset1Amount)
                expect(
                    await liquidator.purchasedAssets(0, rewards2.address, asset1.address, vault2.address),
                    "vault 2 reward 2 asset 1",
                ).to.eq(0)
                expect(
                    await liquidator.purchasedAssets(0, rewards2.address, asset1.address, vault2.address),
                    "vault 2 reward 2 asset 2",
                ).to.eq(0)
                expect(
                    await liquidator.purchasedAssets(0, rewards2.address, asset1.address, vault3.address),
                    "vault 3 reward 2 asset 1",
                ).to.eq(0)
            })
        })
        context("swap a second time", async () => {
            before(async () => {
                await setup()
                await rewards1.transfer(vault1.address, vault1reward1)
                await rewards2.transfer(vault1.address, vault1reward2)
                await rewards3.transfer(vault1.address, vault1reward3)

                await rewards1.transfer(vault2.address, vault2reward1)
                await rewards3.transfer(vault2.address, vault2reward3)

                await rewards1.transfer(vault3.address, vault3reward1)

                await liquidator.collectRewards([vault1.address, vault2.address, vault3.address])

                // Supply assets for the swap
                const reward1Amount = vault1reward1.add(vault3reward1)
                // Swap everything from the first batch
                const swapFromReward1ToAsset1: DexSwapData = {
                    fromAsset: rewards1.address,
                    fromAssetAmount: (await liquidator.pendingRewards(rewards1.address, asset1.address)).rewards,
                    toAsset: asset1.address,
                    minToAssetAmount: reward1Amount.mul(2),
                    data: encodeInitiateSwap("0x3132333431"),
                }
                const swapFromReward2ToAsset1 = {
                    ...swapFromReward1ToAsset1,
                    fromAssetAmount: (await liquidator.pendingRewards(rewards2.address, asset1.address)).rewards,
                    minToAssetAmount: vault1reward2.mul(3e12),
                    fromAsset: rewards2.address,
                }
                const swapFromReward3ToAsset1 = {
                    ...swapFromReward1ToAsset1,
                    fromAssetAmount: (await liquidator.pendingRewards(rewards3.address, asset1.address)).rewards,
                    minToAssetAmount: vault1reward3.mul(4e6),
                    fromAsset: rewards3.address,
                }
                const swapFromReward1ToAsset2 = {
                    ...swapFromReward1ToAsset1,
                    fromAssetAmount: (await liquidator.pendingRewards(rewards1.address, asset2.address)).rewards,
                    minToAssetAmount: vault2reward1.mul(2).div(1e13),
                    toAsset: asset2.address,
                }
                const swapFromReward3ToAsset2 = {
                    ...swapFromReward1ToAsset2,
                    fromAssetAmount: (await liquidator.pendingRewards(rewards3.address, asset2.address)).rewards,
                    minToAssetAmount: BN.from("24000000000"),
                    fromAsset: rewards3.address,
                }

                await verifyAsyncSwap(swapFromReward1ToAsset1)
                await verifyAsyncSwap(swapFromReward2ToAsset1)
                await verifyAsyncSwap(swapFromReward3ToAsset1)
                await verifyAsyncSwap(swapFromReward1ToAsset2)
                await verifyAsyncSwap(swapFromReward3ToAsset2)

                // rewards are a quarter in the second batch
                await rewards1.transfer(vault1.address, vault1reward1.div(4))
                await rewards1.transfer(vault2.address, vault2reward1.div(4))
                await rewards1.transfer(vault3.address, vault3reward1.div(4))

                await liquidator.collectRewards([vault1.address, vault2.address, vault3.address])
            })
            it("reward 1 to asset 1 for vaults 1 and 3", async () => {
                const rewardsAmount = vault1reward1.add(vault3reward1).div(4)
                const assetAmount = rewardsAmount.mul(2)
                const swap: DexSwapData = {
                    fromAsset: rewards1.address,
                    fromAssetAmount: rewardsAmount,
                    toAsset: asset1.address,
                    minToAssetAmount: assetAmount,
                    data: encodeInitiateSwap("0x3132333431"),
                }
                await verifyAsyncSwap(swap)
                const pending = await liquidator.pendingRewards(rewards1.address, asset1.address)
                expect(pending.batch, "batch after").to.eq(2)
                expect(pending.rewards, "rewards after").to.eq(0)

                expect(
                    await liquidator.purchasedAssets(0, rewards1.address, asset1.address, vault1.address),
                    "vault 1 reward 1 asset 1 batch 1",
                ).to.eq(vault1reward1.mul(2))
                expect(
                    await liquidator.purchasedAssets(1, rewards1.address, asset1.address, vault1.address),
                    "vault 1 reward 1 asset 1 batch 2",
                ).to.eq(vault1reward1.mul(2).div(4))
                expect(
                    await liquidator.purchasedAssets(0, rewards1.address, asset1.address, vault3.address),
                    "vault 3 reward 1 asset 1 batch 1",
                ).to.eq(vault3reward1.mul(2))
                expect(
                    await liquidator.purchasedAssets(1, rewards1.address, asset1.address, vault3.address),
                    "vault 3 reward 1 asset 1 batch 2",
                ).to.eq(vault3reward1.mul(2).div(4))
            })
            it("reward 1 to asset 2 for vaults 2", async () => {
                const rewardsAmount = vault2reward1.div(4)
                const assetAmount = rewardsAmount.mul(2).div(1e13)
                const swap: DexSwapData = {
                    fromAsset: rewards1.address,
                    fromAssetAmount: rewardsAmount,
                    toAsset: asset2.address,
                    minToAssetAmount: assetAmount,
                    data: encodeInitiateSwap("0x3132333431"),
                }
                await verifyAsyncSwap(swap)
                const pending = await liquidator.pendingRewards(rewards1.address, asset2.address)
                expect(pending.batch, "batch after").to.eq(2)
                expect(pending.rewards, "rewards after").to.eq(0)

                expect(
                    await liquidator.purchasedAssets(0, rewards1.address, asset2.address, vault2.address),
                    "vault 2 reward 1 asset 3 batch 1",
                ).to.eq(vault2reward1.mul(2).div(1e13))
                expect(
                    await liquidator.purchasedAssets(1, rewards1.address, asset2.address, vault2.address),
                    "vault 2 reward 1 asset 2 batch 2",
                ).to.eq(assetAmount)
            })
        })
        describe("failed as", () => {
            const asset1Amount = vault3reward1.mul(2)
            before(async () => {
                await setup()
                await rewards1.transfer(vault3.address, vault3reward1)
                await liquidator.collectRewards([vault3.address])
            })
            it("initiateSwap not keep or governor", async () => {
                const tx = liquidator.connect(sa.default.signer).initiateSwap(rewards1.address, asset1.address, "0x")
                await expect(tx).to.revertedWith(ERROR.ONLY_KEEPER_GOVERNOR)
            })
            it("initiateSwap invalid reward", async () => {
                const tx = liquidator.connect(sa.keeper.signer).initiateSwap(asset1.address, asset2.address, "0x")
                await expect(tx).to.revertedWith(ERROR.INVALID_SWAP)
            })
            it("initiateSwap no reward", async () => {
                // successfully swap so a new liquidation is created with no rewards
                const swap: DexSwapData = {
                    fromAsset: rewards1.address,
                    fromAssetAmount: (await liquidator.pendingRewards(rewards1.address, asset1.address)).rewards,
                    toAsset: asset1.address,
                    minToAssetAmount: asset1Amount,
                    data: encodeInitiateSwap("0x3132333431"),
                }
                await verifyAsyncSwap(swap)
                const tx = liquidator.connect(sa.keeper.signer).initiateSwap(rewards1.address, asset1.address, swap.data)
                await expect(tx).to.revertedWith(ERROR.NO_PENDING_REWARDS)
            })
            it("initiateSwaps not keep or governor", async () => {
                const tx = liquidator.connect(sa.default.signer).initiateSwaps([rewards1.address], [asset1.address], ["0x"])
                await expect(tx).to.revertedWith(ERROR.ONLY_KEEPER_GOVERNOR)
            })
            it("initiateSwaps invalid input", async () => {
                await expect(liquidator.connect(sa.keeper.signer).initiateSwaps([], [asset1.address], ["0x"])).to.revertedWith(
                    ERROR.WRONG_INPUT,
                )
                await expect(liquidator.connect(sa.keeper.signer).initiateSwaps([rewards1.address], [], ["0x"])).to.revertedWith(
                    ERROR.WRONG_INPUT,
                )
                await expect(liquidator.connect(sa.keeper.signer).initiateSwaps([], [asset1.address], [])).to.revertedWith(
                    ERROR.WRONG_INPUT,
                )
                await expect(liquidator.connect(sa.keeper.signer).initiateSwaps([], [], [])).to.revertedWith(ERROR.WRONG_INPUT)
            })
            it("settleSwap not keep or governor", async () => {
                const tx = liquidator.connect(sa.default.signer).settleSwap(rewards1.address, asset1.address, asset1Amount, "0x")
                await expect(tx).to.revertedWith(ERROR.ONLY_KEEPER_GOVERNOR)
            })
            it("settleSwap invalid reward", async () => {
                const tx = liquidator.connect(sa.keeper.signer).settleSwap(asset1.address, asset2.address, asset1Amount, "0x")
                await expect(tx).to.revertedWith(ERROR.INVALID_SWAP)
            })
            it("settleSwap no reward", async () => {
                const tx = liquidator
                    .connect(sa.keeper.signer)
                    .settleSwap(rewards1.address, asset1.address, asset1Amount, encodeInitiateSwap("0x3132333431"))
                await expect(tx).to.revertedWith(ERROR.NO_PENDING_REWARDS)
            })
            it("settleSwaps not keep or governor", async () => {
                const tx = liquidator.connect(sa.default.signer).settleSwaps([asset1.address], [asset2.address], [asset1Amount], ["0x"])
                await expect(tx).to.revertedWith(ERROR.ONLY_KEEPER_GOVERNOR)
            })
            it("settleSwaps invalid input", async () => {
                await expect(liquidator.connect(sa.keeper.signer).settleSwaps([], [asset1.address], [0], ["0x"])).to.revertedWith(
                    ERROR.WRONG_INPUT,
                )
                await expect(liquidator.connect(sa.keeper.signer).settleSwaps([rewards1.address], [], [0], ["0x"])).to.revertedWith(
                    ERROR.WRONG_INPUT,
                )
                await expect(
                    liquidator.connect(sa.keeper.signer).settleSwaps([rewards1.address], [asset1.address], [], ["0x"]),
                ).to.revertedWith(ERROR.WRONG_INPUT)
                await expect(
                    liquidator.connect(sa.keeper.signer).settleSwaps([rewards1.address], [asset1.address], [0], []),
                ).to.revertedWith(ERROR.WRONG_INPUT)
            })
        })
    })
    describe("donate purchased assets", () => {
        // Generic flow is
        // collect rewards -> swap reward -> donate token
        it("to single vault with single reward", async () => {
            await setup()
            const reward1Amount = simpleToExactAmount(1000)
            const asset1Amount = reward1Amount.mul(2)
            await rewards1.transfer(vault3.address, reward1Amount)
            await liquidator.collectRewards([vault3.address])
            await asset1.transfer(syncSwapper.address, asset1Amount)
            await liquidator.connect(sa.keeper.signer).swap(rewards1.address, asset1.address, 0, "0x")

            await assertDonateTokens([asset1], [asset1Amount], [vault3.address])
        })
        it("fails if donate wrong token to underlying vault", async () => {
            let tx = vault1.donate(rewards1.address, ZERO_ADDRESS)
            await expect(tx).to.be.revertedWith(ERROR.DONATE_WRONG_TOKEN)
            tx = vault2.donate(rewards1.address, ZERO_ADDRESS)
            await expect(tx).to.be.revertedWith(ERROR.DONATE_WRONG_TOKEN)
            tx = vault3.donate(rewards1.address, ZERO_ADDRESS)
            await expect(tx).to.be.revertedWith(ERROR.DONATE_WRONG_TOKEN)
        })
        context("from multiple vaults with multiple rewards", async () => {
            const vault1Asset1Amount = vault1reward1.mul(2).add(vault1reward2.mul(3e12)).add(vault1reward3.mul(4e6))

            before(async () => {
                await setup()
                // Transfer reward 1, 2, 3 to vault1
                // rewards1 is swapped for asset 1, rewards2,3 are swapped for asset 1
                await rewards1.transfer(vault1.address, vault1reward1)
                await rewards2.transfer(vault1.address, vault1reward2)
                await rewards3.transfer(vault1.address, vault1reward3)

                // Transfer reward 1, 3 to vault2
                await rewards1.transfer(vault2.address, vault2reward1)
                await rewards3.transfer(vault2.address, vault2reward3)

                await rewards1.transfer(vault3.address, vault3reward1)

                await liquidator.collectRewards([vault1.address, vault2.address, vault3.address])

                // Supply assets for the swaps
                const asset1Amount = vault1Asset1Amount.add(vault3reward1.mul(2))
                const asset2Amount = vault2reward1.mul(2).div(1e13).add(vault2reward3.mul(4).div(1e7))

                await asset1.transfer(syncSwapper.address, asset1Amount)
                await asset2.transfer(syncSwapper.address, asset2Amount)

                await liquidator.connect(sa.keeper.signer).swap(rewards1.address, asset1.address, 0, "0x")
                await liquidator.connect(sa.keeper.signer).swap(rewards2.address, asset1.address, 0, "0x")
                await liquidator.connect(sa.keeper.signer).swap(rewards3.address, asset1.address, 0, "0x")

                await liquidator.connect(sa.keeper.signer).swap(rewards1.address, asset2.address, 0, "0x")
                await liquidator.connect(sa.keeper.signer).swap(rewards3.address, asset2.address, 0, "0x")
            })
            it("reward 1 to asset 1 for vaults 1 and 3", async () => {
                await assertDonateTokens([asset1, asset1], [vault1Asset1Amount, vault3reward1.mul(2)], [vault1.address, vault3.address])
                expect(
                    await liquidator.purchasedAssets(0, rewards1.address, asset1.address, vault1.address),
                    "vault 1 reward 1 asset 1",
                ).to.eq(0)
                expect(
                    await liquidator.purchasedAssets(0, rewards1.address, asset1.address, vault1.address),
                    "vault 3 reward 1 asset 1",
                ).to.eq(0)
            })
            it("reward 1 to asset 2 for vaults 2", async () => {
                const asset2Amount = vault2reward1.mul(2).div(1e13).add(vault2reward3.mul(4).div(1e7))
                await assertDonateTokens([asset2], [asset2Amount], [vault2.address])

                expect(
                    await liquidator.purchasedAssets(0, rewards1.address, asset2.address, vault2.address),
                    "vault 2 reward 1 asset 2",
                ).to.eq(0)
            })
        })
        describe("failed for reward 1, asset 1 and vault 3 as", () => {
            const reward1Amount = simpleToExactAmount(700000)
            const asset1Amount = reward1Amount.mul(2)
            let rewardTokens, purchaseTokens, vaults
            const beforeEachFixture = async function fixture() {
                await setup()
                await rewards1.transfer(vault3.address, reward1Amount)
                const input = await buildDonateTokensInput(sa.default.signer, [vault3.address])
                rewardTokens = input.rewardTokens
                purchaseTokens = input.purchaseTokens
                vaults = input.vaults
            }
            beforeEach(async () => {
                await loadOrExecFixture(beforeEachFixture)
            })
            it("no rewards collected for vault", async () => {
                const tx = liquidator.connect(sa.keeper.signer).donateTokens(rewardTokens, purchaseTokens, vaults)
                await expect(tx).to.revertedWith(ERROR.NOTHING_TO_DONATE)
            })
            it("not swapped for pair", async () => {
                await liquidator.collectRewards([vault3.address])

                const tx = liquidator.connect(sa.keeper.signer).donateTokens(rewardTokens, purchaseTokens, vaults)
                await expect(tx).to.revertedWith(ERROR.NOTHING_TO_DONATE)
            })
            it("already donated for pair", async () => {
                await liquidator.collectRewards([vault3.address])
                await asset1.transfer(syncSwapper.address, asset1Amount)
                await liquidator.connect(sa.keeper.signer).swap(rewards1.address, asset1.address, 0, "0x")
                await assertDonateTokens([asset1], [asset1Amount], [vault3.address])

                const tx = liquidator.connect(sa.keeper.signer).donateTokens(rewardTokens, purchaseTokens, vaults)
                await expect(tx).to.revertedWith(ERROR.NOTHING_TO_DONATE)
            })
            it("not keep or governor", async () => {
                await liquidator.collectRewards([vault3.address])
                await asset1.transfer(syncSwapper.address, asset1Amount)
                await liquidator.connect(sa.keeper.signer).swap(rewards1.address, asset1.address, 0, "0x")
                const tx = liquidator.connect(sa.default.signer).donateTokens(rewardTokens, purchaseTokens, vaults)

                await expect(tx).to.revertedWith(ERROR.ONLY_KEEPER_GOVERNOR)
            })
            it("wrong input pair on reward tokens or purchase tokens", async () => {
                await expect(liquidator.connect(sa.keeper.signer).donateTokens([], purchaseTokens, vaults)).to.revertedWith(
                    ERROR.WRONG_INPUT,
                )
                await expect(liquidator.connect(sa.keeper.signer).donateTokens(rewardTokens, [], vaults)).to.revertedWith(ERROR.WRONG_INPUT)
                await expect(liquidator.connect(sa.keeper.signer).donateTokens(rewardTokens, purchaseTokens, [])).to.revertedWith(
                    ERROR.WRONG_INPUT,
                )
            })
        })
        context("after two batch swapped", async () => {
            const firstReward1Amount = simpleToExactAmount(1000)
            const firstAsset1Amount = firstReward1Amount.mul(2)
            const secondReward1Amount = simpleToExactAmount(3000)
            const secondAsset1Amount = secondReward1Amount.mul(2)
            before(async () => {
                await setup()
                // First batch
                await rewards1.transfer(vault3.address, firstReward1Amount)
                await liquidator.collectRewards([vault3.address])
                await asset1.transfer(syncSwapper.address, firstAsset1Amount)
                await liquidator.connect(sa.keeper.signer).swap(rewards1.address, asset1.address, 0, "0x")
                // second batch
                await rewards1.transfer(vault3.address, secondReward1Amount)
                await liquidator.collectRewards([vault3.address])
                await asset1.transfer(syncSwapper.address, secondAsset1Amount)
                await liquidator.connect(sa.keeper.signer).swap(rewards1.address, asset1.address, 0, "0x")
            })
            it("first batch include all non donated batches", async () => {
                await assertDonateTokens([asset1], [firstAsset1Amount.add(secondAsset1Amount)], [vault3.address])
            })
            it("second batch - nothing to donate", async () => {
                const { rewardTokens, purchaseTokens, vaults } = await buildDonateTokensInput(sa.default.signer, [vault3.address])
                const tx = liquidator.connect(sa.keeper.signer).donateTokens(rewardTokens, purchaseTokens, vaults)
                await expect(tx).to.revertedWith(ERROR.NOTHING_TO_DONATE)
            })
        })
        context("after two batch add new reward", async () => {
            const firstReward1Amount = simpleToExactAmount(1000)
            const firstAsset1Amount = firstReward1Amount.mul(2)
            const secondReward1Amount = simpleToExactAmount(3000)
            const secondReward4Amount = simpleToExactAmount(2000)
            const secondAsset11Amount = secondReward1Amount.mul(2)
            const secondAsset41Amount = secondReward4Amount.mul(2)

            let rewards4: MockERC20
            before(async () => {
                await setup()
                rewards4 = await new MockERC20__factory(sa.default.signer).deploy("Reward 4", "R4", 18, sa.default.address, reward1Total)
                await syncSwapper
                    .connect(sa.keeper.signer)
                    .setRate({ from: rewards4.address, to: asset1.address, rate: simpleToExactAmount(2, 18) }) // R4/A1 2;
            })
            before(async () => {
                // First batch
                await rewards1.transfer(vault3.address, firstReward1Amount)
                await liquidator.collectRewards([vault3.address])
                await asset1.transfer(syncSwapper.address, firstAsset1Amount)
                await liquidator.connect(sa.keeper.signer).swap(rewards1.address, asset1.address, 0, "0x")

                // Given that a reward is added after first batch
                await vault3.connect(sa.governor.signer).addRewards([rewards4.address])

                // second batch
                // now vault 3 collects an extra reward
                await rewards1.transfer(vault3.address, secondReward1Amount)
                await rewards4.transfer(vault3.address, secondReward4Amount)

                await liquidator.collectRewards([vault3.address])
                await asset1.transfer(syncSwapper.address, secondAsset11Amount.add(secondAsset41Amount)) // for reward 1,4

                await liquidator.connect(sa.keeper.signer).swap(rewards1.address, asset1.address, 0, "0x")
                await liquidator.connect(sa.keeper.signer).swap(rewards4.address, asset1.address, 0, "0x")
            })
            it("first batch include all non donated batches", async () => {
                await assertDonateTokens([asset1], [firstAsset1Amount.add(secondAsset11Amount.add(secondAsset41Amount))], [vault3.address])
            })
            it("second batch - nothing to donate", async () => {
                const { rewardTokens, purchaseTokens, vaults } = await buildDonateTokensInput(sa.default.signer, [vault3.address])
                const tx = liquidator.connect(sa.keeper.signer).donateTokens(rewardTokens, purchaseTokens, vaults)
                await expect(tx).to.revertedWith(ERROR.NOTHING_TO_DONATE)
            })
        })
    })
    describe("claim assets", () => {
        it("fails if invalid batch", async () => {
            await expect(liquidator.claimAssets(1000, rewards1.address, asset1.address)).to.be.revertedWith(ERROR.INVALID_BATCH)
        })
        it("to single vault with single reward", async () => {
            await setup()
            const reward1Amount = simpleToExactAmount(1000)
            const asset1Amount = reward1Amount.mul(2)
            await rewards1.transfer(vault3.address, reward1Amount)
            await liquidator.collectRewards([vault3.address])
            await asset1.transfer(syncSwapper.address, asset1Amount)
            await liquidator.connect(sa.keeper.signer).swap(rewards1.address, asset1.address, 0, "0x")

            // simulate a call from a vault
            const tx = liquidator.connect(vault3Account).claimAssets(0, rewards1.address, asset1.address)

            await expect(tx).to.emit(liquidator, "ClaimedAssets").withArgs(asset1Amount)
            await expect(tx, "asset 1").to.emit(asset1, "Transfer").withArgs(liquidator.address, vault3.address, asset1Amount)
        })
        // TODO - add collection for a reward is zero
        context("from multiple vaults with multiple rewards", async () => {
            before(async () => {
                await setup()
                await rewards1.transfer(vault1.address, vault1reward1)
                await rewards2.transfer(vault1.address, vault1reward2)
                await rewards3.transfer(vault1.address, vault1reward3)

                await rewards1.transfer(vault2.address, vault2reward1)
                await rewards3.transfer(vault2.address, vault2reward3)

                await rewards1.transfer(vault3.address, vault3reward1)

                await liquidator.collectRewards([vault1.address, vault2.address, vault3.address])

                // Supply assets for the swaps
                const reward1Amount = vault1reward1.add(vault3reward1)
                const asset1Amount = reward1Amount.mul(2).add(vault1reward2.mul(3e12)).add(vault1reward3.mul(4e6))
                await asset1.transfer(syncSwapper.address, asset1Amount)
                const asset2Amount = vault2reward1.mul(2).div(1e13).add(vault2reward3.mul(4).div(1e7))
                await asset2.transfer(syncSwapper.address, asset2Amount)

                await liquidator.connect(sa.keeper.signer).swap(rewards1.address, asset1.address, 0, "0x")
                await liquidator.connect(sa.keeper.signer).swap(rewards2.address, asset1.address, 0, "0x")
                await liquidator.connect(sa.keeper.signer).swap(rewards3.address, asset1.address, 0, "0x")
                await liquidator.connect(sa.keeper.signer).swap(rewards1.address, asset2.address, 0, "0x")
                await liquidator.connect(sa.keeper.signer).swap(rewards3.address, asset2.address, 0, "0x")
            })
            it("reward 1 to asset 1 for vaults 1 and 3", async () => {
                // Claim for vault 1
                let tx = await liquidator.connect(vault1Account).claimAssets(0, rewards1.address, asset1.address)

                await expect(tx).to.emit(liquidator, "ClaimedAssets").withArgs(vault1reward1.mul(2))
                await expect(tx, "asset 1").to.emit(asset1, "Transfer").withArgs(liquidator.address, vault1.address, vault1reward1.mul(2))

                // Claim for vault 3
                tx = await liquidator.connect(vault3Account).claimAssets(0, rewards1.address, asset1.address)

                await expect(tx).to.emit(liquidator, "ClaimedAssets").withArgs(vault3reward1.mul(2))

                await expect(tx, "asset 1").to.emit(asset1, "Transfer").withArgs(liquidator.address, vault3.address, vault3reward1.mul(2))

                expect(
                    await liquidator.purchasedAssets(0, rewards1.address, asset1.address, vault1.address),
                    "vault 1 reward 1 asset 1",
                ).to.eq(0)
                expect(
                    await liquidator.purchasedAssets(0, rewards1.address, asset1.address, vault1.address),
                    "vault 3 reward 1 asset 1",
                ).to.eq(0)
            })
            it("reward 1 to asset 2 for vaults 2", async () => {
                const tx = await liquidator.connect(vault2Account).claimAssets(0, rewards1.address, asset2.address)

                const assetAmount = vault2reward1.mul(2).div(1e13)
                await expect(tx).to.emit(liquidator, "ClaimedAssets").withArgs(assetAmount)
                await expect(tx, "asset 2").to.emit(asset2, "Transfer").withArgs(liquidator.address, vault2.address, assetAmount)

                expect(
                    await liquidator.purchasedAssets(0, rewards1.address, asset2.address, vault2.address),
                    "vault 2 reward 1 asset 2",
                ).to.eq(0)
            })
        })
        describe("failed for reward 1, asset 1 and vault 3 as", () => {
            const reward1Amount = simpleToExactAmount(700000)
            const asset1Amount = reward1Amount.mul(2)

            const beforeEachFixture = async function fixture() {
                await setup()
                await rewards1.transfer(vault3.address, reward1Amount)
            }
            beforeEach(async () => {
                await loadOrExecFixture(beforeEachFixture)
            })
            it("no rewards collected for pair", async () => {
                const tx = liquidator.connect(vault3Account).claimAssets(0, rewards1.address, asset1.address)
                await expect(tx).to.revertedWith(ERROR.INVALID_BATCH)
            })
            it("not swapped for pair", async () => {
                await liquidator.collectRewards([vault3.address])
                const tx = liquidator.connect(vault3Account).claimAssets(0, rewards1.address, asset1.address)
                await expect(tx).to.revertedWith(ERROR.NOT_SWAPPED)
            })
            it("already donated for pair", async () => {
                await liquidator.collectRewards([vault3.address])
                await asset1.transfer(syncSwapper.address, asset1Amount)
                await liquidator.connect(sa.keeper.signer).swap(rewards1.address, asset1.address, 0, "0x")
                await liquidator.connect(vault3Account).claimAssets(0, rewards1.address, asset1.address)

                const tx = liquidator.connect(vault3Account).claimAssets(0, rewards1.address, asset1.address)
                await expect(tx).to.revertedWith(ERROR.ALREADY_DONATED)
            })
            it("not the correct vault", async () => {
                await liquidator.collectRewards([vault3.address])
                await asset1.transfer(syncSwapper.address, asset1Amount)
                await liquidator.connect(sa.keeper.signer).swap(rewards1.address, asset1.address, 0, "0x")
                const tx = liquidator.connect(await impersonate(vault2.address)).claimAssets(0, rewards1.address, asset1.address)

                await expect(tx).to.revertedWith(ERROR.ALREADY_DONATED)
            })
        })
        context("after two batch swapped", async () => {
            const firstReward1Amount = simpleToExactAmount(1000)
            const firstAsset1Amount = firstReward1Amount.mul(2)
            const secondReward1Amount = simpleToExactAmount(3000)
            const secondAsset1Amount = secondReward1Amount.mul(2)
            before(async () => {
                await setup()
                // First batch
                await rewards1.transfer(vault3.address, firstReward1Amount)
                await liquidator.collectRewards([vault3.address])
                await asset1.transfer(syncSwapper.address, firstAsset1Amount)
                await liquidator.connect(sa.keeper.signer).swap(rewards1.address, asset1.address, 0, "0x")
                // second batch
                await rewards1.transfer(vault3.address, secondReward1Amount)
                await liquidator.collectRewards([vault3.address])
                await asset1.transfer(syncSwapper.address, secondAsset1Amount)
                await liquidator.connect(sa.keeper.signer).swap(rewards1.address, asset1.address, 0, "0x")
            })
            it("first batch", async () => {
                const tx = liquidator.connect(vault3Account).claimAssets(0, rewards1.address, asset1.address)

                await expect(tx).to.emit(liquidator, "ClaimedAssets").withArgs(firstAsset1Amount)
                await expect(tx, "asset 1").to.emit(asset1, "Transfer").withArgs(liquidator.address, vault3.address, firstAsset1Amount)
            })
            it("second batch", async () => {
                const tx = liquidator.connect(vault3Account).claimAssets(1, rewards1.address, asset1.address)

                await expect(tx).to.emit(liquidator, "ClaimedAssets").withArgs(secondAsset1Amount)
                await expect(tx, "asset 1").to.emit(asset1, "Transfer").withArgs(liquidator.address, vault3.address, secondAsset1Amount)
            })
        })
    })
    describe("set syncSwapper", async () => {
        it("governor sets a new syncSwapper", async () => {
            const syncSwapperAddress = await liquidator.syncSwapper()
            const tx = await liquidator.connect(sa.governor.signer).setSyncSwapper(sa.dummy1.address)

            await expect(tx).to.emit(liquidator, "SwapperUpdated").withArgs(syncSwapperAddress, sa.dummy1.address)
            expect(await liquidator.syncSwapper()).to.eq(sa.dummy1.address)
        })
        it("keeper fails to set new syncSwapper", async () => {
            const tx = liquidator.connect(sa.keeper.signer).setSyncSwapper(sa.dummy1.address)
            await expect(tx).to.revertedWith(ERROR.ONLY_GOVERNOR)
        })
    })
    describe("set asyncSwapper", async () => {
        it("governor sets a new asyncSwapper", async () => {
            const asyncSwapperAddress = await liquidator.asyncSwapper()

            const tx = await liquidator.connect(sa.governor.signer).setAsyncSwapper(sa.dummy1.address)

            await expect(tx).to.emit(liquidator, "SwapperUpdated").withArgs(asyncSwapperAddress, sa.dummy1.address)
            expect(await liquidator.asyncSwapper()).to.eq(sa.dummy1.address)
        })
        it("keeper fails to set new asyncSwapper", async () => {
            const tx = liquidator.connect(sa.keeper.signer).setAsyncSwapper(sa.dummy1.address)
            await expect(tx).to.revertedWith(ERROR.ONLY_GOVERNOR)
        })
    })
    describe("add reward with 24 decimals", () => {
        let rewards4: MockERC20
        beforeEach(async () => {
            await setup()

            rewards4 = await new MockERC20__factory(sa.default.signer).deploy("Reward 4", "R4", 24, sa.default.address, reward1Total)

            await syncSwapper
                .connect(sa.keeper.signer)
                .setRate({ from: rewards4.address, to: asset1.address, rate: simpleToExactAmount(5, 18) }) // R4/A1 2; 24 -> 18
        })
        it("successfully to vault 1", async () => {
            const tx = await vault1.connect(sa.governor.signer).addRewards([rewards4.address])

            await expect(tx).to.emit(vault1, "RewardAdded").withArgs(rewards4.address, 3)
            expect(await vault1.rewardToken(3), "reward token after").eq(rewards4.address)

            await rewards4.transfer(vault1.address, simpleToExactAmount(100, 24))
            await liquidator.collectRewards([vault3.address])
        })
    })
    describe("approve rewards for async swapper", () => {
        let newRewards: MockERC20
        beforeEach(async () => {
            newRewards = await new MockERC20__factory(sa.default.signer).deploy(
                "New Reward",
                "R4",
                18,
                sa.default.address,
                simpleToExactAmount(1000000),
            )
        })
        it("governor can approve a new token", async () => {
            expect(await newRewards.allowance(liquidator.address, asyncSwapper.address), "allowance before").to.eq(0)

            const tx = await liquidator.connect(sa.governor.signer).approveAsyncSwapper(newRewards.address)

            expect(tx).to.emit(newRewards, "Approval").withArgs(liquidator.address, asyncSwapper.address, ethers.constants.MaxUint256)

            expect(await newRewards.allowance(liquidator.address, asyncSwapper.address), "allowance before").to.eq(
                ethers.constants.MaxUint256,
            )
        })
        it("keeper can not approve new token", async () => {
            expect(await newRewards.allowance(liquidator.address, asyncSwapper.address), "allowance before").to.eq(0)

            const tx = liquidator.connect(sa.keeper.signer).approveAsyncSwapper(newRewards.address)

            await expect(tx).to.revertedWith(ERROR.ONLY_GOVERNOR)
            expect(await newRewards.allowance(liquidator.address, asyncSwapper.address), "allowance before").to.eq(0)
        })
    })
    describe("revoke rewards from async swapper", () => {
        let newRewards: MockERC20
        beforeEach(async () => {
            newRewards = await new MockERC20__factory(sa.default.signer).deploy(
                "New Reward",
                "R4",
                18,
                sa.default.address,
                simpleToExactAmount(1000000),
            )
            await liquidator.connect(sa.governor.signer).approveAsyncSwapper(newRewards.address)
        })
        it("governor can revoke a new token", async () => {
            expect(await newRewards.allowance(liquidator.address, asyncSwapper.address), "allowance before").to.eq(
                ethers.constants.MaxUint256,
            )

            const tx = await liquidator.connect(sa.governor.signer).revokeAsyncSwapper(newRewards.address)

            expect(tx).to.emit(newRewards, "Approval").withArgs(liquidator.address, asyncSwapper.address, 0)

            expect(await newRewards.allowance(liquidator.address, asyncSwapper.address), "allowance before").to.eq(0)
        })
        it("keeper can not approve new token", async () => {
            expect(await newRewards.allowance(liquidator.address, asyncSwapper.address), "allowance before").to.eq(
                ethers.constants.MaxUint256,
            )

            const tx = liquidator.connect(sa.keeper.signer).revokeAsyncSwapper(newRewards.address)

            await expect(tx).to.revertedWith(ERROR.ONLY_GOVERNOR)
            expect(await newRewards.allowance(liquidator.address, asyncSwapper.address), "allowance before").to.eq(
                ethers.constants.MaxUint256,
            )
        })
    })
    describe("rescueToken", async () => {
        async function verifyRescueToken(signer: Signer, asset: MockERC20, amount: BN) {
            const to = await nexus.governor()
            const toBalanceBefore = await asset.balanceOf(to)
            const liquidatorBalanceBefore = await asset.balanceOf(liquidator.address)
            const tx = await liquidator.connect(signer).rescueToken(asset.address, amount)
            // Verify events, storage change, balance, etc.
            await expect(tx).to.emit(asset, "Transfer").withArgs(liquidator.address, to, amount)
            expect(await asset.balanceOf(liquidator.address), "dex assets balance decreased").to.equal(liquidatorBalanceBefore.sub(amount))
            expect(await asset.balanceOf(to), "to assets balance increased").to.equal(toBalanceBefore.add(amount))
        }
        it("sends tokens to the liquidator", async () => {
            asset1.transfer(liquidator.address, simpleToExactAmount(100))
            asset2.transfer(liquidator.address, simpleToExactAmount(100))
        })

        it("rescue multiple tokens", async () => {
            const dexAssetsBalBefore = []
            dexAssetsBalBefore.push(await asset1.balanceOf(liquidator.address))
            dexAssetsBalBefore.push(await asset2.balanceOf(liquidator.address))

            await verifyRescueToken(sa.governor.signer, asset1, dexAssetsBalBefore[0])
            await verifyRescueToken(sa.governor.signer, asset2, dexAssetsBalBefore[1])
        })
        describe("fails", async () => {
            it("if caller is not governor", async () => {
                await expect(liquidator.connect(sa.default.signer).rescueToken(asset1.address, BN.from(1)), "!caller").to.be.revertedWith(
                    ERROR.ONLY_GOVERNOR,
                )
            })
            it("if caller is keeper", async () => {
                await expect(liquidator.connect(sa.keeper.signer).rescueToken(asset1.address, BN.from(1)), "!caller").to.be.revertedWith(
                    ERROR.ONLY_GOVERNOR,
                )
            })
            it("if amount is gt balance", async () => {
                const balance = await asset1.balanceOf(liquidator.address)
                await expect(
                    liquidator.connect(sa.governor.signer).rescueToken(asset1.address, balance.add(1)),
                    "!caller",
                ).to.be.revertedWith("ERC20: transfer amount exceeds balance")
            })
        })
    })
})
