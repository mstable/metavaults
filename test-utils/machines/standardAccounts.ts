import type { Signer } from "ethers"
import type { Account } from "types"

/**
 * @dev Standard accounts
 */
export class StandardAccounts {
    /**
     * @dev Default accounts as per system Migrations
     */
    public all: Account[]

    public default: Account

    public governor: Account

    public keeper: Account

    public vaultManager: Account

    public feeReceiver: Account

    public liquidator: Account

    public other: Account

    public dummy1: Account

    public dummy2: Account

    public dummy3: Account

    public dummy4: Account

    public dummy5: Account

    public alice: Account

    public bob: Account

    public async initAccounts(signers: Signer[], debug = false): Promise<StandardAccounts> {
        this.all = await Promise.all(
            signers.map(async (s) => ({
                signer: s,
                address: await s.getAddress(),
            })),
        )
        ;[
            this.default,
            this.governor,
            this.keeper,
            this.vaultManager,
            this.feeReceiver,
            this.liquidator,
            this.alice,
            this.bob,
            this.other,
            this.dummy1,
            this.dummy2,
            this.dummy3,
            this.dummy4,
            this.dummy5,
        ] = this.all
        // display values, useful when forking
        if (debug) {
            console.table([
                { account: "default", address: this.default.address },
                { account: "governor", address: this.governor.address },
                { account: "keeper", address: this.keeper.address },
                { account: "vaultManager", address: this.vaultManager.address },
                { account: "feeReceiver", address: this.feeReceiver.address },
                { account: "alice", address: this.alice.address },
                { account: "bob", address: this.bob.address },
                { account: "other", address: this.other.address },
                { account: "dummy1", address: this.dummy1.address },
                { account: "dummy2", address: this.dummy2.address },
                { account: "dummy3", address: this.dummy3.address },
                { account: "dummy4", address: this.dummy4.address },
                { account: "dummy5", address: this.dummy5.address },
            ])
        }
        return this
    }
}

export default StandardAccounts
