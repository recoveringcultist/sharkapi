// common files
import { MARKETPLACE_CONTRACT } from './common/constants';
import * as MarketplaceABI from './common/NftMarketplace.json';
import * as utils from './common/utils';

// other imports
import Web3 from 'web3';
import { Contract } from 'web3-eth-contract';
import * as admin from 'firebase-admin';
import { Logger } from '@google-cloud/logging-bunyan/build/src/middleware/express';

export default class Web3Manager {
  private static readonly NAME: string = 'Web3Manager';
  private _web3: Web3;
  private _provider;
  private _contract: Contract;
  private _lastBlockProcessed: number = 0;
  private _maxBatchSize: number;
  private _processing: boolean = false;
  private _intervalMillis: number;

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

  constructor(intervalMillis: number = 5000, maxBatchSize: number = 100) {
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
    // });
  }

  // async doStuff() {
  //   const auction = await this.contractCall('auctions', [1]);
  //   console.log(auction);
  // }

  async contractCall(
    fnName: string,
    args?: any[],
    retries: number = 2,
    logger?: Logger
  ) {
    while (retries >= 0) {
      try {
        console.info(
          `contractCall:${fnName}: args=${JSON.stringify(
            args
          )}, retries=${retries}`
        );

        let result = await (this._contract.methods[fnName] as Function)
          .apply(this._contract.methods, args)
          .call();
        return result;
      } catch (err: any) {
        utils.reportError(
          err,
          'contractCall:' + fnName,
          `args=${JSON.stringify(args)}, retries=${retries}`,
          logger
        );
        retries--;
        if (retries >= 0) {
          // refresh web3 connection on error
          this.refreshConnection();
        }
      }
    }
    throw new Error(
      'contractCall:' + fnName + ', failed. args: ' + JSON.stringify(args)
    );
  }

  refreshConnection() {
    this.log('re-establishing web3 connection');
    this.destroyConnection();
    const { web3, contract, provider } = this.initConnection();
    this._web3 = web3;
    this._contract = contract;
    this._provider = provider;
  }
}
