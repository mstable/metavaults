# Meta Vaults Security Audit Scope

Scope of the security audit of [mStable](https://mstable.org/)'s new Meta Vaults by [Hacken](https://hacken.io/), September 2022.

# Code

All code is in the [metavaults](https://github.com/mstable/metavaults) private repository with tag [v0.0.1](https://github.com/mstable/metavaults/tree/v0.0.1).

# Contract scope

All contract are under the [contracts](./contracts/) folder.

## In scope

-   [interfaces](./contracts/interfaces) contract interfaces.
-   [peripheral](./contracts/peripheral/)
    -   [Convex](./contracts/peripheral/Convex) are just interfaces.
    -   [CowSwap](./contracts/peripheral/Cowswap) interface and [CowSwapSeller](./contracts/peripheral/Cowswap/CowSwapSeller.sol) contract.
    -   [Curve](./contracts/peripheral/Curve) are interfaces, libraries and contracts.
    -   [OneInch](./contracts/peripheral/OneInch) are just interfaces.
-   [token](./contracts/tokens) all in scope.
-   [vault](./contracts/vault) all in scope.

## Out of scope

Any contracts in the following are out of scope as they have previously been audited or are just used for testing.

-   [governance](./contracts/governance) all out of scope as perviously audited.
-   [nexus](./contracts/nexus) all out of scope as perviously audited.
-   [upgradability](./contracts/upgradability) all out of scope as perviously audited.
-   [z_mocks](./contracts/z_mocks/) are just used for unit testing.

# Third Party Dependencies

## Contract Libraries

-   [OpenZeppelin](https://www.openzeppelin.com/contracts) is used for ERC20 tokens, access control, initialization, reentry protection, proxies, casting and math operations.

## Protocols

-   [Curve Finance](https://curve.fi/)
-   [Convex Finance](https://www.convexfinance.com/)
-   [Cowswap](https://cowswap.exchange/) may be used for swapping Convex reward tokens (CRV and CVX) to DAI, USDC or USDT.
-   [1Inch](https://app.1inch.io/)'s [Aggregation Protocol](https://docs.1inch.io/docs/aggregation-protocol/introduction) may be used for swapping Convex reward tokens (CRV and CVX) to DAI, USDC or USDT.

## Standards

-   [EIP-20](https://eips.ethereum.org/EIPS/eip-20)
-   [EIP-4626](https://eips.ethereum.org/EIPS/eip-4626)
