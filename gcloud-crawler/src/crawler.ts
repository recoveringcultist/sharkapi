// common files
import { AuctionData } from '../../gcloud/src/common/AuctionData';
import { NULL_ADDRESS } from '../../gcloud/src/common/constants';
import * as utils from '../../gcloud/src/common/utils';

// other imports
import Web3Crawler from './Web3Crawler';

/**
 * query blockchain events continually over time and sync them to firebase db
 */
export const setupCrawler = () => {
  const marketplace = utils.getMarketplaceContract();

  console.log('registering for blockchain events');

  const manager: Web3Crawler = new Web3Crawler();

  const noWrites: boolean = true;

  // marketplace.on('Bid', async (auctionId_, amount_, highestBidder) => {
  //   const auctionId: number = utils.bscParseInt(auctionId_);
  //   let baseMsg = `event: Bid ${auctionId}`;
  //   let amount = utils.bscWeiToFloat(amount_);
  //   console.info(baseMsg + `: amount: ${amount}, bidder: ${highestBidder}`);

  //   if (noWrites) return;

  //   await processBid(auctionId, amount, highestBidder);
  // });

  // // new auction listed
  // marketplace.on('List', async (auctionId_) => {
  //   const auctionId: number = utils.bscParseInt(auctionId_);
  //   const baseMsg = `event: List ${auctionId}`;
  //   console.info(baseMsg);

  //   if (noWrites) return;

  //   await processList(auctionId);
  // });

  // // sold event
  // marketplace.on(
  //   'Sold',
  //   async (auctionId_, salesPrice_, token, highestBidder) => {
  //     const auctionId: number = utils.bscParseInt(auctionId_);
  //     const salesPrice: number = utils.bscWeiToFloat(salesPrice_);
  //     const baseMsg = `event: Sold ${auctionId}`;

  //     console.log(
  //       `${baseMsg}: salesPrice: ${salesPrice}, token: ${token}, highestBidder: ${highestBidder}`
  //     );

  //     if (noWrites) return;

  //     await processSold(auctionId, salesPrice, token, highestBidder);
  //   }
  // );

  // marketplace.on('WithdrawAll', async (auctionId_, account) => {
  //   const auctionId: number = utils.bscParseInt(auctionId_);
  //   const baseMsg = `event: WithdrawAll ${auctionId}`;
  //   console.info(baseMsg + `: account: ${account}`);
  //   if (noWrites) return;

  //   await processWithdrawAll(auctionId, account);
  // });

  // marketplace.on('CloseAuction', async (auctionId_, highestBidder) => {
  //   const auctionId: number = utils.bscParseInt(auctionId_);
  //   const baseMsg = `event: CloseAuction ${auctionId}`;
  //   console.info(baseMsg + `: highestBidder: ${highestBidder}`);

  //   if (noWrites) return;

  //   await processCloseAuction(auctionId, highestBidder);
  // });

  // marketplace.on('EmergencyWithdrawal', async (auctionId_, highestBidder) => {
  //   const auctionId: number = utils.bscParseInt(auctionId_);
  //   const baseMsg = `event: EmergencyWithdrawal ${auctionId}`;
  //   console.info(baseMsg);

  //   if (noWrites) return;

  //   await processEmergencyWithdrawal(auctionId, highestBidder);
  // });

  return manager;
};

export const processList = async (auctionId: number) => {
  const baseMsg = `processList ${auctionId}`;
  console.info(baseMsg);

  try {
    // create data from scratch
    const auctionData: AuctionData = await utils.bscGetCompleteAuctionData(
      auctionId
    );

    // save to database
    await utils.saveAuctionData(auctionData);
  } catch (e: any) {
    utils.reportError(e, baseMsg);
  }
};

