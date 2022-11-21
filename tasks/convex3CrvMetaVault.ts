import { simpleToExactAmount } from "@utils/math"
import { formatUnits } from "ethers/lib/utils"
import { subtask, task, types } from "hardhat/config"
import { AssetProxy__factory, IERC20__factory, IERC4626Vault__factory, PeriodicAllocationPerfFeeMetaVault__factory } from "types/generated"

import { config } from "./deployment/convex3CrvVaults-config"
import { usdFormatter } from "./utils"
import { getBlock } from "./utils/blocks"
import { deployContract } from "./utils/deploy-utils"
import { verifyEtherscan } from "./utils/etherscan"
import { getChain, resolveAddress, resolveAssetToken } from "./utils/networkAddressFactory"
import { getSigner } from "./utils/signerFactory"

import type { BN } from "@utils/math"
import type { Signer } from "ethers"
import type { HardhatRuntimeEnvironment } from "hardhat/types"
import type { AssetProxy, PeriodicAllocationPerfFeeMetaVault } from "types/generated"

import type { Convex3CrvVaultsDeployed } from "./deployment/convex3CrvVaults"

// deployPeriodicAllocationPerfFeeMetaVault
interface AssetSourcingParams {
    singleVaultSharesThreshold: number
    singleSourceVaultIndex: number
}

interface PeriodicAllocationPerfFeeMetaVaultParams {
    nexus: string
    asset: string
    name: string
    symbol: string
    vaultManager: string
    proxyAdmin: string
    performanceFee: number
    feeReceiver: string
    underlyingVaults: Array<string>
    sourceParams: AssetSourcingParams
    assetPerShareUpdateThreshold: BN
    proxy: boolean
}

export async function deployPeriodicAllocationPerfFeeMetaVaults(
    hre: HardhatRuntimeEnvironment,
    signer: Signer,
    nexus: string,
    vaultManager: string,
    proxyAdmin: string,
    convex3CrvVaults: Convex3CrvVaultsDeployed,
) {
    const { periodicAllocationPerfFeeMetaVault: PeriodicAllocationPerfFeeMetaVaultConf } = config
    const underlyingVaults = [convex3CrvVaults.musd.proxy.address, convex3CrvVaults.frax.proxy.address, convex3CrvVaults.busd.proxy.address]
    const periodicAllocationPerfFeeMetaVault = await deployPeriodicAllocationPerfFeeMetaVault(hre, signer, {
        nexus,
        asset: PeriodicAllocationPerfFeeMetaVaultConf.asset,
        name: PeriodicAllocationPerfFeeMetaVaultConf.name,
        symbol: PeriodicAllocationPerfFeeMetaVaultConf.symbol,
        vaultManager,
        proxyAdmin,
        performanceFee: PeriodicAllocationPerfFeeMetaVaultConf.performanceFee,
        feeReceiver: PeriodicAllocationPerfFeeMetaVaultConf.feeReceiver,
        sourceParams: PeriodicAllocationPerfFeeMetaVaultConf.sourceParams,
        assetPerShareUpdateThreshold: PeriodicAllocationPerfFeeMetaVaultConf.assetPerShareUpdateThreshold,
        underlyingVaults,
        proxy: true,
    })
    return periodicAllocationPerfFeeMetaVault
}

export const deployPeriodicAllocationPerfFeeMetaVault = async (
    hre: HardhatRuntimeEnvironment,
    signer: Signer,
    params: PeriodicAllocationPerfFeeMetaVaultParams,
) => {
    const {
        nexus,
        asset,
        name,
        symbol,
        vaultManager,
        proxyAdmin,
        performanceFee,
        feeReceiver,
        underlyingVaults,
        sourceParams,
        assetPerShareUpdateThreshold,
        proxy,
    } = params
    const constructorArguments = [nexus, asset]
    const vaultImpl = await deployContract<PeriodicAllocationPerfFeeMetaVault>(
        new PeriodicAllocationPerfFeeMetaVault__factory(signer),
        "PeriodicAllocationPerfFeeMetaVault",
        constructorArguments,
    )

    await verifyEtherscan(hre, {
        address: vaultImpl.address,
        contract: "contracts/vault/meta/PeriodicAllocationPerfFeeMetaVault.sol:PeriodicAllocationPerfFeeMetaVault",
        constructorArguments: constructorArguments,
    })

    // Proxy
    if (!proxy) {
        return { proxy: undefined, impl: vaultImpl }
    }
    const data = vaultImpl.interface.encodeFunctionData("initialize", [
        name,
        symbol,
        vaultManager,
        performanceFee,
        feeReceiver,
        underlyingVaults,
        sourceParams,
        assetPerShareUpdateThreshold,
    ])
    const proxyConstructorArguments = [vaultImpl.address, proxyAdmin, data]
    const proxyContract = await deployContract<AssetProxy>(new AssetProxy__factory(signer), "AssetProxy", proxyConstructorArguments)

    return { proxy: proxyContract, impl: vaultImpl }
}

