import { expect } from "chai";
import { describeDevMoonbeam } from "../util/setup-dev-tests";
import { customWeb3Request } from "../util/providers";
import { ethers } from "ethers";
import { getCompiled } from "../util/contracts";
import { createContract, createTransaction } from "../util/transactions";
import { ApiPromise } from "@polkadot/api";
import { KeyringPair } from "@polkadot/keyring/types";
import { BN, hexToU8a, bnToHex, u8aToHex } from "@polkadot/util";
import { createBlockWithExtrinsicParachain } from "../util/substrate-rpc";
import Keyring from "@polkadot/keyring";
import { createType } from "@polkadot/types";
import { blake2AsU8a, xxhashAsU8a } from "@polkadot/util-crypto";

import {
  GENESIS_ACCOUNT,
  GENESIS_ACCOUNT_PRIVATE_KEY,
  ALITH,
  ALITH_PRIV_KEY,
} from "../util/constants";

const ADDRESS_XCM_TRANSACTOR = "0x0000000000000000000000000000000000000806";

const GAS_PRICE = "0x" + (1_000_000_000).toString(16);

async function getBalance(context, blockHeight, address) {
  const blockHash = await context.polkadotApi.rpc.chain.getBlockHash(blockHeight);
  const account = await context.polkadotApi.query.system.account.at(blockHash, address);
  return account.data.free;
}

interface AssetMetadata {
  name: string;
  symbol: string;
  decimals: BN;
  isFrozen: boolean;
}
const relayAssetMetadata: AssetMetadata = {
  name: "DOT",
  symbol: "DOT",
  decimals: new BN(12),
  isFrozen: false,
};

interface SourceLocation {
  XCM: {
    parents: number | BN;
    interior: any;
  };
}
const sourceLocationRelay = { XCM: { parents: 1, interior: "Here" } };

describeDevMoonbeam("Precompiles - xtokens", (context) => {
  let sudoAccount, iFace;
  before("Setup genesis account and relay accounts", async () => {
    const keyring = new Keyring({ type: "ethereum" });
    sudoAccount = await keyring.addFromUri(ALITH_PRIV_KEY, null, "ethereum");
    // register index 0 for Alith
    await context.polkadotApi.tx.sudo
      .sudo(context.polkadotApi.tx.xcmTransactor.register(ALITH, 0))
      .signAndSend(sudoAccount);
    await context.createBlock();

    const contractData = await getCompiled("XcmTransactorInstance");
    iFace = new ethers.utils.Interface(contractData.contract.abi);
    const { contract, rawTx } = await createContract(context.web3, "XcmTransactorInstance");
    const address = contract.options.address;
    await context.createBlock({ transactions: [rawTx] });
  });

  it("allows to retrieve index through precompiles", async function () {
    let data = iFace.encodeFunctionData(
      // action
      "account_index",
      [ALITH]
    );
    let tx_call = await customWeb3Request(context.web3, "eth_call", [
      {
        from: ALITH,
        value: "0x0",
        gas: "0x10000",
        gasPrice: GAS_PRICE,
        to: ADDRESS_XCM_TRANSACTOR,
        data: data,
      },
    ]);

    expect(tx_call.result).to.equal(
      "0x0000000000000000000000000000000000000000000000000000000000000000"
    );
  });

  it("allows to issue transfer xtokens", async function () {
    // Build types
    let balance = context.polkadotApi.createType("Balance", 100000000000000);
    let assetBalance = context.polkadotApi.createType("AssetBalance", { balance: balance });

    const assetId = context.polkadotApi.createType(
      "AssetId",
      new BN("42259045809535163221576417993425387648")
    );
    let assetDetails = context.polkadotApi.createType("AssetDetails", { supply: balance });

    // Register the asset
    await context.polkadotApi.tx.sudo
      .sudo(
        context.polkadotApi.tx.assetManager.registerAsset(
          sourceLocationRelay,
          relayAssetMetadata,
          new BN(1)
        )
      )
      .signAndSend(sudoAccount);
    await context.createBlock();

    let assets = (
      (await context.polkadotApi.query.assetManager.assetIdType(assetId)) as any
    ).toJSON();
    // make sure we created it
    expect(assets["xcm"]["parents"]).to.equal(1);

    // Get keys to modify balance
    let module = xxhashAsU8a(new TextEncoder().encode("Assets"), 128);
    let account_key = xxhashAsU8a(new TextEncoder().encode("Account"), 128);
    let blake2concatAssetId = new Uint8Array([
      ...blake2AsU8a(assetId.toU8a(), 128),
      ...assetId.toU8a(),
    ]);
    let blake2concatAccount = new Uint8Array([
      ...blake2AsU8a(hexToU8a(ALITH), 128),
      ...hexToU8a(ALITH),
    ]);
    let overallAccountKey = new Uint8Array([
      ...module,
      ...account_key,
      ...blake2concatAssetId,
      ...blake2concatAccount,
    ]);

    // Get keys to modify total supply
    let assetKey = xxhashAsU8a(new TextEncoder().encode("Asset"), 128);
    let overallAssetKey = new Uint8Array([...module, ...assetKey, ...blake2concatAssetId]);

    await context.polkadotApi.tx.sudo
      .sudo(
        context.polkadotApi.tx.system.setStorage([
          [u8aToHex(overallAccountKey), u8aToHex(assetBalance.toU8a())],
          [u8aToHex(overallAssetKey), u8aToHex(assetDetails.toU8a())],
        ])
      )
      .signAndSend(sudoAccount);
    await context.createBlock();

    let beforeAssetBalance = (await context.polkadotApi.query.assets.account(assetId, ALITH))
      .balance as BN;

    let beforeAssetDetails = (await context.polkadotApi.query.assets.asset(assetId)) as any;

    // supply and balance should be the same
    expect(beforeAssetBalance.eq(new BN(100000000000000))).to.equal(true);
    expect(beforeAssetDetails.unwrap()["supply"].eq(new BN(100000000000000))).to.equal(true);

    let transactor = 0;
    let index = 0;
    let asset =
      // Destination as multilocation
      [
        // one parent
        1,
        [],
      ];
    // 1000 units as fee
    let amountTransferred = 1000;

    // we dont care, the call wont be executed
    let transact_call = new Uint8Array([0x01]);
    // weight
    let weight = 100;

    // Call the precompile
    let data = iFace.encodeFunctionData(
      // action
      "transact_through_derivative",
      [transactor, index, asset, amountTransferred, weight, transact_call]
    );

    const tx = await createTransaction(context.web3, {
      from: ALITH,
      privateKey: ALITH_PRIV_KEY,
      value: "0x0",
      gas: "0x200000",
      gasPrice: GAS_PRICE,
      to: ADDRESS_XCM_TRANSACTOR,
      data,
    });

    const block = await context.createBlock({
      transactions: [tx],
    });

    // We have used 1000 units to pay for the fees in the relay, so balance and supply should
    // have changed
    let afterAssetBalance = (await context.polkadotApi.query.assets.account(assetId, ALITH))
      .balance as BN;
    let expectedBalance = new BN(100000000000000).sub(new BN(1000));
    expect(afterAssetBalance.eq(expectedBalance)).to.equal(true);

    let AfterAssetDetails = (await context.polkadotApi.query.assets.asset(assetId)) as any;

    expect(AfterAssetDetails.unwrap()["supply"].eq(expectedBalance)).to.equal(true);
  });
});
