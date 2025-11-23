import {
	Keypair,
	Connection,
	Transaction,
	sendAndConfirmTransaction,
	PublicKey,
	VersionedTransaction,
	SystemProgram,
} from "@solana/web3.js";

import { ChannelCredentials } from "@grpc/grpc-js";
import { searcherClient } from "jito-ts/dist/sdk/block-engine/searcher";
import { Bundle } from "jito-ts/dist/sdk/block-engine/types";
import { Packet } from "jito-ts/dist/gen/block-engine/packet";
import { bs58 } from "@coral-xyz/anchor/dist/cjs/utils/bytes";
import { onBundleResult, sendBundles } from "./utils";
import * as dotenv from "dotenv";
dotenv.config();

const connection = new Connection("https://api.mainnet-beta.solana.com");
const payer = Keypair.generate();

// const client = searcherClient("your_grpc_endpoint", payer);

// async function createTransaction() {
// 	const transaction = new Transaction();
// 	// Adicione instruções à sua transação aqui

// 	return transaction;
// }

// async function sendTransaction(transaction: Transaction) {
// 	const signature = await sendAndConfirmTransaction(connection, transaction, [payer]);
// 	console.log("Transaction signature:", signature);
// }

async function createLogTransaction(): Promise<Transaction> {
	const transaction = new Transaction()
		.add
		// SystemProgram.log({
		// 	messages: ["Hello, Jito!"],
		// })
		();
	transaction.feePayer = payer.publicKey;
	const { blockhash } = await connection.getRecentBlockhash();
	transaction.recentBlockhash = blockhash;

	transaction.sign(payer);
	return transaction;
}

// async function createBundle(transactions: Transaction[]): Promise<Bundle> {
// 	const header: BundleHeader = {
// 		// Adicione os parâmetros do header aqui
// 	};

// 	const packets: Packet[] = transactions.map((transaction) => ({
// 		// Estrutura do pacote correspondente à transação
// 		data: transaction.serialize(), // Serialize a transação para bytes
// 		// Adicione outras propriedades necessárias aqui
// 	}));

// 	return {
// 		transactionLimit: transactions.length,
// 		header,
// 		packets,
// 		addTransactions: () => {}, // Implemente essa função conforme necessário
// 		addTipTx: () => {}, // Implemente essa função conforme necessário
// 	};
// }

// async function main() {
// 	const transaction = await createTransaction();
// 	const transactions = [transaction];

// 	try {
// 		const bundle = await createBundle(transactions);
// 		const bundleId = await client.sendBundle(bundle);
// 		console.log("Bundle sent with ID:", bundleId);
// 	} catch (error) {
// 		console.error("Error sending bundle:", error);
// 	}

// 	await sendTransaction(transaction);
// }

const main = async () => {
	const blockEngineUrl = process.env.BLOCK_ENGINE_URL || "";
	console.log("BLOCK_ENGINE_URL:", blockEngineUrl);
	//@ts-ignore
	const decodedKey = new Uint8Array(bs58.decode(process.env.JITO_PVT_KEY));
	console.log("AUTH_KEYPAIR_PATH:", decodedKey);
	const keypair = Keypair.fromSecretKey(decodedKey);
	//@ts-ignore
	const payer_decodedKey = new Uint8Array(bs58.decode(process.env.PVT_KEY));
	console.log("AUTH_KEYPAIR_PATH:", payer_decodedKey);
	const payer_keypair = Keypair.fromSecretKey(payer_decodedKey);

	const _accounts = (process.env.ACCOUNTS_OF_INTEREST || "").split(",");
	console.log("ACCOUNTS_OF_INTEREST:", _accounts);
	// const accounts = _accounts.map(a => new PublicKey(a));

	const bundleTransactionLimit = parseInt(process.env.BUNDLE_TRANSACTION_LIMIT || "0");

	const c = searcherClient(blockEngineUrl, keypair);

	const rpcUrl =
		"https://neat-indulgent-flower.solana-mainnet.quiknode.pro/dfca96b091f3949ca05fc29866f6e5a8db485f3c/";
	console.log("RPC_URL:", rpcUrl);
	const conn = new Connection(rpcUrl, "confirmed");

	// await sendBundles(c, bundleTransactionLimit, payer_keypair, conn);
	// onBundleResult(c);
};

main()
	.then(() => {
		console.log("Sending bundle");
	})
	.catch((e) => {
		throw e;
	});
