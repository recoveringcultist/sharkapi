// package imports
import { BigNumber, Contract, providers } from 'ethers';
import Web3 from 'web3';
import fetch from 'node-fetch';
import * as admin from 'firebase-admin';

// local imports
import { AuctionData, NftData } from './AuctionData';
import * as MarketplaceABI from './NftMarketplace.json';
import { UserBidInfo, UserBids, UserBidsInfo } from './UserBids';
import {
  COLLNAME_AUCTION,
  COLLNAME_BIDBALANCE,
  COLLNAME_USERBIDS,
  HAMMER_NFT,
  MARKETPLACE_CONTRACT,
  NULL_ADDRESS,
  RPC_URL,
  SSS1_NFT,
  SSS2_NFT,
  SSS2OG_NFT,
} from './constants';
import { Logger } from '@google-cloud/logging-bunyan/build/src/middleware/express';

export const getRpcPRovider = () => new providers.JsonRpcProvider(RPC_URL);

export const getMarketplaceContract = () =>
  new Contract(MARKETPLACE_CONTRACT, MarketplaceABI.abi, getRpcPRovider());

/**
 * BSC: get total number of auctions
 * @returns
 */
export async function bscAuctionsLength(contract?: Contract, logger?: Logger) {
  if (!contract) contract = getMarketplaceContract();
  const numAuctions = await contractCall(
    'auctionsLength',
    undefined,
    contract,
    logger
  );

  return bscParseInt(numAuctions);
}

/**
 * BSC: get auction data
 * @param auctionId
 * @param contract
 */
export async function bscGetAuction(
  auctionId: number,
  contract?: Contract,
  logger?: Logger
) {
  // load main auction data
  if (!contract) contract = getMarketplaceContract();
  const auction = await contractCall(
    'auctions',
    [auctionId],
    contract,
    logger,
    2,
    (result) => {
      if (result.nftToken == NULL_ADDRESS) {
        throw new Error(
          `auction validator: nft token should not be ${NULL_ADDRESS}\n` +
            JSON.stringify(result)
        );
      }
    }
  );
  return bscParseAuction(auctionId, auction);
}

/**
 * create complete auction data from the blockchain and NFT api, from scratch
 * @param auctionId
 * @param onList if this is a list event or a create-from-scratch-later event
 */
export async function bscGetCompleteAuctionData(
  auctionId: number,
  onList: boolean = true,
  logger?: Logger
) {
  // create auction data from scratch
  const contract: Contract = getMarketplaceContract();
  // load main auction data
  const auctionData: AuctionData = await bscGetAuction(auctionId, contract);
  // load lastPrice
  auctionData.lastPrice = await bscGetLastPrice(
    auctionData.nftToken,
    auctionData.nftTokenId.toString(),
    contract,
    logger
  );
  // lastToken
  auctionData.lastToken = await bscGetLastToken(
    auctionData.nftToken,
    auctionData.nftTokenId.toString(),
    contract,
    logger
  );
  // highest bid and final highest bid are 0 if a list event
  if (onList) {
    auctionData.highestBid = 0;
    auctionData.finalHighestBid = 0;
  } else {
    auctionData.highestBid = await bscGetHighestBid(
      auctionId,
      auctionData,
      contract,
      logger
    );
    auctionData.finalHighestBid = await bscGetFinalHighestBid(
      auctionId,
      contract,
      logger
    );
  }
  // load nft data
  try {
    const nftData = await loadNftData(
      auctionData.nftToken,
      auctionData.nftTokenId,
      logger
    );
    auctionData.nftData = { ...nftData };
    return auctionData;
  } catch (err: any) {
    reportError(
      'getNftData',
      err,
      'auctionData: ' + JSON.stringify(auctionData),
      logger
    );
    throw err;
  }
}

/**
 * get lastPrice from blockchain
 * @param contract
 * @param nftToken
 * @param nftTokenId
 * @returns
 */
export async function bscGetLastPrice(
  nftToken: string,
  nftTokenId: string,
  contract?: Contract,
  logger?: Logger
) {
  // console.log('last price: ' + nftToken + ', ' + nftTokenId);
  if (!contract) contract = getMarketplaceContract();
  const lastPrice = await contractCall(
    'lastPrice',
    [nftToken, nftTokenId],
    contract,
    logger
  ); //   contract.lastPrice(nftToken, nftTokenId);
  // console.log('last price raw data:');
  // console.log(lastPrice);
  return bscWeiToFloat(lastPrice);
}

