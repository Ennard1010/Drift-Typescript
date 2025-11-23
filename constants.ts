export const INITIALIZE = "initialize";
export const GET_AUCTION_DATA = "getAuctionData";
export const GET_MARKET_DATA = "getMarketData";
export const GET_POSITION_DATA = "getPositionData";
export const GET_OPEN_ORDERS = "getOpenOrders";
export const GET_ACCOUNT_INFO = "getAccountInfo";
export const CANCEL_ORDER = "cancelOrder";
export const SEND_ORDERS = "sendOrders";
export const MARKETS: any = [
	{
		isLoopOn: false,
		marketName: "SOL-PERP",
		baseAssetSymbol: "SOL",
		marketIndex: 0,
		data: {},
	},
	{
		isLoopOn: false,
		marketName: "BTC-PERP",
		baseAssetSymbol: "BTC",
		marketIndex: 1,
		data: {},
	},
	{
		isLoopOn: false,
		marketName: "ETH-PERP",
		baseAssetSymbol: "ETH",
		marketIndex: 2,
		data: {},
	},
];
