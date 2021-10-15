// common files
import {
  MARKETPLACE_CONTRACT,
  NULL_ADDRESS,
  RPC_URL,
  WEBSOCKET_NODE,
} from '../../gcloud/src/common/constants';
import * as MarketplaceABI from '../../gcloud/src/common/NftMarketplace.json';
import * as utils from '../../gcloud/src/common/utils';

// other imports
import Web3 from 'web3';
import { Contract } from 'web3-eth-contract';
import * as admin from 'firebase-admin';
import { Logger } from '@google-cloud/logging-bunyan/build/src/middleware/express';
import { AuctionData } from '../../gcloud/src/common/AuctionData';

export default class Web3Crawler {
  private static readonly NAME: string = 'Web3Crawler';
  private _web3: Web3;
  private _provider;
  private _contract: Contract;
  private _lastBlockProcessed: number = 0;
  private _maxBatchSize: number;
  private _processing: boolean = false;
  private _intervalMillis: number;
  private _intervalHandle;
  private _logger: Logger;

  log(msg: string) {
    if (this._logger) {
      this._logger.info(Web3Crawler.NAME + ': ' + msg);
    } else {
      console.info(Web3Crawler.NAME + ': ' + msg);
    }
  }

  error(msg: string) {
    if (this._logger) {
      this._logger.error(Web3Crawler.NAME + ': ' + msg);
    } else {
      console.error(Web3Crawler.NAME + ': ' + msg);
    }
  }

  reportError(err: any, baseMsg?: string, postMsg?: string): string {
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
    if (this._logger) {
      this._logger.error(output);
    } else {
      console.error(output);
    }

    return output;
  }

  initConnection() {
    const options = {
      timeout: 30000, // ms

      // Useful for credentialed urls, e.g: ws://username:password@localhost:8546
      // headers: {
      //   authorization: 'Basic username:password'
      // },

      clientConfig: {
        // Useful if requests are large
        // maxReceivedFrameSize: 100000000,   // bytes - default: 1MiB
        // maxReceivedMessageSize: 100000000, // bytes - default: 8MiB

        // Useful to keep a connection alive
        keepalive: true,
        keepaliveInterval: 60000, // ms
      },

      // Enable auto reconnection
      reconnect: {
        auto: true,
        delay: 5000, // ms
        maxAttempts: 5,
        onTimeout: false,
      },
    };

    // const provider = new Web3.providers.WebsocketProvider(
    //   WEBSOCKET_NODE,
    //   options
    // );

    const provider = new Web3.providers.HttpProvider(RPC_URL, options);

    const web3 = new Web3(provider);
    const contract = new web3.eth.Contract(
      MarketplaceABI.abi as any,
      MARKETPLACE_CONTRACT
    );

    return { web3, contract, provider };
  }

  destroyConnection() {}

  constructor(
    logger?: Logger,
    intervalMillis: number = 5000,
    maxBatchSize: number = 100
  ) {
    this._logger = logger;

    logger.info('Web3Crawler created');

    const { web3, contract, provider } = this.initConnection();
    this._web3 = web3;
    this._contract = contract;
    this._provider = provider;

    this._intervalMillis = intervalMillis;
    this._maxBatchSize = maxBatchSize;

    // const db = admin.database();
    // db.ref('/lastBlockProcessed').once('value', (data) => {
    //   this._lastBlockProcessed = data.val();
    //   this.log('startup, last block processed=' + this._lastBlockProcessed);

    //   setInterval(async () => this.processInterval(), this._intervalMillis);
    //   this.setupListeners();
    // });
  }

  /**
   * start crawling blockchain events
   */
  async start() {
    if (this._intervalHandle) {
      clearInterval(this._intervalHandle);
      this._intervalHandle = null;
    }

    const db = admin.database();
    const data = await db.ref('/lastBlockProcessed').once('value');
    this._lastBlockProcessed = data.val();
    this.log('startup, last block processed=' + this._lastBlockProcessed);

    this._intervalHandle = setInterval(
      async () => this.processInterval(),
      this._intervalMillis
    );
    this.setupListeners();
  }

