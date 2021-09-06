import { Contract } from 'ethers';
import Web3 from 'web3';
import { AuctionData } from './AuctionData';
import * as utils from './utils';

/**
 * listen for events from the blockchain
 */
export const registerForEvents = () => {
  const marketplace = utils.getMarketplaceContract();

  console.log('registering for blockchain events');

  marketplace.on('Bid', async (auctionId_, amount_, highestBidder) => {
    const auctionId: number = parseInt(auctionId_.toString());
    let amount = parseFloat(Web3.utils.fromWei(amount_.toString(), 'ether'));
    console.log(
      `event: bid: auctionId: ${auctionId}, amount: ${amount}, bidder: ${highestBidder}`
    );

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
          utils.getMarketplaceContract(),
          auctionId,
          highestBidder
        );
        await utils.saveAuctionData(existingData);
      }

      // save bid balance info
      await utils.saveBidBalance(auctionId, highestBidder, amount);

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
      console.error('event: bid: error encountered');
      console.error(e.message + '\n' + e.stack);
    }
  });

  // new auction listed
  marketplace.on('List', async (auctionId_) => {
    const auctionId: number = parseInt(auctionId_.toString());
    console.log(`event: list: auctionId: ${auctionId}`);

    try {
      // create data from scratch
      const auctionData: AuctionData = await utils.bscGetCompleteAuctionData(
        auctionId,
        false
      );

      // save to database
      await utils.saveAuctionData(auctionData);
    } catch (e: any) {
      console.error('event: list: error encountered');
      console.error(e.message + '\n' + e.stack);
    }
  });

  // sold event
  marketplace.on(
    'Sold',
    async (auctionId_, salesPrice_, token, highestBidder) => {
      const auctionId: number = parseInt(auctionId_.toString());
      const salesPrice: number = parseInt(salesPrice_.toString());
      console.log(
        `event: sold: auctionId: ${auctionId}, salesPrice: ${salesPrice}, token: ${token}, highestBidder: ${highestBidder}`
      );

      try {
        const existingData: AuctionData = await utils.getAuctionData(auctionId);
        if (!existingData) {
          // somehow we missed prior events, just create the auction data from scratch
          const auctionData: AuctionData =
            await utils.bscGetCompleteAuctionData(auctionId, false);
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

        // save bid balance info
        await utils.saveBidBalance(auctionId, highestBidder, 0);
      } catch (e: any) {
        console.error('event: sold: error encountered');
        console.error(e.message + '\n' + e.stack);
      }
    }
  );

  marketplace.on('WithdrawAll', async (auctionId_, account) => {
    const auctionId: number = parseInt(auctionId_.toString());
    console.log(`event: withdrawall, auctionId: ${auctionId}`);
  });

  marketplace.on('CloseAuction', async (auctionId_, highestBidder) => {
    const auctionId: number = parseInt(auctionId_.toString());
    console.log(`event: closeauction, auctionId: ${auctionId}`);

    try {
      const existingData: AuctionData = await utils.getAuctionData(auctionId);
      if (!existingData) {
        // somehow we missed prior events, just create the auction data from scratch
        const auctionData: AuctionData = await utils.bscGetCompleteAuctionData(
          auctionId,
          false
        );
        await utils.saveAuctionData(auctionData);
        // can't save bid balance info in this case...
      } else {
        // save bid balance info
        await utils.saveBidBalance(auctionId, existingData.highestBidder, 0);

        // update changed fields
        existingData.isSettled = true;
        existingData.highestBidder = utils.NULL_ADDRESS;
        existingData.highestBid = 0;
        await utils.saveAuctionData(existingData);
      }
    } catch (e: any) {
      console.error('event: closeauction: error encountered');
      console.error(e.message + '\n' + e.stack);
    }
  });

  marketplace.on('EmergencyWithdrawal', async (auctionId_) => {
    const auctionId: number = parseInt(auctionId_.toString());
    console.log(`event: emergencywithrawal, auctionId: ${auctionId}`);

    try {
      const existingData: AuctionData = await utils.getAuctionData(auctionId);
      if (!existingData) {
        // somehow we missed prior events, just create the auction data from scratch
        const auctionData: AuctionData = await utils.bscGetCompleteAuctionData(
          auctionId,
          false
        );
        await utils.saveAuctionData(auctionData);

        // can't save bid balance in this case
      } else {
        // save bid balance info
        await utils.saveBidBalance(auctionId, existingData.highestBidder, 0);

        // update changed fields
        existingData.highestBidder = utils.NULL_ADDRESS;
        await utils.saveAuctionData(existingData);
      }
    } catch (e: any) {
      console.error('event: emergencywithdrawal: error encountered');
      console.error(e.message + '\n' + e.stack);
    }
  });
};