subtask("convex-3crv-mv-deploy", "Deploys Convex 3Crv Meta Vault")
    .addParam("vaults", "Comma separated symbols or addresses of the underlying convex vaults", undefined, types.string)
    .addParam(
        "singleSource",
        "Token symbol or address of the vault that smaller withdraws should be sourced from.",
        undefined,
        types.string,
    )
    .addOptionalParam("name", "Vault name", "3CRV Convex Meta Vault", types.string)
    .addOptionalParam("symbol", "Vault symbol", "mv3CRV-CVX", types.string)
    .addOptionalParam("asset", "Token address or symbol of the vault's asset", "3Crv", types.string)
    .addOptionalParam("admin", "Instant or delayed proxy admin: InstantProxyAdmin | DelayedProxyAdmin", "InstantProxyAdmin", types.string)
    .addOptionalParam("feeReceiver", "Address or name of account that will receive vault fees.", "mStableDAO", types.string)
    .addOptionalParam("fee", "Performance fee scaled to 6 decimal places. default 4% = 40000", 40000, types.int)
    .addOptionalParam(
        "singleThreshold",
        "Max percentage of assets withdraws will source from a single vault in basis points. default 10%",
        1000,
        types.int,
    )
    .addOptionalParam("updateThreshold", "Asset per share update threshold. default 100k", 100000, types.int)
    .addOptionalParam("vaultManager", "Name or address to override the Vault Manager", "VaultManager", types.string)
    .addOptionalParam("proxy", "Deploy a proxy contract", true, types.boolean)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const {
            name,
            symbol,
            asset,
            vaults,
            admin,
            feeReceiver,
            fee,
            singleSource,
            singleThreshold,
            updateThreshold,
            vaultManager,
            proxy,
            speed,
        } = taskArgs

        const signer = await getSigner(hre, speed)
        const chain = getChain(hre)

        const nexusAddress = resolveAddress("Nexus", chain)
        const assetToken = await resolveAssetToken(signer, chain, asset)
        const proxyAdminAddress = resolveAddress(admin, chain)
        const vaultManagerAddress = resolveAddress(vaultManager, chain)

        const underlyings = vaults.split(",")
        const underlyingAddresses = underlyings.map((underlying) => resolveAddress(underlying, chain))
        const singleSourceAddress = resolveAddress(singleSource, chain)
        const singleSourceVaultIndex = underlyingAddresses.indexOf(singleSourceAddress)

        const feeReceiverAddress = resolveAddress(feeReceiver, chain)

        const { proxy: proxyContract, impl } = await deployPeriodicAllocationPerfFeeMetaVault(hre, signer, {
            nexus: nexusAddress,
            asset: assetToken.address,
            name,
            symbol,
            vaultManager: vaultManagerAddress,
            proxyAdmin: proxyAdminAddress,
            feeReceiver: feeReceiverAddress,
            performanceFee: fee,
            underlyingVaults: underlyingAddresses,
            sourceParams: {
                singleVaultSharesThreshold: singleThreshold,
                singleSourceVaultIndex,
            },
            assetPerShareUpdateThreshold: simpleToExactAmount(updateThreshold, assetToken.decimals),
            proxy,
        })

        return { proxy: proxyContract, impl }
    })
task("convex-3crv-mv-deploy").setAction(async (_, __, runSuper) => {
    return runSuper()
})

