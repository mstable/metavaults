# Second Meta Vaults Security Audit

Scope of the security audit of [mStable](https://mstable.org/)'s FRAX-based Meta Vaults, November 2022.

# Logic

See [FraxBP Convex Vaults](./FraxBPConvexVaults.md) for an explanation of what the different vaults do and how value flows between them.

# Code

Only the contracts used by the FRAX-based vaults will be audited. Also, simpler contracts that have been previously audited are out of scope given the tight timeframes.

All code is in the [metavaults](https://github.com/mstable/metavaults) repository with tag ??? and commit hash ??? on the [fraxBP](https://github.com/mstable/metavaults/tree/fraxBP) branch.

# Contract scope

All contract are under the [contracts](./contracts/) folder.

## In scope

-   [peripheral](./contracts/peripheral/)
    -   [Curve](./contracts/peripheral/Curve) just the [CurveFraxBpCalculatorLibrary](./contracts/peripheral/Curve/CurveFraxBpCalculatorLibrary.sol) and [CurveFraxBpMetapoolCalculatorLibrary](./contracts/peripheral/Curve/CurveFraxBpMetapoolCalculatorLibrary.sol) libraries. The Curve3Crv* libraries have previously been audited and are not used by the FRAX-based vaults.
-   [shares](./contracts/shared/) just the [SingleSlotMapper](./contracts/shared/SingleSlotMapper.sol) contract as it has not been audited. The others have been through multiple audits.
-   [vault](./contracts/vault) all vault contract except the ones listed below in the out of scope section.
    -   [liquidity/convex](./contracts/vault/liquidity/convex/) the three ConvexFraxBp* vaults are in scope.
    -   [liquidity/curve](./contracts/vault/liquidity/curve/) the two CurveFraxBp* vaults are in scope.
    - [swap](./contracts/vault/swap/) only [CowSwapDex](./contracts/vault/swap/CowSwapDex.sol) is in scope. The 1Inch synchronous swapper is not currently used.

## Out of scope

Any contracts in the following are out of scope as they have previously been audited or are just used for testing.

-   [governance](./contracts/governance) all out of scope as perviously audited.
-   [interfaces](./contracts/interfaces) contract interfaces.
-   [nexus](./contracts/nexus) all out of scope as perviously audited.
-   [peripheral](./contracts/peripheral/)
    -   [Convex](./contracts/peripheral/Convex) are just interfaces.
    -   [Curve](./contracts/peripheral/Curve) are interfaces, libraries or testing contracts. The libraries are ports of Curve's Vyper code with gas optimizations. They are stateless so are not a high risk of containing security issues. Given their logic complexity and they have previously been audited, they are out of scope of this audit.
    -   [Cowswap](./contracts/peripheral/Cowswap/) are just interfaces.
    -   [OneInch](./contracts/peripheral/OneInch) are just interfaces and will not be initially used.
-   [token](./contracts/tokens) all out scope as perviously audited.
-   [upgradability](./contracts/upgradability) all out of scope as perviously audited.
-   [vault](./contracts/vault) any BasicVaults are out of scope as they are just used for testing. Specifically, `PeriodicAllocationBasicVault`, `SameAssetUnderlyingsBasicVault`, `PerfFeeBasicVault`, `LiquidatorBasicVault`, `LiquidatorStreamBasicVault`, `LiquidatorStreamFeeBasicVault`, `Convex3CrvBasicVault`, `Curve3CrvBasicMetaVault` and `BasicSlippage` are all out of scope.
    -   [liquidity/convex](./contracts/vault/liquidity/convex/) the three Convex3Crv* vaults are out of scope.
    -   [liquidity/curve](./contracts/vault/liquidity/curve/) the two Curve3Crv* vaults are out of scope.
    -   [swap](./contracts/vault/swap/) contracts [BasicDexSwap](./contracts/vault/swap/BasicDexSwap.sol) and [OneInchDexSwap](./contracts/vault/swap/OneInchDexSwap.sol) are out of scope.
-   [z_mocks](./contracts/z_mocks/) are just used for unit testing.
-   [BasicVault](./contracts/vault/BasicVault.sol) and [LightBasicVault](./contracts/vault/LightBasicVault.sol) are out of scope.

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
