import { DEAD_ADDRESS } from "@utils/constants"
import { simpleToExactAmount } from "@utils/math"
import { expect } from "chai"

import type { StandardAccounts } from "@utils/machines"
import type { LiquidatorStreamFeeAbstractVault } from "types/generated"

export interface LiquidatorStreamFeeAbstractVaultBehaviourContext {
    vault: LiquidatorStreamFeeAbstractVault
    sa: StandardAccounts
}
export function shouldBehaveLikeLiquidatorStreamFeeAbstractVault(ctx: LiquidatorStreamFeeAbstractVaultBehaviourContext): void {
    it("initial values", async () => {
        expect(await ctx.vault.FEE_SCALE(), "fee scale").to.eq(simpleToExactAmount(1, 6))
        expect(await ctx.vault.feeReceiver(), "feeReceiver").to.not.eq(0)
        expect(await ctx.vault.donationFee(), "donationFee").to.not.eq(0)
    })
    describe("setFeeReceiver", async () => {
        it("should update value", async () => {
            const feeReceiver = await ctx.vault.connect(ctx.sa.default.signer).feeReceiver()
            const tx = await ctx.vault.connect(ctx.sa.governor.signer).setFeeReceiver(ctx.sa.dummy1.address)
            // Verify events, storage change
            await expect(tx).to.emit(ctx.vault, "FeeReceiverUpdated").withArgs(ctx.sa.dummy1.address)
            // Return previous value
            await ctx.vault.connect(ctx.sa.governor.signer).setFeeReceiver(feeReceiver)
        })
        it("fails if caller is not governor", async () => {
            await expect(ctx.vault.connect(ctx.sa.dummy1.signer).setFeeReceiver(DEAD_ADDRESS), "fails due to ").to.be.revertedWith(
                "Only governor can execute",
            )
        })
    })
}
export default shouldBehaveLikeLiquidatorStreamFeeAbstractVault