/**
 * get lastToken from blockchain
 * @param contract
 * @param nftToken
 * @param nftTokenId plz note this is a string
 * @returns
 */
export async function bscGetLastToken(
  nftToken: string,
  nftTokenId: string,
  contract?: Contract,
  logger?: Logger
) {
  if (!contract) contract = getMarketplaceContract();
  const lastToken = await contractCall(
    'lastToken',
    [nftToken, nftTokenId],
    contract,
    logger
  ); //  contract.lastToken(nftToken, nftTokenId);
  // console.log('last token raw data:');
  // console.log(lastToken);
  return lastToken;
}

/**
 * get finalHighestBidder from blockchain
 * @param contract
 * @param auctionId plz note this is a number
 * @returns
 */
export async function bscGetFinalHighestBid(
  auctionId: number,
  contract?: Contract,
  logger?: Logger
) {
  if (!contract) contract = getMarketplaceContract();
  const finalHighestBid = await contractCall(
    'finalHighestBid',
    [auctionId],
    contract,
    logger
  ); // await contract.finalHighestBid(auctionId);
  // console.log('final highest bid raw data:');
  // console.log(finalHighestBid);
  return bscWeiToFloat(finalHighestBid);
}

/**
 * get the bid balance for a user and auction
 * @param contract
 * @param auctionId
 * @param address
 */
export async function bscGetBidBalance(
  auctionId: number,
  address: string,
  contract?: Contract,
  logger?: Logger
) {
  if (!contract) contract = getMarketplaceContract();
  const balance_ = await contractCall(
    'bidBalance',
    [auctionId, address],
    contract,
    logger
  ); // contract.bidBalance(auctionId, address);
  const balance = bscWeiToFloat(balance_);

  // update in db, why not
  // await saveBidBalance(auctionId, address, balance);

  return balance;
}

/**
 * get the number of bids for a user
 * @param contract
 * @param address
 */
export async function bscGetUserBidsLength(
  address: string,
  contract?: Contract,
  logger?: Logger
) {
  if (!contract) contract = getMarketplaceContract();
  const numBids = await contractCall(
    'getUserBidsLength',
    [address],
    contract,
    logger
  ); // await contract.getUserBidsLength(address);
  // console.log(numBids);
  return bscParseInt(numBids);
}

/**
 * get all the user's bids
 * @param contract
 * @param address
 * @returns
 */
export async function bscGetUserBids(
  address: string,
  contract?: Contract,
  logger?: Logger
) {
  if (!contract) contract = getMarketplaceContract();
  const numBids = await bscGetUserBidsLength(address, contract, logger);
  const batchSize = 20;

  // get the bids in batches
  const result: UserBids = {
    address,
    bids: [],
  };
  for (let cursor = 0; cursor < numBids; cursor += batchSize) {
    const bids: any[] = await contractCall(
      'getUserBids',
      [address, cursor, batchSize],
      contract,
      logger
    ); // await contract.getUserBids(address, cursor, batchSize);

    // console.log(bids);
    const numBidsInBatch = bids[0].length;
    // console.log(`bscgetuserbids batch received ${numBidsInBatch} bids`);

    const auctionId_ = bids[0];
    const amount_ = bids[1];

    // add the batch to the result list
    for (let i = 0; i < numBidsInBatch; i++) {
      result.bids.push({
        auctionId: bscParseInt(auctionId_[i]),
        amount: bscWeiToFloat(amount_[i]),
      });
    }
  }

  return result;
}

/**
 * get the highest bid for an auction whether it's settled or not
 * @param contract
 * @param auctionId auctionId to look it up on the blockchain
 * @param auctionData_ optional auctionData to pass in so it doesn't have to call contract.auction()
 * @returns
 */
