import Web3 from 'web3';
import { Contract } from 'web3-eth-contract';
import { MARKETPLACE_CONTRACT } from './constants';
import * as MarketplaceABI from './NftMarketplace.json';
import * as utils from './utils';
import * as events from './events';
import * as admin from 'firebase-admin';

export default class Web3Manager {
  private static readonly NAME: string = 'Web3Manager';
  private _web3: Web3;
  private _provider;
  private _contract: Contract;
  private _lastBlockProcessed: number = 0;
  private _maxBatchSize: number = 100;
  private _processing: boolean = false;

  log(msg: string) {
    console.log(Web3Manager.NAME + ': ' + msg);
  }

  error(msg: string) {
    console.error(Web3Manager.NAME + ': ' + msg);
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

    const provider = new Web3.providers.WebsocketProvider(
      'wss://ws-nd-996-979-001.p2pify.com/3360ae26e76ac4763496b5c0818c6265',
      options
    );

    const web3 = new Web3(provider);
    const contract = new web3.eth.Contract(
      MarketplaceABI.abi as any,
      MARKETPLACE_CONTRACT
    );

    return { web3, contract, provider };
  }

  destroyConnection() {}

  constructor() {
    const { web3, contract, provider } = this.initConnection();
    this._web3 = web3;
    this._contract = contract;
    this._provider = provider;

    const db = admin.database();
    db.ref('/lastBlockProcessed').once('value', (data) => {
      this._lastBlockProcessed = data.val();
      this.log('startup, last block processed=' + this._lastBlockProcessed);

      setInterval(async () => this.processInterval(), 5000);
      this.setupListeners();
    });
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
        utils.reportError(
          error,
          Web3Manager.NAME + ':contract error listener',
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
      utils.reportError(
        err,
        Web3Manager.NAME + ':processInterval',
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
      utils.reportError(
        err,
        Web3Manager.NAME + ':processEventBatch',
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
    await events.processList(auctionId);
  }

  async processBid(values) {
    const auctionId = utils.bscParseInt(values.auctionId);
    const amount = utils.bscWeiToFloat(values.amount);
    const highestBidder = values.highestBidder;
    await events.processBid(auctionId, amount, highestBidder);
  }

  async processSold(values) {
    const auctionId: number = utils.bscParseInt(values.auctionId);
    const salesPrice: number = utils.bscWeiToFloat(values.salesPrice);
    const token = values.token;
    const highestBidder = values.highestBidder;

    await events.processSold(auctionId, salesPrice, token, highestBidder);
  }

  async processWithdrawAll(values) {
    const auctionId: number = utils.bscParseInt(values.auctionId);
    const account = values.account;

    await events.processWithdrawAll(auctionId, account);
  }

  async processCloseAuction(values) {
    const auctionId: number = utils.bscParseInt(values.auctionId);
    const highestBidder = values.highestBidder;
    await events.processCloseAuction(auctionId, highestBidder);
  }

  async processEmergencyWithdrawal(values) {
    const auctionId: number = utils.bscParseInt(values.auctionId);
    const highestBidder = values.highestBidder;
    await events.processEmergencyWithdrawal(auctionId, highestBidder);
  }
}
