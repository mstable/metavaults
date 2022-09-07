import { shouldBehaveLikeVaultManagerRole } from "@test/shared/VaultManagerRole.behaviour"
import { StandardAccounts } from "@utils/machines"
import { expect } from "chai"
import { ethers } from "hardhat"
import { BasicSlippage__factory, MockNexus__factory } from "types/generated"

import type { ContractTransaction } from "ethers"
import type { BasicSlippage, MockNexus, VaultManagerRole } from "types/generated"

const initialSlippage = {
    mint: 99,
    deposit: 101,
    redeem: 11,
    withdraw: 12,
}

describe("BasicSlippage", () => {
    let sa: StandardAccounts
    let nexus: MockNexus
    let slippage: BasicSlippage
    let initTx: ContractTransaction

    before(async () => {
        const accounts = await ethers.getSigners()
        sa = await new StandardAccounts().initAccounts(accounts)
        nexus = await new MockNexus__factory(sa.default.signer).deploy(sa.governor.address)

        slippage = await new BasicSlippage__factory(sa.default.signer).deploy(nexus.address)
        initTx = await slippage.initialize(sa.vaultManager.address, initialSlippage)
    })
    describe("behaviors", async () => {
        shouldBehaveLikeVaultManagerRole(() => ({ vaultManagerRole: slippage as VaultManagerRole, sa }))
    })

    it("post deploy", async () => {
        await expect(initTx).to.emit(slippage, "MintSlippageChange").withArgs(sa.default.address, 99)
        await expect(initTx).to.emit(slippage, "DepositSlippageChange").withArgs(sa.default.address, 101)
        await expect(initTx).to.emit(slippage, "RedeemSlippageChange").withArgs(sa.default.address, 11)
        await expect(initTx).to.emit(slippage, "WithdrawSlippageChange").withArgs(sa.default.address, 12)

        expect(await slippage.mintSlippage(), "mint").to.eq(99)
        expect(await slippage.depositSlippage(), "deposit").to.eq(101)
        expect(await slippage.redeemSlippage(), "redeem").to.eq(11)
        expect(await slippage.withdrawSlippage(), "withdraw").to.eq(12)

        expect(await slippage.BASIS_SCALE(), "basis scale").to.eq(10000)
    })
    it("set mint", async () => {
        const tx = await slippage.connect(sa.governor.signer).setMintSlippage(88)
        await expect(tx).to.emit(slippage, "MintSlippageChange").withArgs(sa.governor.address, 88)
        expect(await slippage.mintSlippage(), "mint").to.eq(88)
        expect(await slippage.depositSlippage(), "deposit").to.eq(101)
        expect(await slippage.redeemSlippage(), "redeem").to.eq(11)
        expect(await slippage.withdrawSlippage(), "withdraw").to.eq(12)
    })
    it("set deposit", async () => {
        const tx = await slippage.connect(sa.governor.signer).setDepositSlippage(89)
        await expect(tx).to.emit(slippage, "DepositSlippageChange").withArgs(sa.governor.address, 89)
        expect(await slippage.depositSlippage(), "deposit").to.eq(89)
    })
    it("set withdraw", async () => {
        const tx = await slippage.connect(sa.governor.signer).setWithdrawSlippage(90)
        await expect(tx).to.emit(slippage, "WithdrawSlippageChange").withArgs(sa.governor.address, 90)
        expect(await slippage.withdrawSlippage(), "withdraw").to.eq(90)
    })
    it("set redeem", async () => {
        const tx = await slippage.connect(sa.governor.signer).setRedeemSlippage(91)
        await expect(tx).to.emit(slippage, "RedeemSlippageChange").withArgs(sa.governor.address, 91)
        expect(await slippage.redeemSlippage(), "redeem").to.eq(91)
    })
})
