import Web3 from 'web3';
import { Contract } from 'web3-eth-contract';
import * as DividendsABI from './common/dividends.json';
import { FINS_DIVIDENDS_CONTRACT, RPC_URL, JAWS_DIVIDENDS_CONTRACT, WEI, FINS_MAX_VAULT_CONTRACT } from './common/constants';
import * as admin from 'firebase-admin';

const fs = require('fs');

export default class Web3Manager {
    private static readonly NAME: string = 'Web3Manager';
    private _web3: Web3;
    private _provider;
    private _dividendsContract: Contract;
    private _finsVaultContract: Contract;
  
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
  
      var provider = new Web3.providers.HttpProvider(
        RPC_URL,
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
  
    constructor() {
      const { web3, divContract, vaultContract, provider } = this.initConnection();
      this._web3 = web3;
      this._dividendsContract = divContract;
      this._finsVaultContract = vaultContract;
      this._provider = provider;
    }

    async getFinsAPR() {
        const contract = this._dividendsContract;
        let dividendsInfo = await contract.methods.info(FINS_DIVIDENDS_CONTRACT).call();
        return dividendsInfo.poolAPY.bnb / (10 ** 16);
    }

    async getFinsVaultBalance() {
        const contract = this._finsVaultContract;
        let totalBalance: number = await contract.methods.balance().call();
        return totalBalance / WEI;
    }
}