export async function bscGetHighestBid(
  auctionId: number,
  auctionData_?: AuctionData,
  contract?: Contract,
  logger?: Logger
) {
  if (!contract) contract = getMarketplaceContract();
  const auctionData = auctionData_
    ? auctionData_
    : await bscGetAuction(auctionId, contract, logger);

  if (!auctionData.isSettled) {
    // auction still running, grab bid balance for highest bidder
    if (auctionData.highestBidder != NULL_ADDRESS) {
      const result = await bscGetBidBalance(
        auctionId,
        auctionData.highestBidder,
        contract,
        logger
      );
      return result;
    } else {
      // no highest bidder yet
      return 0;
    }
  } else {
    // auction not running, use finalhighestbid
    const result = await bscGetFinalHighestBid(auctionId, contract, logger);
    return result;
  }
}

/**
 * load auction data from db
 * @param id
 * @returns
 */
export async function getAuctionData(id: number) {
  const firestore = admin.firestore();

  const snap = await firestore.doc(`${COLLNAME_AUCTION}/${id}`).get();
  const auctionData: AuctionData = snap.data() as AuctionData;
  return auctionData;
}

/**
 * save auction data to db
 * @param auctionData
 * @returns
 */
export async function saveAuctionData(auctionData: AuctionData) {
  const firestore = admin.firestore();
  return firestore
    .doc(`${COLLNAME_AUCTION}/${auctionData.auctionId}`)
    .set(auctionData);
}

/**
 * save bidbalance data to db
 * @param auctionId
 * @param address
 * @param amount
 * @returns
 */
export async function saveBidBalance(
  auctionId: number,
  address: string,
  amount: number
) {
  const firestore = admin.firestore();

  const snap = await firestore.doc(`${COLLNAME_BIDBALANCE}/${address}`).get();
  if (!snap.exists) {
    await firestore.doc(`${COLLNAME_BIDBALANCE}/${address}`).set({});
  }

  const data = {};
  data[auctionId] = amount;
  return firestore.doc(`${COLLNAME_BIDBALANCE}/${address}`).update(data);
}

/**
 * load userBids data from db
 * @param id
 * @returns
 */
export async function getUserBids(address: string): Promise<UserBids> {
  const firestore = admin.firestore();

  const snap = await firestore.doc(`${COLLNAME_USERBIDS}/${address}`).get();
  if (snap.exists) {
    return snap.data() as UserBids;
  } else {
    return {
      address,
      bids: [],
    };
  }
}

/**
 * load userBids data from db with auction info
 * @param id
 * @returns
 */
export async function getUserBidsInfo(address: string): Promise<UserBidsInfo> {
  const firestore = admin.firestore();

  const snap = await firestore.doc(`${COLLNAME_USERBIDS}/${address}`).get();
  if (snap.exists) {
    let bids: UserBidInfo[] = [];
    let userBids: UserBids = snap.data() as UserBids;
    for (const bid of userBids.bids) {
      let auctionData = await getAuctionData(bid.auctionId);
      bids.push({
        auctionId: bid.auctionId,
        amount: bid.amount,
        auctionData,
      });
    }
    let result: UserBidsInfo = {
      address: userBids.address,
      bids,
    };

    return result;
  } else {
    return {
      address,
      bids: [],
    };
  }
}

/**
 * save userbids to db
 * @param userBids
 * @returns
 */
export async function saveUserBids(userBids: UserBids) {
  const firestore = admin.firestore();
  return firestore
    .doc(`${COLLNAME_USERBIDS}/${userBids.address}`)
    .set(userBids);
}

/**
 * get bidbalancedata from db
 * @param address
 * @returns
 */
export async function getBidBalanceUser(address: string) {
  const firestore = admin.firestore();

  const snap = await firestore.doc(`${COLLNAME_BIDBALANCE}/${address}`).get();
  return snap.exists ? (snap.data() as any) : {};
}

/**
 * get bidbalancedata from db
 * @param address
 * @returns
 */
export async function getBidBalance(auctionId: number, address: string) {
  const firestore = admin.firestore();

  const snap = await firestore.doc(`${COLLNAME_BIDBALANCE}/${address}`).get();

  if (snap.exists) {
    const data = snap.data() as any;
    if (data[auctionId] != null) {
      return data[auctionId];
    }
  }

  return 0;
}

/**
 * does auction data exist
 * @param id
 * @returns
 */
export async function auctionDataExists(id: number) {
  const firestore = admin.firestore();

  const snap = await firestore.doc(`${COLLNAME_AUCTION}/${id}`).get();
  return snap.exists;
}

