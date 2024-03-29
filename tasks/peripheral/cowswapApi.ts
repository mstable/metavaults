import { logger } from "@tasks/utils/logger"
import { ZERO, ZERO_ADDRESS } from "@utils/constants"
import { BN } from "@utils/math"
import axios from "axios"
import { formatUnits } from "ethers/lib/utils"

import { Chain } from "../utils/tokens"

const log = logger("cowswap")

// TODO - generate one for mstable
export const DEFAULT_APP_DATA_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000"

export interface CowSwapContext {
    trader?: string
    deadline?: BN
    chainId: Chain
}
export interface SellOrderParams {
    fromAsset: string
    toAsset: string
    fromAssetAmount: BN
    receiver: string
}
export interface PostOrderParams {
    fromAsset: string
    toAsset: string
    fromAssetAmount: BN
    feeAmount: BN
    toAssetAmountAfterFee: BN
    receiver: string
}
export interface FeeAndQuote {
    fee: {
        amount: BN
        expirationDate: Date
    }
    buyAmountAfterFee: BN
}
export interface QuoteOrder {
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

export interface Order {
    sellToken: string
    buyToken: string
    receiver?: string
    sellAmount: BN
    buyAmount: BN
    validTo: BN
    feeAmount: BN
    kind: string
    partiallyFillable: boolean
    status: string
}
export interface CreatedOrder {
    sellToken: string
    buyToken: string
    receiver?: string
    sellAmount: BN
    buyAmount: BN
    validTo: BN
    feeAmount: BN
    kind: string
    partiallyFillable: boolean
    status: string
    uid: string
    creationDate: Date
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
            // [Chain.GNOSIS_CHAIN]: 'https://barn.api.cow.fi/xdai/api',
        }
    }
    return {
        [Chain.mainnet]: "https://api.cow.fi/mainnet/api",
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
 * Gets the URL of the quote API depending of the chain id.
 * @param {Chain} chainId
 * @return {string}  The endpoint.
 */
const getOwnerOrdersURL = (chainId: Chain, owner: string) => `${getGnosisProtocolUrl(false)[chainId]}/v1/account/${owner}/orders`

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

    try {
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
    } catch (err) {
        throw Error(`Failed to post quote to CoW Swap`, { cause: err })
    }
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
    try {
        const response = await axios.get(feeAndQuoteURL, { params: feeAndQuoteParams })
        const feeAndQuote: FeeAndQuote = {
            fee: {
                amount: BN.from(response.data.fee.amount),
                expirationDate: new Date(response.data.fee.expirationDate), // Example '2022-07-05T14:54:43.359280952Z'
            },
            buyAmountAfterFee: BN.from(response.data.buyAmountAfterFee),
        }
        return feeAndQuote
    } catch (err) {
        throw Error(`Failed to get fee and quote from CoW Swap`, { cause: err })
    }
}
export const getOrder = async (chainId: Chain, uid: string): Promise<Order> => {
    const url = getOrdersURL(chainId) + "/" + uid

    try {
        const response = await axios.get(url)
        const order = { ...response.data }

        order.sellAmount = BN.from(order.sellAmount)
        order.buyAmount = BN.from(order.buyAmount)
        order.feeAmount = BN.from(order.feeAmount)

        return order
    } catch (err) {
        throw Error(`Failed to get order from CoW Swap`, { cause: err })
    }
}
export const getOwnerOrders = async (chainId: Chain, owner: string): Promise<Array<CreatedOrder>> => {
    const url = getOwnerOrdersURL(chainId, owner)

    try {
        const response = await axios.get(url)
        const orders = response.data
        return orders.map((order) => ({
            ...order,
            sellAmount: BN.from(order.sellAmount),
            buyAmount: BN.from(order.buyAmount),
            feeAmount: BN.from(order.feeAmount),
            creationDate: new Date(order.creationDate),
        }))
    } catch (err) {
        throw Error(`Failed to get order from CoW Swap`, { cause: err })
    }
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
export const postSellOrder = async (context: CowSwapContext, params: PostOrderParams): Promise<string> => {
    const { fromAsset, toAsset, fromAssetAmount, feeAmount, toAssetAmountAfterFee, receiver } = params

    // # Contract used to sign the order context.trader
    const currentUnixTime = Math.floor(new Date().getTime() / 1000)
    const deadline = context.deadline.add(currentUnixTime).toNumber()
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
    try {
        const response = await axios.post(ordersURL, orderPayload)
        if (!(response.status === 201 || response.status === 200)) throw new Error(response.statusText)
        const orderUid = response.data
        log(`Order uid: ${orderUid}`)
        return orderUid
    } catch (err) {
        if (err?.response?.data?.description) {
            if (err?.response?.data?.errorType === "InsufficientFee") {
                throw Error(`Failed to post order to CoW Swap with fee ${formatUnits(feeAmount)}: ${err.response.data.description}`, {
                    cause: err,
                })
            }
            throw Error(`Failed to post order to CoW Swap: ${err.response.data.description}`, { cause: err })
        } else {
            throw Error(`Failed to post order to CoW Swap`, { cause: err })
        }
    }
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
    // https://api.cow.fi/mainnet/api/v1/orders/0xef86243d05ef15b02484dff412699997360173d88e49cc1c55c6c68a6eb8e5ad86f800375b525300ad609644068a0753bf8de1e26353d6eb
    const tradesURL = getTradesURL(context.chainId)
    const tradesParams = { orderUid }
    // One order can be filled with multiple trades
    return (await axios.get(tradesURL, { params: tradesParams })).data as unknown as Array<TradeMetaData>
}
