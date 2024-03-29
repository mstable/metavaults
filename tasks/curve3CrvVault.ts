import { subtask, task, types } from "hardhat/config"
import { AssetProxy__factory, Curve3CrvBasicMetaVault__factory, Curve3PoolCalculatorLibrary__factory, IERC20Metadata__factory } from "types"

import { config } from "./deployment/convex3CrvVaults-config"
import { deployContract } from "./utils/deploy-utils"
import { verifyEtherscan } from "./utils/etherscan"
import { getChain, resolveAddress, resolveAssetToken } from "./utils/networkAddressFactory"
import { getSigner } from "./utils/signerFactory"

import type { BN } from "@utils/math"
import type { Signer } from "ethers"
import type { HardhatRuntimeEnvironment } from "hardhat/types"
import type { AssetProxy, Curve3CrvBasicMetaVault, Curve3CrvPool, Curve3PoolCalculatorLibrary } from "types"

// deployCurve3CrvMetaVault
type SlippageData = {
    redeem: number
    deposit: number
    withdraw: number
    mint: number
}
interface Curve3CrvBasicMetaVaultParams {
    calculatorLibrary: string
    nexus: string
    asset: string
    metaVault: string
    slippageData: SlippageData
    name: string
    symbol: string
    vaultManager: string
    proxyAdmin: string
    proxy: boolean
    assetToBurn: BN
}
interface Curve3CrvMetaVaultDeployed {
    proxy: AssetProxy
    impl: Curve3CrvBasicMetaVault
}
export interface Curve3CrvMetaVaultsDeployed {
    [key: string]: { proxy: AssetProxy; impl: Curve3CrvBasicMetaVault }
}

export async function deployCurve3PoolCalculatorLibrary(hre: HardhatRuntimeEnvironment, signer: Signer) {
    const calculatorLibrary = await deployContract<Curve3PoolCalculatorLibrary>(
        new Curve3PoolCalculatorLibrary__factory(signer),
        `Curve3PoolCalculatorLibrary`,
        [],
    )

    await verifyEtherscan(hre, {
        address: calculatorLibrary.address,
        contract: "contracts/peripheral/Curve/Curve3PoolCalculatorLibrary.sol:Curve3PoolCalculatorLibrary",
        constructorArguments: [],
    })

    return calculatorLibrary
}

export const deployCurve3CrvMetaVault = async (hre: HardhatRuntimeEnvironment, signer: Signer, deployerAddress: string, params: Curve3CrvBasicMetaVaultParams) => {
    const { calculatorLibrary, nexus, asset, metaVault, slippageData, name, symbol, vaultManager, proxyAdmin, proxy, assetToBurn } = params

    const libraryAddresses = { "contracts/peripheral/Curve/Curve3PoolCalculatorLibrary.sol:Curve3PoolCalculatorLibrary": calculatorLibrary }

    const constructorArguments = [nexus, asset, metaVault]
    const vaultImpl = await deployContract<Curve3CrvBasicMetaVault>(
        new Curve3CrvBasicMetaVault__factory(libraryAddresses, signer),
        "Curve3CrvBasicMetaVault",
        constructorArguments,
    )

    await verifyEtherscan(hre, {
        address: vaultImpl.address,
        contract: "contracts/vault/liquidity/curve/Curve3CrvBasicMetaVault.sol:Curve3CrvBasicMetaVault",
        constructorArguments: constructorArguments,
    })

    // Proxy
    if (!proxy) {
        return { proxy: undefined, impl: vaultImpl }
    }

    // Pre-calculate proxyAddress for approval
    const nonce = await hre.ethers.provider.getTransactionCount(deployerAddress)
    const proxyAddress = hre.ethers.utils.getContractAddress({
      from: deployerAddress,
      nonce: nonce + 1, // Increment 1 to account for approval tx
    });

    // Approve allowance for assetToBurn
    const assetContract = IERC20Metadata__factory.connect(asset, signer)
    await assetContract.approve(proxyAddress, assetToBurn)

    const data = vaultImpl.interface.encodeFunctionData("initialize", [name, symbol, vaultManager, slippageData, assetToBurn])
    const proxyConstructorArguments = [vaultImpl.address, proxyAdmin, data]
    const proxyContract = await deployContract<AssetProxy>(new AssetProxy__factory(signer), "AssetProxy", proxyConstructorArguments)

    return { proxy: proxyContract, impl: vaultImpl }
}

