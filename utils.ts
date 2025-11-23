import {
	Connection,
	Keypair,
	PublicKey,
	SendOptions,
	TransactionInstruction,
	TransactionMessage,
	VersionedTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";

import { SearcherClient } from "jito-ts/dist/sdk/block-engine/searcher";
import { Bundle } from "jito-ts/dist/sdk/block-engine/types";
import { isError } from "util";

const MEMO_PROGRAM_ID = "Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo";

export const sendBundles = async (
	c: SearcherClient,
	bundleTransactionLimit: number,
	keypair: Keypair,
	conn: Connection,
	transaction: any
) => {
	const _tipAccount = (await c.getTipAccounts())[0];
	console.log("tip account:", _tipAccount);
	const tipAccount = new PublicKey(_tipAccount);

	const balance = await conn.getBalance(keypair.publicKey);
	console.log("current account has balance: ", balance);

	let isLeaderSlot = false;
	while (!isLeaderSlot) {
		const next_leader = await c.getNextScheduledLeader();
		const num_slots = next_leader.nextLeaderSlot - next_leader.currentSlot;
		isLeaderSlot = num_slots <= 2;
		console.log(`next jito leader slot in ${num_slots} slots`);
		await new Promise((r) => setTimeout(r, 500));
	}

	const blockHash = await conn.getLatestBlockhash();

	const b = new Bundle([], bundleTransactionLimit);

	console.log(blockHash.blockhash);

	const bundles = [b];

	let maybeBundle = b.addTransactions(transaction);
	if (isError(maybeBundle)) {
		throw maybeBundle;
	}

	maybeBundle = maybeBundle.addTipTx(keypair, 100_000, tipAccount, blockHash.blockhash);

	if (isError(maybeBundle)) {
		throw maybeBundle;
	}

	try {
		// await sendTxWithJito({ serialisedTx: transaction.serialize() });
		const response = await c.sendBundle(b);
		// console.log("resp:", response);
	} catch (e) {
		console.error("error sending bundle:", e);
	}
};

export const onBundleResult = (c: SearcherClient) => {
	c.onBundleResult(
		(result) => {
			console.log("received bundle result:", result);
		},
		(e) => {
			throw e;
		}
	);
};

const buildMemoTransaction = (keypair: Keypair, message: string, recentBlockhash: string): VersionedTransaction => {
	const ix = new TransactionInstruction({
		keys: [
			{
				pubkey: keypair.publicKey,
				isSigner: true,
				isWritable: true,
			},
		],
		programId: new PublicKey(MEMO_PROGRAM_ID),
		data: Buffer.from(message),
	});

	const instructions = [ix];

	const messageV0 = new TransactionMessage({
		payerKey: keypair.publicKey,
		recentBlockhash: recentBlockhash,
		instructions,
	}).compileToV0Message();

	const tx = new VersionedTransaction(messageV0);

	tx.sign([keypair]);

	console.log("txn signature is: ", bs58.encode(tx.signatures[0]));
	return tx;
};

export const logWithTimestamp = (message: any) => {
	const timestamp = new Date().toISOString();
	console.log(`${timestamp}: `, message);
};

export type JitoRegion = "mainnet" | "amsterdam" | "frankfurt" | "ny" | "tokyo";
export const JitoEndpoints = {
	mainnet: "https://mainnet.block-engine.jito.wtf",
	amsterdam: "https://amsterdam.mainnet.block-engine.jito.wtf",
	frankfurt: "https://frankfurt.mainnet.block-engine.jito.wtf",
	ny: "https://ny.mainnet.block-engine.jito.wtf",
	tokyo: "https://tokyo.mainnet.block-engine.jito.wtf",
};
export function getJitoEndpoint(region: JitoRegion) {
	return JitoEndpoints[region];
}
/**
 * Send a transaction using Jito. This only supports sending a single transaction on mainnet.
 * See https://jito-labs.gitbook.io/mev/searcher-resources/json-rpc-api-reference/transactions-endpoint/sendtransaction.
 * @param args.serialisedTx - A single transaction to be sent, in serialised form
 * @param args.sendOptions - Options for sending the transaction. Skip preflight is set to true by default
 * @param args.region - The region of the Jito endpoint to use
 * @returns - The signature of the transaction
 */
export async function sendTxWithJito({ serialisedTx }: { serialisedTx: Uint8Array | Buffer | number[] }) {
	let rpcEndpoint = getJitoEndpoint("mainnet");
	try {
		// let rpcEndpoint = getJitoEndpoint(region);
		let encodedTx = bs58.encode(serialisedTx);
		let payload = {
			jsonrpc: "2.0",
			id: 1,
			method: "sendTransaction",
			params: [encodedTx],
		};
		let res = await fetch(`https://frankfurt.mainnet.block-engine.jito.wtf/api/v1/transactions?bundleOnly=true`, {
			method: "POST",
			body: JSON.stringify(payload),
			headers: { "Content-Type": "application/json" },
		});
		let json = await res.json();
		if (json.error) {
			throw new Error(json.error.message);
		}
		return json;
	} catch (e) {
		console.error("error sending bundle:", e);
	}
}