/**
 * load nft data from AS api
 * @param nftToken
 * @param nftTokenId
 * @returns
 */
export async function loadNftData(
  nftToken: string,
  nftTokenId: number,
  logger?: Logger
) {
  const log = (msg) => {
    if (logger) logger.info(msg);
    else console.info(msg);
  };

  let which: string;
  switch (nftToken) {
    case HAMMER_NFT:
      which = 'hammer';
      break;
    case SSS1_NFT:
      which = '1';
      break;
    case SSS2_NFT:
      which = '2';
      break;
    case SSS2OG_NFT:
      which = '10000';
      break;
    default:
      throw new Error('unknown nftToken ' + nftToken);
  }

  const url = `https://api.autoshark.finance/api/nft/${which}?tokenId=${nftTokenId}`;
  let retries = 2;
  let errorOccurred = false;
  while (retries >= 0) {
    let response, text;

    try {
      response = await fetch(url);
      text = await response.text();
      const json: any = JSON.parse(text);
      const nftData: NftData = json[0];
      if (errorOccurred) {
        // we successfully retried and it worked!
        log(`loadNftData worked after retrying, url=${url}`);
      }
      return nftData;
    } catch (err: any) {
      retries--;
      errorOccurred = true;
      reportError(
        err,
        'loadNftData',
        'url: ' +
          url +
          ', ' +
          retries +
          ' retries left, response received from server: ' +
          text,
        logger
      );
    }
  }
  throw new Error('could could not get NFT data');
}

/**
 * refresh user's bids in db from the blockchain
 * @param address
 */
export async function refreshUserBids(address: string, logger?: Logger) {
  const userBids: UserBids = await bscGetUserBids(address, logger);
  await saveUserBids(userBids);
}

/**
 * refresh an auction in the db from the blockchain
 * @param id
 */
export async function refreshAuction(id: number, logger?: Logger) {
  let nftToken, nftTokenId;
  // see if it already exists in the database
  let existingData: AuctionData = await getAuctionData(id);
  const auctionData: AuctionData = await bscGetCompleteAuctionData(
    id,
    false,
    logger
  );
  if (!existingData) {
    // it doesn't exist, create from scratch
    nftToken = auctionData.nftToken;
    nftTokenId = auctionData.nftTokenId;
    await saveAuctionData(auctionData);
  } else {
    let changed = false;
    // replace it all from the blockchain except for maybe the nft data
    if (!existingData.nftData) {
      existingData.nftData = auctionData.nftData;
      changed = true;
    }
    const fieldsToReplace = [
      'auctionId',
      'nftToken',
      'nftTokenId',
      'owner',
      'token',
      'targetPrice',
      'reservePrice',
      'endTime',
      'minIncrement',
      'isSettled',
      'highestBidder',
      'auctionType',
      'isSold',
      'lastPrice',
      'lastToken',
      'finalHighestBid',
      'highestBid',
    ];
    for (const field of fieldsToReplace) {
      if (existingData[field] != auctionData[field]) {
        changed = true;
        existingData[field] = auctionData[field];
      }
    }

    nftToken = existingData.nftToken;
    nftTokenId = existingData.nftTokenId;

    if (changed) await saveAuctionData(existingData);
  }

  // also refresh last price / last token data for past auctions this nft has been in
  await refreshLastSaleDataForNft(nftToken, nftTokenId);
}

/**
 * get the auctions an nft has been in
 * @param nftToken
 * @param nftTokenId
 * @returns
 */
export async function getAuctionsForNft(nftToken: string, nftTokenId: number) {
  const firestore = admin.firestore();
  const snap = await firestore
    .collection(COLLNAME_AUCTION)
    .where('nftToken', '==', nftToken)
    .where('nftTokenId', '==', nftTokenId)
    .orderBy('auctionId')
    .get();
  const result: AuctionData[] = [];
  for (const doc of snap.docs) {
    result.push(doc.data() as AuctionData);
  }
  return result;
}

/**
 * refresh all the auctions an nft has been in with the most recent lastPrice and lastToken
 * @param nftToken
 * @param nftTokenId
 */
