import { ethereumAddress } from "@utils/regex"

export enum Chain {
    mainnet,
    goerli,
    sepolia,
    polygon,
    mumbai,
}

export interface Token {
    symbol: string
    address: string
    chain: Chain
    decimals: number
    quantityFormatter: string
    assetSymbol?: string
    assetAddress?: string
}

export function isToken(asset: unknown): asset is Token {
    const token = asset as Token
    return token.symbol !== undefined && token.address.match(ethereumAddress) && token.chain !== undefined && token.decimals !== undefined
}

// Vault
export const TAG: Token = {
    symbol: "TAG",
    address: "0x5A036AFae87e6AEBf4eBc01bbEfb3F009eB01772",
    chain: Chain.goerli,
    decimals: 18,
    quantityFormatter: "USD",
}

export const TVG: Token = {
    symbol: "TVG",
    address: "0x0145A7fB49402b29BE7C52D38aeACB5e1aCAe11b",
    chain: Chain.goerli,
    decimals: 18,
    quantityFormatter: "USD",
    assetSymbol: "TAG",
}

// mStable on mainnet
export const mUSD: Token = {
    symbol: "mUSD",
    address: "0xe2f2a5C287993345a840Db3B0845fbC70f5935a5",
    chain: Chain.mainnet,
    decimals: 18,
    quantityFormatter: "USD",
}
export const mBTC: Token = {
    symbol: "mBTC",
    address: "0x945Facb997494CC2570096c74b5F66A3507330a1",
    chain: Chain.mainnet,
    decimals: 18,
    quantityFormatter: "BTC",
}
// mStable on Polygon mainnet
export const PmUSD: Token = {
    symbol: "mUSD",
    address: "0xE840B73E5287865EEc17d250bFb1536704B43B21",
    chain: Chain.polygon,
    decimals: 18,
    quantityFormatter: "USD",
}
export const MmUSD: Token = {
    symbol: "mUSD",
    address: "0x0f7a5734f208A356AB2e5Cf3d02129c17028F3cf",
    chain: Chain.mumbai,
    decimals: 18,
    quantityFormatter: "USD",
}

// USD Main Pool Assets on Mainnet
export const sUSD: Token = {
    symbol: "sUSD",
    address: "0x57Ab1ec28D129707052df4dF418D58a2D46d5f51",
    chain: Chain.mainnet,
    decimals: 18,
    quantityFormatter: "USD",
}
export const USDC: Token = {
    symbol: "USDC",
    address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    chain: Chain.mainnet,
    decimals: 6,
    quantityFormatter: "USD",
}
export const USDT: Token = {
    symbol: "USDT",
    address: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    chain: Chain.mainnet,
    decimals: 6,
    quantityFormatter: "USD",
}
export const DAI: Token = {
    symbol: "DAI",
    address: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
    chain: Chain.mainnet,
    decimals: 18,
    quantityFormatter: "USD",
}

// USD Main Pool Assets on Polygon
export const PUSDC: Token = {
    symbol: "USDC",
    address: "0x2791bca1f2de4661ed88a30c99a7a9449aa84174",
    chain: Chain.polygon,
    decimals: 6,
    quantityFormatter: "USD",
}

export const PUSDT: Token = {
    symbol: "USDT",
    address: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
    chain: Chain.polygon,
    decimals: 6,
    quantityFormatter: "USD",
}
export const PDAI: Token = {
    symbol: "DAI",
    address: "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063",
    chain: Chain.polygon,
    decimals: 18,
    quantityFormatter: "USD",
}

// USD Feeder Pool Assets on Mainnet
export const GUSD: Token = {
    symbol: "GUSD",
    address: "0x056Fd409E1d7A124BD7017459dFEa2F387b6d5Cd",
    chain: Chain.mainnet,
    decimals: 2,
    quantityFormatter: "USD",
}
export const BUSD: Token = {
    symbol: "BUSD",
    address: "0x4Fabb145d64652a948d72533023f6E7A623C7C53",
    chain: Chain.mainnet,
    decimals: 18,
    quantityFormatter: "USD",
}

export const LUSD: Token = {
    symbol: "LUSD",
    address: "0x5f98805A4E8be255a32880FDeC7F6728C6568bA0",
    chain: Chain.mainnet,
    decimals: 18,
    quantityFormatter: "USD",
}

