import { Logger } from '@google-cloud/logging-bunyan/build/src/middleware/express';
import * as admin from 'firebase-admin';
import Web3Manager from './Web3Manager'
import { CAKE_APEX_VAULT_CONTRACT, EXCHANGE_SUBGRAPH_URL, WEI } from './common/constants';

const axios = require('axios');


const w3 = new Web3Manager();
//w3.amountCompounded();

w3.getFinsVaultTVL();


export const createBuybackRoutes = (app, log) => {
  app.get('/buybacks', log, sampleRoute);
};

const sampleRoute = async (req, res, next) => {
  const logger: Logger = (req as any).log;

  // database reference
  const firestore = admin.firestore();



  logger.info('buybacks sample route called');
  res.send('buybacks sample route');
};

/**
 * get USD value of CAKE swapped to FINS from the CAKE vault
 * @returns The total USD value
 */
async function getUSDSwappedFromCake() {
  const timeNow = Math.round(Date.now() / 1000)
  var query: String = `
            query Swap {
              swaps(first: 1000, where: {timestamp_gte: ${timeNow - 86400}, to: "${CAKE_APEX_VAULT_CONTRACT}"}) {
                  pair {
                    token0 {
                      symbol
                    }
                    token1 {
                      symbol
                    }
                  }
                  transaction {
                    id
                  }
                  sender
                  from
                  to
                  amountUSD
                }
            }`
    let data = await axios.post(EXCHANGE_SUBGRAPH_URL, {query: query});
    let total = 0;
    let swaps = data.data.data.swaps;
    for (const swap of swaps) {
      let swapAmount = Number(swap.amountUSD);
      total += swapAmount;
    }
    return total;
}

/* 
async function getFinsDailyAPR() {
  let finsAPR = await w3.getFinsAPR();
  let dailyROI = finsAPR / 365;
  var query: String = `
            query Token {
              tokens(where: {symbol: "FINS"}) {
                  derivedUSD
            }
          }`
  let data = await axios.post(EXCHANGE_SUBGRAPH_URL, {query: query});
  console.log(data.data);
  let finsPrice = data.data.data.tokens[0].derivedUSD;
  let dailyReturn = dailyROI * 28800 * finsPrice;
  console.log(dailyReturn);
  return dailyReturn;
} */

async function getVaultTotalBuyback(amount: number) {
  let finsAPR = await w3.getFinsAPR();
  let dailyROI = finsAPR / 365;
  console.log(dailyROI);
  let total = amount + (dailyROI * amount);
  console.log(total);
}

