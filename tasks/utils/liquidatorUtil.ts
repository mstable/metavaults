import { LiquidatorAbstractVault__factory } from "types/generated"

import type { Provider } from "@ethersproject/providers"
import type { Signer } from "ethers"

/**
 * Builds the argument in order to request to the liquidator to donate tokens.
 *
 * @param {(Signer | Provider)} signer
 * @param {string[]} vaultsAddress The list of vaults to donate tokens.
 * @return  { rewardTokens: [], purchaseTokens: [], vaults: [] } , object containing all the argument for the liquidator.donateTokens function.
 */
export const buildDonateTokensInput = async (signer: Signer | Provider, vaultsAddress: string[]) => {
    const vaultsMap = await Promise.all(
        vaultsAddress.map(async (vaultAddress) => {
            const vault = LiquidatorAbstractVault__factory.connect(vaultAddress, signer)
            const rewardTokens: string[] = await vault.rewardTokens()
            const purchaseTokens: string[] = await Promise.all(rewardTokens.map(async (rewardToken) => vault.donateToken(rewardToken)))
            const vaults: string[] = rewardTokens.map(() => vaultAddress)
            return { rewardTokens, purchaseTokens, vaults }
        }),
    )
    return vaultsMap.reduce(
        (prev, curr) => ({
            rewardTokens: prev.rewardTokens.concat(curr.rewardTokens),
            purchaseTokens: prev.purchaseTokens.concat(curr.purchaseTokens),
            vaults: prev.vaults.concat(curr.vaults),
        }),
        { rewardTokens: [], purchaseTokens: [], vaults: [] },
    )
}
/**
 * Builds  the argument in order to request to the liquidator to initiate swaps.
 *
 * @param {(Signer | Provider)} signer
 * @param {string[]} vaultsAddress
 * @return {*}
 */
export const buildInitiateSwapInput = async (signer: Signer | Provider, vaultsAddress: string[]) => {
    const pairs = await Promise.all(
        vaultsAddress.map(async (vaultAddress) => {
            const vault = LiquidatorAbstractVault__factory.connect(vaultAddress, signer)
            const rewardTokens: string[] = await vault.rewardTokens()
            const purchaseTokens: string[] = await Promise.all(rewardTokens.map(async (rewardToken) => vault.donateToken(rewardToken)))
            return rewardTokens.map((rewardToken, i) => ({ fromAsset: rewardToken, toAsset: purchaseTokens[i] }))
        }),
    )
    // get all distinct  "fromAsset" - "toAsset" pairs
    return pairs
        .flatMap((pair) => pair)
        .reduce((prev, curr) => {
            // if pair already exist do not add it, otherwise add it
            if (prev.find((prevPair) => prevPair.fromAsset !== curr.fromAsset && prevPair.toAsset !== curr.toAsset)) {
                return prev.concat(curr)
            } else {
                return prev
            }
        }, [])
}