// NonPeggedFeederPool contains priceGetter
export const RAI: Token = {
    symbol: "RAI",
    address: "0x03ab458634910aad20ef5f1c8ee96f1d6ac54919",
    chain: Chain.mainnet,
    decimals: 18,
    quantityFormatter: "USD",
}

// FLX token for RAI
export const FLX: Token = {
    symbol: "FLX",
    address: "0x6243d8cea23066d098a15582d81a598b4e8391f4",
    chain: Chain.mainnet,
    decimals: 18,
    quantityFormatter: "USD",
}

// FEI Feeder Pool Asset on Mainnet
export const FEI: Token = {
    symbol: "FEI",
    address: "0x956F47F50A910163D8BF957Cf5846D573E7f87CA",
    chain: Chain.mainnet,
    decimals: 18,
    quantityFormatter: "USD",
}

// TRIBE token for FEI
export const TRIBE: Token = {
    symbol: "TRIBE",
    address: "0xc7283b66Eb1EB5FB86327f08e1B5816b0720212B",
    chain: Chain.mainnet,
    decimals: 18,
    quantityFormatter: "USD",
}

// USD Feeder Pool Assets on Mainnet
export const FRAX: Token = {
    symbol: "FRAX",
    address: "0x853d955acef822db058eb8505911ed77f175b99e",
    chain: Chain.mainnet,
    decimals: 18,
    quantityFormatter: "USD",
}
// USD Feeder Pool Assets on Polygon
export const PFRAX: Token = {
    symbol: "FRAX",
    address: "0x104592a158490a9228070E0A8e5343B499e125D0",
    chain: Chain.polygon,
    decimals: 18,
    quantityFormatter: "USD",
}
export const MFRAX: Token = {
    symbol: "FRAX",
    address: "0x8F6F8064A0222F138d56C077a7F27009BDBBE3B1",
    chain: Chain.mumbai,
    decimals: 18,
    quantityFormatter: "USD",
}

// Alchemix
export const alUSD: Token = {
    symbol: "alUSD",
    address: "0xBC6DA0FE9aD5f3b0d58160288917AA56653660E9",
    chain: Chain.mainnet,
    decimals: 18,
    quantityFormatter: "USD",
}
export const ALCX: Token = {
    symbol: "ALCX",
    address: "0xdBdb4d16EdA451D0503b854CF79D55697F90c8DF",
    chain: Chain.mainnet,
    decimals: 18,
    quantityFormatter: "USD",
}

// BTC
export const renBTC: Token = {
    symbol: "renBTC",
    address: "0xEB4C2781e4ebA804CE9a9803C67d0893436bB27D",
    chain: Chain.mainnet,
    decimals: 8,
    quantityFormatter: "BTC",
}
export const sBTC: Token = {
    symbol: "sBTC",
    address: "0xfE18be6b3Bd88A2D2A7f928d00292E7a9963CfC6",
    chain: Chain.mainnet,
    decimals: 18,
    quantityFormatter: "BTC",
}
export const WBTC: Token = {
    symbol: "WBTC",
    address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
    chain: Chain.mainnet,
    decimals: 8,
    quantityFormatter: "BTC",
}

// BTC Feeder Pool Assets
export const HBTC: Token = {
    symbol: "HBTC",
    address: "0x0316EB71485b0Ab14103307bf65a021042c6d380",
    chain: Chain.mainnet,
    decimals: 18,
    quantityFormatter: "BTC",
}
export const TBTC: Token = {
    symbol: "TBTC",
    address: "0x8dAEBADE922dF735c38C80C7eBD708Af50815fAa",
    chain: Chain.mainnet,
    decimals: 18,
    quantityFormatter: "BTC",
}

export const TBTCv2: Token = {
    symbol: "tBTCv2",
    address: "0x18084fbA666a33d37592fA2633fD49a74DD93a88",
    chain: Chain.mainnet,
    decimals: 18,
    quantityFormatter: "BTC",
}

export const MTA: Token = {
    symbol: "MTA",
    address: "0xa3BeD4E1c75D00fa6f4E5E6922DB7261B5E9AcD2",
    chain: Chain.mainnet,
    decimals: 18,
    quantityFormatter: "USD",
}

export const PMTA: Token = {
    symbol: "MTA",
    address: "0xF501dd45a1198C2E1b5aEF5314A68B9006D842E0",
    chain: Chain.polygon,
    decimals: 18,
    quantityFormatter: "USD",
}

