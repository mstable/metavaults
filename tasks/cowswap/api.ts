import { logger } from "@tasks/utils/logger"
import { ZERO, ZERO_ADDRESS } from "@utils/constants"
import { BN } from "@utils/math"
import axios from "axios"

import { Chain } from "../utils/tokens"

const log = logger("cowswap")

export const DEFAULT_APP_DATA_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000"

export interface CowSwapContext {
    trader?: string
    deadline?: BN
    chainId: Chain
}
interface SellOrderParams {
    fromAsset: string
    toAsset: string
    fromAssetAmount: BN
    receiver: string
}
interface PostOrderParams {
    fromAsset: string
    toAsset: string
    fromAssetAmount: BN
    feeAmount: BN
    toAssetAmountAfterFee: BN
    receiver: string
}
interface FeeAndQuote {
    fee: {
        amount: BN
        expirationDate: Date
    }
    buyAmountAfterFee: BN
}
interface QuoteOrder {
    quote: {
        sellToken: string
        buyToken: string
        receiver?: string
        sellAmount: BN
        buyAmount: BN
        validTo: BN
        appData?: string
        feeAmount: BN
        kind: string
        partiallyFillable: boolean
        sellTokenBalance: string
        buyTokenBalance: string
    }
    from?: string
    expiration: Date
    id: number
}

export interface TradeMetaData {
    blockNumber: number
    logIndex: number
    orderUid: string
    owner: string
    sellToken: string
    buyToken: string
    sellAmount: string
    buyAmount: string
    sellAmountBeforeFees: string
    txHash: string
}

// enable axios logging
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function enableAxiosLogger() {
    axios.interceptors.request.use((request) => {
        log("Starting Request", JSON.stringify(request, null, 2))
        return request
    })

    axios.interceptors.response.use((response) => {
        log("Response:", response)
        return response
    })
}
// enableAxiosLogger()
/**
 * Get the bases URL of the Gnosis protocol API for all supported chains.
 *
 * @param {boolean} isDev
 * @return {*}  {Partial<Record<Chain, string>>} The base urls for all supported chains.
 */
function getGnosisProtocolUrl(isDev: boolean): Partial<Record<Chain, string>> {
    if (isDev) {
        return {
            [Chain.mainnet]: "https://barn.api.cow.fi/mainnet/api",
            [Chain.rinkeby]: "https://barn.api.cow.fi/rinkeby/api",
            // [Chain.GNOSIS_CHAIN]: 'https://barn.api.cow.fi/xdai/api',
        }
    }
    return {
        [Chain.mainnet]: "https://api.cow.fi/mainnet/api",
        [Chain.rinkeby]: "https://api.cow.fi/rinkeby/api",
        // [Chain.GNOSIS_CHAIN]: 'https://api.cow.fi/xdai/api',
    }
}

/**
 * Gets the URL of the feeAndQuote API depending of the chain id.
 * @deprecated Gnosis has marked this end point as deprecated @see  https://api.cow.fi/docs/#/
 * @param {Chain} chainId
 * @return {string}  The endpoint.
 */
const getFeeAndQuoteURL = (chainId: Chain) => {
    return `${getGnosisProtocolUrl(false)[chainId]}/v1/feeAndQuote/sell`
}

/**
 * Gets the URL of the quote API depending of the chain id.
 * @param {Chain} chainId
 * @return {string}  The endpoint.
 */
const getOrdersURL = (chainId: Chain) => `${getGnosisProtocolUrl(false)[chainId]}/v1/orders`
/**
 * Gets the URL of the trades API depending of the chain id.
 * @param {Chain} chainId
 * @return {string}  The endpoint.
 */
const getTradesURL = (chainId: Chain) => `${getGnosisProtocolUrl(false)[chainId]}/v1/trades`

/**
 * Gets the URL of the quote API depending of the chain id.
 * @param {Chain} chainId
 * @return {string}  The endpoint.
 */
const getQuoteURL = (chainId: Chain) => `${getGnosisProtocolUrl(false)[chainId]}/v1/quote`

