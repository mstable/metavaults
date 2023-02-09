import { DEAD_ADDRESS, ZERO_ADDRESS } from "@utils/constants"
import { ContractMocks, StandardAccounts } from "@utils/machines"
import { expect } from "chai"
import { ethers } from "hardhat"
import { Curve3CrvBasicMetaVault__factory, Curve3PoolCalculatorLibrary__factory } from "types/generated"

import type { MockNexus } from "types/generated"
import type { Curve3CrvBasicMetaVaultLibraryAddresses } from "types/generated/factories/contracts/vault/liquidity/curve/Curve3CrvBasicMetaVault__factory"

describe("Curve3CrvBasicMetaVault", () => {
    /* -- Declare shared variables -- */
    let sa: StandardAccounts
    let mocks: ContractMocks
    let nexus: MockNexus

    // Testing contract
    let curve3PoolCalculatorLibraryAddresses: Curve3CrvBasicMetaVaultLibraryAddresses

    /* -- Declare shared functions -- */
    const setup = async () => {
        const accounts = await ethers.getSigners()
        sa = await new StandardAccounts().initAccounts(accounts)

        mocks = await new ContractMocks().init(sa)
        nexus = mocks.nexus

        const threePoolCalculatorLibrary = await new Curve3PoolCalculatorLibrary__factory(sa.default.signer).deploy()
        curve3PoolCalculatorLibraryAddresses = {
            "contracts/peripheral/Curve/Curve3PoolCalculatorLibrary.sol:Curve3PoolCalculatorLibrary": threePoolCalculatorLibrary.address,
        }
    }
    before("init contract", async () => {
        await setup()
    })

    describe("constructor", async () => {
        it("should fail if asset has zero address", async () => {
            let tx = new Curve3CrvBasicMetaVault__factory(curve3PoolCalculatorLibraryAddresses, sa.default.signer).deploy(
                ZERO_ADDRESS,
                ZERO_ADDRESS,
                ZERO_ADDRESS,
            )
            await expect(tx).to.be.revertedWith("Nexus address is zero")

            tx = new Curve3CrvBasicMetaVault__factory(curve3PoolCalculatorLibraryAddresses, sa.default.signer).deploy(
                nexus.address,
                ZERO_ADDRESS,
                ZERO_ADDRESS,
            )
            await expect(tx).to.be.revertedWith("Asset is zero")

            tx = new Curve3CrvBasicMetaVault__factory(curve3PoolCalculatorLibraryAddresses, sa.default.signer).deploy(
                nexus.address,
                DEAD_ADDRESS,
                ZERO_ADDRESS,
            )
            await expect(tx).to.be.revertedWith("Invalid Vault")
        })
    })
})
