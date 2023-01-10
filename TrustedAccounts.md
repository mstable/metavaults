# Trusted Accounts

There are a number of different accounts used to manage vault.

## Governor

-   Is the most trusted role in the Protocol.
-   The governor address is resolved by the Nexus contract.
-   Is a Gnosis Safe contract.
-   Is a 4 of 8 multi signature wallet controlled by the Protocol DAO.
-   Is used for
    -   changing contract configuration that is stored in contract storage.
    -   proposing and accepting after 1 week proxy upgrades.
    -   proposing and accepting after 1 week Nexus changes. eg Keeper account
    -   Setting the Vault Manager on vaults.
-   A fallback for the Keeper that executes operational processes

## Vault Manager

-   Trusted to set min/max amounts passing into functions to protect against sandwich attacks
-   Trusted with Meta Vault asset allocation across the underlying vaults via the settle and rebalance processes.
-   Initiate on-chain calculating and updating storage values. eg
    -   updating the assets per share.
    -   charging a performance fee .
-   For the initial vaults, this is an externally owned account in a server-side wallet.
-   The VaultManager is a role that resolves to an address for each vault so can be a multi-signature contract or another contract.

## Keeper

-   Is a server-side wallet used to automated protocol operations.
-   Is trusted to run jobs at the correct times. eg collecting token rewards
-   Is also trusted to pass in externally calculated values. eg passing min exchange rate for selling token rewards.
-   Used to deploy contracts
