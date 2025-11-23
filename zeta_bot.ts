import { BN, Wallet } from "@coral-xyz/anchor";

import { Commitment, Connection, Keypair, PublicKey } from "@solana/web3.js";
import { unpackAccount } from "@solana/spl-token";
import WebSocket from "ws";
import { CrossClient, Exchange, Network, utils, types, assets, events, constants } from "@zetamarkets/sdk";
import bs58 from "bs58";
import { token } from "@coral-xyz/anchor/dist/cjs/utils";
import * as dotenv from "dotenv";
import { find, map } from "lodash";
import {
	CANCEL_ORDER,
	GET_ACCOUNT_INFO,
	GET_MARKET_DATA,
	GET_OPEN_ORDERS,
	GET_POSITION_DATA,
	INITIALIZE,
	MARKETS,
	SEND_ORDERS,
} from "./constants";
import { ERROR, KEY_NOT_FOUND, SUCCESS, SUCCESS_WITH_OBJECT } from "./status";
import fetch from "node-fetch";
dotenv.config();

(async () => {
	const server_url = "https://dex-devnet-webserver-ecs.zeta.markets";
	const env = "mainnet-beta";
	const connection = new Connection(
		"https://neat-indulgent-flower.solana-mainnet.quiknode.pro/dfca96b091f3949ca05fc29866f6e5a8db485f3c/"
	);
	// let user: Keypair, wallet: Wallet, pvt_key: string;
	// user = Keypair.fromSecretKey(
	// 	//@ts-ignore
	// 	new Uint8Array(bs58.decode(pvt_key))
	// );
	// wallet = new Wallet(user);

	let loadExchangeConfig = types.defaultLoadExchangeConfig(
		Network.MAINNET,
		connection,
		utils.defaultCommitment(),
		0,
		true
	);

	await Exchange.load(
		loadExchangeConfig
		// , wallet
		// , exchangeCallback
	);

	Exchange.getAllSubExchanges().forEach(async (se) => {
		await se.updatePerpSerumMarketIfNeeded(0);
	});

	let tradingAsset = constants.Asset.BTC;

	console.log("aqui", Exchange.getOrderbook(tradingAsset));

	// const client = await CrossClient.load(
	// 	connection,
	// 	wallet,
	// 	undefined
	// 	// , clientCallback
	// );

	// await fetch(`${server_url}/faucet/USDC`, {
	// 	method: "post",
	// 	body: JSON.stringify({
	// 		key: wallet.publicKey.toString(),
	// 		amount: 10_000,
	// 	}),
	// 	headers: { "Content-Type": "application/json" },
	// });

	// Place bid orders
	//   await client.placeOrder(
	//     tradingAsset,
	//     utils.convertDecimalToNativeInteger(0.1),
	//     utils.convertDecimalToNativeLotSize(2),
	//     types.Side.BID,
	//     { tifOptions: {}, orderType: types.OrderType.LIMIT } // Extra optional parameters
	//   );
})();
