import { subtask, task, types } from "hardhat/config"
import { AssetProxy__factory, CurveFraxBpBasicMetaVault__factory, CurveFraxBpCalculatorLibrary__factory } from "types"

import { config } from "./deployment/convexFraxBpVaults-config"
import { deployContract } from "./utils/deploy-utils"
import { verifyEtherscan } from "./utils/etherscan"
import { getChain, resolveAddress, resolveAssetToken } from "./utils/networkAddressFactory"
import { getSigner } from "./utils/signerFactory"

import type { Signer } from "ethers"
import type { HardhatRuntimeEnvironment } from "hardhat/types"
import type { AssetProxy, CurveFraxBpBasicMetaVault, CurveFraxBpCalculatorLibrary, CurveFraxBpPool } from "types"

// deployCurveFraxBpMetaVault
type SlippageData = {
    redeem: number
    deposit: number
    withdraw: number
    mint: number
}
interface CurveFraxBpBasicMetaVaultParams {
    calculatorLibrary: string
    nexus: string
    asset: string
    metaVault: string
    slippageData: SlippageData
    name: string
    symbol: string
    vaultManager: string
    proxyAdmin: string
}
interface CurveFraxBpMetaVaultDeployed {
    proxy: AssetProxy
    impl: CurveFraxBpBasicMetaVault
}
export interface CurveFraxBpMetaVaultsDeployed {
    [key: string]: { proxy: AssetProxy; impl: CurveFraxBpBasicMetaVault }
}

export async function deployCurveFraxBpCalculatorLibrary(hre: HardhatRuntimeEnvironment, signer: Signer) {
    const calculatorLibrary = await deployContract<CurveFraxBpCalculatorLibrary>(
        new CurveFraxBpCalculatorLibrary__factory(signer),
        `CurveFraxBpCalculatorLibrary`,
        [],
    )

    await verifyEtherscan(hre, {
        address: calculatorLibrary.address,
        contract: "contracts/peripheral/Curve/CurveFraxBpCalculatorLibrary.sol:CurveFraxBpCalculatorLibrary",
        constructorArguments: [],
    })

    return calculatorLibrary
}

export const deployCurveFraxBpMetaVault = async (
    hre: HardhatRuntimeEnvironment,
    signer: Signer,
    params: CurveFraxBpBasicMetaVaultParams,
) => {
    const { calculatorLibrary, nexus, asset, metaVault, slippageData, name, symbol, vaultManager, proxyAdmin } = params

    const libraryAddresses = {
        "contracts/peripheral/Curve/CurveFraxBpCalculatorLibrary.sol:CurveFraxBpCalculatorLibrary": calculatorLibrary,
    }

    const constructorArguments = [nexus, asset, metaVault]
    const vaultImpl = await deployContract<CurveFraxBpBasicMetaVault>(
        new CurveFraxBpBasicMetaVault__factory(libraryAddresses, signer),
        "CurveFraxBpBasicMetaVault",
        constructorArguments,
    )

    await verifyEtherscan(hre, {
        address: vaultImpl.address,
        contract: "contracts/vault/liquidity/curve/CurveFraxBpBasicMetaVault.sol:CurveFraxBpBasicMetaVault",
        constructorArguments: constructorArguments,
    })

    // Proxy
    const data = vaultImpl.interface.encodeFunctionData("initialize", [name, symbol, vaultManager, slippageData])
    const proxyConstructorArguments = [vaultImpl.address, proxyAdmin, data]
    const proxy = await deployContract<AssetProxy>(new AssetProxy__factory(signer), "AssetProxy", proxyConstructorArguments)

    return { proxy, impl: vaultImpl }
}

