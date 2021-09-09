import * as utils from './common/utils';
import Web3 from 'web3';
import * as admin from 'firebase-admin';
import { Contract } from 'ethers';
import { AuctionData } from './common/AuctionData';
import { COLLNAME_AUCTION } from './common/constants';

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
          contract,
          parseInt(doc.id),
          data
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