/**
 * Computes the minimum fee and a price estimate for the order. It returns a full order that can be used directly for signing, and with an included signature, passed directly to the order creation endpoint.
 *
 * @param {Chain} chainId The chain id of the network.
 * @param {string} fromAsset The address of the asset to sell
 * @param {string} toAsset The address of the asset to buy
 * @param {BN} fromAssetAmount The amount assets to sell.
 * @return {Promise<QuoteOrder>} the order quote
 */
export const getQuote = async (chainId: Chain, fromAsset: string, toAsset: string, fromAssetAmount: BN): Promise<QuoteOrder> => {
    const quoteURL = getQuoteURL(chainId)
    // The fee is taken from the sell token before the swap.
    const quotePayload = {
        sellToken: fromAsset,
        buyToken: toAsset,
        from: ZERO_ADDRESS,
        appData: DEFAULT_APP_DATA_HASH, //TODO - generate app data for mstable
        partiallyFillable: false,
        sellTokenBalance: "erc20",
        buyTokenBalance: "erc20",
        priceQuality: "fast", //optimal , fast
        kind: "sell",
        sellAmountBeforeFee: fromAssetAmount.toString(),
    }

    const response = await axios.post(quoteURL, quotePayload)
    const quote = { ...response.data.quote }
    quote.sellAmount = BN.from(quote.sellAmount)
    quote.buyAmount = BN.from(quote.buyAmount)
    quote.feeAmount = BN.from(quote.feeAmount)

    const quoteOrder: QuoteOrder = {
        ...response.data,
        quote: { ...quote },
        expiration: new Date(response.data.expiration), // Example '2022-07-05T14:54:43.359280952Z'
    }
    return quoteOrder
}
/**
 * Gets the fee and quote the order
 * @deprecated use getQuote instead
 * @param {Chain} chainId The chain id of the network.
 * @param {string} fromAsset The address of the asset to sell
 * @param {string} toAsset The address of the asset to buy
 * @param {BN} fromAssetAmount The amount assets to sell.
 * @return {Promise<FeeAndQuote>} The fee and quote of the order.
 */
export const getFeeAndQuote = async (chainId: Chain, fromAsset: string, toAsset: string, fromAssetAmount: BN): Promise<FeeAndQuote> => {
    const feeAndQuoteURL = getFeeAndQuoteURL(chainId)
    const feeAndQuoteParams = {
        sellToken: fromAsset,
        buyToken: toAsset,
        sellAmountBeforeFee: fromAssetAmount.toString(),
    }
    const response = await axios.get(feeAndQuoteURL, { params: feeAndQuoteParams })
    const feeAndQuote: FeeAndQuote = {
        fee: {
            amount: BN.from(response.data.fee.amount),
            expirationDate: new Date(response.data.fee.expirationDate), // Example '2022-07-05T14:54:43.359280952Z'
        },
        buyAmountAfterFee: BN.from(response.data.buyAmountAfterFee),
    }
    return feeAndQuote
}

/**
 * Validates fee amount and to asset amount are gt than zero.
 *
 * @param {BN} feeAmount
 * @param {BN} toAssetAmountAfterFee
 */
const validateQuote = (feeAmount: BN, toAssetAmountAfterFee: BN) => {
    if (!feeAmount.gt(ZERO)) throw new Error("wrong fee amount")
    if (!toAssetAmountAfterFee.gt(ZERO)) throw new Error("wrong buy amount")
}

/**
 * Invokes the POST Order API and creates an order on Cowswap, it returns the order uid
 * @param {CowSwapContext} context
 * @param {PostOrderParams} params
 * @return {Promise<string>} The order uid Unique identifier for the order: 56 bytes encoded as hex with 0x prefix. Bytes 0 to 32 are the order digest, bytes 30 to 52 the owner address and bytes 52..56 valid to,
 */
