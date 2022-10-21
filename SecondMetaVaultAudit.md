# Second Meta Vaults Security Audit

Scope of the security audit of [mStable](https://mstable.org/)'s new Meta Vaults, October 2022.

# Logic

See [3Crv Convex Vaults](./3CrvConvexVaults.md) for an explanation of what the different vaults do and how value flows between them.

# Code

Only the high risk contracts will be audited. Simpler contracts that have been previously audited are out of scope given the tight timeframes.

All code is in the [metavaults](https://github.com/mstable/metavaults) private repository with tag [v0.0.3](https://github.com/mstable/metavaults/tree/v0.0.3).

# Contract scope

All contract are under the [contracts](./contracts/) folder.

## In scope

-   [peripheral](./contracts/peripheral/)
    -   [Cowswap](./contracts/peripheral/Cowswap) the [CowSwapSeller](./contracts/peripheral/Cowswap/CowSwapSeller.sol) contract that integrates with CoW Swap.
-   [shares](./contracts/shared/) just the [SingleSlotMapper](./contracts/shared/SingleSlotMapper.sol) contract as it has not been audited. The others have been through multiple audits.
-   [vault](./contracts/vault) all vault contract except the ones listed below in the out of scope section. 
    - [swap](./contracts/vault/swap/) only [CowSwapDex](./contracts/vault/swap/CowSwapDex.sol) is in scope.

## Out of scope

Any contracts in the following are out of scope as they have previously been audited or are just used for testing.

-   [governance](./contracts/governance) all out of scope as perviously audited.
-   [interfaces](./contracts/interfaces) contract interfaces.
-   [nexus](./contracts/nexus) all out of scope as perviously audited.
-   [peripheral](./contracts/peripheral/)
    -   [Convex](./contracts/peripheral/Convex) are just interfaces.
    -   [Curve](./contracts/peripheral/Curve) are interfaces, libraries or testing contracts. The libraries are ports of Curve's Vyper code with gas optimizations. They are stateless so are not a high risk of containing security issues. Given their logic complexity and they have previously been audited, they are out of scope of this audit.
    -   [OneInch](./contracts/peripheral/OneInch) are just interfaces and will not be initially used.
-   [token](./contracts/tokens) all out scope as perviously audited.
-   [upgradability](./contracts/upgradability) all out of scope as perviously audited.
-   [vault](./contracts/vault) any BasicVaults are out of scope as they are just used for testing. Specifically, `PeriodicAllocationBasicVault`, `SameAssetUnderlyingsBasicVault`, `PerfFeeBasicVault`, `LiquidatorBasicVault`, `LiquidatorStreamBasicVault`, `LiquidatorStreamFeeBasicVault`, `Convex3CrvBasicVault`, `Curve3CrvBasicMetaVault` and `BasicSlippage` are all out of scope.
    -   [swap](./contracts/vault/swap/) contracts [BasicDexSwap](./contracts/vault/swap/BasicDexSwap.sol) and [OneInchDexSwap](./contracts/vault/swap/OneInchDexSwap.sol) are out of scope.
-   [z_mocks](./contracts/z_mocks/) are just used for unit testing.
-   [BasicVault](./contracts/vault/BasicVault.sol) and [LightBasicVault](./contracts/vault/LightBasicVault.sol) are out of scope.

# Mainnet Contracts

| Contract | Address| 
|---|---|
|CowSwapDex | [0x8E9A9a122F402CD98727128BaF3dCCAF05189B67](https://etherscan.io/address/0x8E9A9a122F402CD98727128BaF3dCCAF05189B67) |
| Liquidator Impl | [0x56c358d4E8f9b678fc24a8Cc4aA02c02A1393fAD](https://etherscan.io/address/0x56c358d4E8f9b678fc24a8Cc4aA02c02A1393fAD) |
| Liquidator Proxy | [0xD298291059aed77686037aEfFCf497A321A4569e](https://etherscan.io/address/0xD298291059aed77686037aEfFCf497A321A4569e) |
| Curve3CrvMetapoolCalculatorLibrary | [0x5de8865522A61FC9bf2A3ca1A7D196A42863Ea56](https://etherscan.io/address/0x5de8865522A61FC9bf2A3ca1A7D196A42863Ea56) |
| Curve3CrvFactoryMetapoolCalculatorLibrary | [0x3206bf36B1e1764B4C40c5A51A8E237DC4cB10a9](https://etherscan.io/address/0x3206bf36B1e1764B4C40c5A51A8E237DC4cB10a9) |
| Curve3CrvCalculatorLibrary | [0x092C1b41163c85054F008A486BA72347B919aFa7](https://etherscan.io/address/0x092C1b41163c85054F008A486BA72347B919aFa7) |
| FRAX Convex Vault impl | [0x6DE3703418A075481c7ce01199B8e8F82C129485](https://etherscan.io/address/0x6DE3703418A075481c7ce01199B8e8F82C129485) |
| FRAX Convex Vault proxy | [0x98c5910823C2E67d54e4e0C03de44043DbfA7ca8](https://etherscan.io/address/0x98c5910823C2E67d54e4e0C03de44043DbfA7ca8) |
| mUSD Convex Vault impl | [0xa79e8e15dfd58cd5a93ed3f00bbbbe303f2a0cd8](https://etherscan.io/address/0xa79e8e15dfd58cd5a93ed3f00bbbbe303f2a0cd8) |
| mUSD Convex Vault proxy | [0xB9B47E72819934d7A5d60Bf08cD2C78072383EBb](https://etherscan.io/address/0xB9B47E72819934d7A5d60Bf08cD2C78072383EBb) |
| BUSD Convex Vault impl | [0xCd619AADd1DD2e423D1f3C725a25296c7a74281a](https://etherscan.io/address/0xCd619AADd1DD2e423D1f3C725a25296c7a74281a) |
| BUSD Convex Vault proxy | [0x87Ed92648fAE3b3930577c92c8A247b127ED8949](https://etherscan.io/address/0x87Ed92648fAE3b3930577c92c8A247b127ED8949) |
| 3Crv Meta Vault impl | [0xe3CEab97Fb4289f3A4C979E74D20c90Ab16e1F7d](https://etherscan.io/address/0xe3CEab97Fb4289f3A4C979E74D20c90Ab16e1F7d) |
| 3Crv Meta Vault proxy | [0x9614a4C61E45575b56c7e0251f63DCDe797d93C5](https://etherscan.io/address/0x9614a4C61E45575b56c7e0251f63DCDe797d93C5) |
| USDC 3CRV Convex Meta Vault impl | [0x6d68F5b8c22A549334ca85960978f9dE4DebA2D3](https://etherscan.io/address/0x6d68F5b8c22A549334ca85960978f9dE4DebA2D3) |
| USDC 3CRV Convex Meta Vault proxy | [0x455fB969dC06c4Aa77e7db3f0686CC05164436d2](https://etherscan.io/address/0x455fB969dC06c4Aa77e7db3f0686CC05164436d2) |


# Third Party Dependencies

## Contract Libraries

-   [OpenZeppelin](https://www.openzeppelin.com/contracts) is used for ERC20 tokens, access control, initialization, reentry protection, proxies, casting and math operations.

## Protocols

-   [Curve Finance](https://curve.fi/) used to generate yield on stablecoin deposits.
-   [Convex Finance](https://www.convexfinance.com/) used to enhance the yield from Curve pools.
-   [Cowswap](https://cowswap.exchange/) used for swapping Convex reward tokens (CRV and CVX) to DAI, USDC or USDT.

## Standards

-   [EIP-20](https://eips.ethereum.org/EIPS/eip-20)
-   [EIP-4626](https://eips.ethereum.org/EIPS/eip-4626)
