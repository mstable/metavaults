import { simpleToExactAmount } from "@utils/math"
import {
    DataEmitter__factory,
    MockAggregationRouterV4__factory,
    MockERC20__factory,
    MockGPv2Settlement__factory,
    MockGPv2VaultRelayer__factory,
    MockNexus__factory,
} from "types/generated"

import { DEAD_ADDRESS } from "../constants"

import type { Signer } from "ethers"
import type {
    DataEmitter,
    IAggregationRouterV4,
    MockAggregationRouterV4,
    MockERC20,
    MockGPv2Settlement,
    MockGPv2VaultRelayer,
    MockNexus,
} from "types/generated"

import type { StandardAccounts } from "./standardAccounts"

/**
 * @dev Standard mocks
 */
export class ContractMocks {
    public dataEmitter: DataEmitter

    public nexus: MockNexus

    // 18 decimals
    public dai: MockERC20

    // 6 decimals
    public usdc: MockERC20

    // 12 decimals
    public wbtc: MockERC20

    // 18 decimals
    public erc20: MockERC20

    public router: IAggregationRouterV4

    public async init(sa: StandardAccounts): Promise<ContractMocks> {
        this.dataEmitter = await new DataEmitter__factory(sa.default.signer).deploy()

        this.nexus = await new MockNexus__factory(sa.default.signer).deploy(sa.governor.address)
        await this.nexus.setKeeper(sa.keeper.address)

        this.usdc = await new MockERC20__factory(sa.default.signer).deploy(
            "USDC Mock",
            "USDC",
            6,
            sa.default.address,
            simpleToExactAmount(100000000, 6),
        )
        this.dai = await new MockERC20__factory(sa.default.signer).deploy(
            "DAI Mock",
            "DAI",
            18,
            sa.default.address,
            simpleToExactAmount(100000000),
        )
        this.wbtc = await new MockERC20__factory(sa.default.signer).deploy(
            "wBTC Mock",
            "WBTC",
            12,
            sa.default.address,
            simpleToExactAmount(100000000, 12),
        )
        this.erc20 = await new MockERC20__factory(sa.default.signer).deploy(
            "ERC20 Mock",
            "ERC20",
            18,
            sa.default.address,
            simpleToExactAmount(100000000, 18),
        )

        this.router = undefined

        return this
    }

    static async mockERC20Token(
        signer: Signer,
        initialRecipient: string,
        name = "ERC20 Mock",
        symbol = "ERC20",
        decimals = 18,
        initialMint = simpleToExactAmount(100000000),
    ): Promise<MockERC20> {
        return new MockERC20__factory(signer).deploy(name, symbol, decimals, initialRecipient, initialMint)
    }

    static async mockCowSwapGPv2(signer: Signer): Promise<{ gpv2Settlement: MockGPv2Settlement; gpv2VaultRelayer: MockGPv2VaultRelayer }> {
        const gpv2Settlement = await new MockGPv2Settlement__factory(signer).deploy()
        const gpv2VaultRelayer = await new MockGPv2VaultRelayer__factory(signer).deploy(DEAD_ADDRESS)
        return {
            gpv2Settlement,
            gpv2VaultRelayer,
        }
    }

    static async mockOneInchRouter(signer: Signer): Promise<MockAggregationRouterV4> {
        return new MockAggregationRouterV4__factory(signer).deploy()
    }
}
export default ContractMocks
