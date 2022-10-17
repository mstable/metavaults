import { task, types } from "hardhat/config"
import { Curve3CrvFactoryMetapoolCalculatorLibrary__factory, Curve3CrvMetapoolCalculatorLibrary__factory } from "types"

import { setBalancesToAccounts } from "./deployment/convex3CrvVaults"
import { getSigner } from "./utils"
import { resolveAddress } from "./utils/networkAddressFactory"

task("convex-3crv-fork")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const { speed } = taskArgs
        const signer = await getSigner(hre)

        // Deploy the Liquidator
        // const oneInchDexSwap = await hre.run("one-inch-dex-deploy", { speed })
        // const cowSwapDex = await hre.run("cow-swap-dex-deploy", { speed })
        // const liquidator = await hre.run("liq-deploy", {
        //     speed,
        //     syncSwapper: oneInchDexSwap.address,
        //     asyncSwapper: cowSwapDex.address,
        // })

        // Register the new Liquidator in the Nexus
        process.env.IMPERSONATE = resolveAddress("Governor")
        // await hre.run("nexus-prop-mod", { speed, module: "LiquidatorV2", address: resolveAddress("LiquidatorV2") })
        await hre.run("time-increase", { speed, weeks: 1 })
        await hre.run("nexus-acc-mod", { speed, module: "LiquidatorV2" })
        delete process.env.IMPERSONATE

        // Deploy the Convex 3Crv Vaults
        // const Curve3CrvMetapoolCalculatorLibrary = await hre.run("convex-3crv-lib-deploy", { speed, factory: false })
        // const Curve3CrvFactoryMetapoolCalculatorLibrary = await hre.run("convex-3crv-lib-deploy", { speed, factory: true })
        const Curve3CrvMetapoolCalculatorLibrary = Curve3CrvMetapoolCalculatorLibrary__factory.connect(
            resolveAddress("Curve3CrvMetapoolCalculatorLibrary"),
            signer,
        )
        const Curve3CrvFactoryMetapoolCalculatorLibrary = Curve3CrvFactoryMetapoolCalculatorLibrary__factory.connect(
            resolveAddress("Curve3CrvFactoryMetapoolCalculatorLibrary"),
            signer,
        )
        const musdConvexVault = await hre.run("convex-3crv-vault-deploy", {
            speed,
            symbol: "vcx3CRV-mUSD",
            name: "3Crv Convex mUSD Vault",
            pool: "mUSD",
            calculatorLibrary: Curve3CrvMetapoolCalculatorLibrary.address,
        })
        const fraxConvexVault = await hre.run("convex-3crv-vault-deploy", {
            speed,
            symbol: "vcx3CRV-FRAX",
            name: "3Crv Convex FRAX Vault",
            pool: "FRAX",
            calculatorLibrary: Curve3CrvFactoryMetapoolCalculatorLibrary.address,
        })
        // const lusdConvexVault = await hre.run("convex-3crv-vault-deploy", {
        //     speed,
        //     symbol: "vcx3CRV-LUSD",
        //     name: "3Crv Convex LUSD Vault",
        //     pool: "LUSD",
        //     calculatorLibrary: Curve3CrvFactoryMetapoolCalculatorLibrary.address,
        // })
        const busdConvexVault = await hre.run("convex-3crv-vault-deploy", {
            speed,
            symbol: "vcx3CRV-BUSD",
            name: "3Crv Convex BUSD Vault",
            pool: "BUSD",
            calculatorLibrary: Curve3CrvFactoryMetapoolCalculatorLibrary.address,
        })

        // Deploy Convex 3Crv Meta Vault
        const metaVault = await hre.run("convex-3crv-meta-vault-deploy", {
            speed,
            vaults: [
                musdConvexVault.proxy.address,
                fraxConvexVault.proxy.address,
                // lusdConvexVault.proxy.address,
                busdConvexVault.proxy.address,
            ].join(","),
            singleSource: fraxConvexVault.proxy.address,
        })

        // Deploy Curve Meta Vaults
        // const threePoolLib = await hre.run("curve-3crv-lib-deploy", {
        //     speed,
        // })
        const threePoolLib = Curve3CrvMetapoolCalculatorLibrary__factory.connect(resolveAddress("Curve3CrvCalculatorLibrary"), signer)
        const daiCurveVault = await hre.run("curve-3crv-meta-vault-deploy", {
            speed,
            metaVault: metaVault.proxy.address,
            symbol: "3pDAI",
            name: "3Pooler Meta Vault (DAI)",
            asset: "DAI",
            calculatorLibrary: threePoolLib.address,
        })
        const usdcCurveVault = await hre.run("curve-3crv-meta-vault-deploy", {
            speed,
            metaVault: metaVault.proxy.address,
            symbol: "3pUSDC",
            name: "3Pooler Meta Vault (USDC)",
            asset: "USDC",
            calculatorLibrary: threePoolLib.address,
        })
        const usdtCurveVault = await hre.run("curve-3crv-meta-vault-deploy", {
            speed,
            metaVault: metaVault.proxy.address,
            symbol: "3pUSDT",
            name: "3Pooler Meta Vault (USDT)",
            asset: "USDT",
            calculatorLibrary: threePoolLib.address,
        })

        // simulate accounts and deposit tokens.
        await setBalancesToAccounts(hre)
    })
