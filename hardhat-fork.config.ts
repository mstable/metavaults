import { hardhatConfig } from "./hardhat.config"

export default {
    ...hardhatConfig,
    networks: {
        ...hardhatConfig.networks,
        hardhat: {
            allowUnlimitedContractSize: true,
            forking: {
                url: process.env.NODE_URL || "",
            },
        },
    },
    tracer: {
        nameTags: {
            '0xDBFa6187C79f4fE4Cda20609E75760C5AaE88e52': 'BaseRewardPool',
            '0x93A5C724c4992FCBDA6b96F06fa15EB8B5c485b7': 'VirtualBalanceRewardPool',
            '0x4e3FBD56CD56c3e72c1403e103b45Db9da5B9D2B': 'CVX',
            '0xD533a949740bb3306d119CC777fa900bA034cd52': 'CRV',
            '0xF403C135812408BFbE8713b5A23a04b3D48AAE31': 'Booster',
            '0x6B175474E89094C44Da98b954EedeAC495271d0F': 'DAI',
            
        },
    },
}