export async function deployCurve3CrvMetaVaults(
    hre: HardhatRuntimeEnvironment,
    signer: Signer,
    nexus: string,
    vaultManager: string,
    proxyAdmin: string,
    metaVault: string,
    deployerAddress: string
) {
    const curve3CrvMetaVaults: Curve3CrvMetaVaultsDeployed = {}

    const { curve3CrvMetaVault } = config
    const pools: string[] = Object.keys(curve3CrvMetaVault)
    const curve3PoolCalculatorLibrary: Curve3PoolCalculatorLibrary = await deployCurve3PoolCalculatorLibrary(hre, signer)

    for (let i = 0; i < pools.length; i++) {
        const pool = pools[i]
        const curve3CrvPool: Curve3CrvPool = curve3CrvMetaVault[pool]
        const curve3CrvMetaVaultDeployed: Curve3CrvMetaVaultDeployed = await deployCurve3CrvMetaVault(hre, signer, deployerAddress, {
            calculatorLibrary: curve3PoolCalculatorLibrary.address,
            nexus,
            asset: curve3CrvPool.asset,
            metaVault,
            // metaVault: curve3CrvPool.metaVault,
            slippageData: curve3CrvPool.slippageData,
            name: curve3CrvPool.name,
            symbol: curve3CrvPool.symbol,
            vaultManager,
            proxyAdmin,
            proxy: true,
            assetToBurn: curve3CrvPool.assetToBurn
        })
        curve3CrvMetaVaults[pool] = curve3CrvMetaVaultDeployed
    }
    return { curve3CrvMetaVaults, curve3PoolCalculatorLibrary }
}

subtask("curve-3crv-lib-deploy", "Deploys a Curve 3Pool calculator library")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const { speed } = taskArgs

        const signer = await getSigner(hre, speed)

        return deployCurve3PoolCalculatorLibrary(hre, signer)
    })
task("curve-3crv-lib-deploy").setAction(async (_, __, runSuper) => {
    return runSuper()
})

subtask("curve-3crv-meta-vault-deploy", "Deploys Curve 3Pool Meta Vault")
    .addParam("name", "Meta Vault name", undefined, types.string)
    .addParam("symbol", "Meta Vault symbol", undefined, types.string)
    .addParam("asset", "Token address or symbol of the vault's asset. eg DAI, USDC or USDT", undefined, types.string)
    .addParam("assetToBurn", "Amount of assets to deposit and corresponding shares locked", undefined , types.int)
    .addOptionalParam("metaVault", "Underlying Meta Vault override", "mv3CRV-CVX", types.string)
    .addOptionalParam("admin", "Instant or delayed proxy admin: InstantProxyAdmin | DelayedProxyAdmin", "InstantProxyAdmin", types.string)
    .addOptionalParam("calculatorLibrary", "Name or address of the Curve calculator library.", "Curve3CrvCalculatorLibrary", types.string)
    .addOptionalParam("slippage", "Max slippage in basis points. default 1% = 100", 100, types.int)
    .addOptionalParam("vaultManager", "Name or address to override the Vault Manager", "VaultManager", types.string)
    .addOptionalParam("proxy", "Deploy a proxy contract", true, types.boolean)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const { metaVault, name, symbol, asset, calculatorLibrary, slippage, admin, vaultManager, proxy, speed, assetToBurn } = taskArgs

        const signer = await getSigner(hre, speed)
        const chain = getChain(hre)

        const nexusAddress = resolveAddress("Nexus", chain)
        const assetToken = await resolveAssetToken(signer, chain, asset)
        const proxyAdminAddress = resolveAddress(admin, chain)
        const vaultManagerAddress = resolveAddress(vaultManager, chain)
        const metaVaultAddress = resolveAddress(metaVault, chain)
        const calculatorLibraryAddress = resolveAddress(calculatorLibrary, chain)
        const deployerAddress = resolveAddress("OperationsSigner", chain)

        const { proxy: proxyContract, impl } = await deployCurve3CrvMetaVault(hre, signer, deployerAddress, {
            nexus: nexusAddress,
            asset: assetToken.address,
            name,
            symbol,
            metaVault: metaVaultAddress,
            vaultManager: vaultManagerAddress,
            proxyAdmin: proxyAdminAddress,
            slippageData: { mint: slippage, deposit: slippage, redeem: slippage, withdraw: slippage },
            calculatorLibrary: calculatorLibraryAddress,
            proxy,
            assetToBurn
        })

        return { proxyContract, impl }
    })
task("curve-3crv-meta-vault-deploy").setAction(async (_, __, runSuper) => {
    return runSuper()
})