export async function deployCurveFraxBpMetaVaults(
    hre: HardhatRuntimeEnvironment,
    signer: Signer,
    nexus: string,
    vaultManager: string,
    proxyAdmin: string,
    metaVault: string,
) {
    const curveFraxBpMetaVaults: CurveFraxBpMetaVaultsDeployed = {}

    const { curveFraxBpMetaVault } = config
    const pools: string[] = Object.keys(curveFraxBpMetaVault)
    const curveFraxBpCalculatorLibrary: CurveFraxBpCalculatorLibrary = await deployCurveFraxBpCalculatorLibrary(hre, signer)

    for (let i = 0; i < pools.length; i++) {
        const pool = pools[i]
        const curveFraxBpPool: CurveFraxBpPool = curveFraxBpMetaVault[pool]
        const curveFraxBpMetaVaultDeployed: CurveFraxBpMetaVaultDeployed = await deployCurveFraxBpMetaVault(hre, signer, {
            calculatorLibrary: curveFraxBpCalculatorLibrary.address,
            nexus,
            asset: curveFraxBpPool.asset,
            metaVault,
            // metaVault: curveFraxBpPool.metaVault,
            slippageData: curveFraxBpPool.slippageData,
            name: curveFraxBpPool.name,
            symbol: curveFraxBpPool.symbol,
            vaultManager,
            proxyAdmin,
        })
        curveFraxBpMetaVaults[pool] = curveFraxBpMetaVaultDeployed
    }
    return { curveFraxBpMetaVaults, curveFraxBpCalculatorLibrary }
}

subtask("curve-FraxBp-lib-deploy", "Deploys a Curve FraxBp calculator library")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const { speed } = taskArgs

        const signer = await getSigner(hre, speed)

        return deployCurveFraxBpCalculatorLibrary(hre, signer)
    })
task("curve-FraxBp-lib-deploy").setAction(async (_, __, runSuper) => {
    return runSuper()
})

subtask("curve-FraxBp-meta-vault-deploy", "Deploys Curve FraxBp Meta Vault")
    .addParam("name", "Meta Vault name", undefined, types.string)
    .addParam("symbol", "Meta Vault symbol", undefined, types.string)
    .addParam("asset", "Token address or symbol of the vault's asset. eg FRAX or USDC", undefined, types.string)
    .addOptionalParam("metaVault", "Underlying Meta Vault override", "mvFraxBp-CVX", types.string)
    .addOptionalParam("admin", "Instant or delayed proxy admin: InstantProxyAdmin | DelayedProxyAdmin", "InstantProxyAdmin", types.string)
    .addOptionalParam("calculatorLibrary", "Name or address of the Curve calculator library.", "CurveFraxBpCalculatorLibrary", types.string)
    .addOptionalParam("slippage", "Max slippage in basis points. default 1% = 100", 100, types.int)
    .addOptionalParam("vaultManager", "Name or address to override the Vault Manager", "VaultManager", types.string)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const { metaVault, name, symbol, asset, calculatorLibrary, slippage, admin, vaultManager, speed } = taskArgs

        const signer = await getSigner(hre, speed)
        const chain = getChain(hre)

        const nexusAddress = resolveAddress("Nexus", chain)
        const assetToken = await resolveAssetToken(signer, chain, asset)
        const proxyAdminAddress = resolveAddress(admin, chain)
        const vaultManagerAddress = resolveAddress(vaultManager, chain)
        const metaVaultAddress = resolveAddress(metaVault, chain)
        const calculatorLibraryAddress = resolveAddress(calculatorLibrary, chain)

        const { proxy, impl } = await deployCurveFraxBpMetaVault(hre, signer, {
            nexus: nexusAddress,
            asset: assetToken.address,
            name,
            symbol,
            metaVault: metaVaultAddress,
            vaultManager: vaultManagerAddress,
            proxyAdmin: proxyAdminAddress,
            slippageData: { mint: slippage, deposit: slippage, redeem: slippage, withdraw: slippage },
            calculatorLibrary: calculatorLibraryAddress,
        })

        return { proxy, impl }
    })
task("curve-FraxBp-meta-vault-deploy").setAction(async (_, __, runSuper) => {
    return runSuper()
})
