import { Contract, providers } from 'ethers';
import Web3 from 'web3';
import { AuctionData, AUCTION_FIELDS, NftData } from './AuctionData';
import * as MarketplaceABI from './NftMarketplace.json';
import fetch from 'node-fetch';
import * as admin from 'firebase-admin';

export const HAMMER_NFT: string = '0xcA56AF4bde480B3c177E1A4115189F261C2af034';
export const SHARK_NFT: string = '0x13e14f6EC8fee53b69eBd4Bd69e35FFCFe8960DE';
export const COLLNAME_AUCTION: string = 'auctiondata';
export const NULL_ADDRESS: string =
  '0x0000000000000000000000000000000000000000';

export const getRpcPRovider = () =>
  new providers.JsonRpcProvider('https://bsc-dataseed.binance.org/');

export const getMarketplaceContract = () =>
  new Contract(
    '0x7579Cc6c2edC67Cf446bA11C4FfFae874A6808C0',
    MarketplaceABI.abi as any,
    getRpcPRovider()
  );

/**
 * get total number of auctions from blockchain
 * @returns
 */
export async function auctionsLength() {
  const contract = getMarketplaceContract();
  const numAuctions = await contract.auctionsLength();
  return parseInt(numAuctions.toString());
}

/**
 * get auction data from blockchain
 * @param contract
 * @param auctionId
 */
export async function bscGetAuction(contract: Contract, auctionId: number) {
  // load main auction data
  const auction = await contract.auctions(auctionId);
  return createAuctionDataFromAuction(auctionId, auction);
}

/**
 * load auction from blockchain, add nftdata from api
 * @param id
 * @returns
 */
export async function loadAuctionDataBlockchain(
  id: number,
  includeNftData: boolean = true
) {
  const contract = getMarketplaceContract();
  // load main auction data
  const auction = await contract.auctions(id);

  // convert to object
  const auctionData: AuctionData = createAuctionDataFromAuction(id, auction);

  // console.log('auction raw data');
  // console.log(auction);

  // add in extra data
  // lastPrice
  auctionData.lastPrice = await bscGetLastPrice(
    contract,
    auction.nftToken,
    auction.nftTokenId.toString()
  );

  // lastToken
  auctionData.lastToken = await bscGetLastToken(
    contract,
    auction.nftToken,
    auction.nftTokenId.toString()
  );

  // finalHighestBid
  auctionData.finalHighestBid = await bscGetFinalHighestBid(contract, id);

  if (includeNftData) {
    const nftData = await loadNftData(
      auctionData.nftToken,
      auctionData.nftTokenId
    );
    auctionData.nftData = { ...nftData };
  }

  return auctionData;
}

/**
 * create complete auction data from the blockchain and NFT api, from scratch
 * @param auctionId
 * @param onList if this is a list event or a create-from-scratch-later event
 */
export async function bscGetCompleteAuctionData(
  auctionId: number,
  onList: boolean = true
) {
  // create auction data from scratch
  const contract: Contract = getMarketplaceContract();
  // load main auction data
  const auctionData: AuctionData = await bscGetAuction(contract, auctionId);
  // load lastPrice
  auctionData.lastPrice = await bscGetLastPrice(
    contract,
    auctionData.nftToken,
    auctionData.nftTokenId.toString()
  );
  // lastToken
  auctionData.lastToken = await bscGetLastToken(
    contract,
    auctionData.nftToken,
    auctionData.nftTokenId.toString()
  );
  // highest bid and final highest bid are 0 if a list event
  if (onList) {
    auctionData.highestBid = 0;
    auctionData.finalHighestBid = 0;
  } else {
    auctionData.highestBid = await bscGetHighestBid(
      contract,
      auctionId,
      auctionData
    );
    auctionData.finalHighestBid = await bscGetFinalHighestBid(
      contract,
      auctionId
    );
  }
  // load nft data
  const nftData = await loadNftData(
    auctionData.nftToken,
    auctionData.nftTokenId
  );
  auctionData.nftData = { ...nftData };

  return auctionData;
}

/**
 * get lastPrice from blockchain
 * @param contract
 * @param nftToken
 * @param nftTokenId
 * @returns
 */
export async function bscGetLastPrice(
  contract: Contract,
  nftToken: string,
  nftTokenId: string
) {
  // console.log('last price: ' + nftToken + ', ' + nftTokenId);
  const lastPrice = await contract.lastPrice(nftToken, nftTokenId);
  // console.log('last price raw data:');
  // console.log(lastPrice);
  return parseFloat(Web3.utils.fromWei(lastPrice.toString(), 'ether'));
}

/**
 * get lastToken from blockchain
 * @param contract
 * @param nftToken
 * @param nftTokenId plz note this is a string
 * @returns
 */
export async function bscGetLastToken(
  contract: Contract,
  nftToken: string,
  nftTokenId: string
) {
  const lastToken = await contract.lastToken(nftToken, nftTokenId);
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
  contract: Contract,
  auctionId: number
) {
  const finalHighestBid = await contract.finalHighestBid(auctionId);
  // console.log('final highest bid raw data:');
  // console.log(finalHighestBid);
  return parseFloat(Web3.utils.fromWei(finalHighestBid.toString(), 'ether'));
}