async function postSellOrder(context: CowSwapContext, params: PostOrderParams): Promise<string> {
    const { fromAsset, toAsset, fromAssetAmount, feeAmount, toAssetAmountAfterFee, receiver } = params

    // # Contract used to sign the order context.trader
    const deadline = context.deadline.add(Math.floor(new Date().getTime() / 1000)).toNumber()
    const orderPayload = {
        sellToken: fromAsset,
        buyToken: toAsset,
        sellAmount: fromAssetAmount.sub(feeAmount).toString(),
        buyAmount: toAssetAmountAfterFee.toString(),
        validTo: deadline,
        appData: DEFAULT_APP_DATA_HASH,
        feeAmount: feeAmount.toString(),
        kind: "sell",
        partiallyFillable: false,
        receiver: receiver,
        signature: context.trader, // # Contract used to sign the order context.trader
        from: context.trader,
        sellTokenBalance: "erc20",
        buyTokenBalance: "erc20",
        signingScheme: "presign", // # Very important. this tells the api you are going to sign on chain
    }
    const ordersURL = getOrdersURL(context.chainId)
    const response = await axios.post(ordersURL, orderPayload)
    if (!(response.status === 201 || response.status === 200)) throw new Error(response.statusText)
    const orderUid = response.data

    log(`postSellOrder Order uid: ${orderUid}`)
    return orderUid
}
/**
 * Place a sell order on cowswap api.
 *
 * @param {CowSwapContext} context
 * @param {SellOrderParams} params
 * @return {Promise<{ orderUid: string, fromAssetFeeAmount: BN }>} The order uid and the "sell amount after the fee"
 */
export const placeSellOrder = async (
    context: CowSwapContext,
    params: SellOrderParams,
): Promise<{ orderUid: string; fromAssetFeeAmount: BN; toAssetAmountAfterFee: BN }> => {
    const { fromAsset, toAsset, fromAssetAmount, receiver } = params

    const quoteOrder = await getQuote(context.chainId, fromAsset, toAsset, fromAssetAmount)

    // # These two values are needed to create an order
    const feeAmount = quoteOrder.quote.feeAmount
    const toAssetAmountAfterFee = quoteOrder.quote.buyAmount

    validateQuote(feeAmount, toAssetAmountAfterFee)

    // # placeSellOrder order
    const orderUid = await postSellOrder(context, { fromAsset, toAsset, fromAssetAmount, feeAmount, toAssetAmountAfterFee, receiver })
    return { orderUid, fromAssetFeeAmount: feeAmount, toAssetAmountAfterFee }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const placeSellOrderLegacy = async (
    context: CowSwapContext,
    params: SellOrderParams,
): Promise<{ orderUid: string; fromAssetFeeAmount: BN }> => {
    const { fromAsset, toAsset, fromAssetAmount, receiver } = params
    // # get the fee + the buy fromAssetAmount after fee
    const feeAndQuote = await getFeeAndQuote(context.chainId, fromAsset, toAsset, fromAssetAmount)

    // # These two values are needed to create an order
    const feeAmount = feeAndQuote.fee.amount
    const toAssetAmountAfterFee = BN.from(feeAndQuote.buyAmountAfterFee)

    validateQuote(feeAmount, toAssetAmountAfterFee)

    // # placeSellOrder order
    const orderUid = await postSellOrder(context, { fromAsset, toAsset, fromAssetAmount, feeAmount, toAssetAmountAfterFee, receiver })
    return { orderUid, fromAssetFeeAmount: feeAmount }
}
/**
 * Gets the order details by order uid.
 *
 * @param {CowSwapContext} context
 * @param {string} orderUid
 * @return [] array of trades
 */
export const getOrderDetails = async (context: CowSwapContext, orderUid: string) => {
    // https://api.cow.fi/mainnet/api/v1/trades?orderUid=0xc21b7756caf1f6df13e9947767204620371ca791a4b91db8620f04905d25b608e0b3700e0aadcb18ed8d4bff648bc99896a18ad160ef0bca
    const tradesURL = getTradesURL(context.chainId)
    const tradesParams = { orderUid }
    // One order can be filled with multiple trades
    return (await axios.get(tradesURL, { params: tradesParams })).data as unknown as Array<TradeMetaData>
}
