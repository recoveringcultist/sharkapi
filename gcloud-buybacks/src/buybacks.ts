import { Logger } from '@google-cloud/logging-bunyan/build/src/middleware/express';
import * as admin from 'firebase-admin';
import Web3Manager from './Web3Manager'
import { CAKE_APEX_VAULT_CONTRACT, EXCHANGE_SUBGRAPH_URL, WEI } from './common/constants';

const axios = require('axios');

var finsCoreBuybacks = 0;
var cakeApexBuybacks = 0;
var lastRefresh = 0;

const w3 = new Web3Manager();

getData();

export const createBuybackRoutes = (app, log) => {
  app.get('/buybacks', log, buybacksRoute);
};

const buybacksRoute = async (req, res, next) => {
  const logger: Logger = (req as any).log;

  // database reference
  const firestore = admin.firestore();

  if (Date.now() / 1000 >= 43200) {
    getData();
  }

  let buybacks = {
    "finsCore": finsCoreBuybacks,
    "cakeApex": cakeApexBuybacks 
  }

  logger.info('buybacks route called');
  res.json(buybacks);
};

async function getData() {
  getFinsCoreVaultBuybacks();
  getCakeApexVaultBuybacks();
  lastRefresh = Date.now() / 1000;
}

async function getFinsCoreVaultBuybacks() {
  let tvl = await getFinsVaultTVL();
  let totalBuyback = await getFinsCoreVaultTotalBuyback(tvl);
  finsCoreBuybacks = totalBuyback;
}

async function getCakeApexVaultBuybacks() {
  let usdFromCake = await getUSDSwappedFromCake();
  let totalBuyback = await getCakeVaultTotalBuyback(usdFromCake);
  cakeApexBuybacks = totalBuyback;
}


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
                  id
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
      if (swap.id.includes("-1")) {
        let swapAmount = Number(swap.amountUSD);
        total += swapAmount;
      }
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

async function getFinsVaultTVL() {
  let totalTokens = await w3.getFinsVaultBalance();
  var query: String = `
            query Token {
              tokens(where: {symbol: "FINS"}) {
                  derivedUSD
                }
            }`
  let data = await axios.post(EXCHANGE_SUBGRAPH_URL, {query: query});
  let price = data.data.data.tokens[0].derivedUSD;
  return totalTokens * price;
}

async function getFinsCoreVaultTotalBuyback(tvl: number) {
  let finsAPR = await w3.getFinsAPR();
  let dailyROI = finsAPR / 365;
  return tvl * (dailyROI / 100);
}

async function getCakeVaultTotalBuyback(amount: number) {
  let finsAPR = await w3.getFinsAPR();
  let dailyROI = finsAPR / 365;
  let total = amount + (dailyROI * (amount / 1000));
  return total
}

