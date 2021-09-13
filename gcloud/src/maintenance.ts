import * as utils from './common/utils';
import Web3 from 'web3';
import * as admin from 'firebase-admin';
import { Contract } from 'ethers';
import { AuctionData } from './common/AuctionData';
import { COLLNAME_AUCTION } from './common/constants';
import { Logger } from '@google-cloud/logging-bunyan/build/src/middleware/express';
import fetch from 'node-fetch';

/**
 * compare mega's api's finalhighestbid to blockchain finalhighestbid
 * @param req
 * @param res
 * @param next
 */
export const maintenance5 = async (req, res, next) => {
  const logger: Logger = (req as any).log as Logger;
  const firestore = admin.firestore();

  const response = await fetch('https://api.autoshark.finance/api/nft/query');
  const text = await response.text();
  const data: any[] = JSON.parse(text);
  console.log(`there are ${data.length} items`);

  const subset = data
    .filter((v) => {
      return v.isSettled && v.isSold && v.finalHighestBid > 0;
    })
    .sort((a, b) => (a.auctionId < b.auctionId ? -1 : 1));
  console.log(`subset: ${subset.length}`);

  for (const item of subset) {
    const finalHighestBid = await utils.bscGetFinalHighestBid(
      item.auctionId,
      undefined,
      logger
    );
    if (
      finalHighestBid > 0 &&
      item.finalHighestBid > 0 &&
      finalHighestBid != item.finalHighestBid
    ) {
      console.log(
        `auction ${item.auctionId}, bsc final bid=${finalHighestBid}, mega api final bid=${item.finalHighestBid}`
      );
    } else console.log(`skipping auction ${item.auctionId}`);
  }

  res.send('success');
};

/**
 * see how many sold auctions are missing final highest bid and fix from mega's api if possible
 * @param req
 * @param res
 * @param next
 */
export const maintenance4 = async (req, res, next) => {
  const logger: Logger = (req as any).log as Logger;
  const firestore = admin.firestore();
  const snap = await firestore
    .collection(COLLNAME_AUCTION)
    .where('isSold', '==', true)
    .where('isSettled', '==', true)
    .where('finalHighestBid', '==', 0)
    .orderBy('auctionId')
    .get();

  console.log(
    `number of sold/settled auctions missing finalHighestBid: ${snap.size}`
  );

  const response = await fetch('https://api.autoshark.finance/api/nft/query');
  const text = await response.text();
  const data: any[] = JSON.parse(text);

  let numFixes = 0;
  for (const doc of snap.docs) {
    const auctionData: AuctionData = doc.data() as AuctionData;
    console.log(auctionData.auctionId);
    const item = data.find((value) => value.auctionId == auctionData.auctionId);
    if (item && item.finalHighestBid > 0) {
      numFixes++;
      auctionData.finalHighestBid = item.finalHighestBid;
      await utils.saveAuctionData(auctionData);
      console.log(`fixed ${auctionData.auctionId}`);
    }
  }
  console.log(`number fixed: ${numFixes}`);

  res.send('success');
};

/**
 * refresh final highest bid from blockchain for all auctions
 * @param req
 * @param res
 * @param next
 */
export const maintenance3 = async (req, res, next) => {
  const logger: Logger = (req as any).log as Logger;
  const firestore = admin.firestore();

  const start = 356;
  const numAuctions = await utils.bscAuctionsLength(undefined, logger);

  console.info(`updating last highest price for ${numAuctions} auctions`);

  for (let i = start; i < numAuctions; i++) {
    const auctionData: AuctionData = await utils.getAuctionData(i);
    auctionData.finalHighestBid = await utils.bscGetFinalHighestBid(
      auctionData.auctionId,
      undefined,
      logger
    );
    await utils.saveAuctionData(auctionData);
    console.log(
      `updated auction ${auctionData.auctionId}: ${auctionData.isSettled} ${auctionData.isSold} ${auctionData.finalHighestBid}`
    );
  }
  console.log('done');

  res.send('success');
};

/**
 * look for missed auctions in database
 * @param req
 * @param res
 * @param next
 * @returns
 */
export const maintenance2 = async (req, res, next) => {
  const firestore = admin.firestore();

  const numAuctions = await utils.bscAuctionsLength();
  console.log(`there are ${numAuctions} auctions`);
  const missing: number[] = [];

  for (let i = 0; i < numAuctions; i++) {
    const snap = await firestore.doc(COLLNAME_AUCTION + '/' + i).get();
    if (!snap.exists) {
      console.log(`auction ${i} missing in db`);
      missing.push(i);
    } else {
      console.log(`auction ${i} accounted for`);
    }
  }

  console.log(`total auctions missing: ${missing.length}`);
  console.log(missing);

  return res.json(missing);
};

export const maintenance1 = async (req, res, next) => {
  const convert = (input: number) => {
    let strval = input.toString();
    return parseFloat(Web3.utils.fromWei(strval, 'ether'));
  };

  const firestore = admin.firestore();
  const snap = await firestore
    .collection(COLLNAME_AUCTION)
    .where('finalHighestBid', '>', 100000)
    .get();
  for (const doc of snap.docs) {
    console.log(doc.id);
    const data: any = doc.data();
    console.log(data);
    data.finalHighestBid = convert(data.finalHighestBid);
    data.lastPrice = convert(data.lastPrice);
    data.highestBid = convert(data.highestBid);
    await firestore.doc(COLLNAME_AUCTION + '/' + doc.id).set(data);
  }
  res.send('success');
};

/**
 * add highestBid to all auctions
 * @param res
 * @param req
 * @param next
 */
export const temp = async (req, res, next) => {
  const firestore = admin.firestore();
  const snap = await firestore.collection(COLLNAME_AUCTION).get();
  const contract: Contract = utils.getMarketplaceContract();
  try {
    console.log(`checking ${snap.size} documents`);
    for (const doc of snap.docs) {
      let data: AuctionData = doc.data() as AuctionData;

      if (data.highestBid == null) {
        const highestBid = await utils.bscGetHighestBid(
          parseInt(doc.id),
          data,
          contract
        );
        data.highestBid = highestBid;
        await doc.ref.set(data);
        console.log(`${data.auctionId}: added highest bid of ${highestBid}`);
      }
    }
    res.send('success');
  } catch (err) {
    return next(err);
  }
};
