import { ZERO_ADDRESS } from "@utils/constants"
import { expect } from "chai"
import { INexus__factory } from "types/generated"

import type { StandardAccounts } from "@utils/machines"
import type { VaultManagerRole } from "types/generated"

export interface VaultManagerRoleBehaviourContext {
    vaultManagerRole: VaultManagerRole
    sa: StandardAccounts
}

export function shouldBehaveLikeVaultManagerRole(ctx: VaultManagerRoleBehaviourContext): void {
    describe("VaultManagerRole", () => {
        describe("constructor", async () => {
            it("should properly store valid arguments", async () => {
                expect(await ctx.vaultManagerRole.vaultManager(), "vaultManager").to.eq(ctx.sa.vaultManager.address)
            })
        })
        describe("setVaultManager", async () => {
            it("should update the vault manager", async () => {
                expect(await ctx.vaultManagerRole.isVaultManager(ctx.sa.dummy1.address)).to.eq(false)
                const tx = await ctx.vaultManagerRole.connect(ctx.sa.governor.signer).setVaultManager(ctx.sa.dummy1.address)
                // Verify events, storage change, balance, etc.
                await expect(tx).to.emit(ctx.vaultManagerRole, "SetVaultManager").withArgs(ctx.sa.dummy1.address)
                //  revert to previous value
                await ctx.vaultManagerRole.connect(ctx.sa.governor.signer).setVaultManager(ctx.sa.vaultManager.address)
            })
            it("fails if address is the same", async () => {
                expect(await ctx.vaultManagerRole.isVaultManager(ctx.sa.vaultManager.address)).to.eq(true)
                await expect(
                    ctx.vaultManagerRole.connect(ctx.sa.governor.signer).setVaultManager(ctx.sa.vaultManager.address),
                    "fails due to ",
                ).to.be.revertedWith("already vault manager")
            })
            it("fails if address is zero", async () => {
                await expect(
                    ctx.vaultManagerRole.connect(ctx.sa.governor.signer).setVaultManager(ZERO_ADDRESS),
                    "fails due to ",
                ).to.be.revertedWith("zero vault manager")
            })
            it("fails if caller is not governor", async () => {
                await expect(
                    ctx.vaultManagerRole.connect(ctx.sa.default.signer).setVaultManager(ctx.sa.vaultManager.address),
                    "fails due to ",
                ).to.be.revertedWith("Only governor can execute")
            })
        })
        describe("pausable", async () => {
            it("should have Nexus", async () => {
                const nexusAddr = await ctx.vaultManagerRole.nexus()
                expect(nexusAddr).to.not.equal(ZERO_ADDRESS)
            })

            it("should have Governor address", async () => {
                const nexusAddr = await ctx.vaultManagerRole.nexus()
                const nexus = INexus__factory.connect(nexusAddr, ctx.sa.default.signer)

                const nexusGovernor = await nexus.governor()
                expect(nexusGovernor).to.equal(ctx.sa.governor.address)
            })

            it("should not be paused", async () => {
                const paused = await ctx.vaultManagerRole.paused()
                expect(paused).to.eq(false)
            })
            it("should allow pausing and unpausing by governor", async () => {
                // Pause
                let tx = ctx.vaultManagerRole.connect(ctx.sa.governor.signer).pause()
                await expect(tx).to.emit(ctx.vaultManagerRole, "Paused").withArgs(ctx.sa.governor.address)
                // Fail if already paused
                await expect(ctx.vaultManagerRole.connect(ctx.sa.governor.signer).pause()).to.be.revertedWith("Pausable: paused")

                // Unpause
                tx = ctx.vaultManagerRole.connect(ctx.sa.governor.signer).unpause()
                await expect(tx).to.emit(ctx.vaultManagerRole, "Unpaused").withArgs(ctx.sa.governor.address)

                // Fail to unpause twice
                await expect(ctx.vaultManagerRole.connect(ctx.sa.governor.signer).unpause()).to.be.revertedWith("Pausable: not paused")
            })
            it("should fail to pause if non-governor", async () => {
                await expect(ctx.vaultManagerRole.connect(ctx.sa.other.signer).pause()).to.be.revertedWith("Only governor can execute")
            })
        })
    })
}
export default shouldBehaveLikeVaultManagerRole
