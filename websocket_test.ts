import { filter, find } from "lodash";
import WebSocket from "ws";
import {
	GET_ACCOUNT_INFO,
	GET_MARKET_DATA,
	GET_OPEN_ORDERS,
	GET_POSITION_DATA,
	CANCEL_ORDER,
	SEND_ORDERS,
	INITIALIZE,
} from "./constants";

import { ERROR, SUCCESS, SUCCESS_WITH_OBJECT } from "./status";
import * as dotenv from "dotenv";
import { OrderType } from "@drift-labs/sdk";
dotenv.config();
// Create a WebSocket client and connect to the server
const ws = new WebSocket("ws://localhost:8080");
const request = {
	id: "xxxaaa",
	function: INITIALIZE,
	pvt_key: process.env.PVT_KEY,
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

ws.on("open", async () => {
	console.log("Connected to WebSocket server");

	ws.send(JSON.stringify(request));

	// await sleep(50000);
	// ws.send(JSON.stringify({ id: "xpto-123", function: GET_MARKET_DATA, token: "ETH" }));
});

ws.onmessage = (event: any) => {
	try {
		const data = JSON.parse(event.data);
		// console.log(data.orderBook.bids[0]);
		//@ts-ignore
		console.log(data);
		if (data && data.market === "BTC") {
			// ws.send(JSON.stringify({ id: "ETH-123", function: GET_MARKET_DATA, token: "BTC" }));
			console.log("mandando order");
			ws.send(
				JSON.stringify({
					orderId: data.orderId,
					function: SEND_ORDERS,
				})
			);
			// ws.send(JSON.stringify({ id: "BTC-123", function: GET_MARKET_DATA, token: "BTC" }));
			// ws.send(JSON.stringify({ id: "SOL-123", function: GET_MARKET_DATA, token: "SOL" }));
		}

		if (data.status === ERROR) {
			// ws.send(
			// 	JSON.stringify({
			// 		id: "ETH-123",
			// 		function: SEND_ORDERS,
			// 		token: "BTC",
			// 		orderType: OrderType.MARKET,
			// 		direction: "LONG",
			// 		assetAmount: 0.0001,
			// 		price: 62520,
			// 	})
			// );
		}

		if (data.status === SUCCESS_WITH_OBJECT) {
			// console.log(data.orderBook);
		}
		return false;
	} catch (e) {
		console.error("Error parsing message from server:", e);
	}
};

ws.on("close", () => {
	console.log("Disconnected from WebSocket server");
});

ws.on("error", (error) => {
	console.error(`WebSocket error: ${error}`);
});
