import {
	AuctionSubscriber,
	BN,
	DLOBSubscriber,
	DriftClient,
	MarketType,
	OrderSubscriber,
	PerpMarkets,
	PositionDirection,
	UserMap,
	calculateLongShortFundingRate,
	BulkAccountLoader,
	initialize,
	EventSubscriber,
	SlotSubscriber,
	QUOTE_PRECISION,
	SpotMarkets,
	TokenFaucet,
	DriftClientSubscriptionConfig,
	LogProviderConfig,
	getMarketsAndOraclesForSubscription,
	FastSingleTxSender,
	OracleInfo,
	RetryTxSender,
	ConfirmationStrategy,
	PriorityFeeSubscriber,
	PriorityFeeMethod,
	HeliusPriorityFeeResponse,
	HeliusPriorityLevel,
	AverageOverSlotsStrategy,
	BlockhashSubscriber,
	WhileValidTxSender,
	calculateBidAskPrice,
	BASE_PRECISION,
	PostOnlyParams,
	getUserStatsAccountPublicKey,
	isVariant,
} from "@drift-labs/sdk";
import { JitProxyClient, JitterShotgun, PriceType } from "@drift-labs/jit-proxy/lib";
import {
	Commitment,
	Connection,
	Keypair,
	PublicKey,
	Transaction,
	TransactionMessage,
	TransactionVersion,
	VersionedTransaction,
} from "@solana/web3.js";
import { unpackAccount } from "@solana/spl-token";
import WebSocket from "ws";

import bs58 from "bs58";
import * as dotenv from "dotenv";
import { filter, find, keyBy, map } from "lodash";
import {
	CANCEL_ORDER,
	GET_ACCOUNT_INFO,
	GET_AUCTION_DATA,
	GET_MARKET_DATA,
	GET_OPEN_ORDERS,
	GET_POSITION_DATA,
	INITIALIZE,
	MARKETS,
	SEND_ORDERS,
} from "./constants";
import { OrderType } from "@drift-labs/sdk";
import { ERROR, KEY_NOT_FOUND, SUCCESS, SUCCESS_WITH_OBJECT } from "./status";
import { Wallet } from "@coral-xyz/anchor";
import { token } from "@coral-xyz/anchor/dist/cjs/utils";
import { searcherClient } from "jito-ts/dist/sdk/block-engine/searcher";
import { logWithTimestamp, onBundleResult, sendBundles, sendTxWithJito } from "./utils";
import { asBN } from "@drift-labs/sdk/lib/bankrun/bankrunConnection";
dotenv.config();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const mapPrice = (order: any) => {
	const price = Number(order.price.toString());
	const auctionStartPrice = Number(order.auctionStartPrice.toString());
	const auctionEndPrice = Number(order.auctionEndPrice.toString());
	if (price > 0) {
		return price / 1000000;
	}
	if (auctionStartPrice > 0) {
		return auctionStartPrice / 1000000;
	}
	return auctionEndPrice / 1000000;
};
const mapBN = (value: any, dividedBy: number) => {
	return Number(value.toString()) / dividedBy;
};
const getUsdcBalance = async (wallet: Wallet, connection: Connection) => {
	const usdcTokenMintAddress = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
	const associatedAddress = token.associatedAddress({
		mint: usdcTokenMintAddress,
		owner: wallet.publicKey,
	});
	const accountInfo = await connection.getAccountInfo(associatedAddress);

	if (accountInfo) {
		const accountUsdc = unpackAccount(associatedAddress, accountInfo);
		const amount = Number(accountUsdc.amount) / 1000000;
		// console.log("Quantidade USDC na carteira: ", amount);
		return amount;
	} else {
		console.log("No USDC account found.");
		return 0;
	}
};