  /**
   * stop crawling blockchain events
   */
  async stop() {
    if (this._intervalHandle) {
      clearInterval(this._intervalHandle);
      this._intervalHandle = null;
    }
  }

  setupListeners() {
    this._contract.events
      .allEvents()
      .on('connected', (subscriptionId) => {
        this.log('connected: ' + subscriptionId);
      })
      .on('data', (event) => {
        this.log('listener got data event ' + event.event);
        // this.processEvent(event);
        // this.log(
        //   'data: ' +
        //     event.event +
        //     ', ' +
        //     event.blockNumber +
        //     ', returned: ' +
        //     JSON.stringify(event.returnValues)
        // );
      })
      .on('changed', (event) => {
        // remove event from local database
        this.log('changed: ' + JSON.stringify(event));
      })
      .on('error', (error, receipt) => {
        // If the transaction was rejected by the network with a receipt, the second parameter will be the receipt.
        this.reportError(
          error,
          Web3Crawler.NAME + ':contract error listener',
          JSON.stringify(error) + '\n' + JSON.stringify(receipt)
        );
      });
  }

  async processInterval() {
    const web3 = this._web3;
    try {
      if (this._processing) {
        this.log('already processing');
        return;
      }

      this._processing = true;

      // process a batch of events
      const startBlock = this._lastBlockProcessed + 1;
      const currentBlock = await web3.eth.getBlockNumber();
      let endBlock = currentBlock;
      let numBlocks = endBlock - startBlock + 1;
      const blocksLeft = currentBlock - startBlock;

      this.log(`processInterval: ${blocksLeft} blocks behind current`);

      if (numBlocks > this._maxBatchSize) {
        // divide it up into multiple batches
        endBlock = startBlock + this._maxBatchSize - 1;
        numBlocks = endBlock - startBlock + 1;
      }

      // this.log('current block: ' + currentBlock);
      await this.processEventBatch(startBlock, endBlock, currentBlock);
    } catch (err: any) {
      this.reportError(
        err,
        Web3Crawler.NAME + ':processInterval',
        JSON.stringify(err)
      );

      // re-instantiate web3 on error
      this.log('re-establishing web3 connection');
      this.destroyConnection();
      const { web3, contract, provider } = this.initConnection();
      this._web3 = web3;
      this._contract = contract;
      this._provider = provider;
    } finally {
      this._processing = false;
    }
  }

  async processEventBatch(startBlock, endBlock, currentBlock) {
    try {
      const numBlocks = endBlock - startBlock + 1;

      if (numBlocks > 0) {
        this.log(
          `getting events for ${numBlocks} blocks: ${startBlock} to ${endBlock}`
        );

        const events = await this._contract.getPastEvents('allEvents', {
          fromBlock: startBlock,
          toBlock: endBlock,
        });
        if (events.length > 0) {
          this.log(`pastEvents found ${events.length} events`);
          for (const e of events) {
            await this.processEvent(e);
          }
        }
        this._lastBlockProcessed = endBlock;
        const db = admin.database();
        await db
          .ref('/lastBlockProcessed')
          .set(this._lastBlockProcessed, (err) => {
            if (err) throw err;
          });

        const blocksLeft = currentBlock - endBlock;
        this.log(
          `last block processed=${this._lastBlockProcessed}, ${blocksLeft} blocks remain`
        );
      } else {
        this.log(`waiting for block ${startBlock}`);
      }
    } catch (err: any) {
      this.reportError(
        err,
        Web3Crawler.NAME + ':processEventBatch',
        `block ${startBlock} to ${endBlock}`
      );
    }
  }

  async processEvent(e) {
    this.log(
      e.event +
        ', ' +
        e.blockNumber +
        ', returned: ' +
        JSON.stringify(e.returnValues)
    );

    const values = e.returnValues;

    switch (e.event) {
      case 'List':
        await this.processList(values);
        break;
      case 'Bid':
        await this.processBid(values);
        break;
      case 'Sold':
        await this.processSold(values);
        break;
      case 'WithdrawAll':
        await this.processWithdrawAll(values);
        break;
      case 'CloseAuction':
        await this.processCloseAuction(values);
        break;
      case 'EmergencyWithdrawal':
        await this.processEmergencyWithdrawal(values);
        break;
    }
  }