// Old MTA staking contract
// Was previously vault on MTA but that is now the MTA Staking V2 contract
export const vMTA: Token = {
    symbol: "vMTA",
    address: "0xaE8bC96DA4F9A9613c323478BE181FDb2Aa0E1BF",
    chain: Chain.mainnet,
    decimals: 18,
    quantityFormatter: "USD",
}

export const PWMATIC: Token = {
    symbol: "WMATIC",
    address: "0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270",
    chain: Chain.polygon,
    decimals: 18,
    quantityFormatter: "USD",
}

export const AAVE: Token = {
    symbol: "AAVE",
    address: "0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9",
    chain: Chain.mainnet,
    decimals: 18,
    quantityFormatter: "USD",
}
export const stkAAVE: Token = {
    symbol: "stkAAVE",
    address: "0x4da27a545c0c5B758a6BA100e3a049001de870f5",
    chain: Chain.mainnet,
    decimals: 18,
    quantityFormatter: "USD",
}

export const COMP: Token = {
    symbol: "COMP",
    address: "0xc00e94Cb662C3520282E6f5717214004A7f26888",
    chain: Chain.mainnet,
    decimals: 18,
    quantityFormatter: "USD",
}

export const CREAM: Token = {
    symbol: "CREAM",
    address: "0x2ba592f78db6436527729929aaf6c908497cb200",
    chain: Chain.mainnet,
    decimals: 18,
    quantityFormatter: "USD",
}

export const CRV: Token = {
    symbol: "CRV",
    address: "0xD533a949740bb3306d119CC777fa900bA034cd52",
    chain: Chain.mainnet,
    decimals: 18,
    quantityFormatter: "USD",
}

export const CVX: Token = {
    symbol: "CVX",
    address: "0x4e3FBD56CD56c3e72c1403e103b45Db9da5B9D2B",
    chain: Chain.mainnet,
    decimals: 18,
    quantityFormatter: "USD",
}

export const ThreeCRV: Token = {
    symbol: "3Crv",
    address: "0x6c3F90f043a72FA612cbac8115EE7e52BDe6E490",
    chain: Chain.mainnet,
    decimals: 18,
    quantityFormatter: "USD",
}

export const crvFRAX: Token = {
    symbol: "crvFRAX",
    address: "0x3175Df0976dFA876431C2E9eE6Bc45b65d3473CC",
    chain: Chain.mainnet,
    decimals: 18,
    quantityFormatter: "USD",
}

export const musd3CRV: Token = {
    symbol: "musd3CRV",
    address: "0x1AEf73d49Dedc4b1778d0706583995958Dc862e6",
    chain: Chain.mainnet,
    decimals: 18,
    quantityFormatter: "USD",
}

export const cyMUSD: Token = {
    symbol: "cyMUSD",
    address: "0xbe86e8918dfc7d3cb10d295fc220f941a1470c5c",
    chain: Chain.mainnet,
    decimals: 8,
    quantityFormatter: "USD",
}

export const BAL: Token = {
    symbol: "BAL",
    address: "0xba100000625a3754423978a60c9317c58a424e3D",
    chain: Chain.mainnet,
    decimals: 18,
    quantityFormatter: "USD",
}

export const PBAL: Token = {
    symbol: "BAL",
    address: "0x9a71012B13CA4d3D0Cdc72A177DF3ef03b0E76A3",
    chain: Chain.polygon,
    decimals: 18,
    quantityFormatter: "USD",
}

export const mBPT: Token = {
    symbol: "mBPT",
    address: "0xe2469f47aB58cf9CF59F9822e3C5De4950a41C49",
    chain: Chain.mainnet,
    decimals: 18,
    quantityFormatter: "USD",
}

export const tokens = [
    TAG,
    TVG,
    AAVE,
    stkAAVE,
    COMP,
    CRV,
    CVX,
    ThreeCRV,
    MTA,
    PMTA,
    vMTA,
    mUSD,
    PmUSD,
    MmUSD,
    mBTC,
    sUSD,
    USDC,
    USDT,
    DAI,
    GUSD,
    BUSD,
    LUSD,
    RAI,
    FLX,
    FEI,
    TRIBE,
    renBTC,
    sBTC,
    WBTC,
    HBTC,
    TBTC,
    TBTCv2,
    alUSD,
    ALCX,
    FRAX,
    PFRAX,
    PUSDC,
    PUSDT,
    PDAI,
    PWMATIC,
    MFRAX,
    mBPT,
    BAL,
    PBAL,
    musd3CRV,
]
