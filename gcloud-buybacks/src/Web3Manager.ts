import Web3 from 'web3';
import { Contract } from 'web3-eth-contract';
import * as DividendsABI from './common/dividends.json';
import { FINS_DIVIDENDS_CONTRACT, RPC_URL, JAWS_DIVIDENDS_CONTRACT, WEI, FINS_MAX_VAULT_CONTRACT } from './common/constants';

const fs = require('fs');

export default interface Event {

}


export default class Web3Manager {
    private static readonly NAME: string = 'Web3Manager';
    private _web3: Web3;
    private _provider;
    private _dividendsContract: Contract;
    private _finsVaultContract: Contract;
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
  
      var provider = new Web3.providers.WebsocketProvider(
        'wss://ws-nd-996-979-001.p2pify.com/3360ae26e76ac4763496b5c0818c6265',
        options
      ); 

      const dividendsAbi = fs.readFileSync('./src/common/dividends.json', 'utf8');
      const vaultAbi = fs.readFileSync('./src/common/vault.json', 'utf8');

      const web3 = new Web3(provider);
      const divContract = new web3.eth.Contract(
        JSON.parse(dividendsAbi),
        FINS_DIVIDENDS_CONTRACT
      );
      const vaultContract = new web3.eth.Contract(
        JSON.parse(vaultAbi),
        FINS_MAX_VAULT_CONTRACT
      );
  
      return { web3, divContract, vaultContract, provider };
    }
  
    destroyConnection() {}
  
    constructor(intervalMillis: number = 5000, maxBatchSize: number = 100) {
      const { web3, divContract, vaultContract, provider } = this.initConnection();
      this._web3 = web3;
      this._dividendsContract = divContract;
      this._finsVaultContract = vaultContract;
      this._provider = provider;
  
      this._intervalMillis = intervalMillis;
      this._maxBatchSize = maxBatchSize;
  
      // const db = admin.database();
      // db.ref('/lastBlockProcessed').once('value', (data) => {
      //   this._lastBlockProcessed = data.val();
      //   this.log('startup, last block processed=' + this._lastBlockProcessed);
      // });
    }

    async getAmountCompounded() {
        const web3 = this._web3;
        const contract = this._dividendsContract;
        var latestBlock = await web3.eth.getBlockNumber();
        for (let i = 0; i < 6; i++) {
            var options = {fromBlock: latestBlock-5000, toBlock: latestBlock}
            console.log(options);
            var events = await contract.getPastEvents('Compounded', options);
            for (const event of events) {
                console.log(event);
            }
            latestBlock -= 5000;
        }
        //contract.eth.functions()
        return
    }

    async getFinsAPR() {
        const contract = this._dividendsContract;
        let dividendsInfo = await contract.methods.info(FINS_DIVIDENDS_CONTRACT).call();
        return dividendsInfo.poolAPY.bnb / (10 ** 16);
    }

    async getFinsVaultTVL() {
        const contract = this._finsVaultContract;
        let totalShares = await contract.methods.totalSupply().call();
        console.log(totalShares / WEI);
        return totalShares / WEI;
    }
}