(async () => {
	const env = "mainnet-beta";
	const sdkConfig = initialize({ env });
	const connection = new Connection(
		"https://neat-indulgent-flower.solana-mainnet.quiknode.pro/dfca96b091f3949ca05fc29866f6e5a8db485f3c/"
	);

	const blockEngineUrl = process.env.BLOCK_ENGINE_URL || "";
	//@ts-ignore
	const decodedKey = new Uint8Array(bs58.decode(process.env.JITO_PVT_KEY));
	const keypair = Keypair.fromSecretKey(decodedKey);

	const bundleTransactionLimit = parseInt(process.env.BUNDLE_TRANSACTION_LIMIT || "0");

	const c = searcherClient(blockEngineUrl, keypair);

	let driftClient: DriftClient,
		userMap: UserMap,
		orderSubscriber: OrderSubscriber,
		dlobSubscriber: DLOBSubscriber,
		user: Keypair,
		wallet: Wallet,
		pvt_key: string,
		auctionSubscriber: AuctionSubscriber,
		jitProxyClient: JitProxyClient,
		ALL_MAP_ORDERS: any = {},
		shouldLoopBeOn: boolean = false;

	const _initialize = async (pvt_key: string, ws: any) => {
		user = Keypair.fromSecretKey(
			//@ts-ignore
			new Uint8Array(bs58.decode(pvt_key))
		);
		wallet = new Wallet(user);

		logWithTimestamp("1- Se inscrevendo no driftClient");

		const driftPublicKey = new PublicKey(sdkConfig.DRIFT_PROGRAM_ID);

		try {
			driftClient = new DriftClient({
				connection: connection,
				wallet: wallet,
				env: "mainnet-beta",
				programID: driftPublicKey,
			});

			await driftClient.subscribe();
		} catch (e) {
			logWithTimestamp({ m: "deu erro aqui", e });
		}

		logWithTimestamp("se inscreveu drift client");
		const subscriptionConfig:
			| {
					type: "polling";
					frequency: number;
					commitment?: Commitment;
			  }
			| {
					type: "websocket";
					resubTimeoutMs?: number;
					commitment?: Commitment;
			  } = {
			type: "websocket",
			resubTimeoutMs: 15_000,
			commitment: "confirmed",
		};
		logWithTimestamp("2- Se inscrevendo no userMap");
		userMap = new UserMap({
			driftClient,
			connection,
			subscriptionConfig,
			skipInitialLoad: false, // skips initial load of user accounts
			includeIdle: false, // filters out idle users
		});
		await userMap.subscribe();
		logWithTimestamp("3- Se inscrevendo no orderSubscriber");
		orderSubscriber = new OrderSubscriber({
			driftClient,
			subscriptionConfig,
		});
		await orderSubscriber.subscribe();
		logWithTimestamp("4- Se inscrevendo no dlobSubscriber");
		dlobSubscriber = new DLOBSubscriber({
			driftClient,
			dlobSource: userMap,
			slotSource: userMap,
			updateFrequency: 1000,
		});
		await dlobSubscriber.subscribe();

		auctionSubscriber = new AuctionSubscriber({
			driftClient,
			opts: { commitment: "confirmed" },
		});

		await auctionSubscriber.subscribe();

		jitProxyClient = new JitProxyClient({
			driftClient,
			programId: new PublicKey("J1TnP8zvVxbtF5KFp5xRmWuvG9McnhzmBd9XGfCyuxFP"),
		});

		const markets_by_index = keyBy(MARKETS, "marketIndex");
		auctionSubscriber.eventEmitter.on("onAccountUpdate", async (taker, takerKey, slot) => {
			logWithTimestamp(`Auction`);
			map(taker.orders, (order) => {
				logWithTimestamp(`Entrou no loop`);
				const price = mapPrice(order);
				logWithTimestamp(price);
				if (price === 0) {
					return;
				}
				const timestamp = `${Date.now()}${order.orderId}${order.marketIndex}`;
				//@ts-ignore
				const takerStatsKey = (0, getUserStatsAccountPublicKey)(driftClient.program.programId, taker.authority);
				ALL_MAP_ORDERS[timestamp] = {
					order,
					orderParam: {
						takerKey,
						takerStatsKey,
						taker,
						takerOrderId: order.orderId,
						maxPosition: asBN(9999900000),
						minPosition: asBN(-9990000000),
						bid: asBN((price + 100) * 1000000),
						ask: asBN((price - 100) * 1000000),
						postOnly: PostOnlyParams.MUST_POST_ONLY,
						priceType: PriceType.LIMIT,
						referrerInfo: undefined,
						subAccountId: undefined,
					},
				};
				const market = markets_by_index[order.marketIndex];
				const direction = Object.keys(order.direction);
				logWithTimestamp(market);
				if (market) {
					ws.send(
						JSON.stringify({
							type: GET_AUCTION_DATA,
							price: price,
							size: mapBN(order.baseAssetAmount, 1000000000),
							baseAssetSymbol: market ? market.baseAssetSymbol : null,
							direction: direction[0],
							orderId: timestamp,
							status: SUCCESS_WITH_OBJECT,
						})
					);
				}
				return {
					price: price,
					size: mapBN(order.baseAssetAmount, 1000000000),
					market: market ? market.baseAssetSymbol : null,
					direction: direction[0],
					orderId: timestamp,
				};
			});
		});
	};

	const wsConditions = async (data: any, ws: any) => {
		switch (data.function) {
			case SEND_ORDERS:
				if (!data.orderId) {
					return {
						type: SEND_ORDERS,
						msg: "OrderId not informed",
						status: KEY_NOT_FOUND,
					};
				}
				const orderParams = ALL_MAP_ORDERS[data.orderId].orderParam;

				try {
					const PRIORITY_RATE = 15000000; // MICRO_LAMPORTS
					const txParams = {
						computeUnits: PRIORITY_RATE,
						computeUnitsPrice: PRIORITY_RATE,
					};
					logWithTimestamp("Starting transaction");
					logWithTimestamp(orderParams);
					const ix = await jitProxyClient.getJitIx(orderParams);
					const tx = await driftClient.buildTransaction([ix], txParams);
					const transacitonId = await driftClient.sendTransaction(tx, undefined, { skipPreflight: true });
					// return await sendBundle(tx);
					// const transacitonId = await jitProxyClient.jit(orderParams, txParams);
					return {
						type: SEND_ORDERS,
						orderId: transacitonId,
						status: SUCCESS_WITH_OBJECT,
					};
					// const test = async (ix: any) => {
					// 	console.log("passou aqui");
					// 	const blockHash = await connection.getLatestBlockhash();
					// 	const messageV0 = new TransactionMessage({
					// 		payerKey: user.publicKey,
					// 		recentBlockhash: blockHash.blockhash,
					// 		instructions: [ix],
					// 	}).compileToV0Message();

					// 	const tx = new VersionedTransaction(messageV0);
					// 	tx.sign([user]);
					// 	console.log("Ate aqui");
					// 	// await sendTxWithJito({ serialisedTx: tx.serialize() });
					// 	await sendBundles(c, bundleTransactionLimit, user, connection, tx);
					// };

					// const orderParams = {
					// 	orderType: order.orderType,
					// 	marketType: order.marketType,
					// 	direction: order.direction,
					// 	userOrderId: order.userOrderId,
					// 	baseAssetAmount: order.baseAssetAmount,
					// 	price: order.price,
					// 	marketIndex: order.marketIndex,
					// 	reduceOnly: order.reduceOnly,
					// 	postOnly: PostOnlyParams.NONE,
					// 	immediateOrCancel: order.immediateOrCancel,
					// 	maxTs: order.maxTs,
					// 	triggerPrice: order.triggerPrice,
					// 	triggerCondition: order.triggerCondition,
					// 	oraclePriceOffset: order.oraclePriceOffset,
					// 	auctionDuration: order.auctionDuration,
					// 	auctionStartPrice: order.auctionStartPrice,
					// 	auctionEndPrice: order.auctionEndPrice,
					// };
					// logWithTimestamp(instructions);
					// const messageV0 = new TransactionMessage({
					// 	payerKey: user.publicKey,
					// 	recentBlockhash: blockHash.blockhash,
					// 	instructions: [instructions],
					// }).compileToV0Message();

					// const tx = new VersionedTransaction(messageV0);

					// tx.sign([user]);

					// console.log("txn signature is: ", bs58.encode(tx.signatures[0]));
					// logWithTimestamp("Transaction montada");
					// await sendBundles(c, bundleTransactionLimit, user, connection, tx);
					// logWithTimestamp(`Order executed: ${order.orderId}`);
				} catch (error) {
					logWithTimestamp("Error executing order");
					logWithTimestamp(error);
					return {
						type: SEND_ORDERS,
						msg: error,
						status: ERROR,
					};
				}
			default:
				return {};
		}
	};

	const wss = new WebSocket.Server({ port: 8080 });
	console.log("Websocket iniciado");
	//@ts-ignore
	wss.on("connection", (ws) => {
		console.log("Client connected");
		shouldLoopBeOn = true;
		ws.on("message", async (buffer) => {
			try {
				var msg = buffer.toString();
				var data = JSON.parse(msg);
				let response = {};
				if (data.function === INITIALIZE) {
					if (user) {
						if (pvt_key == data.pvt_key) {
							response = { type: INITIALIZE, msg: "pvt key ja informada", status: SUCCESS };
						} else {
							await _initialize(data.pvt_key, ws);
							response = { type: INITIALIZE, msg: "Nova pvt key informada", status: SUCCESS };
						}
					} else {
						await _initialize(data.pvt_key, ws);
						pvt_key = data.pvt_key;
						response = { type: INITIALIZE, msg: "Podemos comecar!", status: SUCCESS };
					}
				} else if (driftClient) {
					response = await wsConditions(data, ws);
				} else {
					response = {
						type: "NOT_FOUND",
						msg: "pvt_key nao informada",
						status: KEY_NOT_FOUND,
					};
				}
				console.log("enviando no websocket:", response);
				ws.send(JSON.stringify({ id: data.id, ...response }));
			} catch (invalidJSON) {
				console.error("Erro ao processar mensagem", invalidJSON);
				ws.send(JSON.stringify({ erro: "mensagem invalida- formato JSON necessario" }));
			}
		});

		ws.on("close", () => {
			shouldLoopBeOn = false;
			console.log("Client disconnected");
		});
	});
})();