  async processList(values) {
    const auctionId = utils.bscParseInt(values.auctionId);
    // await crawler.processList(auctionId);

    const baseMsg = `processList ${auctionId}`;
    this.log(baseMsg);

    try {
      // create data from scratch
      const auctionData: AuctionData = await utils.bscGetCompleteAuctionData(
        auctionId,
        true,
        this._logger
      );

      // save to database
      await utils.saveAuctionData(auctionData);
    } catch (e: any) {
      this.reportError(e, baseMsg);
    }
  }

  async processBid(values) {
    const auctionId = utils.bscParseInt(values.auctionId);
    const amount = utils.bscWeiToFloat(values.amount);
    const highestBidder = values.highestBidder;

    let baseMsg = `processBid ${auctionId}`;
    this.log(baseMsg + `: amount: ${amount}, bidder: ${highestBidder}`);

    try {
      // first, see if this auction exists in the db
      const existingData: AuctionData = await utils.getAuctionData(auctionId);
      if (!existingData) {
        // load the auction data from scratch, we obviously missed the list event
        const auctionData: AuctionData = await utils.bscGetCompleteAuctionData(
          auctionId,
          false,
          this._logger
        );
        await utils.saveAuctionData(auctionData);
      } else {
        // update changed fields
        existingData.highestBidder = highestBidder;
        existingData.highestBid = await utils.bscGetBidBalance(
          auctionId,
          highestBidder
        );

        // update the auction's endTime, some bids extend it
        const freshData = await utils.bscGetAuction(auctionId);
        existingData.endTime = freshData.endTime;

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
      this.reportError(e, baseMsg);
    }
  }

  async processSold(values) {
    const auctionId: number = utils.bscParseInt(values.auctionId);
    const salesPrice: number = utils.bscWeiToFloat(values.salesPrice);
    const token = values.token;
    const highestBidder = values.highestBidder;

    // await crawler.processSold(auctionId, salesPrice, token, highestBidder);

    const baseMsg = `processSold ${auctionId}`;

    this.log(
      `${baseMsg}: salesPrice: ${salesPrice}, token: ${token}, highestBidder: ${highestBidder}`
    );

    try {
      const existingData: AuctionData = await utils.getAuctionData(auctionId);
      if (!existingData) {
        // somehow we missed prior events, just create the auction data from scratch
        const auctionData: AuctionData = await utils.bscGetCompleteAuctionData(
          auctionId,
          false,
          this._logger
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
      this.reportError(e, baseMsg);
    }
  }

  async processWithdrawAll(values) {
    const auctionId: number = utils.bscParseInt(values.auctionId);
    const account = values.account;

    // await crawler.processWithdrawAll(auctionId, account);

    const baseMsg = `processWithdrawAll ${auctionId}, ${account}`;

    this.log(baseMsg);
    await utils.refreshUserBids(account);
  }

  async processCloseAuction(values) {
    const auctionId: number = utils.bscParseInt(values.auctionId);
    const highestBidder = values.highestBidder;
    // await crawler.processCloseAuction(auctionId, highestBidder);

    const baseMsg = `processCloseAuction ${auctionId}`;
    this.log(baseMsg + `: highestBidder: ${highestBidder}`);

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
          false,
          this._logger
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
      this.reportError(e, baseMsg);
    }
  }

  async processEmergencyWithdrawal(values) {
    const auctionId: number = utils.bscParseInt(values.auctionId);
    const highestBidder = values.highestBidder;
    // await crawler.processEmergencyWithdrawal(auctionId, highestBidder);

    const baseMsg = `event: EmergencyWithdrawal ${auctionId}`;
    this.log(baseMsg);

    try {
      // refresh user's bids
      await utils.refreshUserBids(highestBidder);

      const existingData: AuctionData = await utils.getAuctionData(auctionId);
      if (!existingData) {
        // somehow we missed prior events, just create the auction data from scratch
        const auctionData: AuctionData = await utils.bscGetCompleteAuctionData(
          auctionId,
          false,
          this._logger
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
      this.reportError(e, baseMsg);
    }
  }
}
