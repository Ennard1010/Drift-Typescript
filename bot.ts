import {
	BN,
	DLOBSubscriber,
	DriftClient,
	MarketType,
	OrderSubscriber,
	PerpMarkets,
	PositionDirection,
	UserMap,
	calculateLongShortFundingRate,
} from "@drift-labs/sdk";
import { Commitment, Connection, Keypair, PublicKey, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { unpackAccount } from "@solana/spl-token";
import WebSocket from "ws";

import bs58 from "bs58";
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
import { OrderType } from "@drift-labs/sdk";
import { ERROR, KEY_NOT_FOUND, SUCCESS, SUCCESS_WITH_OBJECT } from "./status";
import { Wallet } from "@coral-xyz/anchor";
import { token } from "@coral-xyz/anchor/dist/cjs/utils";
import { searcherClient } from "jito-ts/dist/sdk/block-engine/searcher";
import { onBundleResult, sendBundles } from "./utils";
dotenv.config();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const mapPrice = (price: BN) => {
	return Number(price.toString()) / 1000000;
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
		shouldLoopBeOn: boolean = false;

	const initialize = async (pvt_key: string) => {
		user = Keypair.fromSecretKey(
			//@ts-ignore
			new Uint8Array(bs58.decode(pvt_key))
		);
		wallet = new Wallet(user);
		//@ts-ignore
		console.log("1- Se inscrevendo no driftClient");
		try {
			driftClient = new DriftClient({
				connection: connection,
				wallet: wallet,
				env: "mainnet-beta",
			});
			await driftClient.subscribe();
		} catch (e) {
			console.log("deu erro aqui", e);
		}

		console.log("se inscreveu drift client");
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
		console.log("2- Se inscrevendo no userMap");
		userMap = new UserMap({
			driftClient,
			connection,
			subscriptionConfig,
			skipInitialLoad: false, // skips initial load of user accounts
			includeIdle: false, // filters out idle users
		});
		await userMap.subscribe();
		console.log("3- Se inscrevendo no orderSubscriber");
		orderSubscriber = new OrderSubscriber({
			driftClient,
			subscriptionConfig,
		});
		await orderSubscriber.subscribe();
		console.log("4- Se inscrevendo no dlobSubscriber");
		dlobSubscriber = new DLOBSubscriber({
			driftClient,
			dlobSource: userMap,
			slotSource: userMap,
			updateFrequency: 1000,
		});
		await dlobSubscriber.subscribe();
	};

	const wsConditions = async (data: any, ws: any) => {
		if (!data.token) {
			return {
				msg: "token nao informado",
				status: KEY_NOT_FOUND,
			};
		}
		const token = find(MARKETS, (market) => market.baseAssetSymbol == data.token);
		if (!token) {
			return {
				msg: "token nao informado",
				status: KEY_NOT_FOUND,
			};
		}
		const userDrift = driftClient.getUser();
		const marketInfo = PerpMarkets[env].find((_market) => _market.baseAssetSymbol === token.baseAssetSymbol) || {
			marketIndex: 0,
		};
		const solMarketAccount = driftClient.getPerpMarketAccount(token.marketIndex);
		const userPerpPosition = userDrift.getPerpPosition(token.marketIndex);
		const pnl = userDrift.getUnrealizedPNL(true, 0);
		const funding_pnl = await userDrift.getUnrealizedFundingPNL(0);
		const liquidationPrice = userDrift.liquidationPrice(0);
		const orderId = data.orderId;
		const orderinfo = userDrift.getOrder(orderId);
		switch (data.function) {
			case GET_MARKET_DATA:
				token.isLoopOn = true;
				while (token.isLoopOn && shouldLoopBeOn) {
					await sleep(200);
					const oracle_loop = driftClient.getOracleDataForPerpMarket(token.marketIndex);
					const funding_loop =
						solMarketAccount && (await calculateLongShortFundingRate(solMarketAccount, oracle_loop));
					const orderBookToTranslate = dlobSubscriber.getL2({
						marketName: token.marketName,
					});
					const mappedAsk = map(orderBookToTranslate.asks, (orderbook) => mapPrice(orderbook.price));
					const mappedBid = map(orderBookToTranslate.bids, (orderbook) => mapPrice(orderbook.price));
					const funding_1 = funding_loop && funding_loop[0].toString();
					const funding_2 = funding_loop && funding_loop[1].toString();
					ws.send(
						JSON.stringify({
							type: GET_MARKET_DATA,
							marketName: token.marketName,
							baseAssetSymbol: token.baseAssetSymbol,
							orderBook: { asks: mappedAsk, bids: mappedBid },
							oraclePrice: Number(oracle_loop.price.toString()) / 1000000,
							funding: [funding_1, funding_2],
							status: SUCCESS_WITH_OBJECT,
						})
					);
				}
			case GET_ACCOUNT_INFO:
				const balance = await getUsdcBalance(wallet, connection);
				//puxa o saldo total
				const totalCollateral = await userDrift.getTotalCollateral();
				var totalCollateral_1 = Number(parseFloat(totalCollateral.toString()).toFixed()) / 1000000;
				// puxa o saldo disponível
				const freeCollateral = userDrift.getFreeCollateral();
				var freeCollateral_1 = Number(parseFloat(freeCollateral.toString()).toFixed()) / 1000000;
				return {
					type: GET_ACCOUNT_INFO,
					walletBalance: balance,
					totalCollateral: totalCollateral_1,
					freeCollateral: freeCollateral_1,
					status: SUCCESS_WITH_OBJECT,
				};
			case GET_POSITION_DATA:
				// Logica do position data vai aqui \/
				const baseAssetAmount = Math.abs(Number(userPerpPosition?.baseAssetAmount.toString())) / 1000000000;
				const quoteEntryAmount = Number(userPerpPosition?.quoteEntryAmount.toString()) / 1000000;
				const entry_price = quoteEntryAmount / baseAssetAmount;
				return {
					type: GET_POSITION_DATA,
					positionSize: Number(userPerpPosition?.baseAssetAmount.toString()) / 1000000000,
					entryPrice: entry_price,
					unsettledPnl: Number(pnl.toString()) / 100000,
					liquidationPrice: Number(liquidationPrice.toString()) / 1000000,
					status: SUCCESS_WITH_OBJECT,
				};
			case GET_OPEN_ORDERS:
				if (!data.orderId) {
					return {
						type: GET_OPEN_ORDERS,
						msg: "orderId nao informado",
						status: KEY_NOT_FOUND,
					};
				}
				// Logica do open orders vai aqui \/
				const tamanhoOrdem = orderinfo?.baseAssetAmount;
				const precoOrdem = orderinfo?.price;
				const tipoOrdem = orderinfo?.marketType;
				const filledOrdem = orderinfo?.baseAssetAmountFilled;
				return {
					type: GET_OPEN_ORDERS,
					tipoOrdem: tipoOrdem,
					tamanhoOrdem: tamanhoOrdem,
					precoOrdem: precoOrdem,
					filledOrdem: filledOrdem,
					status: SUCCESS_WITH_OBJECT,
				};
			case CANCEL_ORDER:
				if (!data.orderId) {
					return {
						type: CANCEL_ORDER,
						msg: "orderId nao informado",
						status: KEY_NOT_FOUND,
					};
				}
				//Logica do cancel order \/
				//cancela ordem pelo id
				const cancelarOrdemId = driftClient.cancelOrdersByIds([orderId]);
				return {
					type: CANCEL_ORDER,
					cancelarOrdemId: cancelarOrdemId,
					status: SUCCESS_WITH_OBJECT,
				};
			case SEND_ORDERS:
				if (!data.assetAmount) {
					return {
						type: SEND_ORDERS,
						msg: "assetAmout nao informado",
						status: KEY_NOT_FOUND,
					};
				}
				const orderParams = {
					orderType: data.orderType == "LIMIT" ? OrderType.LIMIT : OrderType.MARKET,
					marketIndex: token.marketIndex,
					direction: data.direction == "LONG" ? PositionDirection.LONG : PositionDirection.SHORT,
					baseAssetAmount: driftClient.convertToPerpPrecision(data.assetAmount),
					// price: driftClient.convertToPricePrecision(data.price),
				};
				try {
					console.log("Montando transaction");
					const blockHash = await connection.getLatestBlockhash();
					const instructions = await driftClient.getPlacePerpOrderIx(orderParams);
					const messageV0 = new TransactionMessage({
						payerKey: user.publicKey,
						recentBlockhash: blockHash.blockhash,
						instructions: [instructions],
					}).compileToV0Message();

					const tx = new VersionedTransaction(messageV0);

					tx.sign([user]);

					console.log("txn signature is: ", bs58.encode(tx.signatures[0]));
					console.log("Transaction montada");
					const orderColocada = await sendBundles(c, bundleTransactionLimit, user, connection, tx);
					console.log("Order placed:", orderColocada);
					return {
						clientOrderId: data.clientOrderId,
						amount: data.assetAmount,
						side: data.direction,
						type: SEND_ORDERS,
						token: data.token,
						status: SUCCESS_WITH_OBJECT,
					};
				} catch (e) {
					console.log("error while placing order", e);
					return {
						type: SEND_ORDERS,
						msg: e,
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
							await initialize(data.pvt_key);
							response = { type: INITIALIZE, msg: "Nova pvt key informada", status: SUCCESS };
						}
					} else {
						await initialize(data.pvt_key);
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

	//  console.log(OrderColocada)
})();