export async function refreshLastSaleDataForNft(
  nftToken: string,
  nftTokenId: number,
  logger?: Logger
) {
  const auctions = await getAuctionsForNft(nftToken, nftTokenId);

  const lastPrice = await bscGetLastPrice(
    nftToken,
    nftTokenId.toString(),
    undefined,
    logger
  );
  const lastToken = await bscGetLastToken(
    nftToken,
    nftTokenId.toString(),
    undefined,
    logger
  );

  for (const auction of auctions) {
    let changed = false;

    if (auction.lastPrice != lastPrice) {
      auction.lastPrice = lastPrice;
      changed = true;
    }
    if (auction.lastToken != lastToken) {
      auction.lastToken = lastToken;
      changed = true;
    }
    if (changed) await saveAuctionData(auction);
  }
}

/**
 * convert wei in bignumber to ETH in float (18 decimals)
 * @param input
 * @returns
 */
export function bscWeiToFloat(input: BigNumber | string): number {
  if (input instanceof BigNumber) input = input.toString();
  return parseFloat(Web3.utils.fromWei(input, 'ether'));
}

/**
 * convert bignumber to int
 * @param input
 * @returns
 */
export function bscParseInt(input: BigNumber | string): number {
  if (input instanceof BigNumber) input = input.toString();
  return parseInt(input);
}

/**
 * convert blockchain auction type to AuctionData
 * @param auctionId
 * @param auction
 * @returns
 */
export function bscParseAuction(auctionId: number, auction: any): AuctionData {
  const {
    nftToken,
    nftTokenId,
    owner,
    token,
    targetPrice,
    reservePrice,
    endTime,
    minIncrement,
    isSettled,
    highestBidder,
    auctionType,
    isSold,
  } = auction;

  const ret: AuctionData = {
    auctionId,
    nftToken,
    nftTokenId: bscParseInt(nftTokenId),
    owner,
    token,
    targetPrice: bscWeiToFloat(targetPrice),
    reservePrice: bscWeiToFloat(reservePrice),
    endTime: bscParseInt(endTime),
    minIncrement: bscWeiToFloat(minIncrement),
    isSettled,
    highestBidder,
    auctionType,
    isSold,
  };

  if (nftToken == NULL_ADDRESS) {
    console.error(
      'parseAuction: nft token should not be 0\n' +
        JSON.stringify(auction) +
        '\n' +
        JSON.stringify(ret)
    );
  }
  return ret;
}

/**
 * report an error to the console. outputs message and stack fields if they exist
 * @param err
 * @param baseMsg prepended to the message
 * @returns
 */
export function reportError(
  err: any,
  baseMsg?: string,
  postMsg?: string,
  logger?: Logger
): string {
  let output = baseMsg ? baseMsg : '';
  output += ': error encountered';
  if (err.mesesage) {
    output += '\n' + err.message;
  }
  if (err.stack) {
    output += '\n' + err.stack;
  }
  if (postMsg) {
    output += '\n' + postMsg;
  }
  if (logger) {
    logger.error(output);
  } else {
    console.error(output);
  }
  return output;
}

/**
 * make a contract call with automatic retries built in
 * @param fnName
 * @param args
 * @param contract
 * @param resultValidator will be passed the raw data returned from the contract. should throw an error if the data is invalid
 * @param retries
 * @returns
 */
export async function contractCall(
  fnName: string,
  args?: any[],
  contract?: Contract,
  logger?: Logger,
  retries: number = 2,
  resultValidator?: (result) => void
) {
  const info = (msg: string) => {
    if (logger) logger.info(msg);
    else console.info(msg);
  };

  let lastErr: any;
  while (retries >= 0) {
    try {
      info(
        `contractCall:${fnName}: args=${JSON.stringify(
          args
        )}, retries=${retries}`
      );
      if (!contract) contract = getMarketplaceContract();
      let result = await (contract[fnName] as Function).apply(contract, args);
      if (resultValidator) resultValidator(result);
      return result;
    } catch (err: any) {
      lastErr = err;

      reportError(
        err,
        'contractCall:' + fnName,
        `args=${JSON.stringify(args)}, retries=${retries}`,
        logger
      );
      retries--;
      if (retries >= 0) {
        // retry with a new contract instance
        contract = undefined;
      }
    }
  }
  throw new Error(
    'contractCall:' +
      fnName +
      ', failed. args: ' +
      JSON.stringify(args) +
      ', lastErr: ' +
      JSON.stringify(lastErr)
  );
}