export const processBid = async (
  auctionId: number,
  amount: number,
  highestBidder: string
) => {
  let baseMsg = `processBid ${auctionId}`;
  console.info(baseMsg + `: amount: ${amount}, bidder: ${highestBidder}`);

  try {
    // first, see if this auction exists in the db
    const existingData: AuctionData = await utils.getAuctionData(auctionId);
    if (!existingData) {
      // load the auction data from scratch, we obviously missed the list event
      const auctionData: AuctionData = await utils.bscGetCompleteAuctionData(
        auctionId,
        false
      );
      await utils.saveAuctionData(auctionData);
    } else {
      // update changed fields
      existingData.highestBidder = highestBidder;
      existingData.highestBid = await utils.bscGetBidBalance(
        auctionId,
        highestBidder
      );
      await utils.saveAuctionData(existingData);
    }

    // save bid balance info
    // await utils.saveBidBalance(auctionId, highestBidder, amount);

    // refresh user's bids
    await utils.refreshUserBids(highestBidder);

    // await supabase
    //   .from("marketplace")
    //   .update({
    //     amount: parseFloat(Web3.utils.fromWei(amount.toString(), "ether")),
    //     highestBidder,
    //   })
    //   .match({
    //     auctionId,
    //   });
  } catch (e: any) {
    utils.reportError(e, baseMsg);
  }
};

export const processSold = async (
  auctionId: number,
  salesPrice: number,
  token: string,
  highestBidder: string
) => {
  const baseMsg = `processSold ${auctionId}`;

  console.log(
    `${baseMsg}: salesPrice: ${salesPrice}, token: ${token}, highestBidder: ${highestBidder}`
  );

  try {
    const existingData: AuctionData = await utils.getAuctionData(auctionId);
    if (!existingData) {
      // somehow we missed prior events, just create the auction data from scratch
      const auctionData: AuctionData = await utils.bscGetCompleteAuctionData(
        auctionId,
        false
      );
      await utils.saveAuctionData(auctionData);
    } else {
      // update changed fields
      existingData.isSettled = true;
      existingData.isSold = true;
      existingData.highestBidder = highestBidder;
      existingData.highestBid = salesPrice;
      existingData.finalHighestBid = salesPrice;
      existingData.lastPrice = salesPrice;
      existingData.lastToken = token;
      await utils.saveAuctionData(existingData);
    }

    // refresh user's bids
    await utils.refreshUserBids(highestBidder);

    // save bid balance info
    // await utils.saveBidBalance(auctionId, highestBidder, 0);
  } catch (e: any) {
    utils.reportError(e, baseMsg);
  }
};

export const processWithdrawAll = async (
  auctionId: number,
  account: string
) => {
  const baseMsg = `processWithdrawAll ${auctionId}, ${account}`;

  console.log(baseMsg);
  await utils.refreshUserBids(account);
};

export const processCloseAuction = async (
  auctionId: number,
  highestBidder: string
) => {
  const baseMsg = `processCloseAuction ${auctionId}`;
  console.info(baseMsg + `: highestBidder: ${highestBidder}`);

  try {
    // refresh user's bids
    await utils.refreshUserBids(highestBidder);

    // save bidbalance info
    // await utils.saveBidBalance(auctionId, highestBidder, 0);

    const existingData: AuctionData = await utils.getAuctionData(auctionId);
    if (!existingData) {
      // somehow we missed prior events, just create the auction data from scratch
      const auctionData: AuctionData = await utils.bscGetCompleteAuctionData(
        auctionId,
        false
      );
      await utils.saveAuctionData(auctionData);
    } else {
      // update changed fields
      existingData.isSettled = true;
      existingData.highestBidder = NULL_ADDRESS;
      existingData.highestBid = 0;
      await utils.saveAuctionData(existingData);
    }
  } catch (e: any) {
    utils.reportError(e, baseMsg);
  }
};

export const processEmergencyWithdrawal = async (auctionId, highestBidder) => {
  const baseMsg = `event: EmergencyWithdrawal ${auctionId}`;
  console.info(baseMsg);

  try {
    // refresh user's bids
    await utils.refreshUserBids(highestBidder);

    const existingData: AuctionData = await utils.getAuctionData(auctionId);
    if (!existingData) {
      // somehow we missed prior events, just create the auction data from scratch
      const auctionData: AuctionData = await utils.bscGetCompleteAuctionData(
        auctionId,
        false
      );
      await utils.saveAuctionData(auctionData);
    } else {
      // save bid balance info
      // await utils.saveBidBalance(auctionId, existingData.highestBidder, 0);

      // update changed fields
      existingData.highestBidder = NULL_ADDRESS;
      await utils.saveAuctionData(existingData);
    }
  } catch (e: any) {
    utils.reportError(e, baseMsg);
  }
};