subtask("convex-3crv-mv-snap", "Logs Convex 3Crv Meta Vault details")
    .addParam("vault", "Vault symbol or address", undefined, types.string)
    .addOptionalParam("owner", "Address, contract name or token symbol to get balances for. Defaults to signer", undefined, types.string)
    .addOptionalParam("block", "Block number. (default: current block)", 0, types.int)
    .setAction(async (taskArgs, hre) => {
        const { vault, owner, block, speed } = taskArgs

        const signer = await getSigner(hre, speed)
        const chain = getChain(hre)

        const blk = await getBlock(hre.ethers, block)

        const vaultToken = await resolveAssetToken(signer, chain, vault)
        const vaultContract = PeriodicAllocationPerfFeeMetaVault__factory.connect(vaultToken.address, signer)
        const fraxVaultContract = IERC4626Vault__factory.connect(resolveAddress("vcx3CRV-FRAX"), signer)
        const musdVaultContract = IERC4626Vault__factory.connect(resolveAddress("vcx3CRV-mUSD"), signer)
        const busdVaultContract = IERC4626Vault__factory.connect(resolveAddress("vcx3CRV-BUSD"), signer)
        const assetToken = await resolveAssetToken(signer, chain, vaultToken.assetSymbol)
        const assetContract = IERC20__factory.connect(assetToken.address, signer)

        await hre.run("vault-snap", {
            vault,
            owner,
        })

        console.log(`\nPeriodicAllocationPerfFeeMetaVault`)
        // Assets
        const assetsInVault = await assetContract.balanceOf(vaultToken.address, {
            blockTag: blk.blockNumber,
        })
        const totalAssets = await vaultContract.totalAssets({
            blockTag: blk.blockNumber,
        })
        console.log(
            `Assets in vault         : ${usdFormatter(assetsInVault, assetToken.decimals)} ${formatUnits(
                assetsInVault.mul(10000).div(totalAssets),
                2,
            )}%`,
        )
        const assetsInUnderlyings = totalAssets.sub(assetsInVault)
        console.log(
            `Assets in underlyings   : ${usdFormatter(assetsInUnderlyings, assetToken.decimals)} ${formatUnits(
                assetsInUnderlyings.mul(10000).div(totalAssets),
                2,
            )}%`,
        )
        const fraxAssets = await fraxVaultContract.maxWithdraw(vaultContract.address, {
            blockTag: blk.blockNumber,
        })
        console.log(
            `Assets in FRAX vault    : ${usdFormatter(fraxAssets, assetToken.decimals)} ${formatUnits(
                fraxAssets.mul(10000).div(totalAssets),
                2,
            )}%`,
        )
        const busdAssets = await busdVaultContract.maxWithdraw(vaultContract.address, {
            blockTag: blk.blockNumber,
        })
        console.log(
            `Assets in BUSD vault    : ${usdFormatter(busdAssets, assetToken.decimals)} ${formatUnits(
                busdAssets.mul(10000).div(totalAssets),
                2,
            )}%`,
        )
        const musdAssets = await musdVaultContract.maxWithdraw(vaultContract.address, {
            blockTag: blk.blockNumber,
        })
        console.log(
            `Assets in mUSD vault    : ${usdFormatter(musdAssets, assetToken.decimals)} ${formatUnits(
                musdAssets.mul(10000).div(totalAssets),
                2,
            )}%`,
        )

        // Assets per share
        console.log(
            `stored assets/share     : ${formatUnits(
                await vaultContract.assetsPerShare({
                    blockTag: blk.blockNumber,
                }),
                26,
            )}`,
        )
        const current = await vaultContract.calculateAssetPerShare({
            blockTag: blk.blockNumber,
        })
        console.log(`current assets/share    : ${formatUnits(current.assetsPerShare_, 26)}`)
        const perfAssetsPerShare = await vaultContract.perfFeesAssetPerShare({
            blockTag: blk.blockNumber,
        })
        const perfPercentage = current.assetsPerShare_.sub(perfAssetsPerShare).mul(1000000).div(perfAssetsPerShare)
        console.log(`performance assets/share: ${formatUnits(perfAssetsPerShare, 26)} ${formatUnits(perfPercentage, 4)}%`)

        const fee = await vaultContract.performanceFee({
            blockTag: blk.blockNumber,
        })
        console.log(
            `Active underlying vaults: ${await vaultContract.activeUnderlyingVaults({
                blockTag: blk.blockNumber,
            })}`,
        )
        console.log(
            `Total underlying vaults : ${await vaultContract.totalUnderlyingVaults({
                blockTag: blk.blockNumber,
            })}`,
        )
        const sourceParams = await vaultContract.sourceParams()
        console.log(`Single vault threshold  : ${sourceParams.singleVaultSharesThreshold / 100}%`)
        console.log(
            `Vault Manager           : ${await vaultContract.vaultManager({
                blockTag: blk.blockNumber,
            })}`,
        )
        console.log(
            `Paused                  : ${await vaultContract.paused({
                blockTag: blk.blockNumber,
            })}`,
        )

        console.log(`\nPerformance fee         : ${fee.toNumber() / 10000}%`)
        const feeReceiver = await vaultContract.feeReceiver({
            blockTag: blk.blockNumber,
        })
        console.log(`Fee receiver            : ${feeReceiver}`)
        const feeShares = await vaultContract.balanceOf(feeReceiver, {
            blockTag: blk.blockNumber,
        })
        const feeAssets = await vaultContract.maxWithdraw(feeReceiver, {
            blockTag: blk.blockNumber,
        })
        console.log(
            `Collected fees          : ${formatUnits(feeShares)} shares, ${formatUnits(feeAssets, assetToken.decimals)} ${
                assetToken.symbol
            }`,
        )
    })
task("convex-3crv-mv-snap").setAction(async (_, __, runSuper) => {
    return runSuper()
})
