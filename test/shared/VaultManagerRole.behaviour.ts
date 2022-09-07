import { ZERO_ADDRESS } from "@utils/constants"
import { expect } from "chai"
import { INexus__factory } from "types/generated"

import { shouldBehaveLikeModule } from "./Module.behaviour"

import type { StandardAccounts } from "@utils/machines"
import type { VaultManagerRole } from "types/generated"

export interface VaultManagerRoleBehaviourContext {
    vaultManagerRole: VaultManagerRole
    sa: StandardAccounts
}

export function shouldBehaveLikeVaultManagerRole(ctx: () => VaultManagerRoleBehaviourContext): void {
    describe("VaultManagerRole", () => {
        describe("constructor", async () => {
            it("should properly store valid arguments", async () => {
                const { sa, vaultManagerRole } = ctx()
                expect(await vaultManagerRole.vaultManager(), "vaultManager").to.eq(sa.vaultManager.address)
            })
        })
        describe("setVaultManager", async () => {
            it("should update the vault manager", async () => {
                const { sa, vaultManagerRole } = ctx()
                expect(await vaultManagerRole.isVaultManager(sa.dummy1.address)).to.eq(false)
                const tx = await vaultManagerRole.connect(sa.governor.signer).setVaultManager(sa.dummy1.address)
                // Verify events, storage change, balance, etc.
                await expect(tx).to.emit(vaultManagerRole, "SetVaultManager").withArgs(sa.dummy1.address)
                //  revert to previous value
                await vaultManagerRole.connect(sa.governor.signer).setVaultManager(sa.vaultManager.address)
            })
            it("fails if address is the same", async () => {
                const { sa, vaultManagerRole } = ctx()
                expect(await vaultManagerRole.isVaultManager(sa.vaultManager.address)).to.eq(true)
                await expect(
                    vaultManagerRole.connect(sa.governor.signer).setVaultManager(sa.vaultManager.address),
                    "fails due to ",
                ).to.be.revertedWith("already vault manager")
            })
            it("fails if address is zero", async () => {
                const { sa, vaultManagerRole } = ctx()
                await expect(
                    vaultManagerRole.connect(sa.governor.signer).setVaultManager(ZERO_ADDRESS),
                    "fails due to ",
                ).to.be.revertedWith("zero vault manager")
            })
            it("fails if caller is not governor", async () => {
                const { sa, vaultManagerRole } = ctx()
                await expect(
                    vaultManagerRole.connect(sa.default.signer).setVaultManager(sa.vaultManager.address),
                    "fails due to ",
                ).to.be.revertedWith("Only governor can execute")
            })
        })
        describe("pausable", async () => {
            it("should have Nexus", async () => {
                const { vaultManagerRole } = ctx()
                const nexusAddr = await vaultManagerRole.nexus()
                expect(nexusAddr).to.not.equal(ZERO_ADDRESS)
            })

            it("should have Governor address", async () => {
                const { sa, vaultManagerRole } = ctx()
                const nexusAddr = await vaultManagerRole.nexus()
                const nexus = INexus__factory.connect(nexusAddr, sa.default.signer)

                const nexusGovernor = await nexus.governor()
                expect(nexusGovernor).to.equal(sa.governor.address)
            })

            it("should not be paused", async () => {
                const { vaultManagerRole } = ctx()
                const paused = await vaultManagerRole.paused()
                expect(paused).to.eq(false)
            })
            it("should allow pausing and unpausing by governor", async () => {
                const { sa, vaultManagerRole } = ctx()
                // Pause
                let tx = vaultManagerRole.connect(sa.governor.signer).pause()
                await expect(tx).to.emit(vaultManagerRole, "Paused").withArgs(sa.governor.address)
                // Fail if already paused
                await expect(vaultManagerRole.connect(sa.governor.signer).pause()).to.be.revertedWith("Pausable: paused")

                // Unpause
                tx = vaultManagerRole.connect(sa.governor.signer).unpause()
                await expect(tx).to.emit(vaultManagerRole, "Unpaused").withArgs(sa.governor.address)

                // Fail to unpause twice
                await expect(vaultManagerRole.connect(sa.governor.signer).unpause()).to.be.revertedWith("Pausable: not paused")
            })
            it("should fail to pause if non-governor", async () => {
                const { sa, vaultManagerRole } = ctx()
                await expect(vaultManagerRole.connect(sa.other.signer).pause()).to.be.revertedWith("Only governor can execute")
            })
        })
        it("should behave like Module ", async () => {
            shouldBehaveLikeModule({ module: ctx().vaultManagerRole, sa: ctx().sa })
        })
    })
}
export default shouldBehaveLikeVaultManagerRole