/**
 * get the bid balance for a user and auction
 * @param contract
 * @param auctionId
 * @param address
 */
export async function bscGetBidBalance(
  contract: Contract,
  auctionId: number,
  address: string
) {
  const balance = await contract.bidBalance(auctionId, address);
  return parseFloat(Web3.utils.fromWei(balance.toString(), 'ether'));
}

/**
 * get the highest bid for an auction whether it's settled or not
 * @param contract
 * @param auctionId auctionId to look it up on the blockchain
 * @param auctionData_ optional auctionData to pass in so it doesn't have to call contract.auction()
 * @returns
 */
export async function bscGetHighestBid(
  contract: Contract,
  auctionId: number,
  auctionData_?: AuctionData
) {
  const auctionData = auctionData_
    ? auctionData_
    : await bscGetAuction(contract, auctionId);

  if (!auctionData.isSettled) {
    // auction still running, grab bid balance for highest bidder
    if (auctionData.highestBidder != NULL_ADDRESS) {
      const result = await bscGetBidBalance(
        contract,
        auctionId,
        auctionData.highestBidder
      );
      return result;
    } else {
      // no highest bidder yet
      return 0;
    }
  } else {
    // auction not running, use finalhighestbid
    const result = await bscGetFinalHighestBid(contract, auctionId);
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
export async function loadNftData(nftToken: string, nftTokenId: number) {
  let which: string;
  switch (nftToken) {
    case HAMMER_NFT:
      which = 'hammer';
      break;
    case SHARK_NFT:
      which = '1';
      break;
    default:
      throw new Error('unknown nftToken ' + nftToken);
  }
  const url = `https://api.autoshark.finance/api/nft/${which}?tokenId=${nftTokenId}`;
  const response = await fetch(url);
  const text = await response.text();
  try {
    const json: any = JSON.parse(text);
    const nftData: NftData = json[0];
    // console.log('loadNftData: ' + JSON.stringify(nftData));
    return nftData;
  } catch (err: any) {
    console.log(err.message);
    console.log('loadNftData: error parsing json, received: ' + text);
    throw new Error(
      'loadNftData: error parsing json from ' +
        url +
        '. error message was ' +
        err.message +
        ', original server response: ' +
        text
    );
  }
}

/**
 * convert blockchain auction type to AuctionData
 * @param auctionId
 * @param auction
 * @returns
 */
export function createAuctionDataFromAuction(
  auctionId: number,
  auction: any
): AuctionData {
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
    nftTokenId: parseInt(nftTokenId.toString()),
    owner,
    token,
    targetPrice: parseFloat(
      Web3.utils.fromWei(targetPrice.toString(), 'ether')
    ),
    reservePrice: parseFloat(
      Web3.utils.fromWei(reservePrice.toString(), 'ether')
    ),
    endTime: parseInt(endTime.toString()),
    minIncrement: parseFloat(
      Web3.utils.fromWei(minIncrement.toString(), 'ether')
    ),
    isSettled,
    highestBidder,
    auctionType,
    isSold,
  };
  return ret;
}

/**
 * refresh an auction in the db from the blockchain
 * @param id
 */
export async function refreshAuction(id: number) {
  // see if it already exists in the database
  let existingData: AuctionData = await getAuctionData(id);
  if (!existingData) {
    // it doesn't exist, create from scratch
    const auctionData: AuctionData = await bscGetCompleteAuctionData(id);
    await saveAuctionData(auctionData);
  } else {
    // only refresh the parts that differ from the blockchain, and only if the auction is not settled
    if (existingData.isSettled) {
      return;
    }

    // compare with data from from blockchain
    const contract: Contract = getMarketplaceContract();
    const auctionData: AuctionData = await bscGetAuction(contract, id);
    let changed = false;
    if (!existingData.isSold && auctionData.isSold) {
      // we missed a sold event
      existingData.isSettled = true;
      existingData.isSold = true;
      existingData.highestBidder = auctionData.highestBidder;
      const highestBid = await bscGetHighestBid(contract, id, existingData);
      existingData.highestBid = highestBid;
      existingData.finalHighestBid = highestBid;
      existingData.lastPrice = highestBid;

      existingData.lastToken = await bscGetLastToken(
        contract,
        existingData.nftToken,
        existingData.nftTokenId.toString()
      );
      changed = true;
    } else {
      // miscellaneous fields
      if (existingData.isSettled != auctionData.isSettled) {
        existingData.isSettled = auctionData.isSettled;
        changed = true;
      }
      if (existingData.highestBidder != auctionData.highestBidder) {
        existingData.highestBidder = auctionData.highestBidder;
        existingData.highestBid = await bscGetHighestBid(
          contract,
          id,
          existingData
        );
        changed = true;
      }
    }

    // grab existing data from db, overwrite with blockchain data
    // const existing: AuctionData = await getAuctionData(id);
    // for (const field of AUCTION_FIELDS) {
    //   existing[field] = auctionData[field];
    // }

    // fill in nft data if needed
    if (!existingData.nftData) {
      const nftData = await loadNftData(
        existingData.nftToken,
        existingData.nftTokenId
      );
      existingData.nftData = { ...nftData };
      changed = true;
    }

    if (changed) await saveAuctionData(existingData);
  }
